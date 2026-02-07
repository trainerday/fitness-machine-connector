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
 */
async function handleScan(): Promise<void> {
  activityLog.log('Scanning for Bluetooth devices (3 seconds)...');

  statusIndicator.setScanning(true);
  deviceList.hide();
  awaitingScanResults = true;

  // Tell main process to start fresh scan
  if (window.electronAPI) {
    window.electronAPI.startBluetoothScan();
  }

  try {
    pendingBluetoothDevice = await fitnessReader.scanForDevices();

    if (pendingBluetoothDevice) {
      activityLog.log(`Connecting to ${pendingBluetoothDevice.name || 'Unknown'}...`);
      await connectToDevice(pendingBluetoothDevice);
    }
  } catch (error) {
    activityLog.log(`Scan error: ${(error as Error).message}`);
  } finally {
    statusIndicator.setScanning(false);
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
 */
async function handleDisconnect(): Promise<void> {
  activityLog.log('Disconnecting...');
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
    distance: data.distance ? Math.round(data.distance * 1000) : undefined, // Convert km to meters
    calories: data.calories,
    elapsedTime: data.duration,
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

  // When connection status changes, update the UI
  fitnessReader.onConnectionChange((connected, deviceName) => {
    if (connected && deviceName) {
      statusIndicator.setConnected(deviceName);
      startUpdateInterval();
    } else {
      stopUpdateInterval();
      statusIndicator.setDisconnected();
      dataDisplay.reset();
      activityLog.log('Device disconnected');
    }
  });
}

/**
 * Set up IPC listeners for main process communication.
 * Handles the device list display from Electron's Bluetooth scanning.
 */
function setupIpcListeners(): void {
  if (!window.electronAPI) {
    return;
  }

  window.electronAPI.onBluetoothScanComplete((devices: BluetoothDeviceInfo[]) => {
    // Only show devices if we're still waiting for scan results
    if (!awaitingScanResults) {
      return;
    }

    // Mark that we've received and displayed the results
    awaitingScanResults = false;

    deviceList.displayDevices(devices);
    activityLog.log(`Found ${devices.length} device(s). Click one to connect.`);
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

/**
 * Handle broadcast button click - toggle broadcasting on/off
 */
function handleBroadcastToggle(): void {
  if (!window.electronAPI) {
    activityLog.log('ERROR: Electron API not available');
    return;
  }

  if (statusIndicator.getIsBroadcasting()) {
    activityLog.log('Stopping FTMS broadcast...');
    window.electronAPI.broadcasterStop();
  } else {
    activityLog.log('Starting FTMS broadcast...');
    window.electronAPI.broadcasterStart();
  }
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
  statusIndicator.onBroadcastClick(handleBroadcastToggle);
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
