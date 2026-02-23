# Device Specifications

This folder contains JSON specification files for each supported fitness device type.

## Adding a New Device

To add support for a new fitness device, simply create a new `.json` file in this folder. The generic parser will automatically pick it up.

### File Structure

```json
{
  "id": "my-device",
  "name": "My Device Name",
  "description": "Brief description of the device",

  "serviceUuid": "0x1826",
  "characteristicUuid": "0x2ad2",

  "minLength": 4,

  "validation": {
    "magicBytes": [
      { "offset": 0, "value": 2 },
      { "offset": 1, "value": 1 }
    ]
  },

  "fields": [
    {
      "name": "power",
      "offset": 2,
      "type": "uint16",
      "endian": "little"
    }
  ],

  "computed": [
    {
      "name": "power",
      "operation": "multiply",
      "operands": ["cadence", "resistance"],
      "factor": 0.15
    }
  ]
}
```

### Field Reference

#### Root Properties

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `id` | string | Yes | Unique identifier (used internally) |
| `name` | string | Yes | Human-readable device name |
| `description` | string | No | Brief description |
| `serviceUuid` | string | Yes | BLE service UUID (16-bit "0x1826" or 128-bit "0bf669f0-...") |
| `characteristicUuid` | string | Yes | BLE characteristic UUID for data notifications |
| `minLength` | number | No | Minimum valid packet length in bytes |

#### Validation (optional)

```json
"validation": {
  "magicBytes": [
    { "offset": 0, "value": 2 }
  ]
}
```

Used to verify packets are from the expected device. Packets failing validation are ignored.

#### Fields

Each field extracts a value from the raw bytes:

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `name` | string | Yes | Target field: `power`, `cadence`, `heartRate`, `speed`, `resistance`, `distance`, `calories`, `duration`, `gear` |
| `offset` | number | Yes | Byte offset in the packet |
| `type` | string | Yes | Data type: `uint8`, `uint16`, `int16`, `uint32`, `int32` |
| `endian` | string | No | `"little"` (default) or `"big"` |
| `divisor` | number | No | Divide raw value by this (e.g., `10` for 0.1 resolution) |
| `multiplier` | number | No | Multiply raw value by this |
| `condition` | object | No | Only include if condition met |

#### Conditions

For values that should only be included under certain conditions:

```json
{
  "name": "heartRate",
  "offset": 11,
  "type": "uint8",
  "condition": {
    "min": 1,
    "max": 250
  }
}
```

For flag-based fields (like FTMS):

```json
{
  "name": "cadence",
  "offset": 4,
  "type": "uint16",
  "condition": {
    "flagOffset": 0,
    "flagBit": 2
  }
}
```

#### Computed Fields

For values calculated from other fields (like power from cadence × resistance):

```json
"computed": [
  {
    "name": "power",
    "operation": "multiply",
    "operands": ["cadence", "resistance"],
    "factor": 0.15
  }
]
```

Supported operations:
- `multiply` - Multiply operands together, optionally multiply by `factor`
- `divide` - Divide first operand by second
- `sum` - Add operands together

## Examples

See existing files in this folder for working examples:
- `ftms-indoor-bike.json` - Standard FTMS (flag-based fields)
- `heart-rate.json` - Simple standard format
- `echelon.json` - Proprietary format with computed power
- `keiser-m3i.json` - Proprietary format with validation

## Finding Device Information

1. **Standard BLE services**: Check [Bluetooth SIG assigned numbers](https://www.bluetooth.com/specifications/assigned-numbers/)
2. **Proprietary devices**: Use a BLE scanner app (nRF Connect, LightBlue) to discover UUIDs
3. **Reverse engineering**: Search GitHub for community projects that have documented the protocol
4. **Wireshark**: Capture BLE traffic to analyze packet structure
