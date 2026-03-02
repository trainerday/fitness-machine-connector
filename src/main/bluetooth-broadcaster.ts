/**
 * Bluetooth FTMS Broadcaster and BLE Bridge
 *
 * Uses C# .NET for all BLE operations:
 * - Scanning for fitness devices
 * - Connecting to devices and reading data
 * - Broadcasting as FTMS to apps like Zwift
 *
 * This bypasses Web Bluetooth limitations (no user gesture required).
 */

import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import { app } from 'electron';
import { EventEmitter } from 'events';
import { FtmsOutput } from '../shared/types/fitness-data';

export interface BroadcasterStatus {
  state: 'stopped' | 'starting' | 'advertising' | 'connected' | 'error';
  deviceName?: string;
  clientAddress?: string;
  error?: string;
}

export interface DiscoveredDevice {
  id: string;
  name: string;
  rssi?: number;
  services?: string[];
  isFitnessDevice?: boolean;
}

export interface FitnessData {
  power?: number;
  cadence?: number;
  heartRate?: number;
  speed?: number;
  resistance?: number;
  source?: string;
}

/**
 * C# .NET based BLE Bridge for Windows
 * Handles scanning, connecting, and FTMS broadcasting
 */
class WindowsBroadcaster extends EventEmitter {
  private process: ChildProcess | null = null;
  private status: BroadcasterStatus = { state: 'stopped' };
  private restartAttempts = 0;
  private maxRestartAttempts = 3;
  private connectedDevice: DiscoveredDevice | null = null;
  private isScanning = false;

  constructor() {
    super();
  }

  private getExecutablePath(): { command: string; args: string[] } {
    const isDev = !app.isPackaged;

    if (isDev) {
      const projectPath = path.join(app.getAppPath(), 'FTMSBluetoothForwarder', 'FTMSBluetoothForwarder.csproj');
      return {
        command: 'dotnet',
        args: ['run', '--project', projectPath, '-c', 'Release'],
      };
    } else {
      const exePath = path.join(process.resourcesPath, 'FTMSBluetoothForwarder.exe');
      return {
        command: exePath,
        args: [],
      };
    }
  }

  start(): void {
    if (this.process) {
      console.log('[BLE] Backend already running');
      return;
    }

    this.status = { state: 'starting' };
    this.emit('status', this.status);

    const { command, args } = this.getExecutablePath();
    console.log(`[BLE] Starting .NET backend: ${command} ${args.join(' ')}`);

    try {
      this.process = spawn(command, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      this.process.stdout?.on('data', (data: Buffer) => {
        this.handleOutput(data.toString());
      });

      this.process.stderr?.on('data', (data: Buffer) => {
        console.error('[BLE] stderr:', data.toString());
      });

      this.process.on('error', (error: Error) => {
        console.error('[BLE] Process error:', error);
        this.status = { state: 'error', error: error.message };
        this.emit('status', this.status);
        this.handleProcessExit();
      });

      this.process.on('exit', (code: number | null) => {
        console.log(`[BLE] Process exited with code ${code}`);
        this.handleProcessExit();
      });

      this.restartAttempts = 0;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[BLE] Failed to start:', errorMessage);
      this.status = { state: 'error', error: errorMessage };
      this.emit('status', this.status);
    }
  }

  private handleOutput(output: string): void {
    const lines = output.trim().split('\n');

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const message = JSON.parse(line);

        // Handle log messages
        if (message.log) {
          console.log('[BLE .NET]', message.log);
          this.emit('log', message.log);
          continue;
        }

        // Handle new protocol events (type-based)
        if (message.type) {
          switch (message.type) {
            case 'ready':
              console.log(`[BLE] .NET backend ready (v${message.version})`);
              this.emit('ready', message);
              break;

            case 'deviceFound':
              console.log(`[BLE] Device found: ${message.device?.name}`);
              this.emit('deviceFound', message.device as DiscoveredDevice);
              break;

            case 'scanComplete':
              console.log(`[BLE] Scan complete: ${message.devicesFound} devices`);
              this.isScanning = false;
              this.emit('scanComplete', message.devicesFound);
              break;

            case 'connected':
              console.log(`[BLE] Connected to: ${message.device?.name}`);
              this.connectedDevice = message.device;
              this.emit('deviceConnected', message.device as DiscoveredDevice);
              break;

            case 'disconnected':
              console.log(`[BLE] Disconnected: ${message.reason}`);
              this.connectedDevice = null;
              this.emit('deviceDisconnected', message.reason);
              break;

            case 'data':
              // Forward fitness data
              this.emit('fitnessData', {
                power: message.power,
                cadence: message.cadence,
                heartRate: message.heartRate,
                speed: message.speed,
                resistance: message.resistance,
                source: message.source,
              } as FitnessData);
              break;

            case 'ftmsStatus':
              // Update status based on FTMS state
              if (message.state === 'advertising') {
                this.status = { state: 'advertising' };
              } else if (message.state === 'connected') {
                this.status = { state: 'connected', clientAddress: message.clientAddress };
              }
              this.emit('status', this.status);
              break;

            case 'error':
              console.error(`[BLE] Error: ${message.message}`);
              this.emit('error', message.message);
              break;

            case 'log':
              console.log(`[BLE .NET ${message.level}]`, message.message);
              this.emit('log', message.message);
              break;
          }
          continue;
        }

        // Handle old protocol (status-based) for backward compatibility
        if (message.status) {
          switch (message.status) {
            case 'advertising':
              this.status = { state: 'advertising', deviceName: message.device_name };
              break;
            case 'connected':
              this.status = { state: 'connected', deviceName: message.device_name, clientAddress: message.client };
              break;
            case 'stopped':
              this.status = { state: 'stopped' };
              break;
          }
          this.emit('status', this.status);
        }
      } catch {
        console.log('[BLE] Raw output:', line);
      }
    }
  }

  private handleProcessExit(): void {
    this.process = null;
    this.isScanning = false;
    this.connectedDevice = null;

    if (this.status.state !== 'stopped' && this.status.state !== 'error') {
      if (this.restartAttempts < this.maxRestartAttempts) {
        this.restartAttempts++;
        console.log(`[BLE] Crashed, restarting (attempt ${this.restartAttempts}/${this.maxRestartAttempts})`);
        setTimeout(() => this.start(), 1000);
      } else {
        this.status = { state: 'error', error: 'Backend crashed too many times' };
        this.emit('status', this.status);
      }
    }
  }

  private sendCommand(command: object): void {
    if (!this.process || !this.process.stdin) {
      console.warn('[BLE] Cannot send command - process not running');
      return;
    }

    try {
      const jsonLine = JSON.stringify(command) + '\n';
      this.process.stdin.write(jsonLine);
    } catch (error) {
      console.error('[BLE] Failed to send command:', error);
    }
  }

  /**
   * Start scanning for BLE fitness devices
   */
  scan(duration: number = 10): void {
    console.log(`[BLE] Starting scan for ${duration} seconds...`);
    this.isScanning = true;
    this.sendCommand({ type: 'scan', duration });
  }

  /**
   * Stop scanning
   */
  stopScan(): void {
    console.log('[BLE] Stopping scan...');
    this.sendCommand({ type: 'stopScan' });
    this.isScanning = false;
  }

  /**
   * Connect to a BLE device by ID
   */
  connect(deviceId: string, deviceName?: string): void {
    console.log(`[BLE] Connecting to ${deviceName || deviceId}...`);
    this.sendCommand({ type: 'connect', deviceId, deviceName });
  }

  /**
   * Disconnect from the current device
   */
  disconnect(): void {
    console.log('[BLE] Disconnecting...');
    this.sendCommand({ type: 'disconnect' });
    this.connectedDevice = null;
  }

  /**
   * Set auto-reconnect settings
   */
  setAutoReconnect(enabled: boolean, deviceId?: string, deviceName?: string): void {
    console.log(`[BLE] Auto-reconnect: ${enabled ? 'enabled' : 'disabled'} for ${deviceName || 'none'}`);
    this.sendCommand({ type: 'setAutoReconnect', enabled, deviceId, deviceName });
  }

  /**
   * Send fitness data to FTMS broadcaster (legacy - used when data comes from Web Bluetooth)
   */
  sendData(data: FtmsOutput): void {
    if (!this.process || !this.process.stdin) {
      return;
    }

    try {
      // Send in legacy format (no type field)
      const jsonLine = JSON.stringify(data) + '\n';
      this.process.stdin.write(jsonLine);
    } catch (error) {
      console.error('[BLE] Failed to send data:', error);
    }
  }

  stop(): void {
    if (!this.process) {
      return;
    }

    console.log('[BLE] Stopping backend...');
    this.status = { state: 'stopped' };

    try {
      this.sendCommand({ type: 'stop' });

      setTimeout(() => {
        if (this.process) {
          this.process.kill();
          this.process = null;
        }
      }, 2000);
    } catch (error) {
      console.error('[BLE] Error stopping:', error);
      this.process?.kill();
      this.process = null;
    }

    this.emit('status', this.status);
  }

  getStatus(): BroadcasterStatus {
    return this.status;
  }

  isRunning(): boolean {
    return this.process !== null && this.status.state !== 'stopped';
  }

  getConnectedDevice(): DiscoveredDevice | null {
    return this.connectedDevice;
  }

  isScanningDevices(): boolean {
    return this.isScanning;
  }
}

/**
 * Main BluetoothBroadcaster class
 * Provides unified interface for BLE operations via .NET
 */
export class BluetoothBroadcaster extends EventEmitter {
  private backend: WindowsBroadcaster;

  constructor() {
    super();

    console.log('[BLE] Initializing .NET backend');
    this.backend = new WindowsBroadcaster();

    // Forward all events from backend
    this.backend.on('status', (status: BroadcasterStatus) => this.emit('status', status));
    this.backend.on('log', (message: string) => this.emit('log', message));
    this.backend.on('ready', (info: unknown) => this.emit('ready', info));
    this.backend.on('deviceFound', (device: DiscoveredDevice) => this.emit('deviceFound', device));
    this.backend.on('scanComplete', (count: number) => this.emit('scanComplete', count));
    this.backend.on('deviceConnected', (device: DiscoveredDevice) => this.emit('deviceConnected', device));
    this.backend.on('deviceDisconnected', (reason: string) => this.emit('deviceDisconnected', reason));
    this.backend.on('fitnessData', (data: FitnessData) => this.emit('fitnessData', data));
    this.backend.on('error', (message: string) => this.emit('error', message));
  }

  /** Start the .NET backend */
  start(): void {
    this.backend.start();
  }

  /** Stop the .NET backend */
  stop(): void {
    this.backend.stop();
  }

  /** Start scanning for BLE devices */
  scan(duration: number = 10): void {
    this.backend.scan(duration);
  }

  /** Stop scanning */
  stopScan(): void {
    this.backend.stopScan();
  }

  /** Connect to a device by ID */
  connect(deviceId: string, deviceName?: string): void {
    this.backend.connect(deviceId, deviceName);
  }

  /** Disconnect from current device */
  disconnect(): void {
    this.backend.disconnect();
  }

  /** Configure auto-reconnect */
  setAutoReconnect(enabled: boolean, deviceId?: string, deviceName?: string): void {
    this.backend.setAutoReconnect(enabled, deviceId, deviceName);
  }

  /** Send fitness data (legacy - when data comes from Web Bluetooth) */
  sendData(data: FtmsOutput): void {
    this.backend.sendData(data);
  }

  /** Get current broadcaster status */
  getStatus(): BroadcasterStatus {
    return this.backend.getStatus();
  }

  /** Check if backend is running */
  isRunning(): boolean {
    return this.backend.isRunning();
  }

  /** Get currently connected device */
  getConnectedDevice(): DiscoveredDevice | null {
    return this.backend.getConnectedDevice();
  }

  /** Check if currently scanning */
  isScanning(): boolean {
    return this.backend.isScanningDevices();
  }
}
