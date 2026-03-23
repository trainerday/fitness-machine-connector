/**
 * ANT+ Adapter
 *
 * Handles everything ANT+-specific after UsbDeviceManager has detected a stick:
 *   1. Opens the stick and scans for nearby ANT+ sensors (wildcard mode)
 *   2. Emits 'antDeviceFound' for each unique sensor discovered → device list
 *   3. On connect(deviceId): locks onto that specific sensor
 *   4. Parses FE-C and Bicycle Power profile data → FtmsOutput
 *   5. Emits 'data' (FtmsOutput) → main.ts calls broadcaster.sendData()
 *
 * Supports two ANT+ profiles:
 *   - FE-C  (Device Type 0x11) : Smart trainers — power, cadence, speed
 *   - Power (Device Type 0x0B) : Power meters  — power, cadence only
 */

import { EventEmitter } from 'events';
import Ant from 'ant-plus';
import { UsbFitnessDevice } from './usb-device-manager';
import { FtmsOutput } from '../shared/types/fitness-data';

// =============================================================================
// TYPES
// =============================================================================

export interface AntSensorDevice {
  /** "ant-{deviceNumber}-{profile}" e.g. "ant-12345-fec" */
  deviceId: string;
  deviceName: string;
  antDeviceNumber: number;
  profile: 'fec' | 'power';
}

// =============================================================================
// CHANNELS
// Ant+ channel numbers used for each profile.
// Each profile needs its own dedicated channel on the stick.
// =============================================================================

const CHANNEL_FEC = 0;
const CHANNEL_POWER = 1;
const ANY_DEVICE = 0; // wildcard — connect to the first sensor found

// =============================================================================
// ANT ADAPTER
// =============================================================================

export class AntAdapter extends EventEmitter {
  private stick: Ant.GarminStick2 | Ant.GarminStick3;
  private fecSensor: Ant.FitnessEquipmentSensor | null = null;
  private powerSensor: Ant.BicyclePowerSensor | null = null;

  private discoveredDevices = new Map<string, AntSensorDevice>();
  private connectedDeviceId: string | null = null;
  private isOpen = false;

  constructor(usbDevice: UsbFitnessDevice) {
    super();
    // GarminStick3 is for PID 0x1009, GarminStick2 covers everything else
    this.stick = usbDevice.productId === 0x1009
      ? new Ant.GarminStick3()
      : new Ant.GarminStick2();
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Open the stick and start scanning in wildcard mode.
   * Any FE-C or Power sensor nearby will emit 'antDeviceFound'.
   */
  startScan(): void {
    console.log('[AntAdapter] Starting ANT+ scan');

    this.stick.on('startup', () => {
      console.log('[AntAdapter] Stick opened, attaching wildcard channels');
      this.attachSensors(ANY_DEVICE);
    });

    this.stick.on('shutdown', () => {
      console.log('[AntAdapter] Stick shut down');
      this.isOpen = false;
    });

    const opened = this.stick.open();
    if (!opened) {
      console.error('[AntAdapter] Failed to open ANT+ stick — is it plugged in and driver installed?');
      this.emit('error', new Error('Failed to open ANT+ stick'));
      return;
    }

    this.isOpen = true;
  }

  /**
   * Lock onto a specific sensor by deviceId (from 'antDeviceFound' event).
   * Stops wildcard scan and reconnects to the chosen device only.
   */
  connect(deviceId: string): void {
    const sensor = this.discoveredDevices.get(deviceId);
    if (!sensor) {
      console.error(`[AntAdapter] Unknown deviceId: ${deviceId}`);
      return;
    }

    console.log(`[AntAdapter] Connecting to: ${sensor.deviceName} (ANT# ${sensor.antDeviceNumber})`);
    this.connectedDeviceId = deviceId;

    // Close existing wildcard channels and reattach with specific device number
    this.detachSensors();
    this.attachSensors(sensor.antDeviceNumber);
  }

  /**
   * Close all channels and shut down the stick.
   */
  disconnect(): void {
    console.log('[AntAdapter] Disconnecting');
    this.connectedDeviceId = null;
    this.detachSensors();

    if (this.isOpen) {
      this.stick.close();
      this.isOpen = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Sensor setup
  // ---------------------------------------------------------------------------

  private attachSensors(deviceNumber: number): void {
    this.attachFec(deviceNumber);
    this.attachPower(deviceNumber);
  }

  private attachFec(deviceNumber: number): void {
    this.fecSensor = new Ant.FitnessEquipmentSensor(this.stick);

    this.fecSensor.on('fitnessData', (data: Ant.FitnessEquipmentSensorState) => {
      this.handleFecData(data);
    });

    this.fecSensor.attach(CHANNEL_FEC, deviceNumber);
  }

  private attachPower(deviceNumber: number): void {
    this.powerSensor = new Ant.BicyclePowerSensor(this.stick);

    this.powerSensor.on('powerData', (data: Ant.BicyclePowerSensorState) => {
      this.handlePowerData(data);
    });

    this.powerSensor.attach(CHANNEL_POWER, deviceNumber);
  }

  private detachSensors(): void {
    this.fecSensor?.detach();
    this.powerSensor?.detach();
    this.fecSensor = null;
    this.powerSensor = null;
  }

  // ---------------------------------------------------------------------------
  // Data handlers
  // ---------------------------------------------------------------------------

  private handleFecData(data: Ant.FitnessEquipmentSensorState): void {
    if (!data.DeviceID) return;

    // Surface new sensors to the device list
    const deviceId = `ant-${data.DeviceID}-fec`;
    if (!this.discoveredDevices.has(deviceId)) {
      const sensor: AntSensorDevice = {
        deviceId,
        deviceName: `ANT+ Trainer (${data.DeviceID})`,
        antDeviceNumber: data.DeviceID,
        profile: 'fec',
      };
      this.discoveredDevices.set(deviceId, sensor);
      console.log(`[AntAdapter] FE-C sensor found: ${sensor.deviceName}`);
      this.emit('antDeviceFound', sensor);
    }

    // Only forward data if we are connected to this specific device
    // (or still in wildcard mode — forward all until user picks one)
    if (this.connectedDeviceId && this.connectedDeviceId !== deviceId) return;

    const power = data.Power ?? 0;
    const cadence = data.Cadence ?? 0;

    if (power === 0 && cadence === 0) return; // skip empty packets

    const output: FtmsOutput = {
      power,
      cadence,
      speed: data.RealSpeed != null ? data.RealSpeed * 3.6 : undefined, // m/s → km/h
      heartRate: data.HeartRate ?? undefined,
    };

    this.emit('data', output);
  }

  private handlePowerData(data: Ant.BicyclePowerSensorState): void {
    if (!data.DeviceID) return;

    const deviceId = `ant-${data.DeviceID}-power`;
    if (!this.discoveredDevices.has(deviceId)) {
      const sensor: AntSensorDevice = {
        deviceId,
        deviceName: `ANT+ Power Meter (${data.DeviceID})`,
        antDeviceNumber: data.DeviceID,
        profile: 'power',
      };
      this.discoveredDevices.set(deviceId, sensor);
      console.log(`[AntAdapter] Power sensor found: ${sensor.deviceName}`);
      this.emit('antDeviceFound', sensor);
    }

    if (this.connectedDeviceId && this.connectedDeviceId !== deviceId) return;

    const power = data.Power ?? 0;
    const cadence = data.Cadence ?? 0;

    if (power === 0 && cadence === 0) return;

    const output: FtmsOutput = {
      power,
      cadence,
    };

    this.emit('data', output);
  }
}
