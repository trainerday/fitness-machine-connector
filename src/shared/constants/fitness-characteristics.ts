/**
 * =============================================================================
 * FITNESS CHARACTERISTICS CONFIGURATION
 * =============================================================================
 *
 * Purpose:
 *   Defines the Bluetooth UUIDs used by fitness devices and maps them to
 *   human-readable characteristic types. This is the FITNESS-SPECIFIC knowledge
 *   that should NOT live in the generic BluetoothService.
 *
 * Why this file exists:
 *   - BluetoothService should be pure and reusable for ANY Bluetooth device
 *   - The knowledge that "UUID 0x2ad2 = FTMS Indoor Bike Data" is fitness-specific
 *   - This file centralizes all fitness UUID knowledge in one place
 *
 * How it's used:
 *   - FitnessDataReader imports this config
 *   - Passes the UUIDs to BluetoothService for subscription
 *   - Uses the mapping to route raw data to the correct parser
 *
 * =============================================================================
 */

/**
 * Human-readable names for fitness characteristic types.
 * Used by the parser to know how to interpret raw bytes.
 */
export type FitnessCharacteristicType =
  | 'ftms-indoor-bike'
  | 'cycling-power'
  | 'heart-rate'
  | 'keiser-m3i';

/**
 * Configuration for a single fitness characteristic.
 */
export interface FitnessCharacteristicConfig {
  /** Human-readable type name */
  type: FitnessCharacteristicType;
  /** Bluetooth service UUID (16-bit) */
  serviceUuid: number;
  /** Bluetooth characteristic UUID (16-bit) */
  characteristicUuid: number;
  /** Description for documentation */
  description: string;
}

/**
 * All fitness characteristics we want to subscribe to.
 * BluetoothService will receive this list and subscribe to each one.
 */
export const FITNESS_CHARACTERISTICS: FitnessCharacteristicConfig[] = [
  {
    type: 'ftms-indoor-bike',
    serviceUuid: 0x1826,    // Fitness Machine Service
    characteristicUuid: 0x2ad2,  // Indoor Bike Data
    description: 'FTMS Indoor Bike Data - provides power, cadence, speed, heart rate',
  },
  {
    type: 'cycling-power',
    serviceUuid: 0x1818,    // Cycling Power Service
    characteristicUuid: 0x2a63,  // Cycling Power Measurement
    description: 'Cycling Power Measurement - provides power data',
  },
  {
    type: 'heart-rate',
    serviceUuid: 0x180d,    // Heart Rate Service
    characteristicUuid: 0x2a37,  // Heart Rate Measurement
    description: 'Heart Rate Measurement - provides heart rate in BPM',
  },
  {
    type: 'keiser-m3i',
    serviceUuid: 0x0001,    // Keiser Custom Service
    characteristicUuid: 0x0002,  // Keiser M3i Data
    description: 'Keiser M3i proprietary format - provides power, cadence, heart rate, gear',
  },
];

/**
 * Get all unique service UUIDs (for Bluetooth device request).
 */
export function getServiceUuids(): number[] {
  return [...new Set(FITNESS_CHARACTERISTICS.map(c => c.serviceUuid))];
}

/**
 * Find the characteristic type for a given characteristic UUID.
 * Returns undefined if the UUID is not a known fitness characteristic.
 */
export function getCharacteristicType(characteristicUuid: number): FitnessCharacteristicType | undefined {
  const config = FITNESS_CHARACTERISTICS.find(c => c.characteristicUuid === characteristicUuid);
  return config?.type;
}
