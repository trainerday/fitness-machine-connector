#!/usr/bin/env python3
"""
FTMS Bike BLE Broadcaster using raw WinRT APIs (Windows only).
Bypasses bless library which has issues on some Windows systems.

Communication protocol:
- Receives: JSON lines on stdin: {"power": 150, "cadence": 85, "heartRate": 120}
- Sends: JSON lines on stdout: {"status": "advertising"}, {"status": "connected"}
"""

import sys
import json
import asyncio
import struct
import threading
import uuid
from typing import Optional, Dict, Any

# WinRT imports
from winrt.windows.devices.bluetooth.genericattributeprofile import (
    GattServiceProvider,
    GattServiceProviderAdvertisingParameters,
    GattLocalCharacteristicParameters,
    GattCharacteristicProperties,
    GattProtectionLevel,
    GattLocalCharacteristicResult,
    GattServiceProviderResult,
)
from winrt.windows.storage.streams import DataWriter, Buffer

# FTMS UUIDs
FTMS_SERVICE_UUID = uuid.UUID("00001826-0000-1000-8000-00805f9b34fb")
INDOOR_BIKE_DATA_UUID = uuid.UUID("00002ad2-0000-1000-8000-00805f9b34fb")
FITNESS_MACHINE_FEATURE_UUID = uuid.UUID("00002acc-0000-1000-8000-00805f9b34fb")
SUPPORTED_POWER_RANGE_UUID = uuid.UUID("00002ad8-0000-1000-8000-00805f9b34fb")

DEVICE_NAME = "TD FTMS Bike"


class FtmsBroadcasterWinRT:
    """FTMS Bike broadcaster using raw WinRT APIs."""

    def __init__(self):
        self.service_provider: Optional[GattServiceProvider] = None
        self.bike_data_characteristic = None
        self.running = False
        self.subscribers = []
        self.current_data: Dict[str, Any] = {
            "power": 0,
            "cadence": 0,
            "heartRate": 0,
            "distance": 0,
            "calories": 0,
            "elapsedTime": 0,
        }

    def log(self, message: str) -> None:
        """Send log message to stdout as JSON."""
        print(json.dumps({"log": message}), flush=True)

    def send_status(self, status: str, **kwargs) -> None:
        """Send status update to stdout as JSON."""
        print(json.dumps({"status": status, **kwargs}), flush=True)

    def build_indoor_bike_data(self) -> bytes:
        """Build FTMS Indoor Bike Data characteristic value."""
        flags = 0x0000
        data = bytearray()

        # Instantaneous speed (always present when bit 0 = 0)
        speed = 0
        data.extend(struct.pack('<H', speed))

        # Bit 2: Instantaneous Cadence (0.5 rpm resolution)
        flags |= (1 << 2)
        cadence = int(self.current_data.get("cadence", 0) * 2)
        data.extend(struct.pack('<H', cadence))

        # Bit 4: Total Distance (meters, 24-bit)
        flags |= (1 << 4)
        distance = int(self.current_data.get("distance", 0))
        data.extend(struct.pack('<I', distance)[:3])

        # Bit 6: Instantaneous Power (watts)
        flags |= (1 << 6)
        power = int(self.current_data.get("power", 0))
        data.extend(struct.pack('<h', power))

        # Bit 8: Expended Energy
        flags |= (1 << 8)
        calories = int(self.current_data.get("calories", 0))
        data.extend(struct.pack('<H', calories))
        data.extend(struct.pack('<H', 0))  # per hour
        data.extend(struct.pack('<B', 0))  # per minute

        # Bit 9: Heart Rate
        flags |= (1 << 9)
        heart_rate = int(self.current_data.get("heartRate", 0))
        data.extend(struct.pack('<B', heart_rate))

        # Bit 11: Elapsed Time
        flags |= (1 << 11)
        elapsed_time = int(self.current_data.get("elapsedTime", 0))
        data.extend(struct.pack('<H', elapsed_time))

        return struct.pack('<H', flags) + bytes(data)

    def build_fitness_machine_feature(self) -> bytes:
        """Build Fitness Machine Feature characteristic value."""
        features = (1 << 1) | (1 << 2) | (1 << 6) | (1 << 7) | (1 << 14)
        target_settings = 0
        return struct.pack('<II', features, target_settings)

    def _create_buffer(self, data: bytes):
        """Create a WinRT Buffer from bytes."""
        writer = DataWriter()
        for byte in data:
            writer.write_byte(byte)
        return writer.detach_buffer()

    async def _on_subscribers_changed(self, sender, args):
        """Handle subscription changes."""
        self.subscribers = list(sender.subscribed_clients)
        if self.subscribers:
            self.log(f"Client subscribed, total: {len(self.subscribers)}")
        else:
            self.log("No subscribers")

    async def setup_service(self) -> bool:
        """Set up the GATT service with characteristics."""
        try:
            # Create service provider
            result: GattServiceProviderResult = await GattServiceProvider.create_async(FTMS_SERVICE_UUID)

            if result.error != 0:
                self.log(f"Failed to create service provider: error {result.error}")
                return False

            self.service_provider = result.service_provider
            service = self.service_provider.service

            # Add Fitness Machine Feature characteristic (read)
            feature_params = GattLocalCharacteristicParameters()
            feature_params.characteristic_properties = GattCharacteristicProperties.READ
            feature_params.read_protection_level = GattProtectionLevel.PLAIN
            feature_params.static_value = self._create_buffer(self.build_fitness_machine_feature())

            feature_result: GattLocalCharacteristicResult = await service.create_characteristic_async(
                FITNESS_MACHINE_FEATURE_UUID, feature_params
            )
            if feature_result.error != 0:
                self.log(f"Failed to create feature characteristic: {feature_result.error}")
                return False

            # Add Indoor Bike Data characteristic (notify)
            bike_params = GattLocalCharacteristicParameters()
            bike_params.characteristic_properties = GattCharacteristicProperties.NOTIFY
            bike_params.read_protection_level = GattProtectionLevel.PLAIN

            bike_result: GattLocalCharacteristicResult = await service.create_characteristic_async(
                INDOOR_BIKE_DATA_UUID, bike_params
            )
            if bike_result.error != 0:
                self.log(f"Failed to create bike data characteristic: {bike_result.error}")
                return False

            self.bike_data_characteristic = bike_result.characteristic
            self.bike_data_characteristic.add_subscribed_clients_changed(
                lambda s, a: asyncio.create_task(self._on_subscribers_changed(s, a))
            )

            # Add Supported Power Range characteristic (read)
            power_params = GattLocalCharacteristicParameters()
            power_params.characteristic_properties = GattCharacteristicProperties.READ
            power_params.read_protection_level = GattProtectionLevel.PLAIN
            power_params.static_value = self._create_buffer(struct.pack('<HHH', 0, 2000, 1))

            power_result = await service.create_characteristic_async(
                SUPPORTED_POWER_RANGE_UUID, power_params
            )
            if power_result.error != 0:
                self.log(f"Failed to create power range characteristic: {power_result.error}")
                return False

            self.log("GATT service configured successfully")
            return True

        except Exception as e:
            self.log(f"Error setting up service: {e}")
            return False

    async def start_advertising(self) -> bool:
        """Start BLE advertising."""
        try:
            # Use GattServiceProvider's built-in advertising
            # Note: Device name will be the Windows Bluetooth name, not custom
            try:
                adv_params = GattServiceProviderAdvertisingParameters()
                adv_params.is_discoverable = True
                adv_params.is_connectable = True
                self.service_provider.start_advertising(adv_params)
                self.log("GATT service advertising started (with params)")
            except TypeError:
                self.service_provider.start_advertising()
                self.log("GATT service advertising started (no params)")

            self.log(f"Device should be visible as your PC's Bluetooth name")
            self.log(f"Service UUID: {FTMS_SERVICE_UUID}")
            self.send_status("advertising", device_name=DEVICE_NAME)
            return True

        except Exception as e:
            self.log(f"Error starting advertising: {e}")
            return False

    async def notify_loop(self) -> None:
        """Continuously notify subscribers with current data."""
        while self.running:
            try:
                if self.bike_data_characteristic and self.subscribers:
                    bike_data = self.build_indoor_bike_data()
                    buffer = self._create_buffer(bike_data)

                    await self.bike_data_characteristic.notify_value_async(buffer)

                await asyncio.sleep(0.25)  # 4Hz as per FTMS spec
            except Exception as e:
                self.log(f"Notify error: {e}")
                await asyncio.sleep(1)

    async def start(self) -> bool:
        """Start the broadcaster."""
        if not await self.setup_service():
            return False

        if not await self.start_advertising():
            return False

        self.running = True
        asyncio.create_task(self.notify_loop())
        return True

    async def stop(self) -> None:
        """Stop the broadcaster."""
        self.running = False

        if self.service_provider:
            try:
                self.service_provider.stop_advertising()
            except Exception:
                pass

        self.send_status("stopped")

    def update_data(self, data: Dict[str, Any]) -> None:
        """Update current fitness data."""
        for key in ["power", "cadence", "heartRate", "distance", "calories", "elapsedTime"]:
            if key in data:
                self.current_data[key] = data[key]


def stdin_reader(broadcaster: FtmsBroadcasterWinRT, loop: asyncio.AbstractEventLoop) -> None:
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
    broadcaster = FtmsBroadcasterWinRT()
    loop = asyncio.get_event_loop()

    # Start stdin reader
    stdin_thread = threading.Thread(
        target=stdin_reader,
        args=(broadcaster, loop),
        daemon=True
    )
    stdin_thread.start()

    try:
        if await broadcaster.start():
            while broadcaster.running:
                await asyncio.sleep(1)
        else:
            broadcaster.log("Failed to start broadcaster")
    except KeyboardInterrupt:
        broadcaster.log("Interrupted")
    except Exception as e:
        broadcaster.log(f"Error: {e}")
    finally:
        await broadcaster.stop()


if __name__ == "__main__":
    asyncio.run(main())
