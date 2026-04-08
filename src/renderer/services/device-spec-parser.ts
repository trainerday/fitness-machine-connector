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
  byteEquals?: { offset: number; value: number };
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
  operation: 'multiply' | 'divide' | 'sum' | 'exponential';
  operands: string[];
  factor?: number;
  base?: number;
  comment?: string;
}

interface InitWrite {
  characteristicUuid: string;
  bytes: number[];
  comment?: string;
}

interface ValidationRule {
  magicBytes?: Array<{ offset: number; value: number }>;
  versionCheck?: { offset: number; value: number };
}

interface PacketSpec {
  comment?: string;
  validation?: ValidationRule;
  minLength?: number;
  fields: StaticField[];
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
  packets?: PacketSpec[];
  flagSize?: number;
  fields?: StaticField[];
  dynamicFields?: DynamicField[];
  computed?: ComputedField[];
  initWrites?: InitWrite[];
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
    // 128-bit UUID string
    const lower = uuid.toLowerCase();
    // BLE standard UUIDs use the base pattern 0000XXXX-0000-1000-8000-00805f9b34fb.
    // The .NET backend emits the full 128-bit form (e.g. "00000002-0000-1000-8000-00805f9b34fb")
    // but specs use the short form (e.g. "0x0002"). Normalize them to the same short key.
    const bleBase = lower.match(/^0000([0-9a-f]{4})-0000-1000-8000-00805f9b34fb$/);
    if (bleBase) {
      hex = bleBase[1];
    } else {
      return lower;
    }
  }

  // Strip leading zeros for consistent matching: "0002" -> "2", "002a" -> "2a"
  return hex.replace(/^0+/, '') || '0';
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
  private identifiedSpecs = new Set<string>();
  /** Accumulated field values per spec — lets computed fields use data from multiple packet types */
  private accumulatedState = new Map<string, Record<string, number>>();

  /**
   * Per-spec cache of last-seen field values.
   * Used for devices like Echelon that send different fields in separate packets
   * (e.g. resistance in D1, cadence in D2) so computed fields can combine them.
   */
  private stateCache = new Map<string, Record<string, number>>();

  /**
   * Parse raw Bluetooth data using device specs.
   */
  parse(characteristicUuid: BluetoothUuid, rawValue: DataView): FitnessData {
    const normalizedUuid = normalizeUuid(characteristicUuid);
    const spec = specByCharacteristic.get(normalizedUuid);

    if (!spec) {
      console.log(`[DeviceSpecParser] No spec found for UUID: ${normalizedUuid}`);
      return {};
    }

    // Log device identification once per spec per connection session
    if (!this.identifiedSpecs.has(spec.id)) {
      this.identifiedSpecs.add(spec.id);
      console.log(
        `%c[Device Identified] ${spec.name} (${spec.id})`,
        'color: #4CAF50; font-weight: bold; font-size: 14px'
      );
      console.log(`  Characteristic: ${characteristicUuid}`);
      console.log(`  Data length:    ${rawValue.byteLength} bytes`);
      console.log(`  Init writes:    ${spec.initWrites?.length ? `yes (${spec.initWrites.length})` : 'none'}`);
    }

    const result = this.parseWithSpec(spec, rawValue);
    return result;
  }

  /**
   * Reset identified device tracking — call this on disconnect so the log
   * fires again on the next connection.
   */
  resetIdentification(): void {
    this.identifiedSpecs.clear();
    this.accumulatedState.clear();
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
   * Identify which device spec matches a given service UUID.
   * Returns the spec name/id or null if unrecognized.
   */
  identifyByServiceUuid(serviceUuid: BluetoothUuid): { id: string; name: string; hasInitWrites: boolean } | null {
    const normalized = normalizeUuid(serviceUuid);
    const spec = deviceSpecs.find(s => normalizeUuid(s.serviceUuid) === normalized);
    if (!spec) return null;
    return {
      id: spec.id,
      name: spec.name,
      hasInitWrites: !!(spec.initWrites?.length),
    };
  }

  /**
   * Get all init writes across all loaded specs.
   * FitnessDataReader attempts each after connecting — writes that don't apply
   * to the connected device fail silently (same pattern as trySubscribe).
   */
  getAllInitWrites(): Array<{ serviceUuid: BluetoothUuid; characteristicUuid: string; bytes: number[] }> {
    const result: Array<{ serviceUuid: BluetoothUuid; characteristicUuid: string; bytes: number[] }> = [];
    for (const spec of deviceSpecs) {
      if (!spec.initWrites?.length) continue;
      for (const w of spec.initWrites) {
        result.push({
          serviceUuid: this.parseUuid(spec.serviceUuid),
          characteristicUuid: w.characteristicUuid,
          bytes: w.bytes,
        });
      }
    }
    return result;
  }

  /**
   * Get the display name for a spec by its id.
   * Returns the spec's human-readable name, or the id itself if not found.
   */
  getSpecName(specId: string): string {
    const spec = deviceSpecs.find(s => s.id === specId);
    return spec?.name ?? specId;
  }

  /**
   * Get the ordered list of field names to display for a given spec.
   * Derived directly from the spec — no hardcoding per device.
   * Excludes private fields (name starts with _) and skip-only fields.
   */
  getDisplayFields(specId: string): string[] {
    const spec = deviceSpecs.find(s => s.id === specId);
    if (!spec) return ['power', 'cadence', 'heartRate'];

    const names: string[] = [];
    const seen = new Set<string>();

    const addField = (name: string) => {
      if (!name.startsWith('_') && !seen.has(name)) {
        seen.add(name);
        names.push(name);
      }
    };

    // Static single-packet fields
    for (const f of spec.fields ?? []) addField(f.name);

    // Dynamic fields (FTMS-style flag-based), excluding skip-only fields
    for (const f of spec.dynamicFields ?? []) {
      if (!f.skip) addField(f.name);
    }

    // Multi-packet specs (e.g. Echelon D1/D2)
    for (const p of spec.packets ?? []) {
      for (const f of p.fields ?? []) addField(f.name);
    }

    // NOTE: computed fields are intentionally excluded — they are synthetic values
    // calculated by the app, not data the device actually broadcasts.

    return names;
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
    let newFields: Record<string, number> = {};

    if (spec.packets) {
      // Multi-packet spec: find the first packet whose validation passes and parse its fields
      for (const packet of spec.packets) {
        if (packet.minLength && value.byteLength < packet.minLength) continue;
        if (packet.validation && !this.validate(packet.validation, value)) continue;
        newFields = this.parseStaticFields(packet.fields, value) as Record<string, number>;
        break;
      }
    } else {
      // Single-packet spec (existing behaviour)
      if (spec.minLength && value.byteLength < spec.minLength) return {};
      if (spec.validation && !this.validate(spec.validation, value)) return {};

      if (spec.mode === 'dynamic' && spec.dynamicFields) {
        newFields = this.parseDynamicFields(spec, value) as Record<string, number>;
      } else if (spec.fields) {
        newFields = this.parseStaticFields(spec.fields, value) as Record<string, number>;
      }
    }

    // Merge new fields into accumulated state for this spec
    const prev = this.accumulatedState.get(spec.id) ?? {};
    const accumulated = { ...prev, ...newFields };
    this.accumulatedState.set(spec.id, accumulated);

    // Apply computed fields using the full accumulated state (spans multiple packet types)
    const data: FitnessData = { ...accumulated };
    if (spec.computed) {
      this.applyComputedFields(spec.computed, data);
    }

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
    // Packet-type byte check (e.g. only parse resistance from 0xd2 packets)
    if (condition.byteEquals !== undefined) {
      if (value.byteLength <= condition.byteEquals.offset) return false;
      if (value.getUint8(condition.byteEquals.offset) !== condition.byteEquals.value) return false;
    }

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
        case 'exponential':
          // result = base^operand[0], then multiply by factor
          if (field.base === undefined) continue;
          result = Math.pow(field.base, values[0]);
          if (field.factor) result *= field.factor;
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
