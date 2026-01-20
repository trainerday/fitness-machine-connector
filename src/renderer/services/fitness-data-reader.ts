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
 *   - Configure BluetoothService with fitness-specific UUIDs (from fitness-characteristics)
 *   - Coordinate BluetoothService and FitnessDataParser
 *   - Provide simple callbacks: onFitnessData(), onConnectionChange()
 *   - Provide simple methods: scanForDevices(), connect(), disconnect()
 *   - Package data nicely for the UI layer
 *
 * What this reader does NOT do:
 *   - Know about Bluetooth protocols (delegates to BluetoothService)
 *   - Know about data byte formats (delegates to FitnessDataParser)
 *   - Manipulate the DOM or UI elements
 *
 * Architecture:
 *   index.ts → FitnessDataReader → FitnessDataParser
 *                                ↘ BluetoothService
 *
 *   FitnessDataReader uses fitness-characteristics.ts to configure BluetoothService
 *   with the correct UUIDs, then routes raw data through the Parser.
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
import { FITNESS_CHARACTERISTICS, getServiceUuids } from '../../shared/constants';
import { bluetoothService, DeviceInfo } from './bluetooth-service';
import { FitnessDataParser } from './fitness-data-parser';

/** Callback for receiving parsed fitness data */
type FitnessDataCallback = (data: FitnessData) => void;

/** Callback for connection status changes */
type ConnectionChangeCallback = (connected: boolean, deviceName?: string) => void;

/**
 * High-level reader that coordinates Bluetooth and parsing.
 * This is the main interface for the UI to interact with fitness devices.
 */
export class FitnessDataReader {
  private parser: FitnessDataParser;
  private fitnessDataCallback: FitnessDataCallback | null = null;
  private connectionChangeCallback: ConnectionChangeCallback | null = null;

  constructor() {
    this.parser = new FitnessDataParser();
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
    // Pass fitness service UUIDs to BluetoothService
    const serviceUuids = getServiceUuids();
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
   * Configure BluetoothService with fitness-specific subscriptions.
   * This passes the UUIDs from fitness-characteristics to BluetoothService.
   */
  private configureBluetoothService(): void {
    // Convert fitness characteristics to subscription format
    const subscriptions = FITNESS_CHARACTERISTICS.map(config => ({
      serviceUuid: config.serviceUuid,
      characteristicUuid: config.characteristicUuid,
    }));

    bluetoothService.setSubscriptions(subscriptions);
  }

  /**
   * Set up internal callbacks to coordinate BluetoothService and Parser.
   * This wires together the data flow: Bluetooth → Parser → UI callback
   */
  private setupBluetoothCallbacks(): void {
    // When raw Bluetooth data arrives, parse it and forward to UI
    bluetoothService.onRawData((rawData) => {
      const fitnessData = this.parser.parse(rawData);
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
