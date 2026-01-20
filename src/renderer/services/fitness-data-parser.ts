/**
 * =============================================================================
 * FITNESS DATA PARSER
 * =============================================================================
 *
 * Purpose:
 *   Converts raw Bluetooth bytes into structured fitness data.
 *   This parser knows how to interpret binary data from fitness devices.
 *
 * Responsibilities:
 *   - Map characteristic UUIDs to parsing functions (using fitness-characteristics config)
 *   - Parse FTMS Indoor Bike Data characteristic bytes
 *   - Parse Cycling Power Measurement characteristic bytes
 *   - Parse Heart Rate Measurement characteristic bytes
 *   - Return structured FitnessData objects
 *
 * What this parser does NOT do:
 *   - Connect to Bluetooth devices (that's BluetoothService's job)
 *   - Coordinate data flow (that's FitnessDataReader's job)
 *   - Interact with the UI
 *
 * Technical Notes:
 *   - All parsing follows Bluetooth SIG GATT specifications
 *   - Data is little-endian as per Bluetooth spec
 *   - Flag fields indicate which optional data is present
 *
 * =============================================================================
 */

import { FitnessData } from '../../shared/types';
import { getCharacteristicType, FitnessCharacteristicType } from '../../shared/constants';
import { RawBluetoothData } from './bluetooth-service';

/**
 * Parses raw Bluetooth characteristic data into structured FitnessData.
 */
export class FitnessDataParser {
  /**
   * Parse raw Bluetooth data based on its characteristic UUID.
   * Uses the fitness-characteristics config to map UUID to type.
   */
  parse(rawData: RawBluetoothData): FitnessData {
    const type = getCharacteristicType(rawData.characteristicUuid);

    if (!type) {
      // Unknown characteristic - return empty data
      return {};
    }

    return this.parseByType(type, rawData.rawValue);
  }

  /**
   * Parse data based on the fitness characteristic type.
   */
  private parseByType(type: FitnessCharacteristicType, value: DataView): FitnessData {
    switch (type) {
      case 'ftms-indoor-bike':
        return this.parseFtmsIndoorBikeData(value);
      case 'cycling-power':
        return this.parseCyclingPowerMeasurement(value);
      case 'heart-rate':
        return this.parseHeartRateMeasurement(value);
      default:
        return {};
    }
  }

  /**
   * Parse FTMS Indoor Bike Data characteristic.
   *
   * Format (per Bluetooth FTMS spec):
   *   - Bytes 0-1: Flags (16-bit, indicates which fields are present)
   *   - Remaining bytes: Optional fields based on flags
   *
   * Flag bits:
   *   - Bit 0: More Data (0 = instantaneous speed present)
   *   - Bit 1: Average Speed present
   *   - Bit 2: Instantaneous Cadence present
   *   - Bit 3: Average Cadence present
   *   - Bit 4: Total Distance present
   *   - Bit 5: Resistance Level present
   *   - Bit 6: Instantaneous Power present
   *   - Bit 9: Heart Rate present
   */
  private parseFtmsIndoorBikeData(value: DataView): FitnessData {
    const flags = value.getUint16(0, true);
    let offset = 2;
    const data: FitnessData = {};

    // Instantaneous Speed (bit 0 = 0 means present)
    if (!(flags & 0x01)) {
      data.speed = value.getUint16(offset, true) / 100; // Resolution: 0.01 km/h
      offset += 2;
    }

    // Average Speed (bit 1)
    if (flags & 0x02) {
      offset += 2; // Skip - we only want instantaneous
    }

    // Instantaneous Cadence (bit 2)
    if (flags & 0x04) {
      data.cadence = value.getUint16(offset, true) / 2; // Resolution: 0.5 RPM
      offset += 2;
    }

    // Average Cadence (bit 3)
    if (flags & 0x08) {
      offset += 2; // Skip
    }

    // Total Distance (bit 4) - 3 bytes
    if (flags & 0x10) {
      offset += 3; // Skip
    }

    // Resistance Level (bit 5)
    if (flags & 0x20) {
      offset += 2; // Skip
    }

    // Instantaneous Power (bit 6)
    if (flags & 0x40) {
      data.power = value.getInt16(offset, true); // Watts (signed)
      offset += 2;
    }

    // Average Power (bit 7)
    if (flags & 0x80) {
      offset += 2; // Skip
    }

    // Expended Energy (bit 8) - 3 fields totaling 5 bytes
    if (flags & 0x100) {
      offset += 5; // Skip
    }

    // Heart Rate (bit 9)
    if (flags & 0x200) {
      data.heartRate = value.getUint8(offset);
    }

    return data;
  }

  /**
   * Parse Cycling Power Measurement characteristic.
   *
   * Format (per Bluetooth CPS spec):
   *   - Bytes 0-1: Flags (16-bit)
   *   - Bytes 2-3: Instantaneous Power (signed 16-bit, Watts)
   *   - Remaining: Optional fields based on flags
   */
  private parseCyclingPowerMeasurement(value: DataView): FitnessData {
    // Power is always at bytes 2-3
    const power = value.getInt16(2, true);
    return { power };
  }

  /**
   * Parse Heart Rate Measurement characteristic.
   *
   * Format (per Bluetooth HRS spec):
   *   - Byte 0: Flags
   *     - Bit 0: Heart Rate Format (0 = UINT8, 1 = UINT16)
   *   - Byte 1 (or 1-2): Heart Rate Value
   */
  private parseHeartRateMeasurement(value: DataView): FitnessData {
    const flags = value.getUint8(0);
    const is16Bit = (flags & 0x01) === 1;

    const heartRate = is16Bit
      ? value.getUint16(1, true)
      : value.getUint8(1);

    return { heartRate };
  }
}
