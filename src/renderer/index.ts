/**
 * =============================================================================
 * RENDERER ENTRY POINT
 * =============================================================================
 *
 * Purpose:
 *   Main entry point for the renderer process.
 *   Coordinates UI components and handles user interactions.
 *
 * Architecture:
 *   This file only interacts with:
 *   - UI components (ActivityLog, DataDisplay, StatusIndicator, DeviceList)
 *   - FitnessDataReader (the single service interface for all fitness data)
 *   - Electron IPC (for device selection flow)
 *
 *   It does NOT know about:
 *   - Bluetooth protocols or raw data
 *   - Data parsing or byte formats
 *   - Low-level device communication
 *
 * =============================================================================
 */

import '../styles/index.css';
import { ActivityLog, DataDisplay, StatusIndicator, DeviceList } from './ui';
import { FitnessDataReader } from './services';
import { BluetoothDeviceInfo, FitnessData, FtmsOutput } from '../shared/types';

// =============================================================================
// STATE
// =============================================================================

/** Device returned from Web Bluetooth requestDevice() */
let pendingBluetoothDevice: BluetoothDevice | null = null;

/** Tracks if we're waiting for scan results (prevents showing list after selection) */
let awaitingScanResults = false;

/** Tracks if a requestDevice() call is already in flight - prevents concurrent scans */
let scanInProgress = false;

/** Tracks if we're in auto-reconnect mode (silent scan, no UI) */
let autoReconnectMode = false;

/** The device name we're trying to auto-reconnect to */
let autoReconnectDeviceName: string | null = null;

/** Latest fitness data, updated on every BLE event but only consumed once per second */
let latestFitnessData: FitnessData | null = null;

/** Interval handle for the 1-second update loop (display + broadcast) */
let updateInterval: ReturnType<typeof setInterval> | null = null;

// =============================================================================
// UI COMPONENTS
// =============================================================================

let activityLog: ActivityLog;
let dataDisplay: DataDisplay;
let statusIndicator: StatusIndicator;
let deviceList: DeviceList;

// =============================================================================
// SERVICES
// =============================================================================

/** Single interface for all fitness data operations */
const fitnessReader = new FitnessDataReader();

// =============================================================================
// BLUETOOTH AVAILABILITY
// =============================================================================

/**
 * Check if Bluetooth is available and update UI accordingly.
 */
function checkBluetoothAvailability(): boolean {
  if (!fitnessReader.isAvailable()) {
    activityLog.log('ERROR: Web Bluetooth is not available in this browser/environment');
    statusIndicator.disableScan();
    return false;
  }
  activityLog.log('Web Bluetooth is available');
  return true;
}

// =============================================================================
// SCAN HANDLING
// =============================================================================

/**
 * Handle scan button click.
 * Initiates device scanning and connection flow.
 * Can be clicked anytime to restart scanning.
 * @param manual - true when triggered by the user (resets auto-reconnect state)
 */
async function handleScan(manual = false): Promise<void> {
  // Always refresh the UI and device cache regardless of whether a scan is running
  deviceList.clear();

  if (manual) {
    // User clicked scan — cancel any pending auto-reconnect so the list isn't suppressed
    autoReconnectMode = false;
    autoReconnectDeviceName = null;
  }

  if (!autoReconnectMode) {
    activityLog.log('Scanning for Bluetooth devices...');
    deviceList.setScanning(true);
    statusIndicator.setScanning(true);

    // Tell main process to clear its device cache so devices re-appear as new.
    // On macOS, select-bluetooth-device fires continuously, so clearing the cache
    // is enough to repopulate the list without needing a new requestDevice() call.
    // NOTE: do NOT send this during auto-reconnect — it triggers pauseLookoutForManualScan()
    // which stops the lookout permanently.
    if (window.electronAPI) {
      window.electronAPI.startBluetoothScan();
    }
  }
  awaitingScanResults = true;

  // Only start requestDevice() if one isn't already running.
  // On macOS the same call stays alive across rescans - we just refresh the cache.
  if (scanInProgress) {
    console.log('[Scan] Reusing existing requestDevice() call');
    return;
  }

  scanInProgress = true;
  try {
    pendingBluetoothDevice = await fitnessReader.scanForDevices();

    if (pendingBluetoothDevice) {
      deviceList.setScanning(false);
      statusIndicator.setScanning(false);
      activityLog.log(`Connecting to ${pendingBluetoothDevice.name || 'Unknown'}...`);
      await connectToDevice(pendingBluetoothDevice);
    } else if (autoReconnectMode) {
      activityLog.log(`Could not find ${autoReconnectDeviceName} - device may be off or out of range`);
      autoReconnectMode = false;
      autoReconnectDeviceName = null;
    }
  } catch (error) {
    activityLog.log(`Scan error: ${(error as Error).message}`);
    deviceList.setScanning(false);
    statusIndicator.setScanning(false);
    autoReconnectMode = false;
    autoReconnectDeviceName = null;
  } finally {
    scanInProgress = false;
  }
}

// =============================================================================
// DEVICE SELECTION
// =============================================================================

/**
 * Handle device selection from the displayed list.
 * Called when user clicks a device in the list.
 */
function handleDeviceSelection(deviceId: string, deviceName: string, protocol?: string): void {
  activityLog.log(`Selecting ${deviceName || 'Unknown'}...`);

  const isUsb = protocol === 'ant-plus' || protocol === 'direct-usb';

  if (isUsb) {
    // USB / ANT+ path: main process owns the connection, no BLE scan to resolve
    if (window.electronAPI) {
      window.electronAPI.connectUsbDevice(deviceId);
    }
    deviceList.hide();
    statusIndicator.setConnected(deviceName);
    startUpdateInterval();
    return;
  }

  // BLE path (existing behaviour)
  awaitingScanResults = false;
  scanInProgress = false;
  deviceList.setScanning(false);
  statusIndicator.setScanning(false);

  if (window.electronAPI) {
    window.electronAPI.selectBluetoothDevice(deviceId);
  }

  deviceList.hide();
}

// =============================================================================
// CONNECTION HANDLING
// =============================================================================

/**
 * Connect to a Bluetooth device.
 */
async function connectToDevice(device: BluetoothDevice): Promise<void> {
  activityLog.log(`Connecting to ${device.name || 'Unknown'}...`);

  try {
    await fitnessReader.connect(device);
    activityLog.log(`Connected to ${device.name || 'Unknown'}`);
    statusIndicator.setConnected(device.name || 'Unknown Device');
  } catch (error) {
    activityLog.log(`Connection failed: ${(error as Error).message}`);
    statusIndicator.setDisconnected();
  }
}

/**
 * Handle disconnect button click.
 * Clears saved device since user explicitly chose to disconnect.
 */
async function handleDisconnect(): Promise<void> {
  activityLog.log('Disconnecting...');

  // Clear saved device - user explicitly disconnected
  if (window.electronAPI) {
    window.electronAPI.clearLastDevice();

    // Stop FTMS broadcast
    window.electronAPI.broadcasterStop();

    // Tell .NET backend to disconnect from source device
    window.electronAPI.broadcasterDisconnect();
  }

  // Stop the update interval (stops data display updates)
  stopUpdateInterval();

  // Disconnect Web Bluetooth connection (if any)
  await fitnessReader.disconnect();

  activityLog.log('Disconnected');
  statusIndicator.setDisconnected();
  dataDisplay.reset();
}

// =============================================================================
// CALLBACKS SETUP
// =============================================================================

/**
 * Convert FitnessData to FtmsOutput format for broadcasting.
 */
function convertToFtmsOutput(data: FitnessData): FtmsOutput {
  return {
    power: data.power ?? 0,
    cadence: data.cadence ?? 0,
    heartRate: data.heartRate,
  };
}

/**
 * Set up callbacks for fitness data and connection changes.
 */
function setupFitnessReaderCallbacks(): void {
  // When fitness data arrives, merge into stored values.
  // Different characteristics (FTMS, HR, etc.) fire independently,
  // so we merge to keep all fields up to date.
  // The 1-second interval handles both display and broadcasting.
  fitnessReader.onFitnessData((data) => {
    latestFitnessData = { ...latestFitnessData, ...data };
  });

  // When connection status changes, update the UI and manage broadcasting
  fitnessReader.onConnectionChange((connected, deviceName) => {
    if (connected && deviceName) {
      statusIndicator.setConnected(deviceName);
      startUpdateInterval();

      // Save connected device for auto-reconnection
      const deviceInfo = fitnessReader.getConnectedDevice();
      console.log('[Renderer] Device info for save:', deviceInfo);
      if (window.electronAPI && deviceInfo) {
        console.log('[Renderer] Saving device:', deviceInfo.name, deviceInfo.id);
        window.electronAPI.saveLastDevice(deviceInfo);
      } else {
        console.log('[Renderer] Could not save device - electronAPI:', !!window.electronAPI, 'deviceInfo:', !!deviceInfo);
      }

      // Auto-start FTMS broadcast when device connects
      if (window.electronAPI) {
        activityLog.log('Starting FTMS broadcast...');
        window.electronAPI.broadcasterStart();
      }
    } else {
      stopUpdateInterval();
      statusIndicator.setDisconnected();
      dataDisplay.reset();
      activityLog.log('Device disconnected');
      // Auto-stop FTMS broadcast when device disconnects
      if (window.electronAPI) {
        window.electronAPI.broadcasterStop();
      }
    }
  });
}

/**
 * Set up IPC listeners for main process communication.
 * Handles streaming device updates from Electron's Bluetooth scanning.
 */
function setupIpcListeners(): void {
  if (!window.electronAPI) {
    return;
  }

  // Listen for devices as they're discovered (streaming)
  window.electronAPI.onBluetoothDeviceFound((device: BluetoothDeviceInfo) => {
    console.log(`[Scan] Device found: ${device.deviceName || 'Unknown'} (${device.deviceId})`);

    // Check if this is the device we're trying to auto-reconnect to
    if (autoReconnectMode && autoReconnectDeviceName) {
      console.log(`[AutoReconnect] Checking: "${device.deviceName}" === "${autoReconnectDeviceName}" ?`);

      if (device.deviceName === autoReconnectDeviceName) {
        devLog(`Found ${device.deviceName}! Connecting...`);

        // Reset auto-reconnect state
        autoReconnectMode = false;
        autoReconnectDeviceName = null;

        // Auto-select this device (this will trigger connection)
        handleDeviceSelection(device.deviceId, device.deviceName);
        return;
      }
    }

    // Only add devices to the list if we're waiting for scan results (not in auto-reconnect mode)
    if (!awaitingScanResults) {
      console.log('[Scan] Ignoring device - not awaiting scan results');
      return;
    }

    // Don't show device list during auto-reconnect
    if (autoReconnectMode) {
      return;
    }

    deviceList.addDevice(device);
  });

  // Listen for broadcaster status updates
  window.electronAPI.onBroadcasterStatus((status) => {
    statusIndicator.setBroadcasterStatus(status);
    activityLog.log(`FTMS Broadcast: ${status.state}${status.error ? ` - ${status.error}` : ''}`);
  });

  // Listen for broadcaster log messages
  window.electronAPI.onBroadcasterLog((message) => {
    activityLog.log(`Broadcaster: ${message}`);
  });

  // Listen for auto-reconnect requests (from wake or startup)
  console.log('[Renderer] Setting up onAttemptReconnect listener');
  window.electronAPI.onAttemptReconnect(async (device) => {
    console.log('[Renderer] Received attempt-reconnect:', device);

    // Don't try to reconnect if already connected
    if (fitnessReader.isConnected()) {
      console.log('[Renderer] Already connected, skipping reconnect');
      return;
    }

    // On Mac, auto-reconnect is handled via executeJavaScript (userGesture=true) in handleAutoReconnect().
    // This IPC path is used on Windows (wake from sleep) or as a fallback.
    await handleAutoReconnect(device);
  });

  // Listen for device connection from .NET backend (bypasses Web Bluetooth)
  window.electronAPI.onDeviceConnectedViaDotnet((device) => {
    console.log('[Renderer] Device connected via .NET:', device);
    activityLog.log(`Connected to ${device.name} (via .NET)`);
    statusIndicator.setConnected(device.name);
    deviceList.hide();

    // Start the update interval for display/broadcast
    startUpdateInterval();

    // Auto-reconnect was successful, clear the mode
    autoReconnectMode = false;
    autoReconnectDeviceName = null;
  });

  // Listen for fitness data from .NET backend
  window.electronAPI.onFitnessDataFromDotnet((data) => {
    // Update latest fitness data (will be consumed by update interval)
    latestFitnessData = {
      power: data.power ?? 0,
      cadence: data.cadence ?? 0,
      heartRate: data.heartRate ?? 0,
      speed: 0,
      distance: 0,
      resistance: 0,
    };
  });

  // Listen for auto-reconnect failure
  window.electronAPI.onAutoReconnectFailed((info) => {
    console.log('[Renderer] Auto-reconnect failed:', info);
    activityLog.log(`Auto-reconnect failed: ${info.reason}`);

    // Show alert to user
    alert(`Could not reconnect to "${info.deviceName}"\n\n${info.reason}\n\nClick "Scan for Devices" to connect manually.`);
  });

  // Listen for lookout mode status (background scanning)
  window.electronAPI.onLookoutStatus((status) => {
    console.log('[Renderer] Lookout status:', status);
    if (status.active && status.deviceName) {
      activityLog.log(`Looking for ${status.deviceName}...`);
      statusIndicator.setLookout(status.deviceName);
    } else {
      statusIndicator.clearLookout();
    }
  });

  // USB / ANT+ device events — appear in the same list as BLE devices
  window.electronAPI.onUsbDeviceFound((device) => {
    console.log(`[USB] Device found: ${device.deviceName} (${device.deviceId})`);
    deviceList.addDevice(device);
  });

  window.electronAPI.onUsbDeviceLost((deviceId) => {
    console.log(`[USB] Device lost: ${deviceId}`);
    deviceList.removeDevice(deviceId);
  });
}

// =============================================================================
// BROADCAST HANDLING
// =============================================================================

/**
 * Start the 1-second interval that updates the display and sends data to the broadcaster.
 */
function startUpdateInterval(): void {
  stopUpdateInterval();
  updateInterval = setInterval(() => {
    if (!latestFitnessData) return;

    // Update display once per second
    dataDisplay.update(latestFitnessData);

    // Forward to broadcaster if broadcasting
    if (window.electronAPI && statusIndicator.getIsBroadcasting()) {
      window.electronAPI.broadcasterSendData(convertToFtmsOutput(latestFitnessData));
    }
  }, 1000);
}

/**
 * Stop the update interval and clear stored data.
 */
function stopUpdateInterval(): void {
  if (updateInterval) {
    clearInterval(updateInterval);
    updateInterval = null;
  }
  latestFitnessData = null;
}

// =============================================================================
// INITIALIZATION
// =============================================================================

/**
 * Auto-reconnect handler called by main process via executeJavaScript with userGesture=true.
 * This allows requestDevice() to run without a real user gesture on macOS.
 */
async function handleAutoReconnect(device: { name: string; id: string }): Promise<void> {
  if (fitnessReader.isConnected()) return;

  // Try getDevices() first (instant, no scan needed if device was previously paired)
  const success = await fitnessReader.reconnect(device.name);
  if (success) {
    activityLog?.log(`Reconnected to ${device.name}`);
    return;
  }

  // Fall back to requestDevice() scan with auto-select
  autoReconnectMode = true;
  autoReconnectDeviceName = device.name;
  handleScan();
}

// Expose for executeJavaScript calls from main process
(window as any).__autoReconnect = handleAutoReconnect;

/**
 * Initialize the application.
 * Sets up UI components, callbacks, and event listeners.
 */
async function init(): Promise<void> {
  // Initialize UI components
  activityLog = new ActivityLog('log');
  dataDisplay = new DataDisplay();
  statusIndicator = new StatusIndicator();
  deviceList = new DeviceList();

  activityLog.log('Initializing FitBridge...');

  // Check Bluetooth availability
  if (!checkBluetoothAvailability()) {
    return;
  }

  // Set up UI event handlers
  statusIndicator.onScanClick(() => handleScan(true));
  statusIndicator.onDisconnectClick(handleDisconnect);
  deviceList.onSelect(handleDeviceSelection);

  // Set up fitness reader callbacks
  setupFitnessReaderCallbacks();

  // Set up IPC listeners for Electron
  setupIpcListeners();

  // Note: Auto-reconnect is handled by the main process
  // It triggers requestDevice() via executeJavaScript which bypasses gesture requirement

  activityLog.log('Ready. Click "Scan for Devices" to find fitness equipment.');
}

/**
 * Log to both console and activity log for easier debugging
 */
function devLog(message: string, data?: unknown): void {
  if (data !== undefined) {
    console.log(`[AutoReconnect] ${message}`, data);
  } else {
    console.log(`[AutoReconnect] ${message}`);
  }
  // Only log to activity log if it's initialized
  if (activityLog) {
    activityLog.log(message);
  }
}


// =============================================================================
// START APPLICATION
// =============================================================================

init();
