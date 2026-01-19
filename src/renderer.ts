/**
 * Renderer process - handles UI and Bluetooth communication
 */

import './index.css';
import { bluetoothService, FitnessData } from './bluetooth-service';

// DOM Elements
const scanBtn = document.getElementById('scan-btn') as HTMLButtonElement;
const disconnectBtn = document.getElementById('disconnect-btn') as HTMLButtonElement;
const deviceStatus = document.getElementById('device-status') as HTMLSpanElement;
const ftmsStatus = document.getElementById('ftms-status') as HTMLSpanElement;
const deviceListSection = document.getElementById('device-list-section') as HTMLElement;
const deviceList = document.getElementById('device-list') as HTMLDivElement;
const logContainer = document.getElementById('log') as HTMLDivElement;

// Data display elements
const powerValue = document.getElementById('power-value') as HTMLSpanElement;
const cadenceValue = document.getElementById('cadence-value') as HTMLSpanElement;
const hrValue = document.getElementById('hr-value') as HTMLSpanElement;
const speedValue = document.getElementById('speed-value') as HTMLSpanElement;

// Store the pending device from Web Bluetooth for connection
let pendingBluetoothDevice: BluetoothDevice | null = null;

// Utility: Add log entry
function log(message: string): void {
  const entry = document.createElement('div');
  entry.className = 'log-entry';
  const timestamp = new Date().toLocaleTimeString();
  entry.textContent = `[${timestamp}] ${message}`;
  logContainer.appendChild(entry);
  logContainer.scrollTop = logContainer.scrollHeight;
}

// Utility: Update data display
function updateDataDisplay(data: FitnessData): void {
  if (data.power !== undefined) {
    powerValue.textContent = Math.round(data.power).toString();
  }
  if (data.cadence !== undefined) {
    cadenceValue.textContent = Math.round(data.cadence).toString();
  }
  if (data.heartRate !== undefined) {
    hrValue.textContent = Math.round(data.heartRate).toString();
  }
  if (data.speed !== undefined) {
    speedValue.textContent = data.speed.toFixed(1);
  }
}

// Utility: Reset data display
function resetDataDisplay(): void {
  powerValue.textContent = '--';
  cadenceValue.textContent = '--';
  hrValue.textContent = '--';
  speedValue.textContent = '--';
}

// Utility: Update connection UI
function updateConnectionUI(connected: boolean, deviceName?: string): void {
  if (connected) {
    deviceStatus.textContent = deviceName || 'Connected';
    deviceStatus.classList.remove('disconnected');
    deviceStatus.classList.add('connected');
    scanBtn.disabled = true;
    disconnectBtn.disabled = false;
    deviceListSection.style.display = 'none';
  } else {
    deviceStatus.textContent = 'Not Connected';
    deviceStatus.classList.remove('connected');
    deviceStatus.classList.add('disconnected');
    scanBtn.disabled = false;
    disconnectBtn.disabled = true;
    resetDataDisplay();
  }
}

// Display found devices in the UI
function displayDevices(devices: Array<{ deviceId: string; deviceName: string }>): void {
  deviceList.innerHTML = '';

  if (devices.length === 0) {
    deviceList.innerHTML = '<div class="no-devices">No devices found. Try scanning again.</div>';
    deviceListSection.style.display = 'block';
    return;
  }

  devices.forEach((device) => {
    const item = document.createElement('div');
    item.className = 'device-item';
    item.innerHTML = `
      <div class="device-info">
        <div class="device-name">${device.deviceName || 'Unknown Device'}</div>
        <div class="device-id">${device.deviceId}</div>
      </div>
      <button class="btn btn-small btn-primary">Connect</button>
    `;

    // Handle device selection
    const connectBtn = item.querySelector('button');
    connectBtn?.addEventListener('click', () => {
      handleDeviceSelection(device.deviceId, device.deviceName);
    });

    deviceList.appendChild(item);
  });

  deviceListSection.style.display = 'block';
  log(`Found ${devices.length} device(s). Click one to connect.`);
}

// Handle device selection from the list
async function handleDeviceSelection(deviceId: string, deviceName: string): Promise<void> {
  log(`Selecting ${deviceName || 'Unknown'}...`);
  console.log('[Renderer] User clicked device:', deviceId);

  // Tell main process which device was selected
  if (window.electronAPI) {
    window.electronAPI.selectBluetoothDevice(deviceId);
  }

  // The pendingBluetoothDevice will be resolved by the requestDevice promise
  // Wait a moment for it to resolve, then connect
  deviceListSection.style.display = 'none';
}

// Check if Web Bluetooth is available
function checkBluetoothAvailability(): boolean {
  if (!bluetoothService.isAvailable()) {
    log('ERROR: Web Bluetooth is not available in this browser/environment');
    scanBtn.disabled = true;
    return false;
  }
  log('Web Bluetooth is available');
  return true;
}

// Handle scan button click
async function handleScan(): Promise<void> {
  log('Scanning for Bluetooth devices (3 seconds)...');
  console.log('[Renderer] handleScan called');
  scanBtn.disabled = true;
  scanBtn.textContent = 'Scanning...';
  deviceListSection.style.display = 'none';
  deviceList.innerHTML = '';

  // Tell main process to start fresh
  if (window.electronAPI) {
    window.electronAPI.startBluetoothScan();
  }

  try {
    console.log('[Renderer] Calling bluetoothService.scanForDevices()');
    // This triggers the Electron Bluetooth scanning
    // The main process will accumulate devices for 3 seconds
    // Then send them via 'bluetooth-scan-complete' event
    pendingBluetoothDevice = await bluetoothService.scanForDevices();

    console.log('[Renderer] scanForDevices resolved:', pendingBluetoothDevice?.name);

    if (pendingBluetoothDevice) {
      log(`Connecting to ${pendingBluetoothDevice.name || 'Unknown'}...`);
      await connectToDevice(pendingBluetoothDevice);
    }
  } catch (error) {
    console.log('[Renderer] Scan error:', error);
    log(`Scan error: ${(error as Error).message}`);
  } finally {
    scanBtn.disabled = false;
    scanBtn.textContent = 'Scan for Devices';
  }
}

// Connect to a Bluetooth device
async function connectToDevice(device: BluetoothDevice): Promise<void> {
  log(`Connecting to ${device.name || 'Unknown'}...`);

  try {
    await bluetoothService.connect(device);
    log(`Connected to ${device.name || 'Unknown'}`);
    updateConnectionUI(true, device.name || 'Unknown Device');
  } catch (error) {
    log(`Connection failed: ${(error as Error).message}`);
    updateConnectionUI(false);
  }
}

// Handle disconnect button click
async function handleDisconnect(): Promise<void> {
  log('Disconnecting...');
  await bluetoothService.disconnect();
  log('Disconnected');
  updateConnectionUI(false);
}

// Set up Bluetooth service callbacks
function setupBluetoothCallbacks(): void {
  // Handle fitness data updates
  bluetoothService.onData((data: FitnessData) => {
    updateDataDisplay(data);
  });

  // Handle connection status changes
  bluetoothService.onConnectionChange((connected, deviceInfo) => {
    if (connected && deviceInfo) {
      updateConnectionUI(true, deviceInfo.name);
    } else {
      updateConnectionUI(false);
      log('Device disconnected');
    }
  });
}

// Initialize the application
function init(): void {
  console.log('[Renderer] init() called');
  log('Initializing Trainerday Device Translator...');

  // Check Bluetooth availability
  if (!checkBluetoothAvailability()) {
    return;
  }

  // Set up event listeners
  scanBtn.addEventListener('click', handleScan);
  disconnectBtn.addEventListener('click', handleDisconnect);
  console.log('[Renderer] Event listeners attached');

  // Set up Bluetooth callbacks
  setupBluetoothCallbacks();

  // Listen for scan complete from main process
  if (window.electronAPI) {
    console.log('[Renderer] electronAPI available, setting up scan complete listener');
    window.electronAPI.onBluetoothScanComplete((devices) => {
      console.log('[Renderer] Scan complete, received devices:', devices.length);
      displayDevices(devices);
    });
  } else {
    console.log('[Renderer] electronAPI NOT available');
  }

  log('Ready. Click "Scan for Devices" to find fitness equipment.');
  console.log('[Renderer] Initialization complete');
}

// Start the application
init();
