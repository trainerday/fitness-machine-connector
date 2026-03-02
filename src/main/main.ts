/**
 * Main process entry point - handles window lifecycle
 */

import { app, BrowserWindow, Tray, Menu, nativeImage, powerMonitor, session } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { BluetoothDeviceManager } from './bluetooth-device-manager';
import { BluetoothBroadcaster } from './bluetooth-broadcaster';
import { setupIpcHandlers } from './ipc-handlers';
import { stopPowerSaveBlocker } from './power-manager';
import { loadLastDevice, loadPersistedBluetoothDevices, saveBluetoothDevicePermission } from './device-persistence';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

// Enable experimental Web Bluetooth features including getDevices()
app.commandLine.appendSwitch('enable-experimental-web-platform-features');
app.commandLine.appendSwitch('enable-web-bluetooth-new-permissions-backend');

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
  setupBluetoothPermissions();
  createWindow();
  createTray();
  setupPowerMonitor();
  setupAutoStart();

  // Attempt auto-reconnect after window loads
  mainWindow?.webContents.on('did-finish-load', () => {
    attemptAutoReconnect();
  });
});

/**
 * Set up Bluetooth device permission handlers
 * This allows navigator.bluetooth.getDevices() to return previously connected devices
 */
function setupBluetoothPermissions(): void {
  // Load persisted device permissions
  const persistedDevices = loadPersistedBluetoothDevices();
  console.log('[Main] Loaded persisted Bluetooth devices:', persistedDevices.length);

  // Grant permissions for previously connected devices
  session.defaultSession.setDevicePermissionHandler((details) => {
    if (details.deviceType === 'bluetooth') {
      console.log('[Main] Device permission check:', details.device);

      // Check if this device was previously granted permission
      const isGranted = persistedDevices.some(
        (d) => d.deviceId === details.device.deviceId
      );

      if (isGranted) {
        console.log('[Main] Device permission granted (persisted):', details.device.deviceName);
        return true;
      }

      // For new devices, grant permission and persist it
      console.log('[Main] Granting new device permission:', details.device.deviceName);
      saveBluetoothDevicePermission(details.device);
      return true;
    }
    return false;
  });

  // Allow permission checks to pass for Bluetooth
  session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    if (permission === 'bluetooth') {
      return true;
    }
    return true; // Allow other permissions by default
  });
}

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
    attemptAutoReconnect();
  });

  powerMonitor.on('suspend', () => {
    console.log('[Main] System going to sleep...');
  });
}

/**
 * Attempt to auto-reconnect to the last connected device
 * Triggers a scan from main process and auto-selects when device is found
 */
function attemptAutoReconnect(): void {
  const savedDevice = loadLastDevice();

  if (!savedDevice) {
    console.log('[Main] No saved device for auto-reconnect');
    return;
  }

  console.log(`[Main] Attempting auto-reconnect to: ${savedDevice.name}`);

  // Set up auto-reconnect mode - will auto-select when device is found
  deviceManager.setAutoReconnect(savedDevice.name, (success, deviceId) => {
    if (success) {
      console.log(`[Main] Auto-reconnect successful: ${deviceId}`);
    } else {
      console.log('[Main] Auto-reconnect failed - device not found');
    }
  });

  // Trigger scan from main process (bypasses gesture requirement)
  mainWindow?.webContents.executeJavaScript(`
    (async () => {
      try {
        console.log('[AutoReconnect] Main process triggering scan...');
        // This will trigger the select-bluetooth-device event in main
        const device = await navigator.bluetooth.requestDevice({
          acceptAllDevices: true,
          optionalServices: [0x1816, 0x1818, 0x180D, 0x1826]
        });
        console.log('[AutoReconnect] Device selected:', device.name);
        // Connection will be handled by the normal flow
        return true;
      } catch (error) {
        console.log('[AutoReconnect] Scan failed:', error.message);
        return false;
      }
    })()
  `).then((result) => {
    console.log('[Main] Auto-reconnect scan result:', result);
  }).catch((error) => {
    console.error('[Main] Auto-reconnect scan error:', error);
    deviceManager.clearAutoReconnect();
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