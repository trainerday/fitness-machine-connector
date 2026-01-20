/**
 * =============================================================================
 * BLUETOOTH SERVICE
 * =============================================================================
 *
 * Purpose:
 *   Pure Bluetooth communication layer. Handles ONLY generic Bluetooth operations.
 *   This service knows NOTHING about fitness, data formats, or what the UUIDs mean.
 *
 * Responsibilities:
 *   - Check if Web Bluetooth is available
 *   - Scan for Bluetooth devices
 *   - Connect to a device's GATT server
 *   - Subscribe to characteristics (given a list of UUIDs)
 *   - Emit raw data with the characteristic UUID that sent it
 *   - Handle disconnection
 *
 * What this service does NOT know:
 *   - What the UUIDs mean (e.g., "0x2ad2 is FTMS Indoor Bike Data")
 *   - How to parse the data
 *   - Anything about fitness, power, cadence, heart rate, etc.
 *
 * This design allows the BluetoothService to be reused for ANY Bluetooth device,
 * not just fitness equipment.
 *
 * =============================================================================
 */

/**
 * Configuration for a characteristic to subscribe to.
 * Just UUIDs - no interpretation of what they mean.
 */
export interface CharacteristicSubscription {
  serviceUuid: number;
  characteristicUuid: number;
}

/**
 * Raw data received from a Bluetooth characteristic.
 * Contains the characteristic UUID and raw bytes - no interpretation.
 */
export interface RawBluetoothData {
  characteristicUuid: number;
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

class BluetoothService {
  private connectedDevice: BluetoothDevice | null = null;
  private gattServer: BluetoothRemoteGATTServer | null = null;
  private rawDataCallback: RawDataCallback | null = null;
  private connectionCallback: ConnectionCallback | null = null;
  private subscriptions: CharacteristicSubscription[] = [];

  /**
   * Check if Web Bluetooth API is available in this environment.
   */
  isAvailable(): boolean {
    return navigator.bluetooth !== undefined;
  }

  /**
   * Register a callback to receive raw Bluetooth data.
   * The callback receives unprocessed bytes with the characteristic UUID.
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
   * Set which characteristics to subscribe to when connecting.
   * This should be called before connect().
   */
  setSubscriptions(subscriptions: CharacteristicSubscription[]): void {
    this.subscriptions = subscriptions;
  }

  /**
   * Scan for available Bluetooth devices.
   * Returns the selected device or null if cancelled.
   *
   * @param serviceUuids - List of service UUIDs to filter/allow access to
   */
  async scanForDevices(serviceUuids: number[]): Promise<BluetoothDevice | null> {
    if (!this.isAvailable()) {
      throw new Error('Web Bluetooth is not available');
    }

    try {
      const device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: serviceUuids,
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
   * Connect to a Bluetooth device and subscribe to configured characteristics.
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
   * Subscribe to all configured characteristics.
   */
  private async subscribeToCharacteristics(): Promise<void> {
    if (!this.gattServer) return;

    for (const sub of this.subscriptions) {
      await this.trySubscribe(sub.serviceUuid, sub.characteristicUuid);
    }
  }

  /**
   * Attempt to subscribe to a specific characteristic.
   * Returns true if successful, false otherwise.
   */
  private async trySubscribe(
    serviceUuid: number,
    characteristicUuid: number
  ): Promise<boolean> {
    if (!this.gattServer) return false;

    try {
      const service = await this.gattServer.getPrimaryService(serviceUuid);
      const characteristic = await service.getCharacteristic(characteristicUuid);

      characteristic.addEventListener('characteristicvaluechanged', (event) => {
        const value = (event.target as BluetoothRemoteGATTCharacteristic).value;
        if (value) {
          this.emitRawData(characteristicUuid, value);
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
  private emitRawData(characteristicUuid: number, rawValue: DataView): void {
    if (this.rawDataCallback) {
      this.rawDataCallback({ characteristicUuid, rawValue });
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
