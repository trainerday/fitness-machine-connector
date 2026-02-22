/**
 * Status indicator UI component - shows connection status
 */

export interface BroadcasterStatus {
  state: 'stopped' | 'starting' | 'advertising' | 'connected' | 'error';
  deviceName?: string;
  clientAddress?: string;
  error?: string;
}

export class StatusIndicator {
  private deviceStatus: HTMLSpanElement;
  private ftmsStatus: HTMLSpanElement;
  private scanBtn: HTMLButtonElement;
  private disconnectBtn: HTMLButtonElement;
  private isBroadcasting = false;

  constructor() {
    this.deviceStatus = this.getElement('device-status') as HTMLSpanElement;
    this.ftmsStatus = this.getElement('ftms-status') as HTMLSpanElement;
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
   * Set scanning state - button stays enabled so user can re-scan anytime
   */
  setScanning(isScanning: boolean): void {
    this.scanBtn.textContent = isScanning ? 'Rescan' : 'Scan for Devices';
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

  /**
   * Update FTMS status display based on broadcaster state
   */
  setBroadcasterStatus(status: BroadcasterStatus): void {
    switch (status.state) {
      case 'stopped':
        this.ftmsStatus.textContent = 'Inactive';
        this.ftmsStatus.classList.remove('connected', 'warning');
        this.ftmsStatus.classList.add('disconnected');
        this.isBroadcasting = false;
        break;

      case 'starting':
        this.ftmsStatus.textContent = 'Starting...';
        this.ftmsStatus.classList.remove('connected', 'disconnected');
        this.ftmsStatus.classList.add('warning');
        break;

      case 'advertising':
        this.ftmsStatus.textContent = 'Broadcasting';
        this.ftmsStatus.classList.remove('disconnected', 'warning');
        this.ftmsStatus.classList.add('connected');
        this.isBroadcasting = true;
        break;

      case 'connected':
        this.ftmsStatus.textContent = `Connected: ${status.clientAddress || 'Client'}`;
        this.ftmsStatus.classList.remove('disconnected', 'warning');
        this.ftmsStatus.classList.add('connected');
        this.isBroadcasting = true;
        break;

      case 'error':
        this.ftmsStatus.textContent = `Error: ${status.error || 'Unknown'}`;
        this.ftmsStatus.classList.remove('connected', 'warning');
        this.ftmsStatus.classList.add('disconnected');
        this.isBroadcasting = false;
        break;
    }
  }

  /**
   * Check if currently broadcasting
   */
  getIsBroadcasting(): boolean {
    return this.isBroadcasting;
  }
}
