/**
 * Power management utilities - prevents system sleep during active broadcasting
 * Allows screen to dim/turn off, but keeps CPU running
 */

import { powerSaveBlocker } from 'electron';

// Power save blocker ID (to stop it later)
let powerSaveBlockerId: number | null = null;

/**
 * Start preventing system sleep (call when broadcasting starts)
 * Uses 'prevent-app-suspension' which:
 * - Allows screen to dim/turn off (saves power)
 * - Prevents system from fully sleeping (CPU keeps running)
 */
export function startPowerSaveBlocker(): void {
  if (powerSaveBlockerId === null) {
    powerSaveBlockerId = powerSaveBlocker.start('prevent-app-suspension');
    console.log('[PowerManager] Power save blocker started (prevent-app-suspension):', powerSaveBlockerId);
  }
}

/**
 * Stop preventing display sleep (call when broadcasting stops)
 */
export function stopPowerSaveBlocker(): void {
  if (powerSaveBlockerId !== null) {
    powerSaveBlocker.stop(powerSaveBlockerId);
    console.log('[PowerManager] Power save blocker stopped:', powerSaveBlockerId);
    powerSaveBlockerId = null;
  }
}

/**
 * Check if power save blocker is currently active
 */
export function isPowerSaveBlockerActive(): boolean {
  return powerSaveBlockerId !== null;
}
