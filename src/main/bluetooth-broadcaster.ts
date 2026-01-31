/**
 * Bluetooth FTMS Broadcaster
 *
 * Hybrid implementation that uses the best backend for each platform:
 * - macOS/Linux: Uses @abandonware/bleno for native BLE peripheral support
 * - Windows: Uses Python bless library via subprocess
 *
 * This approach ensures optimal stability on each platform.
 */

import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import { app } from 'electron';
import { EventEmitter } from 'events';
import { FtmsOutput } from '../shared/types/fitness-data';
import { BlenoBroadcaster } from './bleno-broadcaster';

export interface BroadcasterStatus {
  state: 'stopped' | 'starting' | 'advertising' | 'connected' | 'error';
  deviceName?: string;
  clientAddress?: string;
  error?: string;
}

/**
 * Determine which backend to use based on platform
 */
function shouldUseBleno(): boolean {
  // Use bleno on macOS and Linux, Python on Windows
  return process.platform === 'darwin' || process.platform === 'linux';
}

/**
 * Python-based broadcaster for Windows
 */
class PythonBroadcaster extends EventEmitter {
  private process: ChildProcess | null = null;
  private status: BroadcasterStatus = { state: 'stopped' };
  private restartAttempts = 0;
  private maxRestartAttempts = 3;

  constructor() {
    super();
  }

  private getExecutablePath(): { command: string; args: string[] } {
    const isDev = !app.isPackaged;

    if (isDev) {
      const scriptPath = path.join(app.getAppPath(), 'python', 'ftms_broadcaster.py');

      if (process.platform === 'win32') {
        return {
          command: 'py',
          args: ['-3.11', scriptPath],
        };
      } else {
        return {
          command: 'python3',
          args: [scriptPath],
        };
      }
    } else {
      const exeName =
        process.platform === 'win32'
          ? 'ftms-broadcaster-win.exe'
          : 'ftms-broadcaster-mac';

      const exePath = path.join(process.resourcesPath, exeName);

      return {
        command: exePath,
        args: [],
      };
    }
  }

  start(): void {
    if (this.process) {
      console.log('Broadcaster already running');
      return;
    }

    this.status = { state: 'starting' };
    this.emit('status', this.status);

    const { command, args } = this.getExecutablePath();

    console.log(`Starting Python broadcaster: ${command} ${args.join(' ')}`);

    try {
      this.process = spawn(command, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          PYTHONUNBUFFERED: '1',
        },
      });

      this.process.stdout?.on('data', (data: Buffer) => {
        this.handleOutput(data.toString());
      });

      this.process.stderr?.on('data', (data: Buffer) => {
        console.error('Broadcaster stderr:', data.toString());
      });

      this.process.on('error', (error: Error) => {
        console.error('Broadcaster process error:', error);
        this.status = { state: 'error', error: error.message };
        this.emit('status', this.status);
        this.handleProcessExit();
      });

      this.process.on('exit', (code: number | null) => {
        console.log(`Broadcaster exited with code ${code}`);
        this.handleProcessExit();
      });

      this.restartAttempts = 0;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('Failed to start broadcaster:', errorMessage);
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

        if (message.log) {
          console.log('Broadcaster:', message.log);
          this.emit('log', message.log);
        }

        if (message.status) {
          switch (message.status) {
            case 'advertising':
              this.status = {
                state: 'advertising',
                deviceName: message.device_name,
              };
              break;
            case 'connected':
              this.status = {
                state: 'connected',
                deviceName: message.device_name,
                clientAddress: message.client,
              };
              break;
            case 'stopped':
              this.status = { state: 'stopped' };
              break;
            default:
              console.log('Unknown status:', message.status);
          }
          this.emit('status', this.status);
        }
      } catch {
        console.log('Broadcaster output:', line);
      }
    }
  }

  private handleProcessExit(): void {
    this.process = null;

    if (this.status.state !== 'stopped' && this.status.state !== 'error') {
      if (this.restartAttempts < this.maxRestartAttempts) {
        this.restartAttempts++;
        console.log(
          `Broadcaster crashed, restarting (attempt ${this.restartAttempts}/${this.maxRestartAttempts})`
        );
        setTimeout(() => this.start(), 1000);
      } else {
        this.status = {
          state: 'error',
          error: 'Broadcaster crashed too many times',
        };
        this.emit('status', this.status);
      }
    }
  }

  sendData(data: FtmsOutput): void {
    if (!this.process || !this.process.stdin) {
      return;
    }

    try {
      const jsonLine = JSON.stringify(data) + '\n';
      this.process.stdin.write(jsonLine);
    } catch (error) {
      console.error('Failed to send data to broadcaster:', error);
    }
  }

  stop(): void {
    if (!this.process) {
      return;
    }

    console.log('Stopping broadcaster...');
    this.status = { state: 'stopped' };

    try {
      this.process.stdin?.write(JSON.stringify({ command: 'stop' }) + '\n');

      setTimeout(() => {
        if (this.process) {
          this.process.kill();
          this.process = null;
        }
      }, 2000);
    } catch (error) {
      console.error('Error stopping broadcaster:', error);
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
}

/**
 * Main BluetoothBroadcaster class
 * Automatically selects the best backend based on platform
 */
export class BluetoothBroadcaster extends EventEmitter {
  private backend: BlenoBroadcaster | PythonBroadcaster;
  private backendType: 'bleno' | 'python';

  constructor() {
    super();

    // Choose backend based on platform
    if (shouldUseBleno() && BlenoBroadcaster.isAvailable()) {
      console.log('Using Bleno backend for BLE broadcasting (macOS/Linux)');
      this.backend = new BlenoBroadcaster();
      this.backendType = 'bleno';
    } else {
      console.log('Using Python backend for BLE broadcasting (Windows or fallback)');
      this.backend = new PythonBroadcaster();
      this.backendType = 'python';
    }

    // Forward events from backend
    this.backend.on('status', (status: BroadcasterStatus) => {
      this.emit('status', status);
    });

    this.backend.on('log', (message: string) => {
      this.emit('log', message);
    });
  }

  /**
   * Start the FTMS broadcaster.
   */
  start(): void {
    this.backend.start();
  }

  /**
   * Send fitness data to the broadcaster.
   */
  sendData(data: FtmsOutput): void {
    this.backend.sendData(data);
  }

  /**
   * Stop the broadcaster gracefully.
   */
  stop(): void {
    this.backend.stop();
  }

  /**
   * Get current broadcaster status.
   */
  getStatus(): BroadcasterStatus {
    return this.backend.getStatus();
  }

  /**
   * Check if broadcaster is running.
   */
  isRunning(): boolean {
    return this.backend.isRunning();
  }

  /**
   * Get the backend type being used
   */
  getBackendType(): 'bleno' | 'python' {
    return this.backendType;
  }
}
