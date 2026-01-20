/**
 * Bluetooth data parsers for fitness device characteristics
 */

import { FitnessData } from '../../shared/types';

/**
 * Parse FTMS Indoor Bike Data characteristic
 * See FTMS spec for flag definitions
 */
export function parseIndoorBikeData(value: DataView): FitnessData {
  const flags = value.getUint16(0, true);
  let offset = 2;
  const data: FitnessData = {};

  // Instantaneous Speed (if present, bit 0 = 0 means present)
  if (!(flags & 0x01)) {
    data.speed = value.getUint16(offset, true) / 100; // 0.01 km/h resolution
    offset += 2;
  }

  // Average Speed (skip if present)
  if (flags & 0x02) {
    offset += 2;
  }

  // Instantaneous Cadence (if present)
  if (flags & 0x04) {
    data.cadence = value.getUint16(offset, true) / 2; // 0.5 RPM resolution
    offset += 2;
  }

  // Average Cadence (skip if present)
  if (flags & 0x08) {
    offset += 2;
  }

  // Total Distance (skip if present)
  if (flags & 0x10) {
    offset += 3;
  }

  // Resistance Level (skip if present)
  if (flags & 0x20) {
    offset += 2;
  }

  // Instantaneous Power (if present)
  if (flags & 0x40) {
    data.power = value.getInt16(offset, true);
    offset += 2;
  }

  // Heart Rate (if present)
  if (flags & 0x200) {
    data.heartRate = value.getUint8(offset);
  }

  return data;
}

/**
 * Parse Cycling Power Measurement characteristic
 */
export function parseCyclingPowerData(value: DataView): FitnessData {
  const flags = value.getUint16(0, true);
  const power = value.getInt16(2, true);
  const data: FitnessData = { power };

  // Check if crank revolution data is present (bit 5)
  if (flags & 0x20) {
    // Could calculate cadence from crank revolutions here
  }

  return data;
}

/**
 * Parse Heart Rate Measurement characteristic
 */
export function parseHeartRateData(value: DataView): number {
  const flags = value.getUint8(0);
  // Check if heart rate is 16-bit (bit 0)
  if (flags & 0x01) {
    return value.getUint16(1, true);
  }
  return value.getUint8(1);
}
