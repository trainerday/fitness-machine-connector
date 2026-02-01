using System;

namespace FTMSBluetoothForwarder
{
    /// <summary>
    /// Builds FTMS Indoor Bike Data characteristic byte arrays per Bluetooth FTMS specification.
    /// </summary>
    public static class FtmsDataBuilder
    {
        /// <summary>
        /// Build Indoor Bike Data characteristic value.
        ///
        /// Flags (16-bit):
        /// - Bit 0: More Data (0 = all data present in this message)
        /// - Bit 1: Average Speed Present (0 = not present)
        /// - Bit 2: Instantaneous Cadence Present (1 = present)
        /// - Bit 3: Average Cadence Present (0 = not present)
        /// - Bit 4: Total Distance Present (1 = present)
        /// - Bit 5: Resistance Level Present (0 = not present)
        /// - Bit 6: Instantaneous Power Present (1 = present)
        /// - Bit 7: Average Power Present (0 = not present)
        /// - Bit 8: Expended Energy Present (1 = present)
        /// - Bit 9: Heart Rate Present (1 = present)
        /// - Bit 10: Metabolic Equivalent Present (0 = not present)
        /// - Bit 11: Elapsed Time Present (1 = present)
        /// - Bit 12: Remaining Time Present (0 = not present)
        /// </summary>
        // Debug flag - set to true to log packet bytes
        public static bool DebugLogging = false;
        public static Action<string>? OnDebugLog;

        public static byte[] BuildIndoorBikeData(FitnessData data)
        {
            ushort flags = 0;
            using var ms = new MemoryStream();
            using var writer = new BinaryWriter(ms);

            // Reserve space for flags (will write at end)
            writer.Write((ushort)0);

            // Always include instantaneous speed (when bit 0 of flags is 0)
            // Speed in 0.01 km/h resolution - set to 0 since apps calculate their own
            writer.Write((ushort)0);

            // Bit 2: Instantaneous Cadence (0.5 rpm resolution)
            flags |= (1 << 2);
            ushort cadence = (ushort)(data.Cadence * 2); // 0.5 rpm resolution
            writer.Write(cadence);

            // Bit 4: Total Distance (meters, 24-bit)
            flags |= (1 << 4);
            uint distance = (uint)data.Distance;
            writer.Write((byte)(distance & 0xFF));
            writer.Write((byte)((distance >> 8) & 0xFF));
            writer.Write((byte)((distance >> 16) & 0xFF));

            // Bit 6: Instantaneous Power (watts, signed 16-bit)
            flags |= (1 << 6);
            writer.Write((short)data.Power);

            // Bit 8: Expended Energy (total kcal uint16, per hour uint16, per minute uint8)
            flags |= (1 << 8);
            writer.Write((ushort)data.Calories); // Total energy
            writer.Write((ushort)0); // Energy per hour (not used)
            writer.Write((byte)0);   // Energy per minute (not used)

            // Bit 9: Heart Rate (bpm, uint8)
            flags |= (1 << 9);
            writer.Write((byte)data.HeartRate);

            // Bit 11: Elapsed Time (seconds, uint16)
            flags |= (1 << 11);
            writer.Write((ushort)data.ElapsedTime);

            // Go back and write flags at the beginning
            var result = ms.ToArray();
            result[0] = (byte)(flags & 0xFF);
            result[1] = (byte)((flags >> 8) & 0xFF);

            // Debug: log the packet bytes
            if (DebugLogging && OnDebugLog != null)
            {
                var hex = BitConverter.ToString(result);
                OnDebugLog($"FTMS Packet ({result.Length} bytes): {hex}");
                OnDebugLog($"  Flags: 0x{flags:X4}, HR at byte 16: {result[16]}");
            }

            return result;
        }

        /// <summary>
        /// Build Fitness Machine Feature characteristic value.
        /// Returns 8 bytes: Features (uint32) + Target Settings (uint32)
        /// </summary>
        public static byte[] BuildFitnessMachineFeature()
        {
            // Features we support (per FTMS spec section 4.3.1):
            // Bit 1: Cadence Supported
            // Bit 2: Total Distance Supported
            // Bit 9: Expended Energy Supported
            // Bit 10: Heart Rate Measurement Supported
            // Bit 12: Elapsed Time Supported
            // Bit 14: Power Measurement Supported
            uint features = (1u << 1) | (1u << 2) | (1u << 9) | (1u << 10) | (1u << 12) | (1u << 14);
            uint targetSettings = 0; // No target settings

            var result = new byte[8];
            BitConverter.GetBytes(features).CopyTo(result, 0);
            BitConverter.GetBytes(targetSettings).CopyTo(result, 4);
            return result;
        }

        /// <summary>
        /// Build Supported Power Range characteristic value.
        /// Format: Min (uint16), Max (uint16), Step (uint16)
        /// </summary>
        public static byte[] BuildSupportedPowerRange()
        {
            var result = new byte[6];
            BitConverter.GetBytes((ushort)0).CopyTo(result, 0);    // Min: 0W
            BitConverter.GetBytes((ushort)2000).CopyTo(result, 2); // Max: 2000W
            BitConverter.GetBytes((ushort)1).CopyTo(result, 4);    // Step: 1W
            return result;
        }

        /// <summary>
        /// Build Supported Resistance Range characteristic value.
        /// Format: Min (sint16), Max (sint16), Step (sint16)
        /// </summary>
        public static byte[] BuildSupportedResistanceRange()
        {
            var result = new byte[6];
            BitConverter.GetBytes((short)0).CopyTo(result, 0);    // Min: 0
            BitConverter.GetBytes((short)100).CopyTo(result, 2);  // Max: 100
            BitConverter.GetBytes((short)1).CopyTo(result, 4);    // Step: 1
            return result;
        }

        /// <summary>
        /// Build Control Point response.
        /// Format: Response OpCode (0x80), Request OpCode, Result Code
        /// </summary>
        public static byte[] BuildControlPointResponse(byte requestOpCode, byte resultCode)
        {
            return new byte[] { 0x80, requestOpCode, resultCode };
        }
    }

    /// <summary>
    /// Fitness data received from stdin.
    /// </summary>
    public class FitnessData
    {
        public int Power { get; set; }
        public double Cadence { get; set; }
        public int HeartRate { get; set; }
        public int Distance { get; set; }
        public int Calories { get; set; }
        public int ElapsedTime { get; set; }
    }
}
