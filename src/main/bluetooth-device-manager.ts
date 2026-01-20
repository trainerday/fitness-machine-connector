/**
 * Manages Bluetooth device discovery and selection in the main process
 */

const SCAN_DURATION_MS = 3000;

export class BluetoothDeviceManager {
  private devices: Map<string, Electron.BluetoothDevice> = new Map();
  private selectCallback: ((deviceId: string) => void) | null = null;
  private scanTimeout: NodeJS.Timeout | null = null;
  private onScanComplete: ((devices: Electron.BluetoothDevice[]) => void) | null = null;

  /**
   * Set callback to be called when scan completes
   */
  setOnScanComplete(callback: (devices: Electron.BluetoothDevice[]) => void): void {
    this.onScanComplete = callback;
  }

  /**
   * Handle incoming device from Electron's select-bluetooth-device event
   */
  handleDeviceDiscovered(
    devices: Electron.BluetoothDevice[],
    callback: (deviceId: string) => void
  ): void {
    // Store the callback for later use when user selects a device
    this.selectCallback = callback;

    // Accumulate devices (use Map to deduplicate by deviceId)
    devices.forEach((device) => {
      if (!this.devices.has(device.deviceId)) {
        console.log(`[BluetoothDeviceManager] New device: ${device.deviceName || 'Unknown'} (${device.deviceId})`);
        this.devices.set(device.deviceId, device);
      }
    });

    // Start the scan timeout if not already started
    if (!this.scanTimeout) {
      console.log(`[BluetoothDeviceManager] Starting ${SCAN_DURATION_MS}ms scan timer...`);
      this.scanTimeout = setTimeout(() => {
        this.completeScan();
      }, SCAN_DURATION_MS);
    }
  }

  /**
   * Complete the scan and notify listeners
   */
  private completeScan(): void {
    console.log(`[BluetoothDeviceManager] Scan complete. Found ${this.devices.size} devices.`);

    const deviceList = Array.from(this.devices.values());

    if (this.onScanComplete) {
      this.onScanComplete(deviceList);
    }

    this.scanTimeout = null;
  }

  /**
   * Handle user selecting a device from the list
   */
  selectDevice(deviceId: string): void {
    console.log(`[BluetoothDeviceManager] User selected device: ${deviceId}`);

    if (this.selectCallback) {
      this.selectCallback(deviceId);
      this.selectCallback = null;
      this.devices.clear();
    }
  }

  /**
   * Cancel the current Bluetooth request
   */
  cancelRequest(): void {
    console.log('[BluetoothDeviceManager] Bluetooth request cancelled');

    if (this.selectCallback) {
      this.selectCallback('');
      this.selectCallback = null;
    }

    this.clearScanState();
  }

  /**
   * Reset for a new scan
   */
  startNewScan(): void {
    console.log('[BluetoothDeviceManager] New scan requested, clearing previous devices');
    this.clearScanState();
  }

  /**
   * Clear all scan-related state
   */
  private clearScanState(): void {
    this.devices.clear();

    if (this.scanTimeout) {
      clearTimeout(this.scanTimeout);
      this.scanTimeout = null;
    }
  }
}
