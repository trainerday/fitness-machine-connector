/**
 * Mac BLE Backend
 *
 * FTMS GATT peripheral for macOS using @stoprocent/bleno.
 * Mirrors the behaviour of FTMSBluetoothForwarderWindows (the C# backend)
 * but runs in-process inside the Electron main process.
 *
 * Implements:
 *   - Fitness Machine Service (0x1826)
 *       Feature              (0x2ACC)  Read
 *       Indoor Bike Data     (0x2AD2)  Notify
 *       Supported Power Range(0x2AD8)  Read
 *       Supported Resistance (0x2AD6)  Read
 *       Control Point        (0x2AD9)  Write + Indicate
 *       FTMS Status          (0x2ADA)  Notify
 *   - Heart Rate Service     (0x180D)
 *       HR Measurement       (0x2A37)  Notify
 */

import { EventEmitter } from 'events';
import { BroadcasterStatus, FitnessData } from './bluetooth-broadcaster';
import { FtmsOutput } from '../shared/types/fitness-data';

// ─── FTMS packet builder ──────────────────────────────────────────────────────

function buildIndoorBikeData(power: number, cadence: number, heartRate: number): Buffer {
  // Flags: bit 2 = cadence present, bit 6 = power present, bit 9 = HR present
  let flags = (1 << 2) | (1 << 6);
  const hasHr = heartRate > 0;
  if (hasHr) flags |= (1 << 9);

  const buf = Buffer.alloc(hasHr ? 9 : 8);
  buf.writeUInt16LE(flags, 0);
  buf.writeUInt16LE(0, 2);                               // instantaneous speed = 0
  buf.writeUInt16LE(Math.max(0, Math.round(cadence * 2)), 4); // 0.5 rpm resolution
  buf.writeInt16LE(Math.max(0, power), 6);               // watts (signed)
  if (hasHr) buf.writeUInt8(Math.min(255, heartRate), 8);
  return buf;
}

function buildFeature(): Buffer {
  // Bit 1: Cadence, Bit 10: Heart Rate, Bit 14: Power
  const features = (1 << 1) | (1 << 10) | (1 << 14);
  const buf = Buffer.alloc(8);
  buf.writeUInt32LE(features, 0);
  buf.writeUInt32LE(0, 4); // no target settings
  return buf;
}

function buildPowerRange(): Buffer {
  const buf = Buffer.alloc(6);
  buf.writeUInt16LE(0, 0);    // min 0W
  buf.writeUInt16LE(2000, 2); // max 2000W
  buf.writeUInt16LE(1, 4);    // step 1W
  return buf;
}

function buildResistanceRange(): Buffer {
  const buf = Buffer.alloc(6);
  buf.writeInt16LE(0, 0);   // min 0
  buf.writeInt16LE(100, 2); // max 100
  buf.writeInt16LE(1, 4);   // step 1
  return buf;
}

// ─── Characteristic factories ─────────────────────────────────────────────────

function makeReadChar(bleno: any, uuid: string, value: Buffer): any {
  return new bleno.Characteristic({ uuid, properties: ['read'], value });
}

function makeNotifyChar(bleno: any, uuid: string): any {
  const char = new bleno.Characteristic({ uuid, properties: ['notify'] });
  char._cb = null;
  char.onSubscribe = (_max: number, cb: (buf: Buffer) => void) => { char._cb = cb; };
  char.onUnsubscribe = () => { char._cb = null; };
  return char;
}

function makeControlPointChar(bleno: any, onLog: (m: string) => void): any {
  const char = new bleno.Characteristic({
    uuid: '2ad9',
    properties: ['write', 'indicate'],
  });
  char._cb = null;
  char.onSubscribe = (_max: number, cb: (buf: Buffer) => void) => { char._cb = cb; };
  char.onUnsubscribe = () => { char._cb = null; };
  char.onWriteRequest = (data: Buffer, _offset: number, _withoutResponse: boolean, callback: (r: number) => void) => {
    if (data.length === 0) { callback(bleno.Characteristic.RESULT_SUCCESS); return; }
    const opCode = data[0];
    onLog(`[MacBLE] Control point op: 0x${opCode.toString(16)}`);
    // Respond with success for all known op codes
    const response = Buffer.from([0x80, opCode, 0x01]);
    if (char._cb) char._cb(response);
    callback(bleno.Characteristic.RESULT_SUCCESS);
  };
  return char;
}

// ─── Mac BLE Backend ──────────────────────────────────────────────────────────

export class MacBleBackend extends EventEmitter {
  private bleno: any = null;
  private status: BroadcasterStatus = { state: 'stopped' };
  private isBroadcasting = false;
  private currentData = { power: 0, cadence: 0, heartRate: 0 };
  private notifyInterval: NodeJS.Timeout | null = null;
  private bikeDataChar: any = null;
  private hrChar: any = null;
  private started = false;

  constructor() {
    super();
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      this.bleno = require('@stoprocent/bleno');
      console.log('[MacBLE] bleno loaded successfully');
    } catch (e) {
      console.error('[MacBLE] Failed to load bleno:', e);
    }
  }

  start(): void {
    if (this.started) return;
    this.started = true;

    if (!this.bleno) {
      this.status = { state: 'error', error: 'bleno not available' };
      this.emit('status', this.status);
      return;
    }

    this.bleno.on('stateChange', (state: string) => {
      console.log('[MacBLE] State:', state);
    });

    console.log('[MacBLE] Backend ready');
    this.emit('ready', {});
  }

  startBroadcast(): void {
    if (!this.bleno || this.isBroadcasting) return;
    this.isBroadcasting = true;
    this.status = { state: 'starting' };
    this.emit('status', this.status);

    const doAdvertise = () => {
      this.bleno.stopAdvertising();

      // Build characteristics
      this.bikeDataChar = makeNotifyChar(this.bleno, '2ad2');
      this.hrChar = makeNotifyChar(this.bleno, '2a37');
      const statusChar = makeNotifyChar(this.bleno, '2ada');

      const ftmsService = new this.bleno.PrimaryService({
        uuid: '1826',
        characteristics: [
          makeReadChar(this.bleno, '2acc', buildFeature()),
          this.bikeDataChar,
          makeReadChar(this.bleno, '2ad8', buildPowerRange()),
          makeReadChar(this.bleno, '2ad6', buildResistanceRange()),
          makeControlPointChar(this.bleno, (m) => this.emit('log', m)),
          statusChar,
        ],
      });

      const hrService = new this.bleno.PrimaryService({
        uuid: '180d',
        characteristics: [this.hrChar],
      });

      this.bleno.setServices([ftmsService, hrService], (err: any) => {
        if (err) console.error('[MacBLE] setServices error:', err);
      });

      this.bleno.startAdvertising('TD Bike', ['1826', '180d'], (err: any) => {
        if (err) {
          console.error('[MacBLE] startAdvertising error:', err);
          this.status = { state: 'error', error: String(err) };
          this.emit('status', this.status);
          this.isBroadcasting = false;
          return;
        }
        console.log('[MacBLE] Advertising as "TD Bike"');
        this.status = { state: 'advertising' };
        this.emit('status', this.status);
        this.emit('log', 'FTMS broadcasting started (macOS)');

        // Send data notifications every second
        this.notifyInterval = setInterval(() => this.sendNotifications(), 1000);
      });
    };

    // Wait for powered-on state, or start immediately if already on
    this.bleno.removeAllListeners('stateChange');
    this.bleno.on('stateChange', (state: string) => {
      console.log('[MacBLE] State:', state);
      if (state === 'poweredOn') doAdvertise();
      else if (state === 'poweredOff') {
        this.status = { state: 'error', error: 'Bluetooth is off' };
        this.emit('status', this.status);
      }
    });

    this.bleno.on('accept', (clientAddress: string) => {
      console.log('[MacBLE] Client connected:', clientAddress);
      this.status = { state: 'connected', clientAddress };
      this.emit('status', this.status);
    });

    this.bleno.on('disconnect', (clientAddress: string) => {
      console.log('[MacBLE] Client disconnected:', clientAddress);
      this.status = { state: 'advertising' };
      this.emit('status', this.status);
    });

    if (this.bleno.state === 'poweredOn') doAdvertise();
  }

  private sendNotifications(): void {
    const { power, cadence, heartRate } = this.currentData;

    if (this.bikeDataChar?._cb) {
      this.bikeDataChar._cb(buildIndoorBikeData(power, cadence, heartRate));
    }

    if (heartRate > 0 && this.hrChar?._cb) {
      this.hrChar._cb(Buffer.from([0x00, Math.min(255, heartRate)]));
    }
  }

  stopBroadcast(): void {
    if (!this.bleno || !this.isBroadcasting) return;
    this.isBroadcasting = false;

    if (this.notifyInterval) {
      clearInterval(this.notifyInterval);
      this.notifyInterval = null;
    }

    this.bleno.stopAdvertising();
    this.status = { state: 'stopped' };
    this.emit('status', this.status);
    this.emit('log', 'FTMS broadcasting stopped');
  }

  sendData(data: FtmsOutput): void {
    this.currentData = {
      power: data.power ?? 0,
      cadence: data.cadence ?? 0,
      heartRate: data.heartRate ?? 0,
    };
  }

  disconnect(): void {
    // No persistent connection to drop on the broadcaster side
  }

  stop(): void {
    this.stopBroadcast();
    if (this.bleno) {
      this.bleno.removeAllListeners();
    }
    this.started = false;
  }

  isRunning(): boolean {
    return this.started;
  }

  getStatus(): BroadcasterStatus {
    return this.status;
  }

  // Scanning is handled by Web Bluetooth on Mac — these are no-ops
  scan(_duration?: number): void {}
  stopScan(): void {}
  connect(_deviceId: string, _deviceName?: string): void {}
  setAutoReconnect(_enabled: boolean, _deviceId?: string, _deviceName?: string): void {}
  isScanningDevices(): boolean { return false; }
  getConnectedDevice(): null { return null; }
}
