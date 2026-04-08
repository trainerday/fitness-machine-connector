/**
 * Main process entry point - handles window lifecycle
 */

import { app, BrowserWindow, Tray, Menu, shell, nativeImage, powerMonitor, session, ipcMain } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { BluetoothDeviceManager } from './bluetooth-device-manager';
import { BluetoothBroadcaster } from './bluetooth-broadcaster';
import { UsbDeviceManager, UsbFitnessDevice } from './usb-device-manager';
import { AntAdapter, AntSensorDevice } from './ant-adapter';
import { setupIpcHandlers } from './ipc-handlers';
import { stopPowerSaveBlocker } from './power-manager';
import { loadLastDevice, loadPersistedBluetoothDevices, saveBluetoothDevicePermission } from './device-persistence';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

// Single-instance lock: if a second instance is launched (e.g. clicking the desktop icon
// while already running in the tray), quit the new instance and focus the existing window.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  // Exit immediately - don't set up anything else
  app.quit();
}

// Tray instance
let tray: Tray | null = null;

// Main window reference
let mainWindow: BrowserWindow | null = null;

// Track if we're actually quitting vs just hiding
let isQuitting = false;

// Only initialize these if we have the single-instance lock
// (deferred to prevent second instance from creating resources)
let deviceManager: BluetoothDeviceManager | null = null;
let broadcaster: BluetoothBroadcaster | null = null;
let usbDeviceManager: UsbDeviceManager | null = null;

// One AntAdapter per physical ANT+ stick (keyed by stick deviceId from UsbDeviceManager)
const antAdapters = new Map<string, AntAdapter>();

// Set up second-instance handler (only matters for the first instance)
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    if (process.platform === 'darwin') {
      app.dock?.show();
    }
  }
});

// Enable experimental Web Bluetooth features including getDevices()
app.commandLine.appendSwitch('enable-experimental-web-platform-features');
app.commandLine.appendSwitch('enable-web-bluetooth-new-permissions-backend');

/**
 * Resolve the path to an asset file.
 * In dev: src/assets/<filename> (relative to project root)
 * In prod: <filename> copied to the app's resources folder via extraResource
 */
function getAssetPath(filename: string): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, filename)
    : path.join(app.getAppPath(), 'src/assets', filename);
}

/**
 * Load the tray icon from disk.
 */
function createTrayIcon(): Electron.NativeImage {
  const iconPath = getAssetPath('fitbridge-logo.png');

  let icon = nativeImage.createFromPath(iconPath);

  // macOS tray icons must be ~16x16 (or 18x18); resize and mark as template
  // so the OS automatically adapts it to light/dark mode.
  if (process.platform === 'darwin') {
    icon = icon.resize({ width: 16, height: 16 });
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
    height: 900,
    icon: getAssetPath('fitbridge-logo.png'),
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
    deviceManager?.handleDeviceDiscovered(devices, callback);
  });

  // Stream discovered devices to renderer as they're found
  deviceManager?.setOnDeviceFound((device) => {
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
  // Don't initialize if we're the second instance (should never reach here, but defensive check)
  if (!gotSingleInstanceLock) return;

  // Set application menu — minimal but includes Help > Contact Support
  const menu = Menu.buildFromTemplate([
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      role: 'window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' },
      ],
    },
    {
      role: 'help',
      submenu: [
        {
          label: 'Contact Support',
          click: () => shell.openExternal('mailto:dand@prakitkconsulting.com?subject=FitBridge Support'),
        },
      ],
    },
  ]);
  Menu.setApplicationMenu(menu);

  // Initialize managers only when we have the lock and app is ready
  deviceManager = new BluetoothDeviceManager();
  broadcaster = new BluetoothBroadcaster();
  usbDeviceManager = new UsbDeviceManager();
  setupIpcHandlers(deviceManager, broadcaster, onDeviceDisconnected);
  setupUsbDeviceManager();

  setupBluetoothPermissions();
  createWindow();
  createTray();
  setupPowerMonitor();
  setupAutoStart();

  // Start the .NET backend immediately
  console.log('[Main] Starting .NET BLE backend...');
  broadcaster.start();

  // Forward fitness data from .NET to renderer
  broadcaster.on('fitnessData', (data) => {
    mainWindow?.webContents.send('fitness-data-from-dotnet', data);
  });

  // Listen for disconnection events from broadcaster
  broadcaster.on('deviceDisconnected', onDeviceDisconnected);

  // Attempt auto-reconnect after window loads
  mainWindow?.webContents.on('did-finish-load', () => {
    // Small delay to ensure .NET backend is ready
    setTimeout(() => attemptAutoReconnect(), 2000);
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

// =============================================================================
// DEVICE LOOKOUT MODE
// =============================================================================
// Continuously watches for the saved device in the background.
// When the device appears (e.g., user turns on their bike), auto-connects.
// This creates a "virtual assistant" experience - user just turns on equipment.

let lookoutInterval: NodeJS.Timeout | null = null;
let lookoutActive = false;
let lookoutDeviceName: string | null = null;
let isConnected = false;

const LOOKOUT_SCAN_DURATION = 5; // Short 5-second scans
const LOOKOUT_INTERVAL_MS = 8000; // Scan every 8 seconds (5s scan + 3s pause)

/**
 * Start lookout mode - continuously scan for the saved device
 * Runs silently in the background until device is found or user takes action
 */
function startLookoutMode(): void {
  const savedDevice = loadLastDevice();

  if (!savedDevice) {
    console.log('[Lookout] No saved device, skipping lookout mode');
    return;
  }

  if (lookoutActive) {
    console.log('[Lookout] Already active');
    return;
  }

  if (isConnected) {
    console.log('[Lookout] Already connected, skipping lookout mode');
    return;
  }

  console.log(`[Lookout] Starting lookout for: ${savedDevice.name} (platform: ${process.platform})`);
  lookoutActive = true;
  lookoutDeviceName = savedDevice.name.toLowerCase();

  // Make sure broadcaster is running
  if (broadcaster && !broadcaster.isRunning()) {
    console.log('[Lookout] Starting .NET backend...');
    broadcaster.start();
  }

  // Both macOS and Windows use executeJavaScript to trigger Web Bluetooth auto-reconnect.
  // The .NET backend stays running only for FTMS broadcasting — source device data
  // always flows through the Web Bluetooth path (characteristicvaluechanged events)
  // because the WinRT BLE stack doesn't reliably fire ValueChanged notifications.

  // Notify renderer that lookout is active
  mainWindow?.webContents.send('lookout-status', {
    active: true,
    deviceName: savedDevice.name,
  });

  // Start the first scan immediately
  doLookoutScan();

  // Set up repeating scans
  lookoutInterval = setInterval(() => {
    if (lookoutActive && !isConnected) {
      doLookoutScan();
    }
  }, LOOKOUT_INTERVAL_MS);
}

/**
 * Perform a single lookout scan
 */
function doLookoutScan(): void {
  if (!lookoutActive || isConnected) return;

  // All platforms: use executeJavaScript with userGesture=true to trigger Web Bluetooth.
  // This bypasses the "user gesture required" restriction for requestDevice() and uses
  // Chromium's BLE stack, which reliably delivers characteristicvaluechanged notifications.
  const savedDevice = loadLastDevice();
  if (savedDevice && mainWindow) {
    console.log(`[Lookout] Attempting reconnect to ${savedDevice.name}`);

    // Tell device manager to auto-select this device the moment it appears.
    deviceManager?.setAutoReconnect(savedDevice.name, () => {
      console.log(`[Lookout] Device ${savedDevice.name} was auto-selected`);
    });

    // Clear device cache so the device re-appears as "new" on next scan.
    deviceManager?.startNewScan();

    const payload = JSON.stringify(savedDevice);
    mainWindow.webContents.executeJavaScript(
      `window.__autoReconnect && window.__autoReconnect(${payload})`,
      true // userGesture = true — allows requestDevice() inside
    ).catch(() => {});
  }
}

/**
 * Stop lookout mode
 * Called when: device connects, user manually scans, or user disconnects
 */
function stopLookoutMode(): void {
  if (!lookoutActive) return;

  console.log('[Lookout] Stopping lookout mode');
  lookoutActive = false;
  lookoutDeviceName = null;

  if (lookoutInterval) {
    clearInterval(lookoutInterval);
    lookoutInterval = null;
  }

  broadcaster?.stopScan();

  // Notify renderer
  mainWindow?.webContents.send('lookout-status', { active: false });
}

/**
 * Called when user manually initiates a scan - pause lookout
 */
function pauseLookoutForManualScan(): void {
  if (lookoutActive) {
    console.log('[Lookout] Pausing for manual scan');
    stopLookoutMode();
  }
}

/**
 * Called when device disconnects - restart lookout
 */
function onDeviceDisconnected(): void {
  console.log('[Lookout] Device disconnected, restarting lookout...');
  isConnected = false;

  // Small delay before restarting lookout (let things settle)
  setTimeout(() => {
    if (!isConnected) {
      startLookoutMode();
    }
  }, 2000);
}

/**
 * Legacy function name for compatibility - now starts lookout mode
 */
function attemptAutoReconnect(): void {
  startLookoutMode();
}

// =============================================================================
// USB / ANT+ DEVICE MANAGEMENT
// =============================================================================

/**
 * Wire up UsbDeviceManager events and ANT+ IPC handlers.
 * Called once on app ready, after usbDeviceManager and broadcaster are created.
 */
function setupUsbDeviceManager(): void {
  if (!usbDeviceManager) return;

  // When a fitness USB device is plugged in (or found at startup)
  usbDeviceManager.on('deviceFound', (usbDevice: UsbFitnessDevice) => {
    console.log(`[USB] Device found: ${usbDevice.deviceName} (${usbDevice.deviceId})`);

    if (usbDevice.protocol === 'ant-plus') {
      const adapter = new AntAdapter(usbDevice);
      antAdapters.set(usbDevice.deviceId, adapter);

      // When this stick finds a nearby wireless ANT+ sensor → push to renderer device list
      adapter.on('antDeviceFound', (sensor: AntSensorDevice) => {
        console.log(`[USB] ANT+ sensor discovered: ${sensor.deviceName}`);
        mainWindow?.webContents.send('usb-device-found', {
          deviceId: sensor.deviceId,
          deviceName: sensor.deviceName,
          protocol: 'ant-plus',
        });
      });

      // When the adapter produces parsed fitness data → feed directly into broadcaster
      adapter.on('data', (output) => {
        broadcaster?.sendData(output);
      });

      adapter.on('error', (err: Error) => {
        console.error(`[USB] ANT+ adapter error: ${err.message}`);
      });

      // Start scanning for nearby ANT+ sensors immediately
      adapter.startScan();
    }
  });

  // When a fitness USB stick is unplugged
  usbDeviceManager.on('deviceLost', (stickDeviceId: string) => {
    console.log(`[USB] Device lost: ${stickDeviceId}`);

    const adapter = antAdapters.get(stickDeviceId);
    if (adapter) {
      adapter.disconnect();
      antAdapters.delete(stickDeviceId);
    }

    mainWindow?.webContents.send('usb-device-lost', stickDeviceId);
  });

  usbDeviceManager.start();
}

// User selected an ANT+ sensor from the device list
ipcMain.on('usb-connect-device', (_event, sensorDeviceId: string) => {
  console.log(`[USB] Connecting to sensor: ${sensorDeviceId}`);

  // Find which adapter owns this sensor (sensor IDs encode the ANT device number)
  for (const adapter of antAdapters.values()) {
    adapter.connect(sensorDeviceId);
    return;
  }

  console.warn(`[USB] No adapter found for sensor: ${sensorDeviceId}`);
});

// User disconnected an ANT+ sensor
ipcMain.on('usb-disconnect-device', () => {
  console.log('[USB] Disconnecting ANT+ sensor');
  antAdapters.forEach(adapter => adapter.disconnect());
});

// Pause lookout when user manually initiates a scan
ipcMain.on('start-bluetooth-scan', () => {
  pauseLookoutForManualScan();
});

// On Mac, Web Bluetooth connection success is signalled by broadcaster-start.
// Stop lookout so we don't keep scanning after connecting.
ipcMain.on('broadcaster-start', () => {
  if (lookoutActive) {
    console.log('[Lookout] Device connected (broadcaster started), stopping lookout');
    isConnected = true;
    stopLookoutMode();
  }
});

app.on('window-all-closed', () => {
  // Don't quit when all windows are closed - we're running in the tray
  // On macOS this is the default behavior anyway
});

// Clean up on quit
app.on('before-quit', () => {
  isQuitting = true;
  stopPowerSaveBlocker();
  broadcaster?.stop();
  antAdapters.forEach(adapter => adapter.disconnect());
  antAdapters.clear();
  usbDeviceManager?.stop();
});

app.on('activate', () => {
  // Don't do anything if we're the second instance
  if (!gotSingleInstanceLock) return;

  // On macOS, re-show the window when clicking the dock icon
  if (mainWindow) {
    mainWindow.show();
    app.dock?.show();
  } else {
    createWindow();
  }
});