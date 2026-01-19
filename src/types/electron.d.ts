// Type declarations for Electron IPC exposed via preload

interface BluetoothDeviceInfo {
  deviceId: string;
  deviceName: string;
}

interface ElectronAPI {
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

export {};
