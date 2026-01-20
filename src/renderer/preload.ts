// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

import { contextBridge, ipcRenderer } from 'electron';

// Expose Bluetooth-related IPC to renderer
contextBridge.exposeInMainWorld('electronAPI', {
  // Signal that a new scan is starting
  startBluetoothScan: () => {
    ipcRenderer.send('start-bluetooth-scan');
  },

  // Send selected device ID to main process
  selectBluetoothDevice: (deviceId: string) => {
    ipcRenderer.send('select-bluetooth-device', deviceId);
  },

  // Cancel Bluetooth request
  cancelBluetoothRequest: () => {
    ipcRenderer.send('cancel-bluetooth-request');
  },

  // Listen for scan complete with device list
  onBluetoothScanComplete: (callback: (devices: Array<{ deviceId: string; deviceName: string }>) => void) => {
    ipcRenderer.on('bluetooth-scan-complete', (_event, devices) => {
      callback(devices);
    });
  },

  // Remove listener
  removeBluetoothListeners: () => {
    ipcRenderer.removeAllListeners('bluetooth-scan-complete');
  },
});
