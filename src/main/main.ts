/**
 * Main process entry point - handles window lifecycle
 */

import { app, BrowserWindow, Tray, Menu, nativeImage, powerMonitor } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { BluetoothDeviceManager } from './bluetooth-device-manager';
import { BluetoothBroadcaster } from './bluetooth-broadcaster';
import { setupIpcHandlers } from './ipc-handlers';
import { stopPowerSaveBlocker } from './power-manager';
import { loadLastDevice } from './device-persistence';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

// Tray instance
let tray: Tray | null = null;

// Main window reference
let mainWindow: BrowserWindow | null = null;

// Track if we're actually quitting vs just hiding
let isQuitting = false;

// Create device manager instance
const deviceManager = new BluetoothDeviceManager();

// Create broadcaster instance
const broadcaster = new BluetoothBroadcaster();

// Set up IPC handlers
setupIpcHandlers(deviceManager, broadcaster);

/**
 * Create a simple tray icon programmatically
 * Uses a base64-encoded 16x16 PNG that works on Windows and macOS
 */
function createTrayIcon(): nativeImage {
  // A simple 16x16 cyan circle PNG (base64 encoded)
  // This is a placeholder - replace with a proper icon file for production
  const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAAbwAAAG8B8aLcQwAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAAEKSURBVDiNpZMxSwNBEIW/2dwlRhQLC4sUgpVYWFj4AyxE8A9Y+QMs/QMWFoKFhYWFIFhYWAQLC0GwsBBBsLAQBAsLQbAQc7e7FnfJ5S53AT9YZob35r2ZWfg3JL9EOAvcAOfANrAErABV4BPogrcDfAPnwCJQAcrAF3AKPAOOE+apiBGzyCvwCBwCGWA88bWAXaABZKYBWozhGNgA6sCqDzAkugM8AMf/FIzNwLbN8ApsA2sEcxjEHc4xrAMt4AJY/gtgR9QVMAi6owcYxDtQHRNUgW9gyQewEbMDYBRsBA0CVjE2AGQD/wrgBajEY6gBbaAQY/qmcM/Wvg4sJ+lXwDq7HwR9+wsrNU6R0xUdDwAAAABJRU5ErkJggg==';

  const icon = nativeImage.createFromDataURL(`data:image/png;base64,${pngBase64}`);

  // Mark as template image on macOS (adapts to light/dark mode)
  if (process.platform === 'darwin') {
    icon.setTemplateImage(true);
  }

  return icon;
}

/**
 * Create the system tray with context menu
 */
function createTray(): void {
  const icon = createTrayIcon();
  tray = new Tray(icon);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Window',
      click: () => {
        mainWindow?.show();
        mainWindow?.focus();
        if (process.platform === 'darwin') {
          app.dock?.show();
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setToolTip('Trainerday Device Translator');
  tray.setContextMenu(contextMenu);

  // On Windows/Linux, clicking the tray icon shows the window
  // On macOS, this is handled by the context menu
  tray.on('click', () => {
    if (process.platform !== 'darwin') {
      mainWindow?.show();
      mainWindow?.focus();
    }
  });
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // Hide window instead of closing (minimize to tray)
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow?.hide();

      // On macOS, also hide from dock when minimized to tray
      if (process.platform === 'darwin') {
        app.dock?.hide();
      }
    }
  });

  // Handle Bluetooth device selection from Web Bluetooth API
  mainWindow.webContents.on('select-bluetooth-device', (event, devices, callback) => {
    event.preventDefault();
    console.log(`[Main] select-bluetooth-device fired with ${devices.length} device(s)`);
    deviceManager.handleDeviceDiscovered(devices, callback);
  });

  // Stream discovered devices to renderer as they're found
  deviceManager.setOnDeviceFound((device) => {
    mainWindow?.webContents.send('bluetooth-device-found', device);
  });

  // Load the app
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }
}

// App lifecycle handlers
app.on('ready', () => {
  createWindow();
  createTray();
  setupPowerMonitor();
  setupAutoStart();

  // Attempt auto-reconnect on startup if we have a saved device
  const lastDevice = loadLastDevice();
  console.log('[Main] Startup - checking for saved device:', lastDevice);
  if (lastDevice) {
    console.log('[Main] Found saved device, will attempt auto-reconnect:', lastDevice.name);
    // Give the renderer time to initialize, then trigger reconnect
    setTimeout(() => {
      console.log('[Main] Sending attempt-reconnect to renderer...');
      mainWindow?.webContents.send('attempt-reconnect', lastDevice);
    }, 2000);
  } else {
    console.log('[Main] No saved device found on startup');
  }
});

/**
 * Configure app to start automatically on login
 */
function setupAutoStart(): void {
  // Only set up auto-start in production (not during development)
  if (!app.isPackaged) {
    console.log('[Main] Skipping auto-start setup in development mode');
    return;
  }

  app.setLoginItemSettings({
    openAtLogin: true,
    openAsHidden: true, // Start minimized to tray
  });
  console.log('[Main] Auto-start on login enabled');
}

/**
 * Set up power monitor to detect sleep/wake events
 */
function setupPowerMonitor(): void {
  powerMonitor.on('resume', () => {
    console.log('[Main] System resumed from sleep, attempting reconnect...');
    const lastDevice = loadLastDevice();
    if (lastDevice && mainWindow) {
      mainWindow.webContents.send('attempt-reconnect', lastDevice);
    }
  });

  powerMonitor.on('suspend', () => {
    console.log('[Main] System going to sleep...');
  });
}

app.on('window-all-closed', () => {
  // Don't quit when all windows are closed - we're running in the tray
  // On macOS this is the default behavior anyway
});

// Clean up on quit
app.on('before-quit', () => {
  isQuitting = true;
  stopPowerSaveBlocker();
  broadcaster.stop();
});

app.on('activate', () => {
  // On macOS, re-show the window when clicking the dock icon
  if (mainWindow) {
    mainWindow.show();
    app.dock?.show();
  } else {
    createWindow();
  }
});