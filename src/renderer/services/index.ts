/**
 * =============================================================================
 * SERVICES INDEX
 * =============================================================================
 *
 * This file exports only what the UI layer (index.ts) needs.
 * The UI should only interact with FitnessDataReader.
 *
 * Internal services (BluetoothService, DeviceSpecParser) are not exported
 * because they are implementation details that the UI shouldn't know about.
 *
 * =============================================================================
 */

export { FitnessDataReader } from './fitness-data-reader';
