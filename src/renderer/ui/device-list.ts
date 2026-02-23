/**
 * Device list UI component - displays discovered Bluetooth devices
 * Supports real-time streaming of devices as they're discovered
 */

import { BluetoothDeviceInfo } from '../../shared/types';

// Known fitness device name patterns for filtering
const FITNESS_DEVICE_PATTERNS = [
  // Major fitness equipment brands
  /wahoo/i, /kickr/i, /garmin/i, /zwift/i, /tacx/i, /elite/i, /saris/i,
  /keiser/i, /wattbike/i, /stages/i, /assioma/i, /favero/i, /quarq/i,
  /power2max/i, /srm/i, /4iiii/i, /magene/i, /xoss/i, /coospo/i,
  /polar/i, /suunto/i, /coros/i, /moofit/i, /icg/i, /lifefitness/i,
  // Heart rate keywords
  /hr/i, /hrm/i, /heart/i, /pulse/i,
  // Cycling/fitness keywords
  /bike/i, /trainer/i, /cycling/i, /cadence/i, /speed/i, /power/i,
  /fitness/i, /spin/i, /indoor/i,
  // BLE fitness service indicators
  /ftms/i, /csc/i, /cps/i,
  // Home fitness brands
  /peloton/i, /echelon/i, /bowflex/i, /schwinn/i, /nordictrack/i,
  /concept2/i, /pm5/i, /ergometer/i, /rower/i,
  // App-specific
  /trainerday/i, /td\s/i,
];

export class DeviceList {
  private section: HTMLElement;
  private list: HTMLDivElement;
  private header: HTMLElement;
  private countBadge: HTMLSpanElement;
  private scanningIndicator: HTMLSpanElement;
  private filterToggle: HTMLButtonElement;
  private onDeviceSelect: ((deviceId: string, deviceName: string) => void) | null = null;
  private devices: Map<string, BluetoothDeviceInfo> = new Map();
  private isScanning = false;
  private showAllDevices = true; // Default to showing all devices

  constructor() {
    const section = document.getElementById('device-list-section');
    const list = document.getElementById('device-list');
    const header = document.getElementById('device-list-header');

    if (!section || !list || !header) {
      throw new Error('Device list elements not found');
    }

    this.section = section;
    this.list = list as HTMLDivElement;
    this.header = header;

    // Create count badge
    this.countBadge = document.createElement('span');
    this.countBadge.className = 'device-count-badge';
    this.countBadge.textContent = '0';

    // Create scanning indicator
    this.scanningIndicator = document.createElement('span');
    this.scanningIndicator.className = 'scanning-indicator';
    this.scanningIndicator.textContent = 'Scanning...';

    // Create filter toggle button
    this.filterToggle = document.createElement('button');
    this.filterToggle.className = 'btn btn-small btn-secondary filter-toggle';
    this.filterToggle.textContent = 'Fitness Only';
    this.filterToggle.addEventListener('click', () => this.toggleFilter());

    // Add elements to header
    this.header.appendChild(this.countBadge);
    this.header.appendChild(this.scanningIndicator);
    this.header.appendChild(this.filterToggle);
  }

  /**
   * Set callback for when user selects a device
   */
  onSelect(handler: (deviceId: string, deviceName: string) => void): void {
    this.onDeviceSelect = handler;
  }

  /**
   * Check if a device name matches fitness device patterns
   */
  private isFitnessDevice(deviceName: string): boolean {
    if (!deviceName) return false;
    return FITNESS_DEVICE_PATTERNS.some(pattern => pattern.test(deviceName));
  }

  /**
   * Add a single device to the list (for streaming updates)
   */
  addDevice(device: BluetoothDeviceInfo): void {
    // Skip if we already have this device
    if (this.devices.has(device.deviceId)) {
      return;
    }

    this.devices.set(device.deviceId, device);
    this.updateCountBadge();

    // Check if device should be visible based on filter
    const isFitness = this.isFitnessDevice(device.deviceName);
    const shouldShow = this.showAllDevices || isFitness;

    if (shouldShow) {
      // Remove "no devices" message before adding first visible device
      const noDevicesMsg = this.list.querySelector('.no-devices');
      if (noDevicesMsg) {
        noDevicesMsg.remove();
      }

      const item = this.createDeviceItem(device, isFitness);
      this.list.appendChild(item);
    }

    // Show the section
    this.section.style.display = 'block';
  }

  /**
   * Update the device count badge
   */
  private updateCountBadge(): void {
    const visibleCount = this.showAllDevices
      ? this.devices.size
      : Array.from(this.devices.values()).filter(d => this.isFitnessDevice(d.deviceName)).length;
    const totalCount = this.devices.size;

    if (this.showAllDevices) {
      this.countBadge.textContent = `${totalCount}`;
    } else {
      this.countBadge.textContent = `${visibleCount}/${totalCount}`;
    }
  }

  /**
   * Toggle between showing all devices and fitness devices only
   */
  private toggleFilter(): void {
    this.showAllDevices = !this.showAllDevices;
    this.filterToggle.textContent = this.showAllDevices ? 'Fitness Only' : 'Show All';
    this.refreshList();
  }

  /**
   * Refresh the displayed list based on current filter
   */
  private refreshList(): void {
    this.list.innerHTML = '';

    const devicesToShow = Array.from(this.devices.values())
      .filter(device => this.showAllDevices || this.isFitnessDevice(device.deviceName));

    if (devicesToShow.length === 0 && this.devices.size > 0) {
      this.list.innerHTML = `<div class="no-devices">No fitness devices found. Click "Show All" to see all ${this.devices.size} device(s).</div>`;
    } else if (devicesToShow.length === 0) {
      this.list.innerHTML = '<div class="no-devices">Searching for devices...</div>';
    } else {
      devicesToShow.forEach((device) => {
        const isFitness = this.isFitnessDevice(device.deviceName);
        const item = this.createDeviceItem(device, isFitness);
        this.list.appendChild(item);
      });
    }

    this.updateCountBadge();
  }

  /**
   * Set scanning state (shows/hides scanning indicator)
   */
  setScanning(scanning: boolean): void {
    this.isScanning = scanning;
    this.scanningIndicator.style.display = scanning ? 'inline-flex' : 'none';
  }

  /**
   * Clear all devices and prepare for new scan
   */
  clear(): void {
    this.devices.clear();
    this.list.innerHTML = '<div class="no-devices">Searching for devices...</div>';
    this.updateCountBadge();
    this.section.style.display = 'block';
  }

  /**
   * Create a device list item element
   */
  private createDeviceItem(device: BluetoothDeviceInfo, isFitness: boolean): HTMLDivElement {
    const item = document.createElement('div');
    item.className = 'device-item';
    item.dataset.deviceId = device.deviceId;

    const info = document.createElement('div');
    info.className = 'device-info';

    const nameRow = document.createElement('div');
    nameRow.className = 'device-name-row';

    const name = document.createElement('span');
    name.className = 'device-name';
    name.textContent = device.deviceName || 'Unknown Device';

    nameRow.appendChild(name);

    if (isFitness) {
      const badge = document.createElement('span');
      badge.className = 'fitness-badge';
      badge.textContent = 'FITNESS';
      nameRow.appendChild(badge);
    }

    const id = document.createElement('div');
    id.className = 'device-id';
    id.textContent = device.deviceId;

    info.appendChild(nameRow);
    info.appendChild(id);

    const connectBtn = document.createElement('button');
    connectBtn.className = 'btn btn-small btn-primary';
    connectBtn.textContent = 'Connect';
    connectBtn.addEventListener('click', () => {
      if (this.onDeviceSelect) {
        this.onDeviceSelect(device.deviceId, device.deviceName);
      }
    });

    item.appendChild(info);
    item.appendChild(connectBtn);

    return item;
  }

  /**
   * Hide the device list
   */
  hide(): void {
    this.section.style.display = 'none';
    this.devices.clear();
    this.list.innerHTML = '';
    this.setScanning(false);
  }

  /**
   * Show the device list section
   */
  show(): void {
    this.section.style.display = 'block';
  }
}
