/**
 * Fitness data structure received from Bluetooth devices
 */
export interface FitnessData {
  power?: number;      // Watts
  cadence?: number;    // RPM
  heartRate?: number;  // BPM
  speed?: number;      // km/h
}
