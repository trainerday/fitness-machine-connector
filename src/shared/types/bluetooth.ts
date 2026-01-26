/**
 * Bluetooth-related type definitions
 */

import { FtmsOutput } from './fitness-data';

/**
 * Information about a discovered Bluetooth device (from main process scan)
 */
export interface BluetoothDeviceInfo {
  deviceId: string;
  deviceName: string;
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
 * Electron API exposed via preload script
 */
export interface ElectronAPI {
  // Bluetooth scanning
  startBluetoothScan: () => void;
  selectBluetoothDevice: (deviceId: string) => void;
  cancelBluetoothRequest: () => void;
  onBluetoothScanComplete: (callback: (devices: BluetoothDeviceInfo[]) => void) => void;
  removeBluetoothListeners: () => void;

  // FTMS Broadcaster
  broadcasterStart: () => void;
  broadcasterStop: () => void;
  broadcasterSendData: (data: FtmsOutput) => void;
  broadcasterGetStatus: () => Promise<BroadcasterStatus>;
  onBroadcasterStatus: (callback: (status: BroadcasterStatus) => void) => void;
  onBroadcasterLog: (callback: (message: string) => void) => void;
  removeBroadcasterListeners: () => void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
