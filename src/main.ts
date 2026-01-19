import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

// Store discovered Bluetooth devices
let bluetoothDevices: Map<string, Electron.BluetoothDevice> = new Map();
let selectBluetoothCallback: ((deviceId: string) => void) | null = null;
let scanTimeout: NodeJS.Timeout | null = null;
const SCAN_DURATION_MS = 3000;

const createWindow = () => {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // Handle Bluetooth device selection
  mainWindow.webContents.on('select-bluetooth-device', (event, devices, callback) => {
    event.preventDefault();

    // Store the callback for later use when user selects a device
    selectBluetoothCallback = callback;

    // Accumulate devices (use Map to deduplicate by deviceId)
    devices.forEach((device) => {
      if (!bluetoothDevices.has(device.deviceId)) {
        console.log(`[Main] New device: ${device.deviceName || 'Unknown'} (${device.deviceId})`);
        bluetoothDevices.set(device.deviceId, device);
      }
    });

    // Start the scan timeout if not already started
    if (!scanTimeout) {
      console.log(`[Main] Starting ${SCAN_DURATION_MS}ms scan timer...`);
      scanTimeout = setTimeout(() => {
        console.log(`[Main] Scan complete. Found ${bluetoothDevices.size} devices.`);

        // Convert Map to array and send to renderer
        const deviceList = Array.from(bluetoothDevices.values());
        mainWindow.webContents.send('bluetooth-scan-complete', deviceList);

        // Reset for next scan (but keep callback for selection)
        scanTimeout = null;
      }, SCAN_DURATION_MS);
    }
  });

  // Handle device selection from renderer
  const { ipcMain } = require('electron');

  ipcMain.on('select-bluetooth-device', (_event, deviceId: string) => {
    console.log(`[Main] User selected device: ${deviceId}`);
    if (selectBluetoothCallback) {
      selectBluetoothCallback(deviceId);
      selectBluetoothCallback = null;
      bluetoothDevices.clear(); // Clear for next scan
    }
  });

  ipcMain.on('cancel-bluetooth-request', () => {
    console.log('[Main] Bluetooth request cancelled');
    if (selectBluetoothCallback) {
      selectBluetoothCallback('');
      selectBluetoothCallback = null;
    }
    if (scanTimeout) {
      clearTimeout(scanTimeout);
      scanTimeout = null;
    }
    bluetoothDevices.clear();
  });

  // Reset device list when starting a new scan
  ipcMain.on('start-bluetooth-scan', () => {
    console.log('[Main] New scan requested, clearing previous devices');
    bluetoothDevices.clear();
    if (scanTimeout) {
      clearTimeout(scanTimeout);
      scanTimeout = null;
    }
  });

  // and load the index.html of the app.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  // Open the DevTools.
  mainWindow.webContents.openDevTools();
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', createWindow);

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
