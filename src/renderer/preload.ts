// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

import { contextBridge, ipcRenderer } from 'electron';
import { FtmsOutput } from '../shared/types/fitness-data';

// Broadcaster status type (matches main process)
interface BroadcasterStatus {
  state: 'stopped' | 'starting' | 'advertising' | 'connected' | 'error';
  deviceName?: string;
  clientAddress?: string;
  error?: string;
}

// Persisted device type (matches main process)
interface PersistedDevice {
  id: string;
  name: string;
  lastConnected: number;
}

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

  // Listen for individual devices as they're discovered (streaming)
  onBluetoothDeviceFound: (callback: (device: { deviceId: string; deviceName: string }) => void) => {
    ipcRenderer.on('bluetooth-device-found', (_event, device) => {
      callback(device);
    });
  },

  // Remove listener
  removeBluetoothListeners: () => {
    ipcRenderer.removeAllListeners('bluetooth-device-found');
  },

  // Broadcaster controls
  broadcasterStart: () => {
    ipcRenderer.send('broadcaster-start');
  },

  broadcasterStop: () => {
    ipcRenderer.send('broadcaster-stop');
  },

  broadcasterSendData: (data: FtmsOutput) => {
    ipcRenderer.send('broadcaster-send-data', data);
  },

  broadcasterGetStatus: (): Promise<BroadcasterStatus> => {
    return ipcRenderer.invoke('broadcaster-get-status');
  },

  onBroadcasterStatus: (callback: (status: BroadcasterStatus) => void) => {
    ipcRenderer.on('broadcaster-status', (_event, status) => {
      callback(status);
    });
  },

  onBroadcasterLog: (callback: (message: string) => void) => {
    ipcRenderer.on('broadcaster-log', (_event, message) => {
      callback(message);
    });
  },

  removeBroadcasterListeners: () => {
    ipcRenderer.removeAllListeners('broadcaster-status');
    ipcRenderer.removeAllListeners('broadcaster-log');
  },

  // Device persistence
  saveLastDevice: (device: { id: string; name: string }) => {
    ipcRenderer.send('save-last-device', device);
  },

  loadLastDevice: (): Promise<PersistedDevice | null> => {
    return ipcRenderer.invoke('load-last-device');
  },

  clearLastDevice: () => {
    ipcRenderer.send('clear-last-device');
  },

  // Auto-reconnect listener (triggered by main process on wake or startup)
  onAttemptReconnect: (callback: (device: PersistedDevice) => void) => {
    ipcRenderer.on('attempt-reconnect', (_event, device) => {
      callback(device);
    });
  },

  removeReconnectListener: () => {
    ipcRenderer.removeAllListeners('attempt-reconnect');
  },
});
