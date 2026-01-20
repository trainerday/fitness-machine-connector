/**
 * Device list UI component - displays discovered Bluetooth devices
 */

import { BluetoothDeviceInfo } from '../../shared/types';

export class DeviceList {
  private section: HTMLElement;
  private list: HTMLDivElement;
  private onDeviceSelect: ((deviceId: string, deviceName: string) => void) | null = null;

  constructor() {
    const section = document.getElementById('device-list-section');
    const list = document.getElementById('device-list');

    if (!section || !list) {
      throw new Error('Device list elements not found');
    }

    this.section = section;
    this.list = list as HTMLDivElement;
  }

  /**
   * Set callback for when user selects a device
   */
  onSelect(handler: (deviceId: string, deviceName: string) => void): void {
    this.onDeviceSelect = handler;
  }

  /**
   * Display the list of discovered devices
   */
  displayDevices(devices: BluetoothDeviceInfo[]): void {
    this.list.innerHTML = '';

    if (devices.length === 0) {
      this.list.innerHTML = '<div class="no-devices">No devices found. Try scanning again.</div>';
      this.section.style.display = 'block';
      return;
    }

    devices.forEach((device) => {
      const item = this.createDeviceItem(device);
      this.list.appendChild(item);
    });

    this.section.style.display = 'block';
  }

  /**
   * Create a device list item element
   */
  private createDeviceItem(device: BluetoothDeviceInfo): HTMLDivElement {
    const item = document.createElement('div');
    item.className = 'device-item';

    const info = document.createElement('div');
    info.className = 'device-info';

    const name = document.createElement('div');
    name.className = 'device-name';
    name.textContent = device.deviceName || 'Unknown Device';

    const id = document.createElement('div');
    id.className = 'device-id';
    id.textContent = device.deviceId;

    info.appendChild(name);
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
    this.list.innerHTML = '';
  }

  /**
   * Show the device list section
   */
  show(): void {
    this.section.style.display = 'block';
  }
}
