/**
 * Manages USB device discovery for fitness hardware.
 *
 * Detects known fitness USB devices (ANT+ sticks, direct USB trainers) by VID/PID.
 * Emits unified device events so the renderer can display USB devices alongside BLE
 * devices in the same list.
 *
 * Two categories of USB fitness hardware:
 *   - 'ant-stick'  : A radio transceiver (e.g. Garmin USB2). Detecting the stick
 *                    enables a secondary wireless ANT+ scan for nearby sensors.
 *   - 'direct-usb' : The fitness device itself (e.g. older wired trainers).
 *                    Detecting the device IS discovering the device.
 */

import { EventEmitter } from 'events';
import { usb, getDeviceList, Device } from 'usb';

// =============================================================================
// KNOWN FITNESS USB HARDWARE
// =============================================================================

interface UsbHardwareSpec {
  vendorId: number;
  productId: number;
  name: string;
  type: 'ant-stick' | 'direct-usb';
}

const KNOWN_FITNESS_USB: UsbHardwareSpec[] = [
  // Garmin / Dynastream ANT+ sticks (VID 0x0fcf is Dynastream Innovations)
  { vendorId: 0x0fcf, productId: 0x1008, name: 'ANT+ USB Stick', type: 'ant-stick' },
  { vendorId: 0x0fcf, productId: 0x1009, name: 'ANT+ USB Stick', type: 'ant-stick' },
  { vendorId: 0x0fcf, productId: 0x1004, name: 'ANT+ USB Stick (Dev)', type: 'ant-stick' },
];

// =============================================================================
// TYPES
// =============================================================================

export interface UsbFitnessDevice {
  /** Stable unique ID: "usb-{vid}-{pid}-{bus}-{address}" */
  deviceId: string;
  /** Human-readable name shown in the device list */
  deviceName: string;
  /** Protocol this device uses — drives which adapter is instantiated */
  protocol: 'ant-plus' | 'direct-usb';
  vendorId: number;
  productId: number;
}

// =============================================================================
// USB DEVICE MANAGER
// =============================================================================

export class UsbDeviceManager extends EventEmitter {
  private knownDevices = new Map<string, UsbFitnessDevice>();

  /**
   * Start monitoring USB attach/detach events.
   * Also scans devices already plugged in at startup.
   */
  start(): void {
    console.log('[UsbDeviceManager] Starting USB monitoring');

    // Devices already connected before the app launched
    this.scanExistingDevices();

    // Watch for plug/unplug
    usb.on('attach', (device: Device) => this.handleAttach(device));
    usb.on('detach', (device: Device) => this.handleDetach(device));
  }

  /**
   * Stop monitoring and clean up listeners.
   */
  stop(): void {
    console.log('[UsbDeviceManager] Stopping USB monitoring');
    usb.removeAllListeners('attach');
    usb.removeAllListeners('detach');
    this.knownDevices.clear();
  }

  /**
   * Returns all currently detected fitness USB devices.
   */
  getDevices(): UsbFitnessDevice[] {
    return Array.from(this.knownDevices.values());
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private scanExistingDevices(): void {
    const devices = getDeviceList();
    console.log(`[UsbDeviceManager] Scanning ${devices.length} connected USB device(s)`);
    devices.forEach(device => this.handleAttach(device));
  }

  private handleAttach(device: Device): void {
    const spec = this.matchSpec(device);
    if (!spec) return;

    const fitnessDevice = this.buildFitnessDevice(device, spec);
    if (this.knownDevices.has(fitnessDevice.deviceId)) return; // already known

    console.log(`[UsbDeviceManager] Fitness USB attached: ${fitnessDevice.deviceName} (${fitnessDevice.deviceId})`);
    this.knownDevices.set(fitnessDevice.deviceId, fitnessDevice);

    /**
     * Emit 'deviceFound' — main.ts forwards this to the renderer so the device
     * appears in the device list. Same pattern as 'bluetooth-device-found'.
     */
    this.emit('deviceFound', fitnessDevice);
  }

  private handleDetach(device: Device): void {
    const spec = this.matchSpec(device);
    if (!spec) return;

    const deviceId = this.buildDeviceId(device);
    if (!this.knownDevices.has(deviceId)) return;

    console.log(`[UsbDeviceManager] Fitness USB detached: ${deviceId}`);
    this.knownDevices.delete(deviceId);

    /**
     * Emit 'deviceLost' — main.ts forwards this to the renderer so the device
     * is removed from the list (or shown as disconnected).
     */
    this.emit('deviceLost', deviceId);
  }

  private matchSpec(device: Device): UsbHardwareSpec | undefined {
    const vid = device.deviceDescriptor.idVendor;
    const pid = device.deviceDescriptor.idProduct;
    return KNOWN_FITNESS_USB.find(s => s.vendorId === vid && s.productId === pid);
  }

  private buildFitnessDevice(device: Device, spec: UsbHardwareSpec): UsbFitnessDevice {
    return {
      deviceId: this.buildDeviceId(device),
      deviceName: spec.name,
      protocol: spec.type === 'ant-stick' ? 'ant-plus' : 'direct-usb',
      vendorId: device.deviceDescriptor.idVendor,
      productId: device.deviceDescriptor.idProduct,
    };
  }

  private buildDeviceId(device: Device): string {
    const vid = device.deviceDescriptor.idVendor.toString(16).padStart(4, '0');
    const pid = device.deviceDescriptor.idProduct.toString(16).padStart(4, '0');
    return `usb-${vid}-${pid}-${device.busNumber}-${device.deviceAddress}`;
  }
}
