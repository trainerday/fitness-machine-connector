using System;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading;
using System.Threading.Tasks;
using FTMSBluetoothForwarder;

/// <summary>
/// FitBridge BLE Bridge for Windows.
/// Scans for BLE fitness devices, connects and reads data, then broadcasts via FTMS.
///
/// Communication protocol (JSON over stdin/stdout):
/// Commands (Electron → .NET):
///   {"type": "scan", "duration": 10}
///   {"type": "stopScan"}
///   {"type": "connect", "deviceId": "XXXXXXXXXXXX", "deviceName": "Device"}
///   {"type": "disconnect"}
///   {"type": "getStatus"}
///   {"type": "setAutoReconnect", "enabled": true, "deviceId": "...", "deviceName": "..."}
///
/// Events (.NET → Electron):
///   {"type": "ready", "version": "1.0.0", "platform": "windows"}
///   {"type": "deviceFound", "device": {...}}
///   {"type": "scanComplete", "devicesFound": 5}
///   {"type": "connected", "device": {...}}
///   {"type": "disconnected", "reason": "..."}
///   {"type": "data", "power": 150, "cadence": 85, "source": "ftms"}
///   {"type": "ftmsStatus", "state": "advertising", "clientAddress": "..."}
///   {"type": "status", ...}
///   {"type": "error", "message": "..."}
///   {"type": "log", "level": "info", "message": "..."}
/// </summary>

var cts = new CancellationTokenSource();
var server = new FtmsGattServer();
var scanner = new BleScanner();
var connection = new BleDeviceConnection();

// Auto-reconnect settings
bool autoReconnectEnabled = false;
string? autoReconnectDeviceId = null;
string? autoReconnectDeviceName = null;

// Track if FTMS broadcasting has started (lazy start on first data/connection)
bool ftmsStarted = false;

// JSON serialization options
var jsonOptions = new JsonSerializerOptions
{
    PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    PropertyNameCaseInsensitive = true,
    DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
};

// Send JSON event to stdout
void SendEvent(object eventObj)
{
    var json = JsonSerializer.Serialize(eventObj, jsonOptions);
    Console.WriteLine(json);
}

void Log(string message, string level = "info")
{
    SendEvent(new { type = "log", level, message });
}

// Hook up FTMS server events
server.OnLog += message =>
{
    // Send in both old format (for backward compat) and new format
    Console.WriteLine(JsonSerializer.Serialize(new { log = message }, jsonOptions));
};
server.OnStatus += (status, extra) =>
{
    // Send in old format for backward compatibility
    object outputObj;
    if (extra != null)
    {
        var extraJson = JsonSerializer.Serialize(extra, jsonOptions);
        var extraDict = JsonSerializer.Deserialize<Dictionary<string, object>>(extraJson);
        extraDict!["status"] = status;
        outputObj = extraDict;
    }
    else
    {
        outputObj = new { status };
    }
    Console.WriteLine(JsonSerializer.Serialize(outputObj, jsonOptions));
};

// Hook up scanner events
scanner.OnLog += message => Log(message);
scanner.OnDeviceFound += device =>
{
    SendEvent(new
    {
        type = "deviceFound",
        device = new
        {
            id = device.Id,
            name = device.Name,
            rssi = device.Rssi,
            services = device.Services,
            isFitnessDevice = device.IsFitnessDevice
        }
    });
};
scanner.OnScanComplete += count =>
{
    SendEvent(new { type = "scanComplete", devicesFound = count });
};

// Hook up connection events
connection.OnLog += message => Log(message);
connection.OnDataReceived += (data, source) =>
{
    // Start FTMS server on first data if not already started
    if (!ftmsStarted)
    {
        _ = Task.Run(async () =>
        {
            Log("Starting FTMS broadcast (data from .NET connection)...");
            ftmsStarted = await server.StartAsync();
        });
    }

    // Send data event to Electron
    SendEvent(new
    {
        type = "data",
        power = data.Power > 0 ? data.Power : (int?)null,
        cadence = data.Cadence > 0 ? data.Cadence : (double?)null,
        heartRate = data.HeartRate > 0 ? data.HeartRate : (int?)null,
        speed = data.Speed > 0 ? data.Speed : (double?)null,
        resistance = data.Resistance > 0 ? data.Resistance : (int?)null,
        source
    });

    // Also update FTMS server with the data
    server.UpdateData(data);
};
connection.OnDisconnected += reason =>
{
    SendEvent(new { type = "disconnected", reason });

    // Attempt auto-reconnect if enabled
    if (autoReconnectEnabled && !string.IsNullOrEmpty(autoReconnectDeviceId))
    {
        Log($"Auto-reconnect enabled, will attempt to reconnect to {autoReconnectDeviceName}...");
        _ = Task.Run(async () =>
        {
            await Task.Delay(2000); // Wait 2 seconds before reconnecting
            if (autoReconnectEnabled && !connection.IsConnected)
            {
                var success = await connection.ConnectAsync(autoReconnectDeviceId, autoReconnectDeviceName);
                if (success)
                {
                    SendEvent(new
                    {
                        type = "connected",
                        device = new
                        {
                            id = connection.ConnectedDeviceId,
                            name = connection.ConnectedDeviceName
                        }
                    });
                }
            }
        });
    }
};

// Handle commands from stdin
async Task HandleCommand(string line)
{
    try
    {
        using var doc = JsonDocument.Parse(line);
        var root = doc.RootElement;

        // Check if this is the new protocol (has "type" field) or legacy data format
        if (!root.TryGetProperty("type", out var typeElement))
        {
            // Legacy format: direct fitness data like {"power": 150, "cadence": 85, "heartRate": 120}
            var legacyData = new FitnessData();
            bool hasData = false;

            if (root.TryGetProperty("power", out var powerEl))
            {
                legacyData.Power = powerEl.GetInt32();
                hasData = true;
            }
            if (root.TryGetProperty("cadence", out var cadenceEl))
            {
                legacyData.Cadence = cadenceEl.GetDouble();
                hasData = true;
            }
            if (root.TryGetProperty("heartRate", out var hrEl))
            {
                legacyData.HeartRate = hrEl.GetInt32();
                hasData = true;
            }
            if (root.TryGetProperty("command", out var cmdEl) && cmdEl.GetString() == "stop")
            {
                cts.Cancel();
                return;
            }

            if (hasData)
            {
                // Start FTMS server on first data received (lazy start)
                if (!ftmsStarted)
                {
                    Log("Starting FTMS broadcast (data received)...");
                    ftmsStarted = await server.StartAsync();
                    if (!ftmsStarted)
                    {
                        Log("Failed to start FTMS server", "error");
                    }
                }
                server.UpdateData(legacyData);
            }
            return;
        }

        var type = typeElement.GetString();

        switch (type)
        {
            case "startBroadcast":
                // Explicitly start FTMS broadcasting
                if (!ftmsStarted)
                {
                    Log("Starting FTMS broadcast (explicit command)...");
                    ftmsStarted = await server.StartAsync();
                    if (ftmsStarted)
                    {
                        Log("FTMS broadcast started successfully");
                    }
                    else
                    {
                        Log("Failed to start FTMS server", "error");
                    }
                }
                else
                {
                    Log("FTMS broadcast already running");
                }
                break;

            case "stopBroadcast":
                // Stop FTMS broadcasting
                if (ftmsStarted)
                {
                    Log("Stopping FTMS broadcast...");
                    server.Stop();
                    ftmsStarted = false;
                }
                break;

            case "scan":
                int duration = 10;
                if (root.TryGetProperty("duration", out var durationEl))
                    duration = durationEl.GetInt32();
                scanner.StartScan(duration);
                break;

            case "stopScan":
                scanner.StopScan();
                break;

            case "connect":
                if (root.TryGetProperty("deviceId", out var deviceIdEl))
                {
                    var deviceId = deviceIdEl.GetString();
                    string? deviceName = null;
                    if (root.TryGetProperty("deviceName", out var deviceNameEl))
                        deviceName = deviceNameEl.GetString();

                    if (!string.IsNullOrEmpty(deviceId))
                    {
                        Log($"Connecting to {deviceName ?? deviceId}...");
                        var success = await connection.ConnectAsync(deviceId, deviceName);
                        if (success)
                        {
                            SendEvent(new
                            {
                                type = "connected",
                                device = new
                                {
                                    id = connection.ConnectedDeviceId,
                                    name = connection.ConnectedDeviceName
                                }
                            });

                            // Start FTMS broadcasting if not already running
                            if (!ftmsStarted)
                            {
                                Log("Starting FTMS broadcast (device connected)...");
                                ftmsStarted = await server.StartAsync();
                            }
                        }
                        else
                        {
                            SendEvent(new { type = "error", message = "Failed to connect to device" });
                        }
                    }
                }
                break;

            case "disconnect":
                connection.Disconnect();
                SendEvent(new { type = "disconnected", reason = "User requested disconnect" });
                break;

            case "getStatus":
                SendEvent(new
                {
                    type = "status",
                    scanning = scanner.IsScanning,
                    connected = connection.IsConnected,
                    connectedDevice = connection.IsConnected ? new
                    {
                        id = connection.ConnectedDeviceId,
                        name = connection.ConnectedDeviceName
                    } : null,
                    broadcasting = server.IsRunning,
                    autoReconnect = autoReconnectEnabled,
                    autoReconnectDevice = autoReconnectDeviceName
                });
                break;

            case "setAutoReconnect":
                if (root.TryGetProperty("enabled", out var enabledEl))
                {
                    autoReconnectEnabled = enabledEl.GetBoolean();
                    if (autoReconnectEnabled)
                    {
                        if (root.TryGetProperty("deviceId", out var arDeviceIdEl))
                            autoReconnectDeviceId = arDeviceIdEl.GetString();
                        if (root.TryGetProperty("deviceName", out var arDeviceNameEl))
                            autoReconnectDeviceName = arDeviceNameEl.GetString();
                        Log($"Auto-reconnect enabled for {autoReconnectDeviceName}");
                    }
                    else
                    {
                        Log("Auto-reconnect disabled");
                    }
                }
                break;

            case "stop":
                cts.Cancel();
                break;

            default:
                Log($"Unknown command type: {type}", "warn");
                break;
        }
    }
    catch (JsonException ex)
    {
        Log($"Invalid JSON: {ex.Message}", "error");
    }
    catch (Exception ex)
    {
        Log($"Command error: {ex.Message}", "error");
    }
}

// Handle Ctrl+C
Console.CancelKeyPress += (s, e) =>
{
    e.Cancel = true;
    cts.Cancel();
};

// Send ready event
SendEvent(new
{
    type = "ready",
    version = "1.0.0",
    platform = "windows"
});

// Start FTMS notification loop (4Hz as per FTMS spec)
var notifyTask = Task.Run(async () =>
{
    while (!cts.Token.IsCancellationRequested)
    {
        try
        {
            if (server.IsRunning)
            {
                await server.NotifyAsync();
            }
            await Task.Delay(250, cts.Token); // 4Hz
        }
        catch (OperationCanceledException)
        {
            break;
        }
        catch (Exception ex)
        {
            Log($"Notify loop error: {ex.Message}", "error");
        }
    }
});

// Read stdin for commands
var stdinTask = Task.Run(async () =>
{
    try
    {
        string? line;
        while ((line = Console.ReadLine()) != null && !cts.Token.IsCancellationRequested)
        {
            if (string.IsNullOrWhiteSpace(line)) continue;
            await HandleCommand(line);
        }
    }
    catch (Exception ex)
    {
        Log($"Stdin reader error: {ex.Message}", "error");
    }
});

// Wait for either stdin to close or cancellation
try
{
    await Task.WhenAny(stdinTask, Task.Delay(Timeout.Infinite, cts.Token));
}
catch (OperationCanceledException)
{
    // Normal shutdown
}

// Cleanup
cts.Cancel();
connection.Disconnect();
server.Stop();

try
{
    await Task.WhenAll(notifyTask, stdinTask);
}
catch
{
    // Ignore cancellation exceptions
}

SendEvent(new { type = "log", level = "info", message = "Shutting down..." });
return 0;
