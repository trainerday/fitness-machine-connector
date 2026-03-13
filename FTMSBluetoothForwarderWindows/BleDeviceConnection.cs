using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Windows.Devices.Bluetooth;
using Windows.Devices.Bluetooth.GenericAttributeProfile;
using Windows.Storage.Streams;

namespace FTMSBluetoothForwarder
{
    /// <summary>
    /// Manages connection to a BLE fitness device and reads GATT data.
    /// Acts as a dumb transport: subscribes to all notifiable characteristics,
    /// emits raw bytes upstream, and accepts write commands.
    /// </summary>
    public class BleDeviceConnection : IDisposable
    {
        private BluetoothLEDevice? _device;
        private readonly List<GattCharacteristic> _subscribedCharacteristics = new();
        private bool _disposed;
        private string? _advertisedName; // Store the name from scan advertisement

        // Known characteristic UUIDs kept for logging purposes only
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

        public event Action<string, byte[]>? OnRawDataReceived;  // characteristicUuid, bytes
        public event Action<string>? OnDisconnected;
        public event Action<string>? OnLog;

        public bool IsConnected => _device?.ConnectionStatus == BluetoothConnectionStatus.Connected;
        public string? ConnectedDeviceName => _advertisedName ?? _device?.Name; // Prefer advertised name
        public string? ConnectedDeviceId => _device?.BluetoothAddress.ToString("X12");

        /// <summary>
        /// Connect to a BLE device by its address.
        /// </summary>
        /// <param name="deviceAddress">Hex address of the device</param>
        /// <param name="advertisedName">Optional: the name from scan advertisement (preferred over system name)</param>
        public async Task<bool> ConnectAsync(string deviceAddress, string? advertisedName = null)
        {
            try
            {
                // Store the advertised name if provided
                _advertisedName = advertisedName;

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

                Log($"Connected to {ConnectedDeviceName}");

                // Discover and subscribe to all notifiable characteristics
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
                    // Subscribe to ALL characteristics that support notifications
                    if (characteristic.CharacteristicProperties.HasFlag(GattCharacteristicProperties.Notify))
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

        private async Task SubscribeToCharacteristicAsync(GattCharacteristic characteristic)
        {
            try
            {
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

                OnRawDataReceived?.Invoke(sender.Uuid.ToString(), bytes);
            }
            catch (Exception ex)
            {
                Log($"Error reading characteristic data: {ex.Message}");
            }
        }

        /// <summary>
        /// Write bytes to a specific characteristic (e.g. init writes for Echelon, Keiser).
        /// </summary>
        public async Task WriteCharacteristicAsync(Guid serviceUuid, Guid charUuid, byte[] bytes)
        {
            if (_device == null) return;

            try
            {
                var servicesResult = await _device.GetGattServicesForUuidAsync(serviceUuid, BluetoothCacheMode.Uncached);
                if (servicesResult.Status != GattCommunicationStatus.Success || servicesResult.Services.Count == 0)
                {
                    Log($"WriteCharacteristic: service {serviceUuid} not found");
                    return;
                }

                var service = servicesResult.Services[0];
                var charsResult = await service.GetCharacteristicsForUuidAsync(charUuid, BluetoothCacheMode.Uncached);
                if (charsResult.Status != GattCommunicationStatus.Success || charsResult.Characteristics.Count == 0)
                {
                    Log($"WriteCharacteristic: characteristic {charUuid} not found");
                    return;
                }

                var characteristic = charsResult.Characteristics[0];
                var writer = new DataWriter();
                writer.WriteBytes(bytes);

                var writeStatus = await characteristic.WriteValueAsync(writer.DetachBuffer());
                if (writeStatus == GattCommunicationStatus.Success)
                {
                    Log($"WriteCharacteristic: wrote {bytes.Length} bytes to {GetCharacteristicName(charUuid)}");
                }
                else
                {
                    Log($"WriteCharacteristic: failed to write to {charUuid}: {writeStatus}");
                }
            }
            catch (Exception ex)
            {
                Log($"WriteCharacteristic exception: {ex.Message}");
            }
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
