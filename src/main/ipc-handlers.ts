/**
 * IPC event handlers for main process communication with renderer
 */

import { ipcMain } from 'electron';
import { BluetoothDeviceManager } from './bluetooth-device-manager';

export function setupIpcHandlers(deviceManager: BluetoothDeviceManager): void {
  // Handle device selection from renderer
  ipcMain.on('select-bluetooth-device', (_event, deviceId: string) => {
    deviceManager.selectDevice(deviceId);
  });

  // Handle cancellation from renderer
  ipcMain.on('cancel-bluetooth-request', () => {
    deviceManager.cancelRequest();
  });

  // Handle new scan request from renderer
  ipcMain.on('start-bluetooth-scan', () => {
    deviceManager.startNewScan();
  });
}
