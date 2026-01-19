# BLE Connector App

## Technology

I've researched the options and an Electron app with Node.js is the most mature approach for Bluetooth connectivity on both Windows and Mac.

## What We Need

Build a desktop app that connects to fitness bikes (like Keiser M3i, Echelon, or similar) and makes them appear as a standard FTMS device to apps like Zwift or TrainerDay. Many trainers use their own Bluetooth protocols instead of the industry standard (FTMS), so this app acts as a translator.

The app should:
- Scan for and connect to supported trainers via Bluetooth
- Read their power, cadence, and heart rate data
- Broadcast that data as an FTMS Indoor Bike so Zwift, TrainerDay, and other apps can use it
- Have a simple UI showing connection status and live data values

Start with one trainer type (Keiser M3i), get it working end-to-end, then add support for others.

## Bluetooth Emulator

Since you don't own these bikes, you'll need to build a Bluetooth emulator for testing. This is a separate app/script that pretends to be a trainer by broadcasting fake data over Bluetooth.

The emulator should be able to simulate:
- Keiser M3i (broadcasts in manufacturer data)
- Echelon bike (uses their proprietary protocol)
- Standard FTMS bike (for comparison/testing)
- To fully test this, it needs to run on a different device. It can be a different laptop, an Arduino, or Raspberry Pi. 

As a first step, it should generate realistic fake data - power that varies over time (100-250W), cadence around 80-95 rpm, etc.

Later, what it should do is: when you send a target from TrainerDay app to your app (which goes to the emulator), the emulator should output a random value approximately what the target is. 

## End-to-End Testing

The full test flow looks like this:

```
Emulator (fake bike) → Your App (translator) → TrainerDay or Zwift
```

You should be able to:
1. Start the emulator pretending to be an M3i
2. Start your app and see it connect to the emulator
3. Open TrainerDay (or Zwift) and pair with your app's FTMS device
4. See the fake data flowing all the way through

This proves the whole pipeline works before testing with real hardware.

## UI Requirements

- Show whether the trainer is connected
- Show whether a client app (like Zwift) is connected
- Display current power, cadence, and heart rate values
- Basic controls (quit button, maybe a scan button)

## Example Prompts for AI

To understand the problem:
- "What is the FTMS Bluetooth protocol and how does an Indoor Bike characteristic work?"
- "How does the Keiser M3i broadcast its data over Bluetooth? What format is the manufacturer data?"

To build components:
- "How do I scan for Bluetooth devices in Node.js/Electron and read their advertisement data?"
- "How do I create a Bluetooth peripheral in Node.js that advertises as an FTMS Indoor Bike?"
- "Show me how to build the Indoor Bike Data characteristic buffer with power, cadence, and heart rate"

To build the emulator:
- "How do I create a Bluetooth peripheral that broadcasts like a Keiser M3i?"
- "How do I simulate manufacturer data in a BLE advertisement?"

To debug:
- "My FTMS device shows up in Zwift but won't pair - what could be wrong?"
- "How do I test my FTMS peripheral without a real app connecting to it?"
