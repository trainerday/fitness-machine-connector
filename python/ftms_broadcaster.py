#!/usr/bin/env python3
"""
FTMS Bike BLE Broadcaster using bless library.
Receives fitness data via stdin (JSON) and broadcasts as FTMS Indoor Bike.

Communication protocol:
- Receives: JSON lines on stdin: {"power": 150, "cadence": 85, "heartRate": 120}
- Sends: JSON lines on stdout: {"status": "advertising"}, {"status": "connected", "client": "XX:XX:XX"}
"""

import sys
import json
import asyncio
import signal
import struct
import threading
from typing import Optional, Dict, Any

from bless import (
    BlessServer,
    BlessGATTCharacteristic,
    GATTCharacteristicProperties,
    GATTAttributePermissions,
)

# FTMS UUIDs (standard Bluetooth SIG assigned)
FTMS_SERVICE_UUID = "00001826-0000-1000-8000-00805f9b34fb"
INDOOR_BIKE_DATA_UUID = "00002ad2-0000-1000-8000-00805f9b34fb"
FITNESS_MACHINE_FEATURE_UUID = "00002acc-0000-1000-8000-00805f9b34fb"
FTMS_CONTROL_POINT_UUID = "00002ad9-0000-1000-8000-00805f9b34fb"
FTMS_STATUS_UUID = "00002ada-0000-1000-8000-00805f9b34fb"
SUPPORTED_RESISTANCE_RANGE_UUID = "00002ad6-0000-1000-8000-00805f9b34fb"
SUPPORTED_POWER_RANGE_UUID = "00002ad8-0000-1000-8000-00805f9b34fb"

# FTMS Control Point Op Codes
FTMS_OP_REQUEST_CONTROL = 0x00
FTMS_OP_RESET = 0x01
FTMS_OP_SET_TARGET_SPEED = 0x02
FTMS_OP_SET_TARGET_INCLINE = 0x03
FTMS_OP_SET_TARGET_RESISTANCE = 0x04
FTMS_OP_SET_TARGET_POWER = 0x05
FTMS_OP_SET_TARGET_HR = 0x06
FTMS_OP_START_RESUME = 0x07
FTMS_OP_STOP_PAUSE = 0x08
FTMS_OP_SET_SIMULATION = 0x11
FTMS_OP_RESPONSE = 0x80

# FTMS Result Codes
FTMS_RESULT_SUCCESS = 0x01
FTMS_RESULT_NOT_SUPPORTED = 0x02
FTMS_RESULT_INVALID_PARAM = 0x03
FTMS_RESULT_FAILED = 0x04
FTMS_RESULT_CONTROL_NOT_PERMITTED = 0x05

# Device name - keep short (<=10 chars) to ensure service UUIDs fit in advertisement
DEVICE_NAME = "TD Bike"


class FtmsBroadcaster:
    """FTMS Bike broadcaster using bless."""

    def __init__(self):
        self.server: Optional[BlessServer] = None
        self.loop: Optional[asyncio.AbstractEventLoop] = None
        self.running = False
        self.control_granted = False  # Track if client has control
        self.has_subscribers = False  # Track if any client is subscribed
        self.current_data: Dict[str, Any] = {
            "power": 0,
            "cadence": 0,
            "heartRate": 0,
            "distance": 0,
            "calories": 0,
            "elapsedTime": 0,
        }
        self.notify_task: Optional[asyncio.Task] = None

    def on_subscribe(self, characteristic, client_address):
        """Called when a client subscribes to notifications."""
        self.log(f"Client {client_address} subscribed to {characteristic}")
        self.has_subscribers = True
        self.send_status("connected", client=str(client_address))

    def on_unsubscribe(self, characteristic, client_address):
        """Called when a client unsubscribes from notifications."""
        self.log(f"Client {client_address} unsubscribed from {characteristic}")
        # Don't set has_subscribers to False as other clients may still be subscribed

    def log(self, message: str) -> None:
        """Send log message to stdout as JSON."""
        output = json.dumps({"log": message})
        print(output, flush=True)

    def send_status(self, status: str, **kwargs) -> None:
        """Send status update to stdout as JSON."""
        output = {"status": status, **kwargs}
        print(json.dumps(output), flush=True)

    def build_indoor_bike_data(self) -> bytes:
        """
        Build FTMS Indoor Bike Data characteristic value.

        Flags (16-bit):
        - Bit 0: More Data (0 = all data present in this message)
        - Bit 1: Average Speed Present (0 = not present)
        - Bit 2: Instantaneous Cadence Present (1 = present)
        - Bit 3: Average Cadence Present (0 = not present)
        - Bit 4: Total Distance Present (1 = present)
        - Bit 5: Resistance Level Present (0 = not present)
        - Bit 6: Instantaneous Power Present (1 = present)
        - Bit 7: Average Power Present (0 = not present)
        - Bit 8: Expended Energy Present (1 = present)
        - Bit 9: Heart Rate Present (1 = present)
        - Bit 10: Metabolic Equivalent Present (0 = not present)
        - Bit 11: Elapsed Time Present (1 = present)
        - Bit 12: Remaining Time Present (0 = not present)
        """
        # Flags: cadence + distance + power + energy + heart rate + elapsed time
        # Bits: 2, 4, 6, 8, 9, 11 = 0b0000101101010100 = 0x0B54
        flags = 0x0000

        data = bytearray()

        # Always include instantaneous speed (when bit 0 of flags is 0)
        # Speed in 0.01 km/h resolution - we'll set to 0 since apps calculate their own
        speed = 0
        data.extend(struct.pack('<H', speed))

        # Bit 2: Instantaneous Cadence (0.5 rpm resolution)
        flags |= (1 << 2)
        cadence = int(self.current_data.get("cadence", 0) * 2)  # 0.5 rpm resolution
        data.extend(struct.pack('<H', cadence))

        # Bit 4: Total Distance (meters, 24-bit)
        flags |= (1 << 4)
        distance = int(self.current_data.get("distance", 0))
        data.extend(struct.pack('<I', distance)[:3])  # 24-bit, take first 3 bytes

        # Bit 6: Instantaneous Power (watts, signed 16-bit)
        flags |= (1 << 6)
        power = int(self.current_data.get("power", 0))
        data.extend(struct.pack('<h', power))

        # Bit 8: Expended Energy (total kcal uint16, per hour uint16, per minute uint8)
        flags |= (1 << 8)
        calories = int(self.current_data.get("calories", 0))
        data.extend(struct.pack('<H', calories))  # Total energy
        data.extend(struct.pack('<H', 0))  # Energy per hour (not used)
        data.extend(struct.pack('<B', 0))  # Energy per minute (not used)

        # Bit 9: Heart Rate (bpm, uint8)
        flags |= (1 << 9)
        heart_rate = int(self.current_data.get("heartRate", 0))
        data.extend(struct.pack('<B', heart_rate))

        # Bit 11: Elapsed Time (seconds, uint16)
        flags |= (1 << 11)
        elapsed_time = int(self.current_data.get("elapsedTime", 0))
        data.extend(struct.pack('<H', elapsed_time))

        # Prepend flags
        result = struct.pack('<H', flags) + bytes(data)
        return result

    def build_fitness_machine_feature(self) -> bytes:
        """
        Build Fitness Machine Feature characteristic value.

        Returns 8 bytes:
        - Bytes 0-3: Fitness Machine Features (uint32)
        - Bytes 4-7: Target Setting Features (uint32)
        """
        # Features we support:
        # Bit 1: Cadence Supported
        # Bit 2: Total Distance Supported
        # Bit 6: Heart Rate Measurement Supported
        # Bit 7: Expended Energy Supported
        # Bit 14: Power Measurement Supported
        features = (1 << 1) | (1 << 2) | (1 << 6) | (1 << 7) | (1 << 14)

        # Target settings: none for now
        target_settings = 0

        return struct.pack('<II', features, target_settings)

    def read_request(
        self, characteristic: BlessGATTCharacteristic, **kwargs
    ) -> bytearray:
        """Handle read requests for characteristics."""
        uuid = str(characteristic.uuid).lower()

        if FITNESS_MACHINE_FEATURE_UUID in uuid:
            return bytearray(self.build_fitness_machine_feature())
        elif SUPPORTED_POWER_RANGE_UUID in uuid:
            # Min power: 0W, Max power: 2000W, Step: 1W
            return bytearray(struct.pack('<HHH', 0, 2000, 1))
        elif SUPPORTED_RESISTANCE_RANGE_UUID in uuid:
            # Min: 0, Max: 100, Step: 1
            return bytearray(struct.pack('<hhh', 0, 100, 1))

        return bytearray(characteristic.value or b'')

    def write_request(
        self, characteristic: BlessGATTCharacteristic, value: Any, **kwargs
    ) -> None:
        """Handle write requests (control point)."""
        uuid = str(characteristic.uuid).lower()

        if FTMS_CONTROL_POINT_UUID in uuid:
            self.log(f"Control point write: {value.hex() if value else 'empty'}")

            if value and len(value) > 0:
                op_code = value[0]
                self.handle_control_point(op_code, value)

    def handle_control_point(self, op_code: int, value: bytes) -> None:
        """Handle FTMS Control Point commands and send response."""
        result = FTMS_RESULT_SUCCESS

        if op_code == FTMS_OP_REQUEST_CONTROL:
            self.control_granted = True
            self.log("Control granted to client")
        elif op_code == FTMS_OP_RESET:
            self.log("Reset requested")
        elif op_code == FTMS_OP_START_RESUME:
            self.log("Start/Resume requested")
        elif op_code == FTMS_OP_STOP_PAUSE:
            param = value[1] if len(value) > 1 else 1
            self.log(f"Stop/Pause requested (param={param})")
        elif op_code == FTMS_OP_SET_TARGET_POWER:
            if len(value) >= 3:
                target_power = struct.unpack('<h', value[1:3])[0]
                self.log(f"Target power set: {target_power}W")
        elif op_code == FTMS_OP_SET_TARGET_RESISTANCE:
            if len(value) >= 2:
                target_resistance = value[1]
                self.log(f"Target resistance set: {target_resistance}")
        elif op_code == FTMS_OP_SET_SIMULATION:
            self.log("Simulation parameters received")
        else:
            self.log(f"Unknown op code: {op_code}")
            result = FTMS_RESULT_NOT_SUPPORTED

        # Send response indication
        self.send_control_point_response(op_code, result)

    def send_control_point_response(self, request_op_code: int, result: int) -> None:
        """Send Control Point response indication."""
        if self.server:
            # Response format: [0x80, request_op_code, result_code]
            response = struct.pack('<BBB', FTMS_OP_RESPONSE, request_op_code, result)

            char = self.server.get_characteristic(FTMS_CONTROL_POINT_UUID)
            if char:
                char.value = bytearray(response)
                self.server.update_value(FTMS_SERVICE_UUID, FTMS_CONTROL_POINT_UUID)
                self.log(f"Sent control response: op={request_op_code}, result={result}")

    async def notify_loop(self) -> None:
        """Continuously notify subscribers with current data."""
        while self.running:
            try:
                if self.server:
                    # Update the characteristic value
                    bike_data = self.build_indoor_bike_data()

                    # Get characteristic and update
                    char = self.server.get_characteristic(INDOOR_BIKE_DATA_UUID)
                    if char:
                        char.value = bytearray(bike_data)
                        self.server.update_value(FTMS_SERVICE_UUID, INDOOR_BIKE_DATA_UUID)

                # Notify at ~4Hz (every 250ms) as per FTMS spec
                await asyncio.sleep(0.25)
            except Exception as e:
                self.log(f"Notify error: {str(e)}")
                await asyncio.sleep(1)

    async def setup_server(self) -> None:
        """Set up the BLE GATT server with FTMS service."""
        self.loop = asyncio.get_event_loop()

        self.server = BlessServer(name=DEVICE_NAME, loop=self.loop)
        self.server.read_request_func = self.read_request
        self.server.write_request_func = self.write_request

        # Set up subscription callbacks if available
        if hasattr(self.server, 'subscribe_callback'):
            self.server.subscribe_callback = self.on_subscribe
        if hasattr(self.server, 'unsubscribe_callback'):
            self.server.unsubscribe_callback = self.on_unsubscribe

        # Add FTMS service
        await self.server.add_new_service(FTMS_SERVICE_UUID)

        # Fitness Machine Feature (read)
        await self.server.add_new_characteristic(
            FTMS_SERVICE_UUID,
            FITNESS_MACHINE_FEATURE_UUID,
            GATTCharacteristicProperties.read,
            bytearray(self.build_fitness_machine_feature()),
            GATTAttributePermissions.readable,
        )

        # Indoor Bike Data (notify)
        await self.server.add_new_characteristic(
            FTMS_SERVICE_UUID,
            INDOOR_BIKE_DATA_UUID,
            GATTCharacteristicProperties.notify,
            None,
            GATTAttributePermissions.readable,
        )

        # Supported Power Range (read)
        await self.server.add_new_characteristic(
            FTMS_SERVICE_UUID,
            SUPPORTED_POWER_RANGE_UUID,
            GATTCharacteristicProperties.read,
            bytearray(struct.pack('<HHH', 0, 2000, 1)),
            GATTAttributePermissions.readable,
        )

        # FTMS Control Point (write + indicate)
        await self.server.add_new_characteristic(
            FTMS_SERVICE_UUID,
            FTMS_CONTROL_POINT_UUID,
            GATTCharacteristicProperties.write | GATTCharacteristicProperties.indicate,
            None,
            GATTAttributePermissions.readable | GATTAttributePermissions.writeable,
        )

        # Fitness Machine Status (notify) - required for apps to know device state
        await self.server.add_new_characteristic(
            FTMS_SERVICE_UUID,
            FTMS_STATUS_UUID,
            GATTCharacteristicProperties.notify,
            None,
            GATTAttributePermissions.readable,
        )

        self.log("GATT server configured")

    async def start(self) -> None:
        """Start advertising and notification loop."""
        await self.setup_server()

        # Log the services and characteristics we're offering
        self.log(f"Service: {FTMS_SERVICE_UUID}")
        self.log(f"Characteristics: Feature={FITNESS_MACHINE_FEATURE_UUID}, BikeData={INDOOR_BIKE_DATA_UUID}, ControlPoint={FTMS_CONTROL_POINT_UUID}, Status={FTMS_STATUS_UUID}")

        # Start with explicit service UUID advertisement
        # prioritize_local_name=False ensures service UUIDs are included even if name is long
        await self.server.start(
            advertisement_data={
                "service_uuids": [FTMS_SERVICE_UUID],
            }
        )
        self.running = True
        self.send_status("advertising", device_name=DEVICE_NAME)
        self.log("Server started, waiting for connections...")

        # Start notification loop
        self.notify_task = asyncio.create_task(self.notify_loop())

    async def stop(self) -> None:
        """Stop the server."""
        self.running = False

        if self.notify_task:
            self.notify_task.cancel()
            try:
                await self.notify_task
            except asyncio.CancelledError:
                pass

        if self.server:
            await self.server.stop()

        self.send_status("stopped")

    def update_data(self, data: Dict[str, Any]) -> None:
        """Update current fitness data from incoming JSON."""
        for key in ["power", "cadence", "heartRate", "distance", "calories", "elapsedTime"]:
            if key in data:
                self.current_data[key] = data[key]


def stdin_reader(broadcaster: FtmsBroadcaster, loop: asyncio.AbstractEventLoop) -> None:
    """Read JSON data from stdin in a separate thread."""
    try:
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue

            try:
                data = json.loads(line)

                if data.get("command") == "stop":
                    asyncio.run_coroutine_threadsafe(broadcaster.stop(), loop)
                    break
                else:
                    broadcaster.update_data(data)
            except json.JSONDecodeError as e:
                broadcaster.log(f"Invalid JSON: {e}")
    except Exception as e:
        broadcaster.log(f"Stdin reader error: {e}")


async def main() -> None:
    """Main entry point."""
    broadcaster = FtmsBroadcaster()

    # Handle signals for graceful shutdown
    def signal_handler():
        asyncio.create_task(broadcaster.stop())

    loop = asyncio.get_event_loop()

    # Set up signal handlers (Unix only)
    if sys.platform != "win32":
        loop.add_signal_handler(signal.SIGINT, signal_handler)
        loop.add_signal_handler(signal.SIGTERM, signal_handler)

    # Start stdin reader in background thread
    stdin_thread = threading.Thread(
        target=stdin_reader,
        args=(broadcaster, loop),
        daemon=True
    )
    stdin_thread.start()

    try:
        await broadcaster.start()

        # Keep running until stopped
        while broadcaster.running:
            await asyncio.sleep(1)
    except KeyboardInterrupt:
        broadcaster.log("Interrupted")
    except Exception as e:
        broadcaster.log(f"Error: {e}")
    finally:
        await broadcaster.stop()


if __name__ == "__main__":
    asyncio.run(main())
