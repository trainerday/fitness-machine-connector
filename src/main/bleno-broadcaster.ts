/**
 * Bleno-based FTMS Broadcaster for macOS/Linux
 * Uses the @abandonware/bleno library for native BLE peripheral support.
 * This provides much better stability than the Python bless library on these platforms.
 */

import { EventEmitter } from 'events';
import { FtmsOutput } from '../shared/types/fitness-data';

// Conditionally require bleno - it's not available on Windows
let bleno: any = null;
try {
  bleno = require('@abandonware/bleno');
} catch (e) {
  console.log('Bleno not available on this platform');
}

// FTMS Service and Characteristic UUIDs
const FITNESS_MACHINE_SERVICE_UUID = '1826';
const INDOOR_BIKE_DATA_UUID = '2AD2';
const FITNESS_MACHINE_FEATURE_UUID = '2ACC';
const FITNESS_MACHINE_CONTROL_POINT_UUID = '2AD9';

const DEVICE_NAME = 'TD Bike';

export interface BroadcasterStatus {
  state: 'stopped' | 'starting' | 'advertising' | 'connected' | 'error';
  deviceName?: string;
  clientAddress?: string;
  error?: string;
}

/**
 * Indoor Bike Data Characteristic
 * Notifies subscribers with power, cadence, speed, and heart rate data
 */
class IndoorBikeDataCharacteristic {
  public uuid: string;
  public properties: string[];
  public descriptors: any[];

  private _updateInterval: ReturnType<typeof setInterval> | null = null;
  private _subscribers: ((data: Buffer) => void)[] = [];
  private _currentData: FtmsOutput = { power: 0, cadence: 0 };
  private _onSubscribe: (() => void) | null = null;
  private _onUnsubscribe: (() => void) | null = null;

  constructor() {
    this.uuid = INDOOR_BIKE_DATA_UUID;
    this.properties = ['notify'];
    this.descriptors = [];
  }

  setCallbacks(onSubscribe: () => void, onUnsubscribe: () => void) {
    this._onSubscribe = onSubscribe;
    this._onUnsubscribe = onUnsubscribe;
  }

  onSubscribe(maxValueSize: number, updateValueCallback: (data: Buffer) => void) {
    console.log('Client subscribed to Indoor Bike Data');
    this._subscribers.push(updateValueCallback);

    if (this._subscribers.length === 1) {
      this._startUpdates();
      if (this._onSubscribe) this._onSubscribe();
    }
  }

  onUnsubscribe() {
    console.log('Client unsubscribed from Indoor Bike Data');
    this._subscribers.pop();

    if (this._subscribers.length === 0) {
      this._stopUpdates();
      if (this._onUnsubscribe) this._onUnsubscribe();
    }
  }

  updateData(data: FtmsOutput) {
    this._currentData = data;
  }

  private _startUpdates() {
    console.log('Starting data updates...');

    // Send updates every 250ms (4Hz as per FTMS spec)
    this._updateInterval = setInterval(() => {
      const buffer = this._buildIndoorBikeData(this._currentData);

      this._subscribers.forEach(callback => {
        callback(buffer);
      });
    }, 250);
  }

  private _stopUpdates() {
    if (this._updateInterval) {
      clearInterval(this._updateInterval);
      this._updateInterval = null;
      console.log('Stopped data updates');
    }
  }

  /**
   * Build Indoor Bike Data characteristic buffer
   *
   * FLAG BITS (Bit 0 is INVERTED!):
   *   Bit 0:  Instantaneous Speed (0 = PRESENT, 1 = not present) - INVERTED!
   *   Bit 2:  Instantaneous Cadence
   *   Bit 6:  Instantaneous Power
   *   Bit 9:  Heart Rate
   */
  private _buildIndoorBikeData(data: FtmsOutput): Buffer {
    const buffer = Buffer.alloc(9);

    // Flags: 0x0244
    //   Bit 0 = 0: Speed IS present (INVERTED LOGIC!)
    //   Bit 2 = 1: Cadence present (0x04)
    //   Bit 6 = 1: Power present (0x40)
    //   Bit 9 = 1: Heart Rate present (0x200)
    const flags = 0x0244;
    buffer.writeUInt16LE(flags, 0);

    // Instantaneous Speed (km/h * 100, resolution 0.01 km/h)
    const speed = Math.round((data.speed || 0) * 100);
    buffer.writeUInt16LE(speed, 2);

    // Instantaneous Cadence (rpm * 2, resolution 0.5 RPM)
    const cadence = Math.round((data.cadence || 0) * 2);
    buffer.writeUInt16LE(cadence, 4);

    // Instantaneous Power (watts, signed int16)
    buffer.writeInt16LE(data.power || 0, 6);

    // Heart Rate (BPM, uint8)
    buffer.writeUInt8(data.heartRate || 0, 8);

    return buffer;
  }
}

/**
 * Fitness Machine Feature Characteristic
 * Describes the capabilities of this fitness machine
 */
class FitnessMachineFeatureCharacteristic {
  public uuid: string;
  public properties: string[];
  public value: Buffer | null;

  constructor() {
    this.uuid = FITNESS_MACHINE_FEATURE_UUID;
    this.properties = ['read'];
    this.value = null;
  }

  onReadRequest(offset: number, callback: (result: number, data: Buffer | null) => void) {
    if (offset) {
      callback(bleno.Characteristic.RESULT_ATTR_NOT_LONG, null);
    } else {
      // Features: Cadence, Power, Heart Rate supported
      const features = Buffer.alloc(8);
      // Fitness Machine Features
      // Bit 1: Cadence Supported
      // Bit 14: Power Measurement Supported
      features.writeUInt32LE(0x00004002, 0);
      // Target Setting Features - none
      features.writeUInt32LE(0x00000000, 4);
      callback(bleno.Characteristic.RESULT_SUCCESS, features);
    }
  }
}

/**
 * FTMS Control Point Characteristic
 * Handles control commands from the app
 */
class FitnessMachineControlPointCharacteristic {
  public uuid: string;
  public properties: string[];
  public value: Buffer | null;

  private _updateValueCallback: ((data: Buffer) => void) | null = null;

  constructor() {
    this.uuid = FITNESS_MACHINE_CONTROL_POINT_UUID;
    this.properties = ['write', 'indicate'];
    this.value = null;
  }

  onSubscribe(maxValueSize: number, updateValueCallback: (data: Buffer) => void) {
    console.log('Client subscribed to Control Point');
    this._updateValueCallback = updateValueCallback;
  }

  onUnsubscribe() {
    console.log('Client unsubscribed from Control Point');
    this._updateValueCallback = null;
  }

  onWriteRequest(
    data: Buffer,
    offset: number,
    withoutResponse: boolean,
    callback: (result: number) => void
  ) {
    if (data.length === 0) {
      callback(bleno.Characteristic.RESULT_SUCCESS);
      return;
    }

    const opCode = data[0];
    console.log(`Control Point command received: 0x${opCode.toString(16)}`);

    // Always respond with success
    callback(bleno.Characteristic.RESULT_SUCCESS);

    // Send indication response
    if (this._updateValueCallback) {
      // Response format: [0x80, request_op_code, result_code]
      const response = Buffer.alloc(3);
      response.writeUInt8(0x80, 0); // Response op code
      response.writeUInt8(opCode, 1); // Request op code
      response.writeUInt8(0x01, 2); // Success
      this._updateValueCallback(response);
    }
  }
}

/**
 * Bleno-based FTMS Broadcaster
 */
export class BlenoBroadcaster extends EventEmitter {
  private status: BroadcasterStatus = { state: 'stopped' };
  private indoorBikeDataChar: IndoorBikeDataCharacteristic | null = null;
  private isSetup = false;
  private pendingStart = false;

  constructor() {
    super();

    if (!bleno) {
      console.error('Bleno is not available on this platform');
      return;
    }

    this.setupBlenoEvents();
  }

  private setupBlenoEvents() {
    bleno.on('stateChange', (state: string) => {
      console.log(`Bluetooth state: ${state}`);

      if (state === 'poweredOn') {
        if (this.pendingStart) {
          this.startAdvertising();
        }
      } else {
        bleno.stopAdvertising();
        if (this.status.state !== 'stopped') {
          this.status = { state: 'stopped' };
          this.emit('status', this.status);
        }
      }
    });

    bleno.on('advertisingStart', (error: Error | null) => {
      if (error) {
        console.error('Advertising error:', error);
        this.status = { state: 'error', error: error.message };
        this.emit('status', this.status);
        return;
      }

      console.log('Advertising started');
      this.setupServices();
    });

    bleno.on('accept', (clientAddress: string) => {
      console.log(`Client connected: ${clientAddress}`);
      this.status = {
        state: 'connected',
        deviceName: DEVICE_NAME,
        clientAddress,
      };
      this.emit('status', this.status);
    });

    bleno.on('disconnect', (clientAddress: string) => {
      console.log(`Client disconnected: ${clientAddress}`);
      if (this.status.state === 'connected') {
        this.status = {
          state: 'advertising',
          deviceName: DEVICE_NAME,
        };
        this.emit('status', this.status);
      }
    });
  }

  private startAdvertising() {
    console.log('Starting advertising...');
    bleno.startAdvertising(DEVICE_NAME, [FITNESS_MACHINE_SERVICE_UUID]);
  }

  private setupServices() {
    // Create characteristics
    this.indoorBikeDataChar = new IndoorBikeDataCharacteristic();

    // Set up subscription callbacks
    this.indoorBikeDataChar.setCallbacks(
      () => {
        this.emit('log', 'Client subscribed to bike data');
      },
      () => {
        this.emit('log', 'Client unsubscribed from bike data');
      }
    );

    // Create bleno characteristic wrappers
    const BlenoCharacteristic = bleno.Characteristic;

    const bikeDataChar = new BlenoCharacteristic({
      uuid: INDOOR_BIKE_DATA_UUID,
      properties: ['notify'],
      onSubscribe: this.indoorBikeDataChar.onSubscribe.bind(this.indoorBikeDataChar),
      onUnsubscribe: this.indoorBikeDataChar.onUnsubscribe.bind(this.indoorBikeDataChar),
    });

    const featureChar = new BlenoCharacteristic({
      uuid: FITNESS_MACHINE_FEATURE_UUID,
      properties: ['read'],
      onReadRequest: (offset: number, callback: (result: number, data: Buffer | null) => void) => {
        // Features: Average Speed Supported (matching working emulator)
        const features = Buffer.alloc(8);
        features.writeUInt32LE(0x00000001, 0); // Bit 0: Average Speed Supported
        features.writeUInt32LE(0x00000000, 4); // Target settings features
        callback(BlenoCharacteristic.RESULT_SUCCESS, features);
      },
    });

    const controlPointChar = new BlenoCharacteristic({
      uuid: FITNESS_MACHINE_CONTROL_POINT_UUID,
      properties: ['write', 'indicate'],
      onSubscribe: (maxValueSize: number, updateValueCallback: (data: Buffer) => void) => {
        console.log('Client subscribed to Control Point');
        (controlPointChar as any)._updateValueCallback = updateValueCallback;
      },
      onUnsubscribe: () => {
        console.log('Client unsubscribed from Control Point');
        (controlPointChar as any)._updateValueCallback = null;
      },
      onWriteRequest: (
        data: Buffer,
        offset: number,
        withoutResponse: boolean,
        callback: (result: number) => void
      ) => {
        if (data.length > 0) {
          const opCode = data[0];
          console.log(`Control Point command: 0x${opCode.toString(16)}`);

          callback(BlenoCharacteristic.RESULT_SUCCESS);

          // Send indication response
          const updateCallback = (controlPointChar as any)._updateValueCallback;
          if (updateCallback) {
            const response = Buffer.alloc(3);
            response.writeUInt8(0x80, 0);
            response.writeUInt8(opCode, 1);
            response.writeUInt8(0x01, 2);
            updateCallback(response);
          }
        } else {
          callback(BlenoCharacteristic.RESULT_SUCCESS);
        }
      },
    });

    // Create service
    const fitnessMachineService = new bleno.PrimaryService({
      uuid: FITNESS_MACHINE_SERVICE_UUID,
      characteristics: [bikeDataChar, featureChar, controlPointChar],
    });

    bleno.setServices([fitnessMachineService], (error: Error | null) => {
      if (error) {
        console.error('Error setting services:', error);
        this.status = { state: 'error', error: error.message };
        this.emit('status', this.status);
      } else {
        console.log('FTMS service registered');
        this.isSetup = true;
        this.status = {
          state: 'advertising',
          deviceName: DEVICE_NAME,
        };
        this.emit('status', this.status);
        this.emit('log', 'FTMS broadcaster ready');
      }
    });
  }

  /**
   * Start the broadcaster
   */
  start(): void {
    if (!bleno) {
      this.status = { state: 'error', error: 'Bleno not available' };
      this.emit('status', this.status);
      return;
    }

    this.status = { state: 'starting' };
    this.emit('status', this.status);

    if (bleno.state === 'poweredOn') {
      this.startAdvertising();
    } else {
      this.pendingStart = true;
    }
  }

  /**
   * Stop the broadcaster
   */
  stop(): void {
    if (!bleno) return;

    console.log('Stopping broadcaster...');
    this.pendingStart = false;
    bleno.stopAdvertising();
    this.status = { state: 'stopped' };
    this.emit('status', this.status);
  }

  /**
   * Send fitness data
   */
  sendData(data: FtmsOutput): void {
    if (this.indoorBikeDataChar) {
      this.indoorBikeDataChar.updateData(data);
    }
  }

  /**
   * Get current status
   */
  getStatus(): BroadcasterStatus {
    return this.status;
  }

  /**
   * Check if running
   */
  isRunning(): boolean {
    return this.status.state !== 'stopped' && this.status.state !== 'error';
  }

  /**
   * Check if bleno is available
   */
  static isAvailable(): boolean {
    return bleno !== null;
  }
}
