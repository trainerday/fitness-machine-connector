/**
 * Raw fitness data received from Bluetooth devices.
 * Contains all possible fields that different devices may broadcast.
 */
export interface FitnessData {
  // Core metrics (common across most devices)
  power?: number;        // Watts
  cadence?: number;      // RPM
  heartRate?: number;    // BPM
  speed?: number;        // km/h

  // Extended metrics (device-specific)
  calories?: number;     // kcal (total)
  duration?: number;     // seconds
  distance?: number;     // km (converted from miles for Keiser)
  gear?: number;         // Gear level (1-24 for Keiser)
  resistance?: number;   // Resistance level

  // Device info
  sourceType?: 'ftms' | 'keiser-m3i' | 'cycling-power' | 'heart-rate';
}

/**
 * FTMS Indoor Bike Data output format.
 * This is what we broadcast to receiving apps.
 * Based on Bluetooth FTMS Indoor Bike Data characteristic (0x2AD2).
 */
export interface FtmsOutput {
  // Required fields
  speed: number;         // km/h (calculated from power if not available)
  cadence: number;       // RPM (0.5 resolution in FTMS)
  power: number;         // Watts (signed 16-bit in FTMS)

  // Optional fields
  heartRate?: number;    // BPM
  distance?: number;     // meters (cumulative, 24-bit in FTMS)
  calories?: number;     // kcal (Total Energy)
  resistance?: number;   // Resistance level (0.1 resolution in FTMS)
  elapsedTime?: number;  // seconds
}
