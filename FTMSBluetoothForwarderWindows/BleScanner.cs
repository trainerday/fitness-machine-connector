using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Windows.Devices.Bluetooth.Advertisement;

namespace FTMSBluetoothForwarder
{
    /// <summary>
    /// Scans for BLE devices and reports discovered fitness devices.
    /// </summary>
    public class BleScanner
    {
        private BluetoothLEAdvertisementWatcher? _watcher;
        private readonly Dictionary<string, DiscoveredDevice> _discoveredDevices = new();
        private readonly object _lock = new();

        // Known fitness service UUIDs
        private static readonly Guid FtmsServiceUuid = Guid.Parse("00001826-0000-1000-8000-00805f9b34fb");
        private static readonly Guid CyclingPowerServiceUuid = Guid.Parse("00001818-0000-1000-8000-00805f9b34fb");
        private static readonly Guid HeartRateServiceUuid = Guid.Parse("0000180d-0000-1000-8000-00805f9b34fb");
        private static readonly Guid CyclingSpeedCadenceUuid = Guid.Parse("00001816-0000-1000-8000-00805f9b34fb");

        public event Action<DiscoveredDevice>? OnDeviceFound;
        public event Action<int>? OnScanComplete;
        public event Action<string>? OnLog;

        public bool IsScanning => _watcher?.Status == BluetoothLEAdvertisementWatcherStatus.Started;

        /// <summary>
        /// Start scanning for BLE devices.
        /// </summary>
        public void StartScan(int durationSeconds = 10)
        {
            StopScan();

            lock (_lock)
            {
                _discoveredDevices.Clear();
            }

            _watcher = new BluetoothLEAdvertisementWatcher
            {
                ScanningMode = BluetoothLEScanningMode.Active
            };

            _watcher.Received += OnAdvertisementReceived;
            _watcher.Stopped += OnWatcherStopped;

            Log($"Starting BLE scan for {durationSeconds} seconds...");
            _watcher.Start();

            // Auto-stop after duration
            Task.Delay(TimeSpan.FromSeconds(durationSeconds)).ContinueWith(_ =>
            {
                StopScan();
            });
        }

        /// <summary>
        /// Stop scanning.
        /// </summary>
        public void StopScan()
        {
            if (_watcher != null)
            {
                _watcher.Received -= OnAdvertisementReceived;
                _watcher.Stopped -= OnWatcherStopped;

                if (_watcher.Status == BluetoothLEAdvertisementWatcherStatus.Started)
                {
                    _watcher.Stop();
                }

                _watcher = null;
            }
        }

        private void OnAdvertisementReceived(BluetoothLEAdvertisementWatcher sender,
            BluetoothLEAdvertisementReceivedEventArgs args)
        {
            try
            {
                var address = args.BluetoothAddress.ToString("X12");
                var name = args.Advertisement.LocalName;

                // Skip devices without names (unless they advertise fitness services)
                var services = args.Advertisement.ServiceUuids;
                bool isFitnessDevice = IsFitnessDevice(services, name);

                if (string.IsNullOrEmpty(name) && !isFitnessDevice)
                {
                    return;
                }

                lock (_lock)
                {
                    if (_discoveredDevices.ContainsKey(address))
                    {
                        // Update RSSI
                        _discoveredDevices[address].Rssi = args.RawSignalStrengthInDBm;
                        return;
                    }

                    var device = new DiscoveredDevice
                    {
                        Id = address,
                        Name = string.IsNullOrEmpty(name) ? $"Unknown ({address})" : name,
                        Rssi = args.RawSignalStrengthInDBm,
                        Services = new List<string>(),
                        IsFitnessDevice = isFitnessDevice
                    };

                    foreach (var service in services)
                    {
                        device.Services.Add(service.ToString());
                    }

                    _discoveredDevices[address] = device;

                    Log($"Found device: {device.Name} (RSSI: {device.Rssi}, Fitness: {device.IsFitnessDevice})");
                    OnDeviceFound?.Invoke(device);
                }
            }
            catch (Exception ex)
            {
                Log($"Error processing advertisement: {ex.Message}");
            }
        }

        private bool IsFitnessDevice(IList<Guid> services, string? name)
        {
            // Check for known fitness service UUIDs
            foreach (var service in services)
            {
                if (service == FtmsServiceUuid ||
                    service == CyclingPowerServiceUuid ||
                    service == HeartRateServiceUuid ||
                    service == CyclingSpeedCadenceUuid)
                {
                    return true;
                }
            }

            // Check for known fitness device name patterns
            if (!string.IsNullOrEmpty(name))
            {
                var lowerName = name.ToLower();
                if (lowerName.Contains("keiser") ||
                    lowerName.Contains("wahoo") ||
                    lowerName.Contains("tacx") ||
                    lowerName.Contains("elite") ||
                    lowerName.Contains("echelon") ||
                    lowerName.Contains("peloton") ||
                    lowerName.Contains("stages") ||
                    lowerName.Contains("assioma") ||
                    lowerName.Contains("kickr") ||
                    lowerName.Contains("zwift") ||
                    lowerName.Contains("ftms") ||
                    lowerName.Contains("bike") ||
                    lowerName.Contains("trainer") ||
                    lowerName.Contains("power") ||
                    lowerName.Contains("hr") ||
                    lowerName.Contains("heart"))
                {
                    return true;
                }
            }

            return false;
        }

        private void OnWatcherStopped(BluetoothLEAdvertisementWatcher sender,
            BluetoothLEAdvertisementWatcherStoppedEventArgs args)
        {
            int count;
            lock (_lock)
            {
                count = _discoveredDevices.Count;
            }

            Log($"Scan complete. Found {count} devices.");
            OnScanComplete?.Invoke(count);
        }

        private void Log(string message)
        {
            OnLog?.Invoke(message);
        }
    }

    /// <summary>
    /// Represents a discovered BLE device.
    /// </summary>
    public class DiscoveredDevice
    {
        public string Id { get; set; } = "";
        public string Name { get; set; } = "";
        public short Rssi { get; set; }
        public List<string> Services { get; set; } = new();
        public bool IsFitnessDevice { get; set; }
    }
}
