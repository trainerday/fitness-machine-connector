/**
 * Device list UI component - displays discovered Bluetooth devices.
 * Trusted devices (previously connected) always sort to the top with a ★ badge,
 * and can be filtered to exclusively with the Trusted toggle.
 */

import { BluetoothDeviceInfo, TrustedDevice } from '../../shared/types';

// Name patterns used only for the FITNESS badge — not for filtering
const FITNESS_DEVICE_PATTERNS = [
  /wahoo/i, /kickr/i, /garmin/i, /zwift/i, /tacx/i, /elite/i, /saris/i,
  /keiser/i, /wattbike/i, /stages/i, /assioma/i, /favero/i, /quarq/i,
  /power2max/i, /srm/i, /4iiii/i, /magene/i, /xoss/i, /coospo/i,
  /polar/i, /suunto/i, /coros/i, /moofit/i, /icg/i, /lifefitness/i,
  /hr/i, /hrm/i, /heart/i, /pulse/i,
  /bike/i, /trainer/i, /cycling/i, /cadence/i, /speed/i, /power/i,
  /fitness/i, /spin/i, /indoor/i,
  /ftms/i, /csc/i, /cps/i,
  /peloton/i, /echelon/i, /bowflex/i, /schwinn/i, /nordictrack/i,
  /concept2/i, /pm5/i, /ergometer/i, /rower/i,
  /trainerday/i, /td\s/i,
];

export class DeviceList {
  private section: HTMLElement;
  private list: HTMLDivElement;
  private header: HTMLElement;
  private countBadge: HTMLSpanElement;
  private scanningIndicator: HTMLSpanElement;
  private trustedToggle: HTMLButtonElement;
  private fitnessToggle: HTMLButtonElement;
  private usbToggle: HTMLButtonElement;
  private onDeviceSelect: ((deviceId: string, deviceName: string, protocol?: string) => void) | null = null;
  private onTrustDevice: ((id: string, name: string) => void) | null = null;
  private devices: Map<string, BluetoothDeviceInfo> = new Map();
  private trustedIds: Set<string> = new Set();
  private isScanning = false;
  private activeFilter: 'trusted' | 'fitness' | 'usb' | null = null;
  private searchQuery = '';

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

    this.countBadge = document.createElement('span');
    this.countBadge.className = 'device-count-badge';
    this.countBadge.textContent = '0';

    this.scanningIndicator = document.createElement('span');
    this.scanningIndicator.className = 'scanning-indicator';
    this.scanningIndicator.textContent = 'Scanning...';

    this.trustedToggle = document.createElement('button');
    this.trustedToggle.className = 'btn btn-small btn-secondary filter-toggle';
    this.trustedToggle.textContent = 'Trusted';
    this.trustedToggle.addEventListener('click', () => this.setFilter('trusted'));

    this.fitnessToggle = document.createElement('button');
    this.fitnessToggle.className = 'btn btn-small btn-secondary filter-toggle';
    this.fitnessToggle.textContent = 'Fitness';
    this.fitnessToggle.addEventListener('click', () => this.setFilter('fitness'));

    this.usbToggle = document.createElement('button');
    this.usbToggle.className = 'btn btn-small btn-secondary filter-toggle';
    this.usbToggle.textContent = 'USB';
    this.usbToggle.addEventListener('click', () => this.setFilter('usb'));

    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.className = 'device-search';
    searchInput.placeholder = 'Search devices...';
    searchInput.addEventListener('input', () => {
      this.searchQuery = searchInput.value.trim().toLowerCase();
      this.refreshList();
    });

    this.header.appendChild(this.countBadge);
    this.header.appendChild(this.scanningIndicator);
    this.header.appendChild(this.trustedToggle);
    this.header.appendChild(this.fitnessToggle);
    this.header.appendChild(this.usbToggle);
    this.header.appendChild(searchInput);
  }

  onSelect(handler: (deviceId: string, deviceName: string, protocol?: string) => void): void {
    this.onDeviceSelect = handler;
  }

  onTrust(handler: (id: string, name: string) => void): void {
    this.onTrustDevice = handler;
  }

  setTrustedDevices(trusted: TrustedDevice[]): void {
    this.trustedIds = new Set(trusted.map(d => d.id));
  }

  addDevice(device: BluetoothDeviceInfo): void {
    if (this.devices.has(device.deviceId)) return;

    this.devices.set(device.deviceId, device);
    this.updateCountBadge();

    const isTrusted = this.trustedIds.has(device.deviceId);
    const visible = this.isVisible(device, isTrusted);

    if (visible) {
      const noDevicesMsg = this.list.querySelector('.no-devices');
      if (noDevicesMsg) noDevicesMsg.remove();

      const item = this.createDeviceItem(device, isTrusted);

      // Trusted devices always go above non-trusted ones
      if (isTrusted) {
        const firstNonTrusted = this.list.querySelector('.device-item:not(.device-item--trusted)');
        this.list.insertBefore(item, firstNonTrusted ?? null);
      } else {
        this.list.appendChild(item);
      }
    }

    this.section.style.display = 'block';
  }

  removeDevice(deviceId: string): void {
    this.devices.delete(deviceId);
    this.updateCountBadge();

    const item = this.list.querySelector(`[data-device-id="${deviceId}"]`);
    if (item) item.remove();

    if (this.list.children.length === 0) {
      this.list.innerHTML = '<div class="no-devices">Searching for devices...</div>';
    }
  }

  private isVisible(device: BluetoothDeviceInfo, isTrusted: boolean): boolean {
    if (this.activeFilter === 'trusted' && !isTrusted) return false;
    if (this.activeFilter === 'fitness' && !this.isFitnessDevice(device.deviceName)) return false;
    if (this.activeFilter === 'usb' && device.protocol !== 'ant-plus' && device.protocol !== 'direct-usb') return false;
    if (!this.matchesSearch(device.deviceName)) return false;
    return true;
  }

  private matchesSearch(deviceName: string): boolean {
    if (!this.searchQuery) return true;
    return deviceName.toLowerCase().includes(this.searchQuery);
  }

  private isFitnessDevice(deviceName: string): boolean {
    if (!deviceName) return false;
    return FITNESS_DEVICE_PATTERNS.some(pattern => pattern.test(deviceName));
  }

  private setFilter(filter: 'trusted' | 'fitness' | 'usb'): void {
    this.activeFilter = this.activeFilter === filter ? null : filter;
    this.trustedToggle.classList.toggle('active', this.activeFilter === 'trusted');
    this.fitnessToggle.classList.toggle('active', this.activeFilter === 'fitness');
    this.usbToggle.classList.toggle('active', this.activeFilter === 'usb');
    this.refreshList();
  }

  private updateCountBadge(): void {
    const total = this.devices.size;
    const visible = Array.from(this.devices.values()).filter(d =>
      this.isVisible(d, this.trustedIds.has(d.deviceId))
    ).length;
    this.countBadge.textContent = visible === total ? `${total}` : `${visible}/${total}`;
  }

  private refreshList(): void {
    this.list.innerHTML = '';

    const allDevices = Array.from(this.devices.values());
    const trusted = allDevices.filter(d => this.trustedIds.has(d.deviceId) && this.isVisible(d, true));
    const others  = allDevices.filter(d => !this.trustedIds.has(d.deviceId) && this.isVisible(d, false));

    const devicesToShow = [...trusted, ...others];

    if (devicesToShow.length === 0 && this.devices.size > 0) {
      this.list.innerHTML = `<div class="no-devices">No devices match the current filters (${this.devices.size} found).</div>`;
    } else if (devicesToShow.length === 0) {
      this.list.innerHTML = '<div class="no-devices">Searching for devices...</div>';
    } else {
      devicesToShow.forEach(device => {
        const isTrusted = this.trustedIds.has(device.deviceId);
        this.list.appendChild(this.createDeviceItem(device, isTrusted));
      });
    }

    this.updateCountBadge();
  }

  setScanning(scanning: boolean): void {
    this.isScanning = scanning;
    this.scanningIndicator.style.display = scanning ? 'inline-flex' : 'none';
  }

  clear(): void {
    this.devices.clear();
    this.list.innerHTML = '<div class="no-devices">Searching for devices...</div>';
    this.updateCountBadge();
    this.section.style.display = 'block';
  }

  private createDeviceItem(device: BluetoothDeviceInfo, isTrusted: boolean): HTMLDivElement {
    const item = document.createElement('div');
    item.className = `device-item${isTrusted ? ' device-item--trusted' : ''}`;
    item.dataset.deviceId = device.deviceId;

    const info = document.createElement('div');
    info.className = 'device-info';

    const nameRow = document.createElement('div');
    nameRow.className = 'device-name-row';

    const name = document.createElement('span');
    name.className = 'device-name';
    name.textContent = device.deviceName || 'Unknown Device';
    nameRow.appendChild(name);

    if (this.isFitnessDevice(device.deviceName)) {
      const badge = document.createElement('span');
      badge.className = 'fitness-badge';
      badge.textContent = 'FITNESS';
      nameRow.appendChild(badge);
    }

    if (device.protocol === 'ant-plus' || device.protocol === 'direct-usb') {
      const protoBadge = document.createElement('span');
      protoBadge.className = 'protocol-badge protocol-badge--usb';
      protoBadge.textContent = device.protocol === 'ant-plus' ? 'ANT+' : 'USB';
      nameRow.appendChild(protoBadge);
    } else {
      const protoBadge = document.createElement('span');
      protoBadge.className = 'protocol-badge protocol-badge--ble';
      protoBadge.textContent = 'BLE';
      nameRow.appendChild(protoBadge);
    }

    const id = document.createElement('div');
    id.className = 'device-id';
    id.textContent = device.deviceId;

    info.appendChild(nameRow);
    info.appendChild(id);

    const right = document.createElement('div');
    right.className = 'device-item-right';

    if (isTrusted) {
      const star = document.createElement('span');
      star.className = 'trusted-star';
      star.textContent = '★';
      star.title = 'Trusted device';
      right.appendChild(star);
    }

    const connectBtn = document.createElement('button');
    connectBtn.className = 'btn btn-small btn-primary';
    connectBtn.textContent = 'Connect';
    connectBtn.addEventListener('click', () => {
      // Mark as trusted on first connect
      if (!this.trustedIds.has(device.deviceId)) {
        this.trustedIds.add(device.deviceId);
        this.onTrustDevice?.(device.deviceId, device.deviceName);
      }
      this.onDeviceSelect?.(device.deviceId, device.deviceName, device.protocol);
    });

    right.appendChild(connectBtn);

    item.appendChild(info);
    item.appendChild(right);

    return item;
  }

  hide(): void {
    this.section.style.display = 'none';
    this.devices.clear();
    this.list.innerHTML = '';
    this.setScanning(false);
  }

  show(): void {
    this.section.style.display = 'block';
  }
}
