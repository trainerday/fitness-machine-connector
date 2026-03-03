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

  broadcasterDisconnect: () => {
    ipcRenderer.send('broadcaster-disconnect');
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

  // .NET backend events (bypasses Web Bluetooth limitations)
  onDeviceConnectedViaDotnet: (callback: (device: { id: string; name: string }) => void) => {
    ipcRenderer.on('device-connected-via-dotnet', (_event, device) => {
      callback(device);
    });
  },

  onFitnessDataFromDotnet: (callback: (data: { power?: number; cadence?: number; heartRate?: number; source?: string }) => void) => {
    ipcRenderer.on('fitness-data-from-dotnet', (_event, data) => {
      callback(data);
    });
  },

  onAutoReconnectFailed: (callback: (info: { deviceName: string; reason: string }) => void) => {
    ipcRenderer.on('auto-reconnect-failed', (_event, info) => {
      callback(info);
    });
  },

  // Lookout mode status (background scanning for saved device)
  onLookoutStatus: (callback: (status: { active: boolean; deviceName?: string }) => void) => {
    ipcRenderer.on('lookout-status', (_event, status) => {
      callback(status);
    });
  },

  removeDotnetListeners: () => {
    ipcRenderer.removeAllListeners('device-connected-via-dotnet');
    ipcRenderer.removeAllListeners('fitness-data-from-dotnet');
    ipcRenderer.removeAllListeners('auto-reconnect-failed');
    ipcRenderer.removeAllListeners('lookout-status');
  },
});
