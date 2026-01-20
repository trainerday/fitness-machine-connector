/**
 * Main process entry point - handles window lifecycle
 */

import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { BluetoothDeviceManager } from './bluetooth-device-manager';
import { setupIpcHandlers } from './ipc-handlers';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

// Create device manager instance
const deviceManager = new BluetoothDeviceManager();

// Set up IPC handlers
setupIpcHandlers(deviceManager);

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // Handle Bluetooth device selection from Web Bluetooth API
  mainWindow.webContents.on('select-bluetooth-device', (event, devices, callback) => {
    event.preventDefault();
    deviceManager.handleDeviceDiscovered(devices, callback);
  });

  // Send discovered devices to renderer when scan completes
  deviceManager.setOnScanComplete((devices) => {
    mainWindow.webContents.send('bluetooth-scan-complete', devices);
  });

  // Load the app
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  // Open DevTools in development
  mainWindow.webContents.openDevTools();
}

// App lifecycle handlers
app.on('ready', createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
