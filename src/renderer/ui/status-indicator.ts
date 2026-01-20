/**
 * Status indicator UI component - shows connection status
 */

export class StatusIndicator {
  private deviceStatus: HTMLSpanElement;
  private scanBtn: HTMLButtonElement;
  private disconnectBtn: HTMLButtonElement;

  constructor() {
    this.deviceStatus = this.getElement('device-status') as HTMLSpanElement;
    this.scanBtn = this.getElement('scan-btn') as HTMLButtonElement;
    this.disconnectBtn = this.getElement('disconnect-btn') as HTMLButtonElement;
  }

  private getElement(id: string): HTMLElement {
    const element = document.getElementById(id);
    if (!element) {
      throw new Error(`Status indicator element not found: ${id}`);
    }
    return element;
  }

  /**
   * Update UI to show connected state
   */
  setConnected(deviceName: string): void {
    this.deviceStatus.textContent = deviceName || 'Connected';
    this.deviceStatus.classList.remove('disconnected');
    this.deviceStatus.classList.add('connected');
    this.scanBtn.disabled = true;
    this.disconnectBtn.disabled = false;
  }

  /**
   * Update UI to show disconnected state
   */
  setDisconnected(): void {
    this.deviceStatus.textContent = 'Not Connected';
    this.deviceStatus.classList.remove('connected');
    this.deviceStatus.classList.add('disconnected');
    this.scanBtn.disabled = false;
    this.disconnectBtn.disabled = true;
  }

  /**
   * Set scanning state
   */
  setScanning(isScanning: boolean): void {
    this.scanBtn.disabled = isScanning;
    this.scanBtn.textContent = isScanning ? 'Scanning...' : 'Scan for Devices';
  }

  /**
   * Disable scan button (e.g., when Bluetooth unavailable)
   */
  disableScan(): void {
    this.scanBtn.disabled = true;
  }

  /**
   * Set up button click handlers
   */
  onScanClick(handler: () => void): void {
    this.scanBtn.addEventListener('click', handler);
  }

  onDisconnectClick(handler: () => void): void {
    this.disconnectBtn.addEventListener('click', handler);
  }
}
