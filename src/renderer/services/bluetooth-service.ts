/**
 * Bluetooth service for connecting to fitness devices
 * Uses Web Bluetooth API (runs in renderer process)
 */

import { FitnessData, ConnectedDeviceInfo } from '../../shared/types';
import {
  FITNESS_SERVICE_UUIDS,
  FTMS_CHARACTERISTICS,
  STANDARD_CHARACTERISTICS,
} from '../../shared/constants';
import {
  parseIndoorBikeData,
  parseCyclingPowerData,
  parseHeartRateData,
} from './data-parsers';

type DataCallback = (data: FitnessData) => void;
type ConnectionCallback = (connected: boolean, device?: ConnectedDeviceInfo) => void;

class BluetoothService {
  private connectedDevice: BluetoothDevice | null = null;
  private server: BluetoothRemoteGATTServer | null = null;
  private dataCallback: DataCallback | null = null;
  private connectionCallback: ConnectionCallback | null = null;

  /**
   * Check if Web Bluetooth is available
   */
  isAvailable(): boolean {
    return navigator.bluetooth !== undefined;
  }

  /**
   * Set callback for fitness data updates
   */
  onData(callback: DataCallback): void {
    this.dataCallback = callback;
  }

  /**
   * Set callback for connection status changes
   */
  onConnectionChange(callback: ConnectionCallback): void {
    this.connectionCallback = callback;
  }

  /**
   * Scan for fitness devices
   */
  async scanForDevices(): Promise<BluetoothDevice | null> {
    console.log('[BluetoothService] scanForDevices called');

    if (!this.isAvailable()) {
      console.log('[BluetoothService] Web Bluetooth NOT available');
      throw new Error('Web Bluetooth is not available');
    }

    console.log('[BluetoothService] Web Bluetooth is available, starting requestDevice...');

    try {
      console.log('[BluetoothService] Calling navigator.bluetooth.requestDevice()');
      const device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [
          FITNESS_SERVICE_UUIDS.FTMS,
          FITNESS_SERVICE_UUIDS.CYCLING_POWER,
          FITNESS_SERVICE_UUIDS.CYCLING_SPEED_CADENCE,
          FITNESS_SERVICE_UUIDS.HEART_RATE,
        ],
      });

      console.log('[BluetoothService] requestDevice returned:', device?.name, device?.id);
      return device;
    } catch (error) {
      console.log('[BluetoothService] requestDevice error:', (error as Error).message);
      if ((error as Error).message?.includes('cancelled')) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Connect to a device and start reading data
   */
  async connect(device: BluetoothDevice): Promise<void> {
    if (!device.gatt) {
      throw new Error('Device does not support GATT');
    }

    // Disconnect from any existing device
    await this.disconnect();

    try {
      // Connect to GATT server
      this.server = await device.gatt.connect();
      this.connectedDevice = device;

      // Set up disconnect handler
      device.addEventListener('gattserverdisconnected', () => {
        this.handleDisconnect();
      });

      // Notify connection
      if (this.connectionCallback) {
        this.connectionCallback(true, {
          device,
          name: device.name || 'Unknown Device',
          id: device.id,
          services: [],
          isFitnessDevice: true,
        });
      }

      // Try to subscribe to fitness data
      await this.subscribeToFitnessData();

    } catch (error) {
      this.connectedDevice = null;
      this.server = null;
      throw error;
    }
  }

  /**
   * Subscribe to fitness data characteristics
   */
  private async subscribeToFitnessData(): Promise<void> {
    if (!this.server) return;

    // Try FTMS Indoor Bike Data first
    const ftmsSubscribed = await this.trySubscribeToFTMS();
    if (ftmsSubscribed) return;

    // Try Cycling Power Service as fallback
    await this.trySubscribeToCyclingPower();

    // Also try Heart Rate Service
    await this.trySubscribeToHeartRate();
  }

  /**
   * Try to subscribe to FTMS Indoor Bike Data
   */
  private async trySubscribeToFTMS(): Promise<boolean> {
    if (!this.server) return false;

    try {
      const ftmsService = await this.server.getPrimaryService(FITNESS_SERVICE_UUIDS.FTMS);
      const indoorBikeChar = await ftmsService.getCharacteristic(FTMS_CHARACTERISTICS.INDOOR_BIKE_DATA);

      indoorBikeChar.addEventListener('characteristicvaluechanged', (event) => {
        const value = (event.target as BluetoothRemoteGATTCharacteristic).value;
        if (value && this.dataCallback) {
          const data = parseIndoorBikeData(value);
          this.dataCallback(data);
        }
      });

      await indoorBikeChar.startNotifications();
      console.log('[BluetoothService] Subscribed to FTMS Indoor Bike Data');
      return true;
    } catch (e) {
      console.log('[BluetoothService] FTMS not available, trying other services...');
      return false;
    }
  }

  /**
   * Try to subscribe to Cycling Power Service
   */
  private async trySubscribeToCyclingPower(): Promise<boolean> {
    if (!this.server) return false;

    try {
      const powerService = await this.server.getPrimaryService(FITNESS_SERVICE_UUIDS.CYCLING_POWER);
      const powerChar = await powerService.getCharacteristic(STANDARD_CHARACTERISTICS.CYCLING_POWER_MEASUREMENT);

      powerChar.addEventListener('characteristicvaluechanged', (event) => {
        const value = (event.target as BluetoothRemoteGATTCharacteristic).value;
        if (value && this.dataCallback) {
          const data = parseCyclingPowerData(value);
          this.dataCallback(data);
        }
      });

      await powerChar.startNotifications();
      console.log('[BluetoothService] Subscribed to Cycling Power');
      return true;
    } catch (e) {
      console.log('[BluetoothService] Cycling Power not available');
      return false;
    }
  }

  /**
   * Try to subscribe to Heart Rate Service
   */
  private async trySubscribeToHeartRate(): Promise<boolean> {
    if (!this.server) return false;

    try {
      const hrService = await this.server.getPrimaryService(FITNESS_SERVICE_UUIDS.HEART_RATE);
      const hrChar = await hrService.getCharacteristic(STANDARD_CHARACTERISTICS.HEART_RATE_MEASUREMENT);

      hrChar.addEventListener('characteristicvaluechanged', (event) => {
        const value = (event.target as BluetoothRemoteGATTCharacteristic).value;
        if (value && this.dataCallback) {
          const heartRate = parseHeartRateData(value);
          this.dataCallback({ heartRate });
        }
      });

      await hrChar.startNotifications();
      console.log('[BluetoothService] Subscribed to Heart Rate');
      return true;
    } catch (e) {
      console.log('[BluetoothService] Heart Rate not available');
      return false;
    }
  }

  /**
   * Handle device disconnection
   */
  private handleDisconnect(): void {
    this.connectedDevice = null;
    this.server = null;

    if (this.connectionCallback) {
      this.connectionCallback(false);
    }
  }

  /**
   * Disconnect from current device
   */
  async disconnect(): Promise<void> {
    if (this.server && this.server.connected) {
      this.server.disconnect();
    }
    this.connectedDevice = null;
    this.server = null;
  }

  /**
   * Get current connection status
   */
  isConnected(): boolean {
    return this.server?.connected ?? false;
  }

  /**
   * Get connected device info
   */
  getConnectedDevice(): BluetoothDevice | null {
    return this.connectedDevice;
  }
}

// Export singleton instance
export const bluetoothService = new BluetoothService();
