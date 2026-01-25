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
 */
export interface FtmsOutput {
  speed: number;         // km/h (calculated if not available)
  cadence: number;       // RPM
  power: number;         // Watts
  heartRate?: number;    // BPM (optional)
  distance?: number;     // meters (cumulative)
  calories?: number;     // kcal
  resistance?: number;   // Resistance level
}
