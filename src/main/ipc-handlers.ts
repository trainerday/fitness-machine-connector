/**
 * IPC event handlers for main process communication with renderer
 */

import { ipcMain, BrowserWindow } from 'electron';
import { BluetoothDeviceManager } from './bluetooth-device-manager';
import { BluetoothBroadcaster, BroadcasterStatus } from './bluetooth-broadcaster';
import { FtmsOutput } from '../shared/types/fitness-data';
import { startPowerSaveBlocker, stopPowerSaveBlocker } from './power-manager';
import { saveLastDevice, loadLastDevice, clearLastDevice, PersistedDevice } from './device-persistence';

export function setupIpcHandlers(
  deviceManager: BluetoothDeviceManager,
  broadcaster: BluetoothBroadcaster
): void {
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

  // Broadcaster controls
  ipcMain.on('broadcaster-start', () => {
    console.log('[IPC] broadcaster-start received');
    broadcaster.start();
    startPowerSaveBlocker();
  });

  ipcMain.on('broadcaster-stop', () => {
    console.log('[IPC] broadcaster-stop received');
    broadcaster.stop();
    stopPowerSaveBlocker();
  });

  ipcMain.on('broadcaster-send-data', (_event, data: FtmsOutput) => {
    broadcaster.sendData(data);
  });

  ipcMain.handle('broadcaster-get-status', (): BroadcasterStatus => {
    return broadcaster.getStatus();
  });

  // Forward broadcaster status changes to renderer
  broadcaster.on('status', (status: BroadcasterStatus) => {
    const windows = BrowserWindow.getAllWindows();
    windows.forEach((win) => {
      win.webContents.send('broadcaster-status', status);
    });
  });

  broadcaster.on('log', (message: string) => {
    const windows = BrowserWindow.getAllWindows();
    windows.forEach((win) => {
      win.webContents.send('broadcaster-log', message);
    });
  });

  // Device persistence handlers
  ipcMain.on('save-last-device', (_event, device: { id: string; name: string }) => {
    console.log('[IPC] Received save-last-device:', device);
    saveLastDevice(device);
  });

  ipcMain.handle('load-last-device', (): PersistedDevice | null => {
    console.log('[IPC] Renderer requested load-last-device');
    const device = loadLastDevice();
    console.log('[IPC] Returning saved device:', device);
    return device;
  });

  ipcMain.on('clear-last-device', () => {
    clearLastDevice();
  });
}
