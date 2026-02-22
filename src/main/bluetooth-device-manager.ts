/**
 * Manages Bluetooth device discovery and selection in the main process
 */

export class BluetoothDeviceManager {
  private devices: Map<string, Electron.BluetoothDevice> = new Map();
  private selectCallback: ((deviceId: string) => void) | null = null;
  private onDeviceFound: ((device: Electron.BluetoothDevice) => void) | null = null;
  private isScanning = false;

  /**
   * Set callback to be called when a new device is discovered
   */
  setOnDeviceFound(callback: (device: Electron.BluetoothDevice) => void): void {
    this.onDeviceFound = callback;
  }

  /**
   * Handle incoming device from Electron's select-bluetooth-device event
   * Streams devices to the renderer as they're discovered
   */
  handleDeviceDiscovered(
    devices: Electron.BluetoothDevice[],
    callback: (deviceId: string) => void
  ): void {
    // Store the callback for later use when user selects a device
    this.selectCallback = callback;
    this.isScanning = true;

    // Stream new devices as they're discovered
    devices.forEach((device) => {
      if (!this.devices.has(device.deviceId)) {
        console.log(`[BluetoothDeviceManager] New device: ${device.deviceName || 'Unknown'} (${device.deviceId})`);
        this.devices.set(device.deviceId, device);

        // Immediately notify renderer of new device
        if (this.onDeviceFound) {
          this.onDeviceFound(device);
        }
      }
    });
  }

  /**
   * Handle user selecting a device from the list
   */
  selectDevice(deviceId: string): void {
    console.log(`[BluetoothDeviceManager] User selected device: ${deviceId}`);

    if (this.selectCallback) {
      this.selectCallback(deviceId);
      this.selectCallback = null;
    }

    // Clear state after selection
    this.devices.clear();
    this.isScanning = false;
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
   * Reset for a new scan - clears device list for fresh discovery
   */
  startNewScan(): void {
    console.log('[BluetoothDeviceManager] New scan requested, clearing previous devices');
    this.clearScanState();
  }

  /**
   * Check if currently scanning
   */
  getIsScanning(): boolean {
    return this.isScanning;
  }

  /**
   * Clear all scan-related state
   */
  private clearScanState(): void {
    this.devices.clear();
    this.isScanning = false;
  }
}
