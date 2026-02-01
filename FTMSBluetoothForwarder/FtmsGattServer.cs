using System;
using System.Threading.Tasks;
using Windows.Devices.Bluetooth;
using Windows.Devices.Bluetooth.Advertisement;
using Windows.Devices.Bluetooth.GenericAttributeProfile;
using Windows.Storage.Streams;

namespace FTMSBluetoothForwarder
{
    /// <summary>
    /// FTMS (Fitness Machine Service) GATT Server for broadcasting indoor bike data.
    /// Implements the Bluetooth FTMS specification for indoor bikes.
    /// </summary>
    public class FtmsGattServer
    {
        // Standard Bluetooth SIG assigned UUIDs for FTMS
        public static readonly Guid FtmsServiceUuid = Guid.Parse("00001826-0000-1000-8000-00805f9b34fb");
        public static readonly Guid IndoorBikeDataUuid = Guid.Parse("00002ad2-0000-1000-8000-00805f9b34fb");
        public static readonly Guid FitnessMachineFeatureUuid = Guid.Parse("00002acc-0000-1000-8000-00805f9b34fb");
        public static readonly Guid ControlPointUuid = Guid.Parse("00002ad9-0000-1000-8000-00805f9b34fb");
        public static readonly Guid FtmsStatusUuid = Guid.Parse("00002ada-0000-1000-8000-00805f9b34fb");
        public static readonly Guid SupportedPowerRangeUuid = Guid.Parse("00002ad8-0000-1000-8000-00805f9b34fb");
        public static readonly Guid SupportedResistanceRangeUuid = Guid.Parse("00002ad6-0000-1000-8000-00805f9b34fb");

        // Heart Rate Service UUIDs (separate service - many apps require this for HR)
        public static readonly Guid HeartRateServiceUuid = Guid.Parse("0000180d-0000-1000-8000-00805f9b34fb");
        public static readonly Guid HeartRateMeasurementUuid = Guid.Parse("00002a37-0000-1000-8000-00805f9b34fb");

        // FTMS Control Point Op Codes
        private const byte OpRequestControl = 0x00;
        private const byte OpReset = 0x01;
        private const byte OpSetTargetPower = 0x05;
        private const byte OpSetTargetResistance = 0x04;
        private const byte OpStartResume = 0x07;
        private const byte OpStopPause = 0x08;
        private const byte OpResponse = 0x80;

        // FTMS Result Codes
        private const byte ResultSuccess = 0x01;
        private const byte ResultNotSupported = 0x02;

        private GattServiceProvider? _serviceProvider;
        private GattServiceProvider? _heartRateServiceProvider;
        private BluetoothLEAdvertisementPublisher? _advertiser;
        private GattLocalCharacteristic? _indoorBikeDataChar;
        private GattLocalCharacteristic? _controlPointChar;
        private GattLocalCharacteristic? _statusChar;
        private GattLocalCharacteristic? _heartRateMeasurementChar;

        private FitnessData _currentData = new();
        private bool _controlGranted;
        private readonly object _dataLock = new();

        public event Action<string>? OnLog;
        public event Action<string, object?>? OnStatus;

        public bool IsRunning => _serviceProvider?.AdvertisementStatus == GattServiceProviderAdvertisementStatus.Started;

        public string DeviceName { get; set; } = "TD Bike";

        public void UpdateData(FitnessData data)
        {
            lock (_dataLock)
            {
                _currentData = data;
            }
        }

        public async Task<bool> StartAsync()
        {
            try
            {
                // Check Bluetooth adapter
                var adapter = await BluetoothAdapter.GetDefaultAsync();
                if (adapter == null)
                {
                    Log("No Bluetooth adapter found");
                    return false;
                }

                if (!adapter.IsPeripheralRoleSupported)
                {
                    Log("Bluetooth adapter does not support peripheral role");
                    return false;
                }

                Log("Creating FTMS GATT service...");

                // Create service provider
                var serviceResult = await GattServiceProvider.CreateAsync(FtmsServiceUuid);
                if (serviceResult.Error != BluetoothError.Success)
                {
                    Log($"Failed to create service: {serviceResult.Error}");
                    return false;
                }

                _serviceProvider = serviceResult.ServiceProvider;

                // Create all FTMS characteristics
                await CreateFitnessMachineFeatureCharacteristic();
                await CreateIndoorBikeDataCharacteristic();
                await CreateSupportedPowerRangeCharacteristic();
                await CreateSupportedResistanceRangeCharacteristic();
                await CreateControlPointCharacteristic();
                await CreateStatusCharacteristic();

                // Create Heart Rate Service (separate service for maximum compatibility)
                await CreateHeartRateService();

                // Start GATT service advertising
                var advParameters = new GattServiceProviderAdvertisingParameters
                {
                    IsDiscoverable = true,
                    IsConnectable = true
                };

                _serviceProvider.AdvertisementStatusChanged += OnAdvertisementStatusChanged;
                _serviceProvider.StartAdvertising(advParameters);

                // Also start explicit BLE advertisement with service UUID
                // This ensures the service UUID appears in the advertisement packet
                // which is required for apps that filter by service UUID during scanning
                StartExplicitAdvertisement();

                Log($"Service: {FtmsServiceUuid}");
                Log($"Characteristics: Feature={FitnessMachineFeatureUuid}, BikeData={IndoorBikeDataUuid}, ControlPoint={ControlPointUuid}, Status={FtmsStatusUuid}");

                return true;
            }
            catch (Exception ex)
            {
                Log($"Error starting server: {ex.Message}");
                return false;
            }
        }

        public void Stop()
        {
            // Stop explicit advertiser
            if (_advertiser != null)
            {
                try
                {
                    _advertiser.Stop();
                    _advertiser = null;
                }
                catch (Exception ex)
                {
                    Log($"Error stopping advertiser: {ex.Message}");
                }
            }

            // Stop FTMS GATT service
            if (_serviceProvider != null)
            {
                try
                {
                    _serviceProvider.StopAdvertising();
                    _serviceProvider.AdvertisementStatusChanged -= OnAdvertisementStatusChanged;
                    _serviceProvider = null;
                }
                catch (Exception ex)
                {
                    Log($"Error stopping FTMS service: {ex.Message}");
                }
            }

            // Stop Heart Rate GATT service
            if (_heartRateServiceProvider != null)
            {
                try
                {
                    _heartRateServiceProvider.StopAdvertising();
                    _heartRateServiceProvider = null;
                }
                catch (Exception ex)
                {
                    Log($"Error stopping Heart Rate service: {ex.Message}");
                }
            }

            SendStatus("stopped");
        }

        private void StartExplicitAdvertisement()
        {
            try
            {
                _advertiser = new BluetoothLEAdvertisementPublisher();

                // Set the device name
                _advertiser.Advertisement.LocalName = DeviceName;

                // Add service UUIDs to the advertisement
                _advertiser.Advertisement.ServiceUuids.Add(FtmsServiceUuid);
                _advertiser.Advertisement.ServiceUuids.Add(HeartRateServiceUuid);

                _advertiser.StatusChanged += (sender, args) =>
                {
                    switch (args.Status)
                    {
                        case BluetoothLEAdvertisementPublisherStatus.Started:
                            Log($"Advertisement started with name '{DeviceName}', FTMS and Heart Rate services");
                            break;
                        case BluetoothLEAdvertisementPublisherStatus.Aborted:
                            Log($"Advertisement aborted: {args.Error}");
                            break;
                        case BluetoothLEAdvertisementPublisherStatus.Stopped:
                            Log("Advertisement stopped");
                            break;
                    }
                };

                _advertiser.Start();
            }
            catch (Exception ex)
            {
                Log($"Failed to start explicit advertisement: {ex.Message}");
            }
        }

        public async Task NotifyAsync()
        {
            try
            {
                FitnessData data;
                lock (_dataLock)
                {
                    data = _currentData;
                }

                // Notify FTMS Indoor Bike Data
                if (_indoorBikeDataChar != null && _indoorBikeDataChar.SubscribedClients.Count > 0)
                {
                    var bikeData = FtmsDataBuilder.BuildIndoorBikeData(data);
                    var writer = new DataWriter();
                    writer.WriteBytes(bikeData);

                    foreach (var client in _indoorBikeDataChar.SubscribedClients)
                    {
                        await _indoorBikeDataChar.NotifyValueAsync(writer.DetachBuffer(), client);
                    }
                }

                // Notify Heart Rate Measurement (separate service)
                if (_heartRateMeasurementChar != null && _heartRateMeasurementChar.SubscribedClients.Count > 0 && data.HeartRate > 0)
                {
                    // Heart Rate Measurement format:
                    // Byte 0: Flags (0x00 = HR is uint8, no other fields)
                    // Byte 1: Heart Rate value (uint8)
                    var hrData = new byte[] { 0x00, (byte)data.HeartRate };
                    var hrWriter = new DataWriter();
                    hrWriter.WriteBytes(hrData);

                    foreach (var client in _heartRateMeasurementChar.SubscribedClients)
                    {
                        await _heartRateMeasurementChar.NotifyValueAsync(hrWriter.DetachBuffer(), client);
                    }
                }
            }
            catch (Exception ex)
            {
                Log($"Notify error: {ex.Message}");
            }
        }

        private async Task CreateFitnessMachineFeatureCharacteristic()
        {
            var featureData = FtmsDataBuilder.BuildFitnessMachineFeature();
            var writer = new DataWriter();
            writer.WriteBytes(featureData);

            var parameters = new GattLocalCharacteristicParameters
            {
                CharacteristicProperties = GattCharacteristicProperties.Read,
                ReadProtectionLevel = GattProtectionLevel.Plain,
                StaticValue = writer.DetachBuffer()
            };

            var result = await _serviceProvider!.Service.CreateCharacteristicAsync(
                FitnessMachineFeatureUuid, parameters);

            if (result.Error != BluetoothError.Success)
                Log($"Failed to create Feature characteristic: {result.Error}");
        }

        private async Task CreateIndoorBikeDataCharacteristic()
        {
            var parameters = new GattLocalCharacteristicParameters
            {
                CharacteristicProperties = GattCharacteristicProperties.Notify,
                ReadProtectionLevel = GattProtectionLevel.Plain
            };

            var result = await _serviceProvider!.Service.CreateCharacteristicAsync(
                IndoorBikeDataUuid, parameters);

            if (result.Error == BluetoothError.Success)
            {
                _indoorBikeDataChar = result.Characteristic;
                _indoorBikeDataChar.SubscribedClientsChanged += OnIndoorBikeDataSubscribersChanged;
            }
            else
            {
                Log($"Failed to create IndoorBikeData characteristic: {result.Error}");
            }
        }

        private async Task CreateSupportedPowerRangeCharacteristic()
        {
            var rangeData = FtmsDataBuilder.BuildSupportedPowerRange();
            var writer = new DataWriter();
            writer.WriteBytes(rangeData);

            var parameters = new GattLocalCharacteristicParameters
            {
                CharacteristicProperties = GattCharacteristicProperties.Read,
                ReadProtectionLevel = GattProtectionLevel.Plain,
                StaticValue = writer.DetachBuffer()
            };

            var result = await _serviceProvider!.Service.CreateCharacteristicAsync(
                SupportedPowerRangeUuid, parameters);

            if (result.Error != BluetoothError.Success)
                Log($"Failed to create SupportedPowerRange characteristic: {result.Error}");
        }

        private async Task CreateSupportedResistanceRangeCharacteristic()
        {
            var rangeData = FtmsDataBuilder.BuildSupportedResistanceRange();
            var writer = new DataWriter();
            writer.WriteBytes(rangeData);

            var parameters = new GattLocalCharacteristicParameters
            {
                CharacteristicProperties = GattCharacteristicProperties.Read,
                ReadProtectionLevel = GattProtectionLevel.Plain,
                StaticValue = writer.DetachBuffer()
            };

            var result = await _serviceProvider!.Service.CreateCharacteristicAsync(
                SupportedResistanceRangeUuid, parameters);

            if (result.Error != BluetoothError.Success)
                Log($"Failed to create SupportedResistanceRange characteristic: {result.Error}");
        }

        private async Task CreateControlPointCharacteristic()
        {
            var parameters = new GattLocalCharacteristicParameters
            {
                CharacteristicProperties = GattCharacteristicProperties.Write | GattCharacteristicProperties.Indicate,
                WriteProtectionLevel = GattProtectionLevel.Plain,
                ReadProtectionLevel = GattProtectionLevel.Plain
            };

            var result = await _serviceProvider!.Service.CreateCharacteristicAsync(
                ControlPointUuid, parameters);

            if (result.Error == BluetoothError.Success)
            {
                _controlPointChar = result.Characteristic;
                _controlPointChar.WriteRequested += OnControlPointWriteRequested;
            }
            else
            {
                Log($"Failed to create ControlPoint characteristic: {result.Error}");
            }
        }

        private async Task CreateStatusCharacteristic()
        {
            var parameters = new GattLocalCharacteristicParameters
            {
                CharacteristicProperties = GattCharacteristicProperties.Notify,
                ReadProtectionLevel = GattProtectionLevel.Plain
            };

            var result = await _serviceProvider!.Service.CreateCharacteristicAsync(
                FtmsStatusUuid, parameters);

            if (result.Error == BluetoothError.Success)
            {
                _statusChar = result.Characteristic;
            }
            else
            {
                Log($"Failed to create Status characteristic: {result.Error}");
            }
        }

        private async Task CreateHeartRateService()
        {
            try
            {
                // Create a separate Heart Rate Service
                var serviceResult = await GattServiceProvider.CreateAsync(HeartRateServiceUuid);
                if (serviceResult.Error != BluetoothError.Success)
                {
                    Log($"Failed to create Heart Rate service: {serviceResult.Error}");
                    return;
                }

                _heartRateServiceProvider = serviceResult.ServiceProvider;

                // Create Heart Rate Measurement characteristic (Notify only)
                var parameters = new GattLocalCharacteristicParameters
                {
                    CharacteristicProperties = GattCharacteristicProperties.Notify,
                    ReadProtectionLevel = GattProtectionLevel.Plain
                };

                var result = await _heartRateServiceProvider.Service.CreateCharacteristicAsync(
                    HeartRateMeasurementUuid, parameters);

                if (result.Error == BluetoothError.Success)
                {
                    _heartRateMeasurementChar = result.Characteristic;
                    _heartRateMeasurementChar.SubscribedClientsChanged += OnHeartRateSubscribersChanged;
                    Log("Heart Rate Service created successfully");
                }
                else
                {
                    Log($"Failed to create Heart Rate Measurement characteristic: {result.Error}");
                    return;
                }

                // Start advertising the Heart Rate Service
                var advParameters = new GattServiceProviderAdvertisingParameters
                {
                    IsDiscoverable = true,
                    IsConnectable = true
                };
                _heartRateServiceProvider.StartAdvertising(advParameters);
            }
            catch (Exception ex)
            {
                Log($"Error creating Heart Rate service: {ex.Message}");
            }
        }

        private void OnHeartRateSubscribersChanged(GattLocalCharacteristic sender, object args)
        {
            int count = sender.SubscribedClients.Count;
            Log($"Heart Rate subscribers: {count}");
        }

        private void OnIndoorBikeDataSubscribersChanged(GattLocalCharacteristic sender, object args)
        {
            int count = sender.SubscribedClients.Count;
            Log($"Indoor Bike Data subscribers: {count}");

            if (count > 0)
            {
                SendStatus("connected", new { subscribers = count });
            }
        }

        private async void OnControlPointWriteRequested(GattLocalCharacteristic sender, GattWriteRequestedEventArgs args)
        {
            var deferral = args.GetDeferral();

            try
            {
                var request = await args.GetRequestAsync();
                if (request == null) return;

                var reader = DataReader.FromBuffer(request.Value);
                var bytes = new byte[request.Value.Length];
                reader.ReadBytes(bytes);

                Log($"Control point write: {BitConverter.ToString(bytes)}");

                if (bytes.Length > 0)
                {
                    byte opCode = bytes[0];
                    byte result = HandleControlPoint(opCode, bytes);

                    // Respond to the write request
                    if (request.Option == GattWriteOption.WriteWithResponse)
                    {
                        request.Respond();
                    }

                    // Send indication with response
                    await SendControlPointResponse(opCode, result);
                }
            }
            catch (Exception ex)
            {
                Log($"Control point error: {ex.Message}");
            }
            finally
            {
                deferral.Complete();
            }
        }

        private byte HandleControlPoint(byte opCode, byte[] value)
        {
            switch (opCode)
            {
                case OpRequestControl:
                    _controlGranted = true;
                    Log("Control granted to client");
                    return ResultSuccess;

                case OpReset:
                    Log("Reset requested");
                    return ResultSuccess;

                case OpStartResume:
                    Log("Start/Resume requested");
                    return ResultSuccess;

                case OpStopPause:
                    byte param = value.Length > 1 ? value[1] : (byte)1;
                    Log($"Stop/Pause requested (param={param})");
                    return ResultSuccess;

                case OpSetTargetPower:
                    if (value.Length >= 3)
                    {
                        short targetPower = BitConverter.ToInt16(value, 1);
                        Log($"Target power set: {targetPower}W");
                    }
                    return ResultSuccess;

                case OpSetTargetResistance:
                    if (value.Length >= 2)
                    {
                        byte targetResistance = value[1];
                        Log($"Target resistance set: {targetResistance}");
                    }
                    return ResultSuccess;

                default:
                    Log($"Unknown op code: {opCode}");
                    return ResultNotSupported;
            }
        }

        private async Task SendControlPointResponse(byte requestOpCode, byte result)
        {
            if (_controlPointChar == null) return;

            try
            {
                var response = FtmsDataBuilder.BuildControlPointResponse(requestOpCode, result);
                var writer = new DataWriter();
                writer.WriteBytes(response);
                var buffer = writer.DetachBuffer();

                foreach (var client in _controlPointChar.SubscribedClients)
                {
                    await _controlPointChar.NotifyValueAsync(buffer, client);
                }

                Log($"Sent control response: op={requestOpCode}, result={result}");
            }
            catch (Exception ex)
            {
                Log($"Failed to send control response: {ex.Message}");
            }
        }

        private void OnAdvertisementStatusChanged(GattServiceProvider sender,
            GattServiceProviderAdvertisementStatusChangedEventArgs args)
        {
            switch (args.Status)
            {
                case GattServiceProviderAdvertisementStatus.Started:
                    Log("Server started, waiting for connections...");
                    SendStatus("advertising", new { device_name = DeviceName });
                    break;
                case GattServiceProviderAdvertisementStatus.Stopped:
                    Log("Server stopped");
                    break;
                case GattServiceProviderAdvertisementStatus.Aborted:
                    Log($"Advertising aborted: {args.Error}");
                    break;
            }
        }

        private void Log(string message)
        {
            OnLog?.Invoke(message);
        }

        private void SendStatus(string status, object? extra = null)
        {
            OnStatus?.Invoke(status, extra);
        }
    }
}
