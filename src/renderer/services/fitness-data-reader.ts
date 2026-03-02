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

/**
 * High-level reader that coordinates Bluetooth and parsing.
 * This is the main interface for the UI to interact with fitness devices.
 */
export class FitnessDataReader {
  private fitnessDataCallback: FitnessDataCallback | null = null;
  private connectionChangeCallback: ConnectionChangeCallback | null = null;

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

  /**
   * Scan for available fitness devices.
   * Returns the selected device or null if user cancelled.
   */
  async scanForDevices(): Promise<BluetoothDevice | null> {
    // Pass fitness service UUIDs from device specs to BluetoothService
    const serviceUuids = deviceSpecParser.getServiceUuids();
    return bluetoothService.scanForDevices(serviceUuids);
  }

  /**
   * Connect to a fitness device and start receiving data.
   */
  async connect(device: BluetoothDevice): Promise<void> {
    await bluetoothService.connect(device);
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
    // Get characteristic configs from device specs
    const subscriptions = deviceSpecParser.getCharacteristicConfigs();
    bluetoothService.setSubscriptions(subscriptions);
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

    // When connection status changes, forward to UI
    bluetoothService.onConnectionChange((connected, deviceInfo) => {
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
