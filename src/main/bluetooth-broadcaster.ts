/**
 * Bluetooth FTMS Broadcaster
 * Manages the Python bless-based FTMS broadcaster subprocess.
 * Sends fitness data to the Python process which broadcasts it via BLE.
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

export class BluetoothBroadcaster extends EventEmitter {
  private process: ChildProcess | null = null;
  private status: BroadcasterStatus = { state: 'stopped' };
  private restartAttempts = 0;
  private maxRestartAttempts = 3;

  constructor() {
    super();
  }

  /**
   * Get the path to the Python broadcaster executable.
   * In development, runs the Python script directly.
   * In production, uses the compiled executable.
   */
  private getExecutablePath(): { command: string; args: string[] } {
    const isDev = !app.isPackaged;

    if (isDev) {
      // Development: run Python script directly
      const scriptPath = path.join(
        app.getAppPath(),
        'python',
        'ftms_broadcaster.py'
      );

      // Use python3 on Unix, py launcher on Windows with Python 3.10
      // (3.10 has pre-built wheels for bleak-winrt, newer versions don't)
      if (process.platform === 'win32') {
        return {
          command: 'py',
          args: ['-3.10', scriptPath],
        };
      } else {
        return {
          command: 'python3',
          args: [scriptPath],
        };
      }
    } else {
      // Production: use compiled executable from resources
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

  /**
   * Start the FTMS broadcaster.
   */
  start(): void {
    if (this.process) {
      console.log('Broadcaster already running');
      return;
    }

    this.status = { state: 'starting' };
    this.emit('status', this.status);

    const { command, args } = this.getExecutablePath();

    console.log(`Starting broadcaster: ${command} ${args.join(' ')}`);

    try {
      this.process = spawn(command, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        // Ensure proper environment
        env: {
          ...process.env,
          PYTHONUNBUFFERED: '1', // Disable Python output buffering
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

  /**
   * Handle output from the Python process (JSON messages).
   */
  private handleOutput(output: string): void {
    // Split by newlines in case multiple messages arrive together
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
        // Not JSON, just log it
        console.log('Broadcaster output:', line);
      }
    }
  }

  /**
   * Handle process exit - attempt restart if unexpected.
   */
  private handleProcessExit(): void {
    this.process = null;

    if (this.status.state !== 'stopped' && this.status.state !== 'error') {
      // Unexpected exit, try to restart
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

  /**
   * Send fitness data to the broadcaster.
   */
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

  /**
   * Stop the broadcaster gracefully.
   */
  stop(): void {
    if (!this.process) {
      return;
    }

    console.log('Stopping broadcaster...');
    this.status = { state: 'stopped' };

    try {
      // Send stop command
      this.process.stdin?.write(JSON.stringify({ command: 'stop' }) + '\n');

      // Give it time to shut down gracefully
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

  /**
   * Get current broadcaster status.
   */
  getStatus(): BroadcasterStatus {
    return this.status;
  }

  /**
   * Check if broadcaster is running.
   */
  isRunning(): boolean {
    return this.process !== null && this.status.state !== 'stopped';
  }
}
