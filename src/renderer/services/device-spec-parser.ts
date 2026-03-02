/**
 * =============================================================================
 * GENERIC DEVICE SPEC PARSER
 * =============================================================================
 *
 * Purpose:
 *   Parses fitness device data using JSON specifications from device-specs folder.
 *   This allows adding new devices by simply creating a JSON file - no code needed.
 *
 * How it works:
 *   1. Load all JSON specs from device-specs folder at startup
 *   2. When data arrives, match characteristic UUID to a spec
 *   3. Parse bytes according to the spec's field definitions
 *   4. Apply transformations (divisor, multiplier) and computed fields
 *
 * =============================================================================
 */

import { FitnessData } from '../../shared/types';

// Import all device specs
// In production, these could be loaded dynamically
import heartRateSpec from '../../device-specs/heart-rate.json';
import cyclingPowerSpec from '../../device-specs/cycling-power.json';
import echelonSpec from '../../device-specs/echelon.json';
import keiserM3iSpec from '../../device-specs/keiser-m3i.json';
import ftmsIndoorBikeSpec from '../../device-specs/ftms-indoor-bike.json';

// =============================================================================
// TYPES
// =============================================================================

type BluetoothUuid = number | string;

interface FieldCondition {
  min?: number;
  max?: number;
  flagOffset?: number;
  flagBit?: number;
  flagValue?: boolean;
}

interface StaticField {
  name: string;
  offset: number;
  type: 'uint8' | 'uint16' | 'int16' | 'uint32' | 'int32' | 'uint24';
  endian?: 'little' | 'big';
  divisor?: number;
  multiplier?: number;
  condition?: FieldCondition;
  comment?: string;
}

interface DynamicField {
  name: string;
  type: 'uint8' | 'uint16' | 'int16' | 'uint32' | 'int32' | 'uint24';
  flagBit: number;
  flagInverted?: boolean;
  divisor?: number;
  multiplier?: number;
  skip?: boolean;
  linkedToPrevious?: boolean;
  comment?: string;
}

interface ComputedField {
  name: string;
  operation: 'multiply' | 'divide' | 'sum';
  operands: string[];
  factor?: number;
  comment?: string;
}

interface ValidationRule {
  magicBytes?: Array<{ offset: number; value: number }>;
  versionCheck?: { offset: number; value: number };
}

interface DeviceSpec {
  id: string;
  name: string;
  description?: string;
  serviceUuid: string;
  characteristicUuid: string;
  minLength?: number;
  validation?: ValidationRule;
  mode?: 'static' | 'dynamic';
  flagOffset?: number;
  flagSize?: number;
  fields?: StaticField[];
  dynamicFields?: DynamicField[];
  computed?: ComputedField[];
}

// =============================================================================
// SPEC REGISTRY
// =============================================================================

const deviceSpecs: DeviceSpec[] = [
  heartRateSpec as DeviceSpec,
  cyclingPowerSpec as DeviceSpec,
  echelonSpec as DeviceSpec,
  keiserM3iSpec as DeviceSpec,
  ftmsIndoorBikeSpec as DeviceSpec,
];

// Build lookup map for fast characteristic matching
const specByCharacteristic = new Map<string, DeviceSpec>();

function normalizeUuid(uuid: BluetoothUuid): string {
  let hex: string;

  if (typeof uuid === 'number') {
    hex = uuid.toString(16).toLowerCase();
  } else if (uuid.startsWith('0x')) {
    // Handle "0x1234" format - strip prefix
    hex = uuid.slice(2).toLowerCase();
  } else {
    // 128-bit UUID string - return as-is (lowercase)
    return uuid.toLowerCase();
  }

  // For 16-bit UUIDs, strip leading zeros for consistent matching
  // "0002" -> "2", "002a" -> "2a"
  hex = hex.replace(/^0+/, '') || '0';

  return hex;
}

// Initialize lookup map
console.log('[DeviceSpecParser] Loading', deviceSpecs.length, 'device specs');
deviceSpecs.forEach(spec => {
  const normalizedUuid = normalizeUuid(spec.characteristicUuid);
  console.log(`[DeviceSpecParser] Registered: ${spec.id} (char: ${normalizedUuid})`);
  specByCharacteristic.set(normalizedUuid, spec);
});

// =============================================================================
// PARSER CLASS
// =============================================================================

export class DeviceSpecParser {
  /**
   * Parse raw Bluetooth data using device specs.
   */
  parse(characteristicUuid: BluetoothUuid, rawValue: DataView): FitnessData {
    const normalizedUuid = normalizeUuid(characteristicUuid);
    const spec = specByCharacteristic.get(normalizedUuid);

    console.log(`[DeviceSpecParser] Received data from characteristic: ${characteristicUuid} (normalized: ${normalizedUuid})`);
    console.log(`[DeviceSpecParser] Available specs:`, Array.from(specByCharacteristic.keys()));

    if (!spec) {
      console.log(`[DeviceSpecParser] No spec found for UUID: ${normalizedUuid}`);
      return {};
    }

    console.log(`[DeviceSpecParser] Matched spec: ${spec.id}, data length: ${rawValue.byteLength}`);
    const result = this.parseWithSpec(spec, rawValue);
    console.log(`[DeviceSpecParser] Parsed result:`, result);
    return result;
  }

  /**
   * Get all service UUIDs from loaded specs.
   * Converts "0x1826" format to numbers for Web Bluetooth API.
   */
  getServiceUuids(): BluetoothUuid[] {
    const uuidStrings = new Set<string>();
    const result: BluetoothUuid[] = [];

    deviceSpecs.forEach(spec => {
      const parsed = this.parseUuid(spec.serviceUuid);
      const key = String(parsed);
      if (!uuidStrings.has(key)) {
        uuidStrings.add(key);
        result.push(parsed);
      }
    });

    console.log('[DeviceSpecParser] Service UUIDs:', result);
    return result;
  }

  /**
   * Get all characteristic configs for subscription setup.
   */
  getCharacteristicConfigs(): Array<{ serviceUuid: BluetoothUuid; characteristicUuid: BluetoothUuid }> {
    return deviceSpecs.map(spec => ({
      serviceUuid: this.parseUuid(spec.serviceUuid),
      characteristicUuid: this.parseUuid(spec.characteristicUuid),
    }));
  }

  private parseUuid(uuid: string): BluetoothUuid {
    if (uuid.startsWith('0x')) {
      return parseInt(uuid, 16);
    }
    return uuid;
  }

  private parseWithSpec(spec: DeviceSpec, value: DataView): FitnessData {
    // Check minimum length
    if (spec.minLength && value.byteLength < spec.minLength) {
      return {};
    }

    // Run validation
    if (spec.validation && !this.validate(spec.validation, value)) {
      return {};
    }

    // Parse fields based on mode
    let data: FitnessData;
    if (spec.mode === 'dynamic' && spec.dynamicFields) {
      data = this.parseDynamicFields(spec, value);
    } else if (spec.fields) {
      data = this.parseStaticFields(spec.fields, value);
    } else {
      data = {};
    }

    // Apply computed fields
    if (spec.computed) {
      this.applyComputedFields(spec.computed, data);
    }

    // Set source type
    data.sourceType = spec.id as FitnessData['sourceType'];

    return data;
  }

  private validate(rules: ValidationRule, value: DataView): boolean {
    // Check magic bytes
    if (rules.magicBytes) {
      for (const check of rules.magicBytes) {
        if (value.byteLength <= check.offset) {
          console.log(`[DeviceSpecParser] Validation failed: not enough bytes for magic check at offset ${check.offset}`);
          return false;
        }
        const actual = value.getUint8(check.offset);
        if (actual !== check.value) {
          console.log(`[DeviceSpecParser] Validation failed: magic byte at ${check.offset} is ${actual}, expected ${check.value}`);
          return false;
        }
      }
    }

    // Check version
    if (rules.versionCheck) {
      if (value.byteLength <= rules.versionCheck.offset) {
        console.log(`[DeviceSpecParser] Validation failed: not enough bytes for version check`);
        return false;
      }
      const actual = value.getUint8(rules.versionCheck.offset);
      if (actual !== rules.versionCheck.value) {
        console.log(`[DeviceSpecParser] Validation failed: version at ${rules.versionCheck.offset} is ${actual}, expected ${rules.versionCheck.value}`);
        return false;
      }
    }

    return true;
  }

  private parseStaticFields(fields: StaticField[], value: DataView): FitnessData {
    const data: FitnessData = {};

    for (const field of fields) {
      // Check if we have enough bytes
      const size = this.getTypeSize(field.type);
      if (value.byteLength < field.offset + size) continue;

      // Check condition
      if (field.condition && !this.checkCondition(field.condition, value, field.offset, field.type)) {
        continue;
      }

      // Read value
      let rawValue = this.readValue(value, field.offset, field.type, field.endian || 'little');

      // Apply transformations
      if (field.divisor) rawValue /= field.divisor;
      if (field.multiplier) rawValue *= field.multiplier;

      // Store value (skip fields starting with _)
      if (!field.name.startsWith('_')) {
        (data as Record<string, number>)[field.name] = Math.round(rawValue * 100) / 100;
      }
    }

    return data;
  }

  private parseDynamicFields(spec: DeviceSpec, value: DataView): FitnessData {
    const data: FitnessData = {};
    const flagOffset = spec.flagOffset || 0;
    const flagSize = spec.flagSize || 2;

    // Read flags
    let flags = 0;
    if (flagSize === 1) {
      flags = value.getUint8(flagOffset);
    } else if (flagSize === 2) {
      flags = value.getUint16(flagOffset, true);
    }

    // Start offset after flags
    let offset = flagOffset + flagSize;

    // Process each field in order
    for (const field of spec.dynamicFields || []) {
      // Check if field is present based on flag
      const flagSet = (flags & (1 << field.flagBit)) !== 0;
      const isPresent = field.flagInverted ? !flagSet : flagSet;

      // For linked fields, they share the flag check with previous field
      // and are always present if the group is present
      if (field.linkedToPrevious) {
        // This field is part of a group, check if we have data
        const size = this.getTypeSize(field.type);
        if (value.byteLength < offset + size) continue;

        // Read and skip
        offset += size;
        continue;
      }

      if (!isPresent) continue;

      // Check if we have enough bytes
      const size = this.getTypeSize(field.type);
      if (value.byteLength < offset + size) continue;

      // Read value
      let rawValue = this.readValue(value, offset, field.type, 'little');
      offset += size;

      // Skip fields (just advance offset, don't store)
      if (field.skip) continue;

      // Apply transformations
      if (field.divisor) rawValue /= field.divisor;
      if (field.multiplier) rawValue *= field.multiplier;

      // Store value (skip fields starting with _)
      if (!field.name.startsWith('_')) {
        (data as Record<string, number>)[field.name] = Math.round(rawValue * 100) / 100;
      }
    }

    return data;
  }

  private checkCondition(condition: FieldCondition, value: DataView, offset: number, type: string): boolean {
    // Flag-based condition
    if (condition.flagOffset !== undefined && condition.flagBit !== undefined) {
      const flags = value.getUint8(condition.flagOffset);
      const flagSet = (flags & (1 << condition.flagBit)) !== 0;
      const expectedValue = condition.flagValue !== undefined ? condition.flagValue : true;
      if (flagSet !== expectedValue) return false;
    }

    // Value range condition (check after reading)
    if (condition.min !== undefined || condition.max !== undefined) {
      const rawValue = this.readValue(value, offset, type as StaticField['type'], 'little');
      if (condition.min !== undefined && rawValue < condition.min) return false;
      if (condition.max !== undefined && rawValue > condition.max) return false;
    }

    return true;
  }

  private applyComputedFields(computed: ComputedField[], data: FitnessData): void {
    for (const field of computed) {
      const values = field.operands.map(op => (data as Record<string, number>)[op]);

      // Skip if any operand is missing
      if (values.some(v => v === undefined || v === null)) continue;

      let result: number;
      switch (field.operation) {
        case 'multiply':
          result = values.reduce((a, b) => a * b, 1);
          if (field.factor) result *= field.factor;
          break;
        case 'divide':
          if (values[1] === 0) continue;
          result = values[0] / values[1];
          break;
        case 'sum':
          result = values.reduce((a, b) => a + b, 0);
          break;
        default:
          continue;
      }

      (data as Record<string, number>)[field.name] = Math.round(result * 100) / 100;
    }
  }

  private getTypeSize(type: string): number {
    switch (type) {
      case 'uint8': return 1;
      case 'uint16':
      case 'int16': return 2;
      case 'uint24': return 3;
      case 'uint32':
      case 'int32': return 4;
      default: return 1;
    }
  }

  private readValue(value: DataView, offset: number, type: string, endian: 'little' | 'big'): number {
    const littleEndian = endian === 'little';

    switch (type) {
      case 'uint8':
        return value.getUint8(offset);
      case 'uint16':
        return value.getUint16(offset, littleEndian);
      case 'int16':
        return value.getInt16(offset, littleEndian);
      case 'uint24':
        // 24-bit unsigned (always little-endian in BLE)
        return value.getUint8(offset) |
               (value.getUint8(offset + 1) << 8) |
               (value.getUint8(offset + 2) << 16);
      case 'uint32':
        return value.getUint32(offset, littleEndian);
      case 'int32':
        return value.getInt32(offset, littleEndian);
      default:
        return value.getUint8(offset);
    }
  }
}

// Export singleton instance
export const deviceSpecParser = new DeviceSpecParser();
