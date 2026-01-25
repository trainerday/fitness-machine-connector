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
      case 'keiser-m3i':
        return this.parseKeiserM3iData(value);
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
    const data: FitnessData = {
      sourceType: 'ftms',
    };

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

    // Total Distance (bit 4) - 3 bytes (24-bit unsigned, in meters)
    if (flags & 0x10) {
      const distanceMeters =
        value.getUint8(offset) |
        (value.getUint8(offset + 1) << 8) |
        (value.getUint8(offset + 2) << 16);
      data.distance = distanceMeters / 1000; // Convert to km
      offset += 3;
    }

    // Resistance Level (bit 5)
    if (flags & 0x20) {
      data.resistance = value.getInt16(offset, true) / 10; // Resolution: 0.1
      offset += 2;
    }

    // Instantaneous Power (bit 6)
    if (flags & 0x40) {
      data.power = value.getInt16(offset, true); // Watts (signed)
      offset += 2;
    }

    // Average Power (bit 7)
    if (flags & 0x80) {
      offset += 2; // Skip average power
    }

    // Expended Energy (bit 8) - Total Energy (2 bytes), Energy per Hour (2 bytes), Energy per Minute (1 byte)
    if (flags & 0x100) {
      data.calories = value.getUint16(offset, true); // Total energy in kcal
      offset += 5; // Skip remaining energy fields
    }

    // Heart Rate (bit 9)
    if (flags & 0x200) {
      data.heartRate = value.getUint8(offset);
      offset += 1;
    }

    // Metabolic Equivalent (bit 10)
    if (flags & 0x400) {
      offset += 1; // Skip
    }

    // Elapsed Time (bit 11)
    if (flags & 0x800) {
      data.duration = value.getUint16(offset, true); // Seconds
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
    return { power, sourceType: 'cycling-power' };
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

    return { heartRate, sourceType: 'heart-rate' };
  }

  /**
   * Parse Keiser M3i proprietary data format.
   *
   * Format (19 bytes, little-endian):
   *   - Bytes 0-1: Magic [0x02, 0x01] (validates Keiser data)
   *   - Byte 2: Version Major (6 = M3i)
   *   - Byte 3: Version Minor (firmware)
   *   - Byte 4: Data Type (0 = realtime)
   *   - Byte 5: Equipment ID (0-200)
   *   - Bytes 6-7: Cadence (uint16LE ÷ 10 = RPM)
   *   - Bytes 8-9: Heart Rate (uint16LE ÷ 10 = BPM)
   *   - Bytes 10-11: Power (uint16LE = watts)
   *   - Bytes 12-13: Calories (uint16LE)
   *   - Bytes 14-15: Duration (uint16LE = seconds)
   *   - Bytes 16-17: Distance (uint16LE ÷ 10 = miles)
   *   - Byte 18: Gear (1-24)
   *
   * Reference: https://dev.keiser.com/mseries/direct/
   */
  private parseKeiserM3iData(value: DataView): FitnessData {
    const data: FitnessData = {
      sourceType: 'keiser-m3i',
    };

    // Validate minimum length
    if (value.byteLength < 12) {
      return data;
    }

    // Validate magic bytes [0x02, 0x01]
    const magic0 = value.getUint8(0);
    const magic1 = value.getUint8(1);
    if (magic0 !== 0x02 || magic1 !== 0x01) {
      return data;
    }

    // Validate version major (6 = M3i)
    const versionMajor = value.getUint8(2);
    if (versionMajor !== 6) {
      return data;
    }

    // Parse cadence (bytes 6-7): uint16LE ÷ 10 = RPM
    if (value.byteLength >= 8) {
      const rawCadence = value.getUint16(6, true);
      data.cadence = rawCadence / 10;
    }

    // Parse heart rate (bytes 8-9): uint16LE ÷ 10 = BPM
    if (value.byteLength >= 10) {
      const rawHeartRate = value.getUint16(8, true);
      // Only set heart rate if non-zero
      if (rawHeartRate > 0) {
        data.heartRate = Math.round(rawHeartRate / 10);
      }
    }

    // Parse power (bytes 10-11): uint16LE = watts
    if (value.byteLength >= 12) {
      data.power = value.getUint16(10, true);
    }

    // Parse calories (bytes 12-13): uint16LE = kcal
    if (value.byteLength >= 14) {
      data.calories = value.getUint16(12, true);
    }

    // Parse duration (bytes 14-15): uint16LE = seconds
    if (value.byteLength >= 16) {
      data.duration = value.getUint16(14, true);
    }

    // Parse distance (bytes 16-17): uint16LE ÷ 10 = miles, convert to km
    if (value.byteLength >= 18) {
      const rawDistance = value.getUint16(16, true);
      const distanceMiles = rawDistance / 10;
      data.distance = distanceMiles * 1.60934; // Convert miles to km
    }

    // Parse gear (byte 18): 1-24
    if (value.byteLength >= 19) {
      data.gear = value.getUint8(18);
    }

    return data;
  }
}
