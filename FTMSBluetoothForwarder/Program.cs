using System;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading;
using System.Threading.Tasks;
using FTMSBluetoothForwarder;

/// <summary>
/// FTMS Bike BLE Broadcaster for Windows.
/// Receives fitness data via stdin (JSON) and broadcasts as FTMS Indoor Bike.
///
/// Communication protocol (same as Python version):
/// - Receives: JSON lines on stdin: {"power": 150, "cadence": 85, "heartRate": 120}
/// - Sends: JSON lines on stdout: {"status": "advertising"}, {"log": "message"}
/// </summary>

var cts = new CancellationTokenSource();
var server = new FtmsGattServer();

// JSON serialization options
var jsonOptions = new JsonSerializerOptions
{
    PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
};

// Hook up logging to stdout as JSON
server.OnLog += message =>
{
    var output = JsonSerializer.Serialize(new { log = message }, jsonOptions);
    Console.WriteLine(output);
};

server.OnStatus += (status, extra) =>
{
    object outputObj;
    if (extra != null)
    {
        // Merge status with extra properties
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

// Handle Ctrl+C
Console.CancelKeyPress += (s, e) =>
{
    e.Cancel = true;
    cts.Cancel();
};

// Start the server
bool started = await server.StartAsync();
if (!started)
{
    Console.WriteLine(JsonSerializer.Serialize(new { status = "error", message = "Failed to start GATT server" }, jsonOptions));
    return 1;
}

// Start notification loop (4Hz as per FTMS spec)
var notifyTask = Task.Run(async () =>
{
    while (!cts.Token.IsCancellationRequested)
    {
        try
        {
            await server.NotifyAsync();
            await Task.Delay(250, cts.Token); // 4Hz
        }
        catch (OperationCanceledException)
        {
            break;
        }
        catch (Exception ex)
        {
            Console.WriteLine(JsonSerializer.Serialize(new { log = $"Notify loop error: {ex.Message}" }, jsonOptions));
        }
    }
});

// Read stdin for data updates
var stdinTask = Task.Run(() =>
{
    try
    {
        string? line;
        while ((line = Console.ReadLine()) != null && !cts.Token.IsCancellationRequested)
        {
            if (string.IsNullOrWhiteSpace(line)) continue;

            try
            {
                var input = JsonSerializer.Deserialize<InputData>(line, jsonOptions);
                if (input == null) continue;

                // Check for stop command
                if (input.Command == "stop")
                {
                    cts.Cancel();
                    break;
                }

                // Update fitness data
                server.UpdateData(new FitnessData
                {
                    Power = input.Power ?? 0,
                    Cadence = input.Cadence ?? 0,
                    HeartRate = input.HeartRate ?? 0,
                    Distance = input.Distance ?? 0,
                    Calories = input.Calories ?? 0,
                    ElapsedTime = input.ElapsedTime ?? 0
                });
            }
            catch (JsonException ex)
            {
                Console.WriteLine(JsonSerializer.Serialize(new { log = $"Invalid JSON: {ex.Message}" }, jsonOptions));
            }
        }
    }
    catch (Exception ex)
    {
        Console.WriteLine(JsonSerializer.Serialize(new { log = $"Stdin reader error: {ex.Message}" }, jsonOptions));
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
server.Stop();

try
{
    await Task.WhenAll(notifyTask, stdinTask);
}
catch
{
    // Ignore cancellation exceptions
}

Console.WriteLine(JsonSerializer.Serialize(new { status = "stopped" }, jsonOptions));
return 0;

/// <summary>
/// Input data from stdin JSON.
/// </summary>
class InputData
{
    public int? Power { get; set; }
    public double? Cadence { get; set; }
    public int? HeartRate { get; set; }
    public int? Distance { get; set; }
    public int? Calories { get; set; }
    public int? ElapsedTime { get; set; }
    public string? Command { get; set; }
}
