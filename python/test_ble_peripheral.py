#!/usr/bin/env python3
"""
Diagnostic script to test if BLE peripheral mode is supported on this system.
"""

import sys
import asyncio
import platform

def check_platform():
    """Check platform and provide guidance."""
    print(f"Platform: {platform.system()}")
    print(f"Version: {platform.version()}")
    print(f"Python: {sys.version}")
    print()

async def test_winrt_peripheral():
    """Test Windows WinRT BLE peripheral support."""
    print("Testing Windows WinRT BLE Peripheral support...")
    print("-" * 50)

    try:
        # Try new package structure first (winrt-Windows.Devices.Bluetooth)
        try:
            from winrt.windows.devices.bluetooth import BluetoothAdapter
            from winrt.windows.devices.bluetooth.genericattributeprofile import (
                GattServiceProvider,
            )
        except ImportError:
            # Try alternative import style
            import winrt.windows.devices.bluetooth as bt
            import winrt.windows.devices.bluetooth.genericattributeprofile as gatt
            BluetoothAdapter = bt.BluetoothAdapter
            GattServiceProvider = gatt.GattServiceProvider

        print("[OK] WinRT Bluetooth modules imported")

        # Get the default adapter
        adapter = await BluetoothAdapter.get_default_async()
        if adapter is None:
            print("[FAIL] No Bluetooth adapter found")
            return False

        print(f"[OK] Bluetooth adapter found")
        print(f"     Address: {adapter.bluetooth_address:012X}")
        print(f"     Is Central Supported: {adapter.is_central_role_supported}")
        print(f"     Is Peripheral Supported: {adapter.is_peripheral_role_supported}")

        if not adapter.is_peripheral_role_supported:
            print()
            print("[FAIL] Your Bluetooth adapter does NOT support peripheral mode!")
            print("       This is a hardware/driver limitation.")
            print("       Options:")
            print("       1. Use a different USB Bluetooth adapter that supports peripheral mode")
            print("       2. Use the app without broadcasting on Windows")
            return False

        print()
        print("[OK] Peripheral mode IS supported by your adapter!")
        print("     Attempting to create a test GATT service...")

        # Try to actually create a service provider
        import uuid
        test_uuid = uuid.UUID("12345678-1234-5678-1234-567812345678")

        result = await GattServiceProvider.create_async(test_uuid)

        if result.error != 0:
            print(f"[FAIL] Could not create GATT service. Error code: {result.error}")
            return False

        print("[OK] Successfully created test GATT service provider!")
        print()
        print("Your system SHOULD support BLE peripheral mode.")
        print("If bless still fails, it may be a library issue.")

        return True

    except ImportError as e:
        print(f"[FAIL] WinRT modules not available: {e}")
        print("       Try: pip install winrt-Windows.Devices.Bluetooth")
        return False
    except Exception as e:
        print(f"[FAIL] Error during test: {type(e).__name__}: {e}")
        return False

async def test_bless():
    """Test bless library directly."""
    print()
    print("Testing bless library...")
    print("-" * 50)

    try:
        from bless import BlessServer
        print("[OK] bless imported successfully")

        loop = asyncio.get_event_loop()
        server = BlessServer(name="Test", loop=loop)
        print("[OK] BlessServer created")

        # Try to add a service
        test_uuid = "12345678-1234-5678-1234-567812345678"
        await server.add_new_service(test_uuid)
        print("[OK] Test service added")

        # Try to start
        print("     Attempting to start advertising...")
        await server.start()
        print("[OK] Server started successfully!")

        await asyncio.sleep(1)
        await server.stop()
        print("[OK] Server stopped")

        return True

    except Exception as e:
        print(f"[FAIL] bless error: {type(e).__name__}: {e}")
        return False

async def main():
    print("=" * 50)
    print("BLE Peripheral Mode Diagnostic")
    print("=" * 50)
    print()

    check_platform()

    if platform.system() == "Windows":
        winrt_ok = await test_winrt_peripheral()
        if winrt_ok:
            await test_bless()
    elif platform.system() == "Darwin":
        print("macOS detected - peripheral mode should work via CoreBluetooth")
        await test_bless()
    else:
        print(f"Platform {platform.system()} - testing bless directly")
        await test_bless()

if __name__ == "__main__":
    asyncio.run(main())
