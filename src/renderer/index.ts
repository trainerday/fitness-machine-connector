/**
 * Renderer process entry point
 * Coordinates UI components with Bluetooth service
 */

import '../styles/index.css';
import { ActivityLog, DataDisplay, StatusIndicator, DeviceList } from './ui';
import { bluetoothService } from './services';
import { FitnessData, BluetoothDeviceInfo } from '../shared/types';

// Store the pending device from Web Bluetooth for connection
let pendingBluetoothDevice: BluetoothDevice | null = null;

// Track if we're waiting for scan results (prevents showing list after selection)
let awaitingScanResults = false;

// UI Components
let activityLog: ActivityLog;
let dataDisplay: DataDisplay;
let statusIndicator: StatusIndicator;
let deviceList: DeviceList;

/**
 * Check if Web Bluetooth is available
 */
function checkBluetoothAvailability(): boolean {
  if (!bluetoothService.isAvailable()) {
    activityLog.log('ERROR: Web Bluetooth is not available in this browser/environment');
    statusIndicator.disableScan();
    return false;
  }
  activityLog.log('Web Bluetooth is available');
  return true;
}

/**
 * Handle scan button click
 */
async function handleScan(): Promise<void> {
  activityLog.log('Scanning for Bluetooth devices (3 seconds)...');
  console.log('[Renderer] handleScan called');

  statusIndicator.setScanning(true);
  deviceList.hide();
  awaitingScanResults = true;

  // Tell main process to start fresh
  if (window.electronAPI) {
    window.electronAPI.startBluetoothScan();
  }

  try {
    console.log('[Renderer] Calling bluetoothService.scanForDevices()');
    pendingBluetoothDevice = await bluetoothService.scanForDevices();

    console.log('[Renderer] scanForDevices resolved:', pendingBluetoothDevice?.name);

    if (pendingBluetoothDevice) {
      activityLog.log(`Connecting to ${pendingBluetoothDevice.name || 'Unknown'}...`);
      await connectToDevice(pendingBluetoothDevice);
    }
  } catch (error) {
    console.log('[Renderer] Scan error:', error);
    activityLog.log(`Scan error: ${(error as Error).message}`);
  } finally {
    statusIndicator.setScanning(false);
  }
}

/**
 * Handle device selection from the list
 */
function handleDeviceSelection(deviceId: string, deviceName: string): void {
  activityLog.log(`Selecting ${deviceName || 'Unknown'}...`);
  console.log('[Renderer] User clicked device:', deviceId);

  // Stop listening for scan results
  awaitingScanResults = false;

  // Tell main process which device was selected
  if (window.electronAPI) {
    window.electronAPI.selectBluetoothDevice(deviceId);
  }

  deviceList.hide();
}

/**
 * Connect to a Bluetooth device
 */
async function connectToDevice(device: BluetoothDevice): Promise<void> {
  activityLog.log(`Connecting to ${device.name || 'Unknown'}...`);

  try {
    await bluetoothService.connect(device);
    activityLog.log(`Connected to ${device.name || 'Unknown'}`);
    statusIndicator.setConnected(device.name || 'Unknown Device');
  } catch (error) {
    activityLog.log(`Connection failed: ${(error as Error).message}`);
    statusIndicator.setDisconnected();
  }
}

/**
 * Handle disconnect button click
 */
async function handleDisconnect(): Promise<void> {
  activityLog.log('Disconnecting...');
  await bluetoothService.disconnect();
  activityLog.log('Disconnected');
  statusIndicator.setDisconnected();
  dataDisplay.reset();
}

/**
 * Set up Bluetooth service callbacks
 */
function setupBluetoothCallbacks(): void {
  // Handle fitness data updates
  bluetoothService.onData((data: FitnessData) => {
    dataDisplay.update(data);
  });

  // Handle connection status changes
  bluetoothService.onConnectionChange((connected, deviceInfo) => {
    if (connected && deviceInfo) {
      statusIndicator.setConnected(deviceInfo.name);
    } else {
      statusIndicator.setDisconnected();
      dataDisplay.reset();
      activityLog.log('Device disconnected');
    }
  });
}

/**
 * Set up IPC listeners for main process communication
 */
function setupIpcListeners(): void {
  if (!window.electronAPI) {
    console.log('[Renderer] electronAPI NOT available');
    return;
  }

  console.log('[Renderer] electronAPI available, setting up scan complete listener');

  window.electronAPI.onBluetoothScanComplete((devices: BluetoothDeviceInfo[]) => {
    console.log('[Renderer] Scan complete, received devices:', devices.length);

    // Only show devices if we're still waiting for scan results
    if (!awaitingScanResults) {
      console.log('[Renderer] Ignoring scan results - device already selected');
      return;
    }

    // Mark that we've received and displayed the results
    awaitingScanResults = false;

    deviceList.displayDevices(devices);
    activityLog.log(`Found ${devices.length} device(s). Click one to connect.`);
  });
}

/**
 * Initialize the application
 */
function init(): void {
  console.log('[Renderer] init() called');

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
  console.log('[Renderer] Event listeners attached');

  // Set up Bluetooth callbacks
  setupBluetoothCallbacks();

  // Set up IPC listeners
  setupIpcListeners();

  activityLog.log('Ready. Click "Scan for Devices" to find fitness equipment.');
  console.log('[Renderer] Initialization complete');
}

// Start the application
init();
