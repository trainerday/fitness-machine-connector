// Bluetooth service using Web Bluetooth API
// This runs in the renderer process

// Standard Bluetooth GATT Service UUIDs for fitness devices
export const FITNESS_SERVICE_UUIDS = {
  FTMS: 0x1826,                    // Fitness Machine Service
  CYCLING_POWER: 0x1818,           // Cycling Power Service
  CYCLING_SPEED_CADENCE: 0x1816,   // Cycling Speed and Cadence Service
  HEART_RATE: 0x180d,              // Heart Rate Service
};

// FTMS Characteristic UUIDs
export const FTMS_CHARACTERISTICS = {
  INDOOR_BIKE_DATA: 0x2ad2,
  FITNESS_MACHINE_FEATURE: 0x2acc,
  FITNESS_MACHINE_CONTROL_POINT: 0x2ad9,
  FITNESS_MACHINE_STATUS: 0x2ada,
};

export interface FitnessData {
  power?: number;      // Watts
  cadence?: number;    // RPM
  heartRate?: number;  // BPM
  speed?: number;      // km/h
}

export interface BluetoothDeviceInfo {
  device: BluetoothDevice;
  name: string;
  id: string;
  services: string[];
  isFitnessDevice: boolean;
}

type DataCallback = (data: FitnessData) => void;
type ConnectionCallback = (connected: boolean, device?: BluetoothDeviceInfo) => void;

class BluetoothService {
  private connectedDevice: BluetoothDevice | null = null;
  private server: BluetoothRemoteGATTServer | null = null;
  private dataCallback: DataCallback | null = null;
  private connectionCallback: ConnectionCallback | null = null;

  // Check if Web Bluetooth is available
  isAvailable(): boolean {
    return navigator.bluetooth !== undefined;
  }

  // Set callback for fitness data updates
  onData(callback: DataCallback): void {
    this.dataCallback = callback;
  }

  // Set callback for connection status changes
  onConnectionChange(callback: ConnectionCallback): void {
    this.connectionCallback = callback;
  }

  // Scan for fitness devices
  async scanForDevices(): Promise<BluetoothDevice | null> {
    console.log('[BT Service] scanForDevices called');

    if (!this.isAvailable()) {
      console.log('[BT Service] Web Bluetooth NOT available');
      throw new Error('Web Bluetooth is not available');
    }

    console.log('[BT Service] Web Bluetooth is available, starting requestDevice...');

    try {
      // Request device with fitness service filters
      // acceptAllDevices allows seeing all BLE devices
      console.log('[BT Service] Calling navigator.bluetooth.requestDevice()');
      const device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [
          FITNESS_SERVICE_UUIDS.FTMS,
          FITNESS_SERVICE_UUIDS.CYCLING_POWER,
          FITNESS_SERVICE_UUIDS.CYCLING_SPEED_CADENCE,
          FITNESS_SERVICE_UUIDS.HEART_RATE,
        ],
      });

      console.log('[BT Service] requestDevice returned:', device?.name, device?.id);
      return device;
    } catch (error) {
      console.log('[BT Service] requestDevice error:', (error as Error).message);
      if ((error as Error).message?.includes('cancelled')) {
        return null; // User cancelled
      }
      throw error;
    }
  }

  // Connect to a device and start reading data
  async connect(device: BluetoothDevice): Promise<void> {
    if (!device.gatt) {
      throw new Error('Device does not support GATT');
    }

    // Disconnect from any existing device
    await this.disconnect();

    try {
      // Connect to GATT server
      this.server = await device.gatt.connect();
      this.connectedDevice = device;

      // Set up disconnect handler
      device.addEventListener('gattserverdisconnected', () => {
        this.handleDisconnect();
      });

      // Notify connection
      if (this.connectionCallback) {
        this.connectionCallback(true, {
          device,
          name: device.name || 'Unknown Device',
          id: device.id,
          services: [],
          isFitnessDevice: true,
        });
      }

      // Try to subscribe to fitness data
      await this.subscribeToFitnessData();

    } catch (error) {
      this.connectedDevice = null;
      this.server = null;
      throw error;
    }
  }

  // Subscribe to fitness data characteristics
  private async subscribeToFitnessData(): Promise<void> {
    if (!this.server) return;

    // Try FTMS Indoor Bike Data first
    try {
      const ftmsService = await this.server.getPrimaryService(FITNESS_SERVICE_UUIDS.FTMS);
      const indoorBikeChar = await ftmsService.getCharacteristic(FTMS_CHARACTERISTICS.INDOOR_BIKE_DATA);

      indoorBikeChar.addEventListener('characteristicvaluechanged', (event) => {
        const value = (event.target as BluetoothRemoteGATTCharacteristic).value;
        if (value) {
          const data = this.parseIndoorBikeData(value);
          if (this.dataCallback) {
            this.dataCallback(data);
          }
        }
      });

      await indoorBikeChar.startNotifications();
      console.log('Subscribed to FTMS Indoor Bike Data');
      return;
    } catch (e) {
      console.log('FTMS not available, trying other services...');
    }

    // Try Cycling Power Service
    try {
      const powerService = await this.server.getPrimaryService(FITNESS_SERVICE_UUIDS.CYCLING_POWER);
      const powerChar = await powerService.getCharacteristic(0x2a63); // Cycling Power Measurement

      powerChar.addEventListener('characteristicvaluechanged', (event) => {
        const value = (event.target as BluetoothRemoteGATTCharacteristic).value;
        if (value) {
          const data = this.parseCyclingPowerData(value);
          if (this.dataCallback) {
            this.dataCallback(data);
          }
        }
      });

      await powerChar.startNotifications();
      console.log('Subscribed to Cycling Power');
    } catch (e) {
      console.log('Cycling Power not available');
    }

    // Try Heart Rate Service
    try {
      const hrService = await this.server.getPrimaryService(FITNESS_SERVICE_UUIDS.HEART_RATE);
      const hrChar = await hrService.getCharacteristic(0x2a37); // Heart Rate Measurement

      hrChar.addEventListener('characteristicvaluechanged', (event) => {
        const value = (event.target as BluetoothRemoteGATTCharacteristic).value;
        if (value) {
          const heartRate = this.parseHeartRateData(value);
          if (this.dataCallback) {
            this.dataCallback({ heartRate });
          }
        }
      });

      await hrChar.startNotifications();
      console.log('Subscribed to Heart Rate');
    } catch (e) {
      console.log('Heart Rate not available');
    }
  }

  // Parse FTMS Indoor Bike Data characteristic
  private parseIndoorBikeData(value: DataView): FitnessData {
    const flags = value.getUint16(0, true);
    let offset = 2;
    const data: FitnessData = {};

    // Instantaneous Speed (if present, bit 0 = 0 means present)
    if (!(flags & 0x01)) {
      data.speed = value.getUint16(offset, true) / 100; // 0.01 km/h resolution
      offset += 2;
    }

    // Average Speed (skip if present)
    if (flags & 0x02) {
      offset += 2;
    }

    // Instantaneous Cadence (if present)
    if (flags & 0x04) {
      data.cadence = value.getUint16(offset, true) / 2; // 0.5 RPM resolution
      offset += 2;
    }

    // Average Cadence (skip if present)
    if (flags & 0x08) {
      offset += 2;
    }

    // Total Distance (skip if present)
    if (flags & 0x10) {
      offset += 3;
    }

    // Resistance Level (skip if present)
    if (flags & 0x20) {
      offset += 2;
    }

    // Instantaneous Power (if present)
    if (flags & 0x40) {
      data.power = value.getInt16(offset, true);
      offset += 2;
    }

    // Heart Rate (if present)
    if (flags & 0x200) {
      data.heartRate = value.getUint8(offset);
    }

    return data;
  }

  // Parse Cycling Power Measurement characteristic
  private parseCyclingPowerData(value: DataView): FitnessData {
    const flags = value.getUint16(0, true);
    const power = value.getInt16(2, true);
    const data: FitnessData = { power };

    // Check if crank revolution data is present (bit 5)
    if (flags & 0x20) {
      // Could calculate cadence from crank revolutions here
    }

    return data;
  }

  // Parse Heart Rate Measurement characteristic
  private parseHeartRateData(value: DataView): number {
    const flags = value.getUint8(0);
    // Check if heart rate is 16-bit (bit 0)
    if (flags & 0x01) {
      return value.getUint16(1, true);
    }
    return value.getUint8(1);
  }

  // Handle device disconnection
  private handleDisconnect(): void {
    this.connectedDevice = null;
    this.server = null;

    if (this.connectionCallback) {
      this.connectionCallback(false);
    }
  }

  // Disconnect from current device
  async disconnect(): Promise<void> {
    if (this.server && this.server.connected) {
      this.server.disconnect();
    }
    this.connectedDevice = null;
    this.server = null;
  }

  // Get current connection status
  isConnected(): boolean {
    return this.server?.connected ?? false;
  }

  // Get connected device info
  getConnectedDevice(): BluetoothDevice | null {
    return this.connectedDevice;
  }
}

// Export singleton instance
export const bluetoothService = new BluetoothService();
