/**
 * Bare-bones FTMS BLE skeleton (TypeScript + @abandonware/bleno)
 * - Advertises as a BLE peripheral
 * - Exposes FTMS service (0x1826)
 * - Exposes two characteristics:
 *   - Indoor Bike Data (0x2AD2) notify-only (no payload generation here)
 *   - Fitness Machine Feature (0x2ACC) read-only (returns empty/minimal buffer)
 *
 * NOTE: bleno typings are imperfect; this file intentionally keeps BT parts only
 * and uses light `any` where bleno types are missing.
 */

import bleno from '@abandonware/bleno';

// UUIDs (lowercase for consistency)
const FITNESS_MACHINE_SERVICE_UUID = '1826';
const INDOOR_BIKE_DATA_UUID = '2ad2';
const FITNESS_MACHINE_FEATURE_UUID = '2acc';

const DEVICE_NAME = 'FTMS Bike BLE Skeleton';

// Minimal “result codes” access (bleno typing gaps)
const CharacteristicAny = (bleno as any).Characteristic;
const PrimaryServiceAny = (bleno as any).PrimaryService;

/**
 * Indoor Bike Data Characteristic (Notify)
 * BLE-only: manages subscribe/unsubscribe and holds the notification callback.
 * No timers, no payload creation.
 */
class IndoorBikeDataCharacteristic extends CharacteristicAny {
  private notifyCb: ((data: Buffer) => void) | null = null;

  constructor() {
    super({
      uuid: INDOOR_BIKE_DATA_UUID,
      properties: ['notify'],
      descriptors: [],
    });
  }

  // Called when a client (Zwift, etc.) subscribes to notifications
  public onSubscribe(_maxValueSize: number, updateValueCallback: (data: Buffer) => void): void {
    console.log('📱 Client subscribed to Indoor Bike Data');
    this.notifyCb = updateValueCallback;

    // Intentionally NOT sending any data here.
    // Later you can do: this.notifyCb?.(someBuffer)
  }

  public onUnsubscribe(): void {
    console.log('📱 Client unsubscribed from Indoor Bike Data');
    this.notifyCb = null;
  }
}

/**
 * Fitness Machine Feature Characteristic (Read)
 * BLE-only: read handler returns a placeholder 8-byte buffer.
 */
class FitnessMachineFeatureCharacteristic extends CharacteristicAny {
  constructor() {
    super({
      uuid: FITNESS_MACHINE_FEATURE_UUID,
      properties: ['read'],
      value: null,
    });
  }

  public onReadRequest(
    offset: number,
    callback: (result: number, data?: Buffer | null) => void
  ): void {
    if (offset) {
      callback(CharacteristicAny.RESULT_ATTR_NOT_LONG, null);
      return;
    }

    // Placeholder 8 bytes (FTMS Feature = 2x uint32)
    const features = Buffer.alloc(8, 0x00);
    callback(CharacteristicAny.RESULT_SUCCESS, features);
  }
}

/**
 * BLE state + advertising
 */
bleno.on('stateChange', (state: string) => {
  console.log(`🔵 Bluetooth state: ${state}`);

  if (state === 'poweredOn') {
    console.log('📡 Starting advertising...');
    bleno.startAdvertising(DEVICE_NAME, [FITNESS_MACHINE_SERVICE_UUID]);
  } else {
    console.log('⏹️  Stopping advertising...');
    bleno.stopAdvertising();
  }
});

/**
 * Register GATT services once advertising starts
 */
bleno.on('advertisingStart', (error: Error | null) => {
  if (error) {
    console.error('❌ Advertising error:', error);
    return;
  }

  console.log('✅ Advertising started successfully!');
  console.log(`📱 Device name: ${DEVICE_NAME}`);
  console.log(`🆔 Service UUID: ${FITNESS_MACHINE_SERVICE_UUID}`);
  console.log('');

  const fitnessMachineService = new PrimaryServiceAny({
    uuid: FITNESS_MACHINE_SERVICE_UUID,
    characteristics: [
      new IndoorBikeDataCharacteristic(),
      new FitnessMachineFeatureCharacteristic(),
    ],
  });

  bleno.setServices([fitnessMachineService], (err: Error | null) => {
    if (err) console.error('❌ Error setting services:', err);
    else console.log('✅ FTMS service registered');
  });
});

/**
 * Connection events
 */
bleno.on('accept', (clientAddress: string) => {
  console.log(`✅ Client connected: ${clientAddress}`);
});

bleno.on('disconnect', (clientAddress: string) => {
  console.log(`❌ Client disconnected: ${clientAddress}`);
});

/**
 * Graceful shutdown
 */
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down BLE skeleton...');
  bleno.stopAdvertising();
  process.exit(0);
});

console.log('');
console.log('═══════════════════════════════════════════════════════');
console.log('🚴 FTMS BLE Skeleton (TypeScript)');
console.log('═══════════════════════════════════════════════════════');
console.log('');
console.log('Waiting for Bluetooth to power on...');
