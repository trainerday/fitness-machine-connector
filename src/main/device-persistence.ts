/**
 * Device persistence - saves and loads last connected device info
 * Enables auto-reconnection after sleep/wake or app restart
 */

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

export interface PersistedDevice {
  id: string;           // Note: Web Bluetooth IDs change between sessions, so we match by name
  name: string;         // Device name - used for matching on reconnect
  lastConnected: number; // timestamp
}

const PERSISTENCE_FILE = 'last-device.json';

/**
 * Get the path to the persistence file in the user data directory
 */
function getPersistencePath(): string {
  const filePath = path.join(app.getPath('userData'), PERSISTENCE_FILE);
  console.log('[DevicePersistence] Persistence path:', filePath);
  return filePath;
}

/**
 * Save the last connected device info to disk
 */
export function saveLastDevice(device: { id: string; name: string }): void {
  const data: PersistedDevice = {
    id: device.id,
    name: device.name,
    lastConnected: Date.now(),
  };

  try {
    const filePath = getPersistencePath();
    const json = JSON.stringify(data, null, 2);
    console.log('[DevicePersistence] Writing to:', filePath);
    console.log('[DevicePersistence] Data:', json);
    fs.writeFileSync(filePath, json);
    console.log('[DevicePersistence] Saved device successfully:', data.name);
  } catch (error) {
    console.error('[DevicePersistence] Failed to save device:', error);
  }
}

/**
 * Load the last connected device info from disk
 * Returns null if no device was saved or if the file is invalid
 */
export function loadLastDevice(): PersistedDevice | null {
  try {
    const filePath = getPersistencePath();

    if (!fs.existsSync(filePath)) {
      console.log('[DevicePersistence] No saved device found');
      return null;
    }

    const data = fs.readFileSync(filePath, 'utf-8');
    const device = JSON.parse(data) as PersistedDevice;

    console.log('[DevicePersistence] Loaded device:', device.name);
    return device;
  } catch (error) {
    console.error('[DevicePersistence] Failed to load device:', error);
    return null;
  }
}

/**
 * Clear the saved device (e.g., when user explicitly disconnects)
 */
export function clearLastDevice(): void {
  try {
    const filePath = getPersistencePath();

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log('[DevicePersistence] Cleared saved device');
    }
  } catch (error) {
    console.error('[DevicePersistence] Failed to clear device:', error);
  }
}
