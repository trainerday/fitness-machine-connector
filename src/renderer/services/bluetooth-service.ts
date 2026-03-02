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
 * UUID type - supports both 16-bit (number) and 128-bit (string) UUIDs.
 */
export type BluetoothUuid = number | string;

/**
 * Configuration for a characteristic to subscribe to.
 * Just UUIDs - no interpretation of what they mean.
 */
export interface CharacteristicSubscription {
  serviceUuid: BluetoothUuid;
  characteristicUuid: BluetoothUuid;
}

/**
 * Raw data received from a Bluetooth characteristic.
 * Contains the characteristic UUID and raw bytes - no interpretation.
 */
export interface RawBluetoothData {
  characteristicUuid: BluetoothUuid;
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
   * @param serviceUuids - List of service UUIDs to filter/allow access to (16-bit or 128-bit)
   */
  async scanForDevices(serviceUuids: BluetoothUuid[]): Promise<BluetoothDevice | null> {
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
   * Attempt to reconnect to a previously paired device by name.
   * Uses navigator.bluetooth.getDevices() which doesn't require user interaction.
   * We match by name because Web Bluetooth device IDs can change between sessions.
   * Returns true if reconnection successful, false otherwise.
   */
  async reconnectToDevice(deviceName: string): Promise<boolean> {
    if (!this.isAvailable()) {
      console.log('[BluetoothService] Bluetooth not available for reconnect');
      return false;
    }

    try {
      console.log('[BluetoothService] Calling navigator.bluetooth.getDevices()...');

      // getDevices() returns previously permitted devices without user interaction
      const devices = await navigator.bluetooth.getDevices();
      console.log(`[BluetoothService] getDevices() returned ${devices.length} device(s)`);

      if (devices.length === 0) {
        console.log('[BluetoothService] No previously permitted devices found');
        return false;
      }

      devices.forEach((d) => console.log(`[BluetoothService]   - "${d.name}" (${d.id})`));

      // Match by name since device IDs change between sessions
      const device = devices.find((d) => d.name === deviceName);

      if (!device) {
        console.log(`[BluetoothService] Device "${deviceName}" not found in permitted devices`);
        return false;
      }

      console.log(`[BluetoothService] Found matching device: ${device.name} (${device.id})`);
      console.log('[BluetoothService] Attempting to connect...');

      // Connect to the device
      await this.connect(device);
      console.log('[BluetoothService] Reconnection successful!');
      return true;
    } catch (error) {
      console.error('[BluetoothService] Reconnection failed:', error);
      return false;
    }
  }

  /**
   * Get the currently connected device info
   */
  getConnectedDevice(): DeviceInfo | null {
    if (!this.connectedDevice) return null;
    return {
      name: this.connectedDevice.name || 'Unknown Device',
      id: this.connectedDevice.id,
    };
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
    serviceUuid: BluetoothUuid,
    characteristicUuid: BluetoothUuid
  ): Promise<boolean> {
    if (!this.gattServer) return false;

    console.log(`[BluetoothService] Trying to subscribe: service=${serviceUuid}, char=${characteristicUuid}`);

    try {
      const service = await this.gattServer.getPrimaryService(serviceUuid);
      console.log(`[BluetoothService] Got service: ${serviceUuid}`);
      const characteristic = await service.getCharacteristic(characteristicUuid);
      console.log(`[BluetoothService] Got characteristic: ${characteristicUuid}`);

      characteristic.addEventListener('characteristicvaluechanged', (event) => {
        const value = (event.target as BluetoothRemoteGATTCharacteristic).value;
        if (value) {
          this.emitRawData(characteristicUuid, value);
        }
      });

      await characteristic.startNotifications();
      console.log(`[BluetoothService] Subscribed successfully to ${characteristicUuid}`);
      return true;
    } catch (error) {
      console.log(`[BluetoothService] Failed to subscribe to service=${serviceUuid}, char=${characteristicUuid}:`, error);
      return false;
    }
  }

  /**
   * Emit raw data to registered callback.
   */
  private emitRawData(characteristicUuid: BluetoothUuid, rawValue: DataView): void {
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
