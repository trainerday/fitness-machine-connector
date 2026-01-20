/**
 * =============================================================================
 * BLUETOOTH SERVICE
 * =============================================================================
 *
 * Purpose:
 *   Pure Bluetooth communication layer. Handles ONLY Bluetooth operations.
 *   This service knows nothing about fitness data, parsing, or the UI.
 *
 * Responsibilities:
 *   - Check if Web Bluetooth is available
 *   - Scan for Bluetooth devices
 *   - Connect to a device's GATT server
 *   - Subscribe to characteristics and emit raw data
 *   - Handle disconnection
 *
 * What this service does NOT do:
 *   - Parse or interpret data (that's the Parser's job)
 *   - Know about fitness metrics like power, cadence, etc.
 *   - Interact with the UI
 *
 * Usage:
 *   This service is used by FitnessDataReader, not directly by the UI.
 *
 * =============================================================================
 */

/**
 * Identifies which type of Bluetooth characteristic sent the data.
 * This allows the parser to know how to interpret the raw bytes.
 */
export type CharacteristicType = 'ftms-indoor-bike' | 'cycling-power' | 'heart-rate';

/**
 * Raw data packet from a Bluetooth characteristic.
 * Contains the characteristic type and raw bytes - no interpretation.
 */
export interface RawBluetoothData {
  characteristicType: CharacteristicType;
  rawValue: DataView;
}

/**
 * Basic device info for connection status callbacks.
 */
export interface DeviceInfo {
  name: string;
  id: string;
}

/** Callback type for raw data events */
type RawDataCallback = (data: RawBluetoothData) => void;

/** Callback type for connection status events */
type ConnectionCallback = (connected: boolean, device?: DeviceInfo) => void;

/**
 * Standard Bluetooth GATT Service UUIDs.
 * These are defined by the Bluetooth SIG specification.
 */
const SERVICE_UUIDS = {
  FTMS: 0x1826,              // Fitness Machine Service
  CYCLING_POWER: 0x1818,     // Cycling Power Service
  HEART_RATE: 0x180d,        // Heart Rate Service
} as const;

/**
 * Standard Bluetooth GATT Characteristic UUIDs.
 * These identify specific data points within a service.
 */
const CHARACTERISTIC_UUIDS = {
  FTMS_INDOOR_BIKE_DATA: 0x2ad2,
  CYCLING_POWER_MEASUREMENT: 0x2a63,
  HEART_RATE_MEASUREMENT: 0x2a37,
} as const;

class BluetoothService {
  private connectedDevice: BluetoothDevice | null = null;
  private gattServer: BluetoothRemoteGATTServer | null = null;
  private rawDataCallback: RawDataCallback | null = null;
  private connectionCallback: ConnectionCallback | null = null;

  /**
   * Check if Web Bluetooth API is available in this environment.
   */
  isAvailable(): boolean {
    return navigator.bluetooth !== undefined;
  }

  /**
   * Register a callback to receive raw Bluetooth data.
   * The callback receives unprocessed bytes with a characteristic type identifier.
   */
  onRawData(callback: RawDataCallback): void {
    this.rawDataCallback = callback;
  }

  /**
   * Register a callback for connection status changes.
   */
  onConnectionChange(callback: ConnectionCallback): void {
    this.connectionCallback = callback;
  }

  /**
   * Scan for available Bluetooth devices.
   * Returns the selected device or null if cancelled.
   */
  async scanForDevices(): Promise<BluetoothDevice | null> {
    if (!this.isAvailable()) {
      throw new Error('Web Bluetooth is not available');
    }

    try {
      const device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [
          SERVICE_UUIDS.FTMS,
          SERVICE_UUIDS.CYCLING_POWER,
          SERVICE_UUIDS.HEART_RATE,
        ],
      });
      return device;
    } catch (error) {
      if ((error as Error).message?.includes('cancelled')) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Connect to a Bluetooth device and start listening for data.
   */
  async connect(device: BluetoothDevice): Promise<void> {
    if (!device.gatt) {
      throw new Error('Device does not support GATT');
    }

    await this.disconnect();

    this.gattServer = await device.gatt.connect();
    this.connectedDevice = device;

    device.addEventListener('gattserverdisconnected', () => {
      this.handleDisconnect();
    });

    this.notifyConnectionChange(true, {
      name: device.name || 'Unknown Device',
      id: device.id,
    });

    await this.subscribeToCharacteristics();
  }

  /**
   * Disconnect from the current device.
   */
  async disconnect(): Promise<void> {
    if (this.gattServer?.connected) {
      this.gattServer.disconnect();
    }
    this.connectedDevice = null;
    this.gattServer = null;
  }

  /**
   * Check if currently connected to a device.
   */
  isConnected(): boolean {
    return this.gattServer?.connected ?? false;
  }

  /**
   * Subscribe to available fitness-related characteristics.
   * Tries FTMS first, then falls back to individual services.
   */
  private async subscribeToCharacteristics(): Promise<void> {
    if (!this.gattServer) return;

    // Try FTMS first (most complete data)
    const ftmsSuccess = await this.trySubscribe(
      SERVICE_UUIDS.FTMS,
      CHARACTERISTIC_UUIDS.FTMS_INDOOR_BIKE_DATA,
      'ftms-indoor-bike'
    );

    // If FTMS not available, try Cycling Power
    if (!ftmsSuccess) {
      await this.trySubscribe(
        SERVICE_UUIDS.CYCLING_POWER,
        CHARACTERISTIC_UUIDS.CYCLING_POWER_MEASUREMENT,
        'cycling-power'
      );
    }

    // Always try Heart Rate (can be additional to other services)
    await this.trySubscribe(
      SERVICE_UUIDS.HEART_RATE,
      CHARACTERISTIC_UUIDS.HEART_RATE_MEASUREMENT,
      'heart-rate'
    );
  }

  /**
   * Attempt to subscribe to a specific characteristic.
   * Returns true if successful, false otherwise.
   */
  private async trySubscribe(
    serviceUuid: number,
    characteristicUuid: number,
    characteristicType: CharacteristicType
  ): Promise<boolean> {
    if (!this.gattServer) return false;

    try {
      const service = await this.gattServer.getPrimaryService(serviceUuid);
      const characteristic = await service.getCharacteristic(characteristicUuid);

      characteristic.addEventListener('characteristicvaluechanged', (event) => {
        const value = (event.target as BluetoothRemoteGATTCharacteristic).value;
        if (value) {
          this.emitRawData(characteristicType, value);
        }
      });

      await characteristic.startNotifications();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Emit raw data to registered callback.
   */
  private emitRawData(characteristicType: CharacteristicType, rawValue: DataView): void {
    if (this.rawDataCallback) {
      this.rawDataCallback({ characteristicType, rawValue });
    }
  }

  /**
   * Handle device disconnection event.
   */
  private handleDisconnect(): void {
    this.connectedDevice = null;
    this.gattServer = null;
    this.notifyConnectionChange(false);
  }

  /**
   * Notify connection status change.
   */
  private notifyConnectionChange(connected: boolean, device?: DeviceInfo): void {
    if (this.connectionCallback) {
      this.connectionCallback(connected, device);
    }
  }
}

/** Singleton instance */
export const bluetoothService = new BluetoothService();
