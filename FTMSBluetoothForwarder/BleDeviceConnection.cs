using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Windows.Devices.Bluetooth;
using Windows.Devices.Bluetooth.GenericAttributeProfile;
using Windows.Storage.Streams;

namespace FTMSBluetoothForwarder
{
    /// <summary>
    /// Manages connection to a BLE fitness device and reads GATT data.
    /// </summary>
    public class BleDeviceConnection : IDisposable
    {
        private BluetoothLEDevice? _device;
        private readonly List<GattCharacteristic> _subscribedCharacteristics = new();
        private bool _disposed;

        // Known characteristic UUIDs for fitness devices
        private static readonly Guid FtmsIndoorBikeDataUuid = Guid.Parse("00002ad2-0000-1000-8000-00805f9b34fb");
        private static readonly Guid CyclingPowerMeasurementUuid = Guid.Parse("00002a63-0000-1000-8000-00805f9b34fb");
        private static readonly Guid HeartRateMeasurementUuid = Guid.Parse("00002a37-0000-1000-8000-00805f9b34fb");
        private static readonly Guid CyclingSpeedCadenceUuid = Guid.Parse("00002a5b-0000-1000-8000-00805f9b34fb");

        // Keiser M3i custom UUIDs
        private static readonly Guid KeiserServiceUuid = Guid.Parse("00000001-0000-1000-8000-00805f9b34fb");
        private static readonly Guid KeiserCharacteristicUuid = Guid.Parse("00000002-0000-1000-8000-00805f9b34fb");

        // Echelon custom UUIDs
        private static readonly Guid EchelonServiceUuid = Guid.Parse("0bf669f1-45f2-11e7-9598-0800200c9a66");
        private static readonly Guid EchelonCharacteristicUuid = Guid.Parse("0bf669f4-45f2-11e7-9598-0800200c9a66");

        public event Action<FitnessData, string>? OnDataReceived;  // data, source
        public event Action<string>? OnDisconnected;
        public event Action<string>? OnLog;

        public bool IsConnected => _device?.ConnectionStatus == BluetoothConnectionStatus.Connected;
        public string? ConnectedDeviceName => _device?.Name;
        public string? ConnectedDeviceId => _device?.BluetoothAddress.ToString("X12");

        /// <summary>
        /// Connect to a BLE device by its address.
        /// </summary>
        public async Task<bool> ConnectAsync(string deviceAddress)
        {
            try
            {
                // Parse the address (hex string to ulong)
                if (!ulong.TryParse(deviceAddress, System.Globalization.NumberStyles.HexNumber, null, out ulong address))
                {
                    Log($"Invalid device address: {deviceAddress}");
                    return false;
                }

                Log($"Connecting to device {deviceAddress}...");

                _device = await BluetoothLEDevice.FromBluetoothAddressAsync(address);
                if (_device == null)
                {
                    Log("Failed to get device");
                    return false;
                }

                _device.ConnectionStatusChanged += OnConnectionStatusChanged;

                Log($"Connected to {_device.Name}");

                // Discover and subscribe to fitness characteristics
                await DiscoverAndSubscribeAsync();

                return true;
            }
            catch (Exception ex)
            {
                Log($"Connection failed: {ex.Message}");
                return false;
            }
        }

        /// <summary>
        /// Disconnect from the current device.
        /// </summary>
        public void Disconnect()
        {
            if (_device != null)
            {
                Log("Disconnecting...");
                UnsubscribeAll();
                _device.ConnectionStatusChanged -= OnConnectionStatusChanged;
                _device.Dispose();
                _device = null;
            }
        }

        private async Task DiscoverAndSubscribeAsync()
        {
            if (_device == null) return;

            var servicesResult = await _device.GetGattServicesAsync(BluetoothCacheMode.Uncached);
            if (servicesResult.Status != GattCommunicationStatus.Success)
            {
                Log($"Failed to get services: {servicesResult.Status}");
                return;
            }

            Log($"Found {servicesResult.Services.Count} services");

            foreach (var service in servicesResult.Services)
            {
                await TrySubscribeToServiceAsync(service);
            }
        }

        private async Task TrySubscribeToServiceAsync(GattDeviceService service)
        {
            try
            {
                var charsResult = await service.GetCharacteristicsAsync(BluetoothCacheMode.Uncached);
                if (charsResult.Status != GattCommunicationStatus.Success)
                {
                    return;
                }

                foreach (var characteristic in charsResult.Characteristics)
                {
                    // Check if this is a characteristic we care about
                    if (IsRelevantCharacteristic(characteristic.Uuid))
                    {
                        await SubscribeToCharacteristicAsync(characteristic);
                    }
                }
            }
            catch (Exception ex)
            {
                Log($"Error processing service {service.Uuid}: {ex.Message}");
            }
        }

        private bool IsRelevantCharacteristic(Guid uuid)
        {
            return uuid == FtmsIndoorBikeDataUuid ||
                   uuid == CyclingPowerMeasurementUuid ||
                   uuid == HeartRateMeasurementUuid ||
                   uuid == CyclingSpeedCadenceUuid ||
                   uuid == KeiserCharacteristicUuid ||
                   uuid == EchelonCharacteristicUuid;
        }

        private async Task SubscribeToCharacteristicAsync(GattCharacteristic characteristic)
        {
            try
            {
                // Check if characteristic supports notifications
                if (!characteristic.CharacteristicProperties.HasFlag(GattCharacteristicProperties.Notify))
                {
                    return;
                }

                var status = await characteristic.WriteClientCharacteristicConfigurationDescriptorAsync(
                    GattClientCharacteristicConfigurationDescriptorValue.Notify);

                if (status != GattCommunicationStatus.Success)
                {
                    Log($"Failed to subscribe to {characteristic.Uuid}: {status}");
                    return;
                }

                characteristic.ValueChanged += OnCharacteristicValueChanged;
                _subscribedCharacteristics.Add(characteristic);

                Log($"Subscribed to {GetCharacteristicName(characteristic.Uuid)}");
            }
            catch (Exception ex)
            {
                Log($"Error subscribing to {characteristic.Uuid}: {ex.Message}");
            }
        }

        private void UnsubscribeAll()
        {
            foreach (var characteristic in _subscribedCharacteristics)
            {
                try
                {
                    characteristic.ValueChanged -= OnCharacteristicValueChanged;
                }
                catch { }
            }
            _subscribedCharacteristics.Clear();
        }

        private void OnCharacteristicValueChanged(GattCharacteristic sender, GattValueChangedEventArgs args)
        {
            try
            {
                var reader = DataReader.FromBuffer(args.CharacteristicValue);
                var bytes = new byte[args.CharacteristicValue.Length];
                reader.ReadBytes(bytes);

                var data = ParseCharacteristicData(sender.Uuid, bytes, out string source);
                if (data != null)
                {
                    OnDataReceived?.Invoke(data, source);
                }
            }
            catch (Exception ex)
            {
                Log($"Error parsing data: {ex.Message}");
            }
        }

        private FitnessData? ParseCharacteristicData(Guid uuid, byte[] data, out string source)
        {
            source = "unknown";

            if (uuid == FtmsIndoorBikeDataUuid)
            {
                source = "ftms";
                return ParseFtmsIndoorBikeData(data);
            }
            else if (uuid == CyclingPowerMeasurementUuid)
            {
                source = "cycling-power";
                return ParseCyclingPowerData(data);
            }
            else if (uuid == HeartRateMeasurementUuid)
            {
                source = "heart-rate";
                return ParseHeartRateData(data);
            }
            else if (uuid == KeiserCharacteristicUuid)
            {
                source = "keiser-m3i";
                return ParseKeiserData(data);
            }
            else if (uuid == EchelonCharacteristicUuid)
            {
                source = "echelon";
                return ParseEchelonData(data);
            }

            return null;
        }

        private FitnessData ParseFtmsIndoorBikeData(byte[] data)
        {
            // FTMS Indoor Bike Data parsing
            // Flags (2 bytes) + variable fields based on flags
            if (data.Length < 2) return new FitnessData();

            var flags = BitConverter.ToUInt16(data, 0);
            int offset = 2;
            var result = new FitnessData();

            // Bit 0: More Data (ignored)
            // Bit 1: Average Speed Present
            // Bit 2: Instantaneous Cadence Present
            if ((flags & 0x04) != 0 && offset + 2 <= data.Length)
            {
                result.Cadence = BitConverter.ToUInt16(data, offset) / 2.0; // 0.5 RPM resolution
                offset += 2;
            }

            // Bit 3: Average Cadence Present (skip)
            if ((flags & 0x08) != 0) offset += 2;

            // Bit 4: Total Distance Present (skip)
            if ((flags & 0x10) != 0) offset += 3;

            // Bit 5: Resistance Level Present
            if ((flags & 0x20) != 0 && offset + 2 <= data.Length)
            {
                result.Resistance = BitConverter.ToInt16(data, offset);
                offset += 2;
            }

            // Bit 6: Instantaneous Power Present
            if ((flags & 0x40) != 0 && offset + 2 <= data.Length)
            {
                result.Power = BitConverter.ToInt16(data, offset);
                offset += 2;
            }

            // Bit 7: Average Power Present (skip)
            if ((flags & 0x80) != 0) offset += 2;

            // Bit 8-9: Expended Energy (skip)
            if ((flags & 0x100) != 0) offset += 5;

            // Bit 10: Heart Rate Present
            if ((flags & 0x400) != 0 && offset + 1 <= data.Length)
            {
                result.HeartRate = data[offset];
            }

            return result;
        }

        private FitnessData ParseCyclingPowerData(byte[] data)
        {
            if (data.Length < 4) return new FitnessData();

            var flags = BitConverter.ToUInt16(data, 0);
            var power = BitConverter.ToInt16(data, 2);

            return new FitnessData { Power = power };
        }

        private FitnessData ParseHeartRateData(byte[] data)
        {
            if (data.Length < 2) return new FitnessData();

            // Bit 0 of flags indicates if HR is uint8 or uint16
            bool isUint16 = (data[0] & 0x01) != 0;
            int heartRate = isUint16 ? BitConverter.ToUInt16(data, 1) : data[1];

            return new FitnessData { HeartRate = heartRate };
        }

        private FitnessData ParseKeiserData(byte[] data)
        {
            // Keiser M3i format: proprietary
            // This is a simplified parser - actual format may vary
            if (data.Length < 14) return new FitnessData();

            var result = new FitnessData();

            // Keiser format (typical):
            // Bytes vary by version, but commonly:
            // Power is at offset 10-11 (big endian)
            // Cadence is at offset 6-7
            // Heart rate at offset 8
            try
            {
                result.Cadence = (data[6] << 8 | data[7]) / 10.0;
                result.HeartRate = data[8];
                result.Power = data[10] << 8 | data[11];
            }
            catch { }

            return result;
        }

        private FitnessData ParseEchelonData(byte[] data)
        {
            // Echelon format: proprietary
            if (data.Length < 10) return new FitnessData();

            var result = new FitnessData();

            try
            {
                // Echelon data format varies by model
                // Common format: cadence at byte 7, resistance at byte 5
                result.Cadence = data[7];
                result.Resistance = data[5];
                // Power is often calculated from cadence and resistance
                result.Power = (int)(result.Cadence * (1 + result.Resistance / 32.0) * 0.5);
            }
            catch { }

            return result;
        }

        private string GetCharacteristicName(Guid uuid)
        {
            if (uuid == FtmsIndoorBikeDataUuid) return "FTMS Indoor Bike";
            if (uuid == CyclingPowerMeasurementUuid) return "Cycling Power";
            if (uuid == HeartRateMeasurementUuid) return "Heart Rate";
            if (uuid == KeiserCharacteristicUuid) return "Keiser M3i";
            if (uuid == EchelonCharacteristicUuid) return "Echelon";
            return uuid.ToString();
        }

        private void OnConnectionStatusChanged(BluetoothLEDevice sender, object args)
        {
            if (sender.ConnectionStatus == BluetoothConnectionStatus.Disconnected)
            {
                Log("Device disconnected");
                OnDisconnected?.Invoke("Connection lost");
            }
        }

        private void Log(string message)
        {
            OnLog?.Invoke(message);
        }

        public void Dispose()
        {
            if (!_disposed)
            {
                Disconnect();
                _disposed = true;
            }
        }
    }
}
