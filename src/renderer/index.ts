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
 */
async function handleScan(): Promise<void> {
  // If user manually clicks scan, exit auto-reconnect mode
  if (!autoReconnectMode) {
    activityLog.log('Scanning for Bluetooth devices...');
  }

  // Clear previous results and show scanning state (unless in auto-reconnect mode)
  deviceList.clear();
  if (!autoReconnectMode) {
    deviceList.setScanning(true);
    statusIndicator.setScanning(true);
  }
  awaitingScanResults = true;

  // Tell main process to start fresh scan
  if (window.electronAPI) {
    window.electronAPI.startBluetoothScan();
  }

  try {
    pendingBluetoothDevice = await fitnessReader.scanForDevices();

    if (pendingBluetoothDevice) {
      deviceList.setScanning(false);
      statusIndicator.setScanning(false);
      activityLog.log(`Connecting to ${pendingBluetoothDevice.name || 'Unknown'}...`);
      await connectToDevice(pendingBluetoothDevice);
    } else if (autoReconnectMode) {
      // Scan completed without finding the auto-reconnect target
      activityLog.log(`Could not find ${autoReconnectDeviceName} - device may be off or out of range`);
      autoReconnectMode = false;
      autoReconnectDeviceName = null;
    }
  } catch (error) {
    activityLog.log(`Scan error: ${(error as Error).message}`);
    deviceList.setScanning(false);
    statusIndicator.setScanning(false);
    // Reset auto-reconnect state on error
    autoReconnectMode = false;
    autoReconnectDeviceName = null;
  }
}

// =============================================================================
// DEVICE SELECTION
// =============================================================================

/**
 * Handle device selection from the displayed list.
 * Called when user clicks a device in the list.
 */
function handleDeviceSelection(deviceId: string, deviceName: string): void {
  activityLog.log(`Selecting ${deviceName || 'Unknown'}...`);

  // Stop listening for scan results
  awaitingScanResults = false;
  deviceList.setScanning(false);
  statusIndicator.setScanning(false);

  // Tell main process which device was selected
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
  }

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
    console.log(`[Renderer] Device found: ${device.deviceName || 'Unknown'} (${device.deviceId})`);

    // Check if this is the device we're trying to auto-reconnect to
    if (autoReconnectMode && autoReconnectDeviceName && device.deviceName === autoReconnectDeviceName) {
      console.log(`[Renderer] Found auto-reconnect target: ${device.deviceName}`);
      activityLog.log(`Found ${device.deviceName}, connecting...`);

      // Reset auto-reconnect state
      autoReconnectMode = false;
      autoReconnectDeviceName = null;

      // Auto-select this device (this will trigger connection)
      handleDeviceSelection(device.deviceId, device.deviceName);
      return;
    }

    // Only add devices to the list if we're waiting for scan results (not in auto-reconnect mode)
    if (!awaitingScanResults) {
      console.log('[Renderer] Ignoring device - not awaiting scan results');
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

    // Set up auto-reconnect mode - will silently scan and connect when device is found
    autoReconnectMode = true;
    autoReconnectDeviceName = device.name;
    activityLog.log(`Looking for ${device.name}...`);

    // Trigger a scan - the device discovery handler will auto-connect when it finds the device
    console.log('[Renderer] Starting silent scan for auto-reconnect');
    handleScan();
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
 * Initialize the application.
 * Sets up UI components, callbacks, and event listeners.
 */
function init(): void {
  // Initialize UI components
  activityLog = new ActivityLog('log');
  dataDisplay = new DataDisplay();
  statusIndicator = new StatusIndicator();
  deviceList = new DeviceList();

  activityLog.log('Initializing Trainerday Device Translator...');

  // Check Bluetooth availability
  if (!checkBluetoothAvailability()) {
    return;
  }

  // Set up UI event handlers
  statusIndicator.onScanClick(handleScan);
  statusIndicator.onDisconnectClick(handleDisconnect);
  deviceList.onSelect(handleDeviceSelection);

  // Set up fitness reader callbacks
  setupFitnessReaderCallbacks();

  // Set up IPC listeners for Electron
  setupIpcListeners();

  activityLog.log('Ready. Click "Scan for Devices" to find fitness equipment.');
}

// =============================================================================
// START APPLICATION
// =============================================================================

init();
