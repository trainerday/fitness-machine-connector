/**
 * =============================================================================
 * FITNESS DATA READER
 * =============================================================================
 *
 * Purpose:
 *   High-level coordinator that provides a clean, simple interface for the UI.
 *   This is the ONLY service that index.ts should interact with for fitness data.
 *
 * Responsibilities:
 *   - Configure BluetoothService with UUIDs from device specs (JSON files)
 *   - Coordinate BluetoothService and DeviceSpecParser
 *   - Provide simple callbacks: onFitnessData(), onConnectionChange()
 *   - Provide simple methods: scanForDevices(), connect(), disconnect()
 *
 * Architecture:
 *   index.ts → FitnessDataReader → DeviceSpecParser (reads device-specs/*.json)
 *                                ↘ BluetoothService
 *
 * Usage:
 *   const reader = new FitnessDataReader();
 *   reader.onFitnessData((data) => updateUI(data));
 *   reader.onConnectionChange((connected, name) => updateStatus(connected, name));
 *   await reader.connect(device);
 *
 * =============================================================================
 */

import { FitnessData } from '../../shared/types';
import { bluetoothService, DeviceInfo } from './bluetooth-service';
import { deviceSpecParser } from './device-spec-parser';

/** Callback for receiving parsed fitness data */
type FitnessDataCallback = (data: FitnessData) => void;

/** Callback for connection status changes */
type ConnectionChangeCallback = (connected: boolean, deviceName?: string) => void;

/** Callback for diagnostic status messages */
type StatusLogCallback = (message: string) => void;

/**
 * High-level reader that coordinates Bluetooth and parsing.
 * This is the main interface for the UI to interact with fitness devices.
 */
export class FitnessDataReader {
  private fitnessDataCallback: FitnessDataCallback | null = null;
  private connectionChangeCallback: ConnectionChangeCallback | null = null;
  private statusLogCallback: StatusLogCallback | null = null;

  constructor() {
    this.configureBluetoothService();
    this.setupBluetoothCallbacks();
  }

  /**
   * Check if Bluetooth is available on this device.
   */
  isAvailable(): boolean {
    return bluetoothService.isAvailable();
  }

  /**
   * Register a callback to receive parsed fitness data.
   * The callback receives clean FitnessData objects ready for display.
   */
  onFitnessData(callback: FitnessDataCallback): void {
    this.fitnessDataCallback = callback;
  }

  /**
   * Register a callback for connection status changes.
   * Provides a simple connected/disconnected status with device name.
   */
  onConnectionChange(callback: ConnectionChangeCallback): void {
    this.connectionChangeCallback = callback;
  }

  onStatusLog(callback: StatusLogCallback): void {
    this.statusLogCallback = callback;
  }

  /**
   * Scan for available fitness devices.
   * Returns the selected device or null if user cancelled.
   */
  async scanForDevices(): Promise<BluetoothDevice | null> {
    const serviceUuids = deviceSpecParser.getServiceUuids();
    return bluetoothService.scanForDevices(serviceUuids);
  }

  /**
   * Connect to a fitness device and start receiving data.
   * After subscribing, fires any init writes defined in the device spec (e.g. Echelon activation).
   */
  async connect(device: BluetoothDevice): Promise<void> {
    await bluetoothService.connect(device);
    await this.sendInitWrites();
  }

  /**
   * Send any init writes required by the connected device's spec.
   * Attempts all writes from all specs — writes that don't apply to the
   * current device fail silently (device won't have the service).
   */
  private async sendInitWrites(): Promise<void> {
    const writes = deviceSpecParser.getAllInitWrites();
    if (writes.length === 0) return;

    for (const w of writes) {
      try {
        await bluetoothService.writeCharacteristic(w.serviceUuid, w.characteristicUuid, w.bytes);
        this.statusLogCallback?.(`Init write OK → ${w.characteristicUuid}`);
      } catch (err) {
        this.statusLogCallback?.(`Init write failed → ${w.characteristicUuid}: ${(err as Error).message}`);
      }
    }
  }

  /**
   * Disconnect from the current device.
   */
  async disconnect(): Promise<void> {
    await bluetoothService.disconnect();
  }

  /**
   * Check if currently connected to a device.
   */
  isConnected(): boolean {
    return bluetoothService.isConnected();
  }

  /**
   * Attempt to reconnect to a previously paired device by name.
   * This is used for auto-reconnection after sleep/wake or app restart.
   * We use name instead of ID because Web Bluetooth IDs change between sessions.
   * Returns true if reconnection successful, false otherwise.
   */
  async reconnect(deviceName: string): Promise<boolean> {
    return bluetoothService.reconnectToDevice(deviceName);
  }

  /**
   * Get info about the currently connected device.
   */
  getConnectedDevice(): { name: string; id: string } | null {
    return bluetoothService.getConnectedDevice();
  }

  /**
   * Configure BluetoothService with fitness-specific subscriptions.
   * Uses device specs to determine which characteristics to subscribe to.
   */
  private configureBluetoothService(): void {
    const subscriptions = deviceSpecParser.getCharacteristicConfigs();
    bluetoothService.setSubscriptions(subscriptions);
    bluetoothService.onSubscriptionStatus((msg) => this.statusLogCallback?.(msg));
  }

  /**
   * Set up internal callbacks to coordinate BluetoothService and Parser.
   * This wires together the data flow: Bluetooth → DeviceSpecParser → UI callback
   */
  private setupBluetoothCallbacks(): void {
    // When raw Bluetooth data arrives, parse it using device specs and forward to UI
    bluetoothService.onRawData((rawData) => {
      console.log(`[FitnessDataReader] Raw data received from ${rawData.characteristicUuid}, ${rawData.rawValue.byteLength} bytes`);
      const fitnessData = deviceSpecParser.parse(rawData.characteristicUuid, rawData.rawValue);
      console.log(`[FitnessDataReader] Parsed data:`, fitnessData);
      this.emitFitnessData(fitnessData);
    });

    // When connection status changes, forward to UI and reset identification on disconnect
    bluetoothService.onConnectionChange((connected, deviceInfo) => {
      if (!connected) deviceSpecParser.resetIdentification();
      this.emitConnectionChange(connected, deviceInfo);
    });
  }

  /**
   * Emit parsed fitness data to registered callback.
   */
  private emitFitnessData(data: FitnessData): void {
    if (this.fitnessDataCallback) {
      this.fitnessDataCallback(data);
    }
  }

  /**
   * Emit connection status change to registered callback.
   */
  private emitConnectionChange(connected: boolean, deviceInfo?: DeviceInfo): void {
    if (this.connectionChangeCallback) {
      this.connectionChangeCallback(connected, deviceInfo?.name);
    }
  }
}
