/**
 * Standard Bluetooth GATT Service and Characteristic UUIDs for fitness devices
 */

// Standard Bluetooth GATT Service UUIDs
export const FITNESS_SERVICE_UUIDS = {
  FTMS: 0x1826,                    // Fitness Machine Service
  CYCLING_POWER: 0x1818,           // Cycling Power Service
  CYCLING_SPEED_CADENCE: 0x1816,   // Cycling Speed and Cadence Service
  HEART_RATE: 0x180d,              // Heart Rate Service
} as const;

// FTMS Characteristic UUIDs
export const FTMS_CHARACTERISTICS = {
  INDOOR_BIKE_DATA: 0x2ad2,
  FITNESS_MACHINE_FEATURE: 0x2acc,
  FITNESS_MACHINE_CONTROL_POINT: 0x2ad9,
  FITNESS_MACHINE_STATUS: 0x2ada,
} as const;

// Standard Characteristic UUIDs (used by multiple services)
export const STANDARD_CHARACTERISTICS = {
  CYCLING_POWER_MEASUREMENT: 0x2a63,
  HEART_RATE_MEASUREMENT: 0x2a37,
} as const;
