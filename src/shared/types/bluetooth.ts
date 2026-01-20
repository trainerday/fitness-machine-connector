/**
 * Bluetooth-related type definitions
 */

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
 * Electron API exposed via preload script
 */
export interface ElectronAPI {
  startBluetoothScan: () => void;
  selectBluetoothDevice: (deviceId: string) => void;
  cancelBluetoothRequest: () => void;
  onBluetoothScanComplete: (callback: (devices: BluetoothDeviceInfo[]) => void) => void;
  removeBluetoothListeners: () => void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
