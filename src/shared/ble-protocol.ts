/**
 * BLE Protocol - JSON message format between Electron and .NET BLE component
 *
 * Communication is via stdin/stdout with newline-delimited JSON.
 */

// =============================================================================
// COMMANDS (Electron → .NET)
// =============================================================================

export interface ScanCommand {
  type: 'scan';
  duration?: number;  // seconds, default 10
}

export interface StopScanCommand {
  type: 'stopScan';
}

export interface ConnectCommand {
  type: 'connect';
  deviceId: string;
  deviceName?: string;  // for logging
}

export interface DisconnectCommand {
  type: 'disconnect';
}

export interface GetStatusCommand {
  type: 'getStatus';
}

export interface SetAutoReconnectCommand {
  type: 'setAutoReconnect';
  enabled: boolean;
  deviceId?: string;
  deviceName?: string;
}

export type BleCommand =
  | ScanCommand
  | StopScanCommand
  | ConnectCommand
  | DisconnectCommand
  | GetStatusCommand
  | SetAutoReconnectCommand;

// =============================================================================
// EVENTS (.NET → Electron)
// =============================================================================

export interface DeviceInfo {
  id: string;
  name: string;
  rssi?: number;
  services?: string[];  // UUIDs of advertised services
}

export interface DeviceFoundEvent {
  type: 'deviceFound';
  device: DeviceInfo;
}

export interface ScanCompleteEvent {
  type: 'scanComplete';
  devicesFound: number;
}

export interface ConnectedEvent {
  type: 'connected';
  device: DeviceInfo;
}

export interface DisconnectedEvent {
  type: 'disconnected';
  reason?: string;
}

export interface FitnessDataEvent {
  type: 'data';
  power?: number;       // watts
  cadence?: number;     // rpm
  heartRate?: number;   // bpm
  speed?: number;       // km/h
  distance?: number;    // meters
  resistance?: number;  // level
  source: string;       // device type identifier (e.g., 'keiser-m3i', 'ftms')
}

export interface FtmsStatusEvent {
  type: 'ftmsStatus';
  state: 'stopped' | 'advertising' | 'connected';
  clientAddress?: string;
}

export interface StatusEvent {
  type: 'status';
  scanning: boolean;
  connected: boolean;
  connectedDevice?: DeviceInfo;
  broadcasting: boolean;
  autoReconnect: boolean;
  autoReconnectDevice?: string;
}

export interface ErrorEvent {
  type: 'error';
  code?: string;
  message: string;
}

export interface LogEvent {
  type: 'log';
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
}

export interface ReadyEvent {
  type: 'ready';
  version: string;
  platform: string;
}

export type BleEvent =
  | DeviceFoundEvent
  | ScanCompleteEvent
  | ConnectedEvent
  | DisconnectedEvent
  | FitnessDataEvent
  | FtmsStatusEvent
  | StatusEvent
  | ErrorEvent
  | LogEvent
  | ReadyEvent;

// =============================================================================
// UTILITIES
// =============================================================================

/**
 * Parse a JSON line from .NET stdout
 */
export function parseEvent(line: string): BleEvent | null {
  try {
    const event = JSON.parse(line) as BleEvent;
    if (!event.type) return null;
    return event;
  } catch {
    return null;
  }
}

/**
 * Serialize a command to JSON line for .NET stdin
 */
export function serializeCommand(command: BleCommand): string {
  return JSON.stringify(command) + '\n';
}
