#!/usr/bin/env python3
"""
Simple BLE advertisement test - just broadcast a name, no GATT services.
"""

import asyncio
import sys

async def test_simple_advertisement():
    """Test basic BLE advertising."""
    print("Testing simple BLE advertisement...")

    try:
        from winrt.windows.devices.bluetooth.advertisement import (
            BluetoothLEAdvertisementPublisher,
            BluetoothLEAdvertisementPublisherStatus,
        )

        publisher = BluetoothLEAdvertisementPublisher()

        # Try without local_name first (it was causing errors)
        print(f"Starting advertisement (no name - testing basic functionality)...")
        publisher.start()

        # Check status
        await asyncio.sleep(0.5)
        status = publisher.status
        print(f"Publisher status: {status}")

        if status == BluetoothLEAdvertisementPublisherStatus.STARTED:
            print("[OK] Advertisement is RUNNING!")
            print("Look for unknown/unnamed device in your scanner app...")
            print("Press Ctrl+C to stop")

            while True:
                await asyncio.sleep(1)
                # Re-check status periodically
                if publisher.status != BluetoothLEAdvertisementPublisherStatus.STARTED:
                    print(f"Status changed to: {publisher.status}")
                    break
        else:
            print(f"[FAIL] Advertisement not started. Status: {status}")

            # Check for common issues
            if status == BluetoothLEAdvertisementPublisherStatus.ABORTED:
                print("  -> ABORTED: Another app may be using the Bluetooth adapter")
            elif status == BluetoothLEAdvertisementPublisherStatus.WAITING:
                print("  -> WAITING: Waiting for Bluetooth to be ready")

    except Exception as e:
        print(f"[FAIL] Error: {e}")
        import traceback
        traceback.print_exc()
    finally:
        try:
            publisher.stop()
            print("Advertisement stopped")
        except:
            pass


async def test_gatt_only():
    """Test GATT advertising alone."""
    print("\n" + "="*50)
    print("Testing GATT Service Provider advertisement...")

    try:
        from winrt.windows.devices.bluetooth.genericattributeprofile import (
            GattServiceProvider,
            GattServiceProviderAdvertisingParameters,
            GattServiceProviderAdvertisementStatus,
            GattLocalCharacteristicParameters,
            GattCharacteristicProperties,
            GattProtectionLevel,
        )
        from winrt.windows.devices.bluetooth import BluetoothAdapter
        from winrt.windows.storage.streams import DataWriter
        import uuid

        # First check adapter status
        print("Checking Bluetooth adapter...")
        adapter = await BluetoothAdapter.get_default_async()
        if adapter:
            print(f"  Adapter address: {adapter.bluetooth_address:012X}")
            print(f"  Is Central Supported: {adapter.is_central_role_supported}")
            print(f"  Is Peripheral Supported: {adapter.is_peripheral_role_supported}")
            print(f"  Is Advertisement Offload Supported: {adapter.is_advertisement_offload_supported}")
            print(f"  Is Extended Advertising Supported: {adapter.is_extended_advertising_supported}")
        else:
            print("[FAIL] No adapter found")
            return

        # Create a simple test service
        test_uuid = uuid.UUID("12345678-1234-5678-1234-567812345678")
        char_uuid = uuid.UUID("12345678-1234-5678-1234-567812345679")

        result = await GattServiceProvider.create_async(test_uuid)

        if result.error != 0:
            print(f"[FAIL] Could not create service: error {result.error}")
            return

        provider = result.service_provider
        print(f"[OK] Created GATT service provider")

        # Add event handler for status changes
        def on_status_changed(sender, args):
            print(f"  [EVENT] Advertisement status changed! Error: {args.error}")

        provider.add_advertisement_status_changed(on_status_changed)

        # Add a characteristic (required for advertising to work)
        char_params = GattLocalCharacteristicParameters()
        char_params.characteristic_properties = GattCharacteristicProperties.READ
        char_params.read_protection_level = GattProtectionLevel.PLAIN

        # Create static value
        writer = DataWriter()
        writer.write_byte(0x01)
        char_params.static_value = writer.detach_buffer()

        char_result = await provider.service.create_characteristic_async(char_uuid, char_params)
        if char_result.error != 0:
            print(f"[FAIL] Could not create characteristic: error {char_result.error}")
            return

        print(f"[OK] Added test characteristic")

        # Check initial status
        print(f"Initial advertisement status: {provider.advertisement_status}")

        # Try with explicit parameters
        print("Starting advertisement with explicit parameters...")
        adv_params = GattServiceProviderAdvertisingParameters()
        adv_params.is_connectable = True
        adv_params.is_discoverable = True

        try:
            provider.start_advertising(adv_params)
        except TypeError:
            print("  (Using parameterless start)")
            provider.start_advertising()

        # Wait a bit for status to update
        await asyncio.sleep(2)

        status = provider.advertisement_status
        print(f"After start, status: {status} (0=Stopped, 2=Started, 3=Aborted)")

        if status == GattServiceProviderAdvertisementStatus.STARTED:
            print("[OK] GATT Advertisement is RUNNING!")
            print("Look for your PC's Bluetooth name in your scanner app...")
            print("Press Ctrl+C to stop")

            while True:
                await asyncio.sleep(1)
        elif status == GattServiceProviderAdvertisementStatus.ABORTED:
            print("[FAIL] Advertisement ABORTED")
            print("  Possible causes:")
            print("  - Another app is using Bluetooth advertising")
            print("  - Bluetooth radio is busy")
            print("  - Driver doesn't support peripheral mode properly")
        else:
            print(f"[FAIL] GATT advertisement not started (status={status})")
            print("  This may indicate a driver limitation")
            print("  Try: Run as Administrator")
            print("  Try: Disable/re-enable Bluetooth in Windows settings")

    except Exception as e:
        print(f"[FAIL] Error: {e}")
        import traceback
        traceback.print_exc()


async def main():
    print("="*50)
    print("BLE Advertisement Test")
    print("="*50)

    # First try simple advertisement
    try:
        await test_simple_advertisement()
    except KeyboardInterrupt:
        print("\nStopped by user")

    # Then try GATT
    try:
        await test_gatt_only()
    except KeyboardInterrupt:
        print("\nStopped by user")


if __name__ == "__main__":
    asyncio.run(main())
