/**
 * Bluetooth-related type definitions
 */

import { FtmsOutput } from './fitness-data';
import { AppSettings } from './settings';

/**
 * Information about a discovered Bluetooth device (from main process scan)
 */
export interface BluetoothDeviceInfo {
  deviceId: string;
  deviceName: string;
  /** Connection protocol — undefined means BLE (legacy) */
  protocol?: 'ble' | 'ant-plus' | 'direct-usb';
}

/**
 * Extended device info after connection
 */
export interface ConnectedDeviceInfo {
  device: BluetoothDevice;
  name: string;
  id: string;
  services: string[];
  isFitnessDevice: boolean;
}

/**
 * FTMS Broadcaster status
 */
export interface BroadcasterStatus {
  state: 'stopped' | 'starting' | 'advertising' | 'connected' | 'error';
  deviceName?: string;
  clientAddress?: string;
  error?: string;
}

/**
 * Persisted device info for auto-reconnect
 */
export interface PersistedDevice {
  id: string;
  name: string;
  lastConnected: number;
}

/**
 * Electron API exposed via preload script
 */
export interface ElectronAPI {
  // Bluetooth scanning
  startBluetoothScan: () => void;
  selectBluetoothDevice: (deviceId: string) => void;
  cancelBluetoothRequest: () => void;
  onBluetoothDeviceFound: (callback: (device: BluetoothDeviceInfo) => void) => void;
  removeBluetoothListeners: () => void;

  // FTMS Broadcaster
  broadcasterStart: () => void;
  broadcasterStop: () => void;
  broadcasterDisconnect: () => void;
  broadcasterSendData: (data: FtmsOutput) => void;
  broadcasterGetStatus: () => Promise<BroadcasterStatus>;
  onBroadcasterStatus: (callback: (status: BroadcasterStatus) => void) => void;
  onBroadcasterLog: (callback: (message: string) => void) => void;
  removeBroadcasterListeners: () => void;

  // Device persistence
  saveLastDevice: (device: { id: string; name: string }) => void;
  loadLastDevice: () => Promise<PersistedDevice | null>;
  clearLastDevice: () => void;

  // Auto-reconnect
  onAttemptReconnect: (callback: (device: PersistedDevice) => void) => void;
  removeReconnectListener: () => void;

  // .NET backend events
  onDeviceConnectedViaDotnet: (callback: (device: { id: string; name: string }) => void) => void;
  onFitnessDataFromDotnet: (callback: (data: { power?: number; cadence?: number; heartRate?: number; source?: string }) => void) => void;
  onRawDataFromDotnet: (callback: (data: { characteristicUuid: string; bytes: number[] }) => void) => void;
  writeCharacteristicViaDotnet: (serviceUuid: string, characteristicUuid: string, bytes: number[]) => void;
  onAutoReconnectFailed: (callback: (info: { deviceName: string; reason: string }) => void) => void;
  onLookoutStatus: (callback: (status: { active: boolean; deviceName?: string }) => void) => void;
  removeDotnetListeners: () => void;

  // Settings
  getSettings: () => Promise<AppSettings>;
  setSetting: (key: 'theme' | 'liveDataMode', value: string) => void;
  addTrustedDevice: (id: string, name: string) => void;

  // Source device disconnect notification (triggers lookout restart in main)
  notifySourceDeviceDisconnected: () => void;

  // Logging
  logToMain: (message: string) => void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
