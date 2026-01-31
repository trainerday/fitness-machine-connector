/**
 * Mock Test - Electron Main Process
 *
 * Uses bleno for FTMS broadcasting on macOS/Linux (same as working emulator)
 * Falls back to Python on Windows
 */

const { app, BrowserWindow, ipcMain } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const readline = require('readline');
const EventEmitter = require('events');

// Python paths (fallback for Windows)
const PYTHON_SCRIPT = path.join(__dirname, '..', 'python', 'ftms_broadcaster.py');
const PYTHON_VENV = path.join(__dirname, '..', 'python', 'venv');

let mainWindow = null;
let broadcaster = null;

// =============================================================================
// BLENO BROADCASTER (macOS/Linux)
// =============================================================================

// FTMS Service and Characteristic UUIDs
const FITNESS_MACHINE_SERVICE_UUID = '1826';
const INDOOR_BIKE_DATA_UUID = '2AD2';
const FITNESS_MACHINE_FEATURE_UUID = '2ACC';
const FITNESS_MACHINE_CONTROL_POINT_UUID = '2AD9';

const DEVICE_NAME = 'TD Bike';

let bleno = null;
try {
  bleno = require('@abandonware/bleno');
} catch (e) {
  console.log('Bleno not available, will use Python fallback');
}

class BlenoBroadcaster extends EventEmitter {
  constructor() {
    super();
    this.status = 'stopped';
    this.indoorBikeDataChar = null;
    this.updateInterval = null;
    this.subscribers = [];
    this.currentData = { power: 0, cadence: 0, speed: 0, heartRate: 0 };
    this.isSetup = false;
    this.pendingStart = false;

    if (bleno) {
      this.setupBlenoEvents();
    }
  }

  setupBlenoEvents() {
    bleno.on('stateChange', (state) => {
      console.log(`Bluetooth state: ${state}`);
      this.emit('log', `Bluetooth state: ${state}`);

      if (state === 'poweredOn') {
        if (this.pendingStart) {
          this.startAdvertising();
        }
      } else {
        bleno.stopAdvertising();
        if (this.status !== 'stopped') {
          this.status = 'stopped';
          this.emit('status', 'stopped');
        }
      }
    });

    bleno.on('advertisingStart', (error) => {
      if (error) {
        console.error('Advertising error:', error);
        this.status = 'error';
        this.emit('status', 'error');
        return;
      }

      console.log('Advertising started');
      this.emit('log', 'Advertising started');
      this.setupServices();
    });

    bleno.on('accept', (clientAddress) => {
      console.log(`Client connected: ${clientAddress}`);
      this.status = 'connected';
      this.emit('status', 'connected');
      this.emit('log', `Client connected: ${clientAddress}`);
    });

    bleno.on('disconnect', (clientAddress) => {
      console.log(`Client disconnected: ${clientAddress}`);
      this.emit('log', `Client disconnected: ${clientAddress}`);
      if (this.status === 'connected') {
        this.status = 'advertising';
        this.emit('status', 'advertising');
      }
    });
  }

  startAdvertising() {
    console.log('Starting advertising...');
    this.emit('log', 'Starting advertising...');
    bleno.startAdvertising(DEVICE_NAME, [FITNESS_MACHINE_SERVICE_UUID]);
  }

  setupServices() {
    const BlenoCharacteristic = bleno.Characteristic;
    const self = this;

    // Indoor Bike Data Characteristic
    const bikeDataChar = new BlenoCharacteristic({
      uuid: INDOOR_BIKE_DATA_UUID,
      properties: ['notify'],
      onSubscribe: (maxValueSize, updateValueCallback) => {
        console.log('Client subscribed to Indoor Bike Data');
        self.emit('log', 'Client subscribed to Indoor Bike Data');
        self.subscribers.push(updateValueCallback);

        if (self.subscribers.length === 1) {
          self.startDataUpdates();
        }
      },
      onUnsubscribe: () => {
        console.log('Client unsubscribed from Indoor Bike Data');
        self.emit('log', 'Client unsubscribed from Indoor Bike Data');
        self.subscribers.pop();

        if (self.subscribers.length === 0) {
          self.stopDataUpdates();
        }
      },
    });

    // Fitness Machine Feature Characteristic
    const featureChar = new BlenoCharacteristic({
      uuid: FITNESS_MACHINE_FEATURE_UUID,
      properties: ['read'],
      onReadRequest: (offset, callback) => {
        if (offset) {
          callback(BlenoCharacteristic.RESULT_ATTR_NOT_LONG, null);
        } else {
          // Features: Average Speed Supported (matching working emulator)
          const features = Buffer.alloc(8);
          features.writeUInt32LE(0x00000001, 0); // Bit 0: Average Speed Supported
          features.writeUInt32LE(0x00000000, 4); // Target settings features
          callback(BlenoCharacteristic.RESULT_SUCCESS, features);
        }
      },
    });

    // Control Point Characteristic
    const controlPointChar = new BlenoCharacteristic({
      uuid: FITNESS_MACHINE_CONTROL_POINT_UUID,
      properties: ['write', 'indicate'],
      onSubscribe: (maxValueSize, updateValueCallback) => {
        console.log('Client subscribed to Control Point');
        controlPointChar._updateValueCallback = updateValueCallback;
      },
      onUnsubscribe: () => {
        console.log('Client unsubscribed from Control Point');
        controlPointChar._updateValueCallback = null;
      },
      onWriteRequest: (data, offset, withoutResponse, callback) => {
        if (data.length > 0) {
          const opCode = data[0];
          console.log(`Control Point command: 0x${opCode.toString(16)}`);
          self.emit('log', `Control Point command: 0x${opCode.toString(16)}`);

          callback(BlenoCharacteristic.RESULT_SUCCESS);

          // Send indication response
          if (controlPointChar._updateValueCallback) {
            const response = Buffer.alloc(3);
            response.writeUInt8(0x80, 0); // Response op code
            response.writeUInt8(opCode, 1); // Request op code
            response.writeUInt8(0x01, 2); // Success
            controlPointChar._updateValueCallback(response);
          }
        } else {
          callback(BlenoCharacteristic.RESULT_SUCCESS);
        }
      },
    });

    // Create service
    const fitnessMachineService = new bleno.PrimaryService({
      uuid: FITNESS_MACHINE_SERVICE_UUID,
      characteristics: [bikeDataChar, featureChar, controlPointChar],
    });

    bleno.setServices([fitnessMachineService], (error) => {
      if (error) {
        console.error('Error setting services:', error);
        this.status = 'error';
        this.emit('status', 'error');
      } else {
        console.log('FTMS service registered');
        this.emit('log', 'FTMS service registered');
        this.isSetup = true;
        this.status = 'advertising';
        this.emit('status', 'advertising');
      }
    });
  }

  startDataUpdates() {
    console.log('Starting data updates...');
    this.emit('log', 'Starting data updates (4Hz)');

    // Send updates every 250ms (4Hz as per FTMS spec)
    this.updateInterval = setInterval(() => {
      const buffer = this.buildIndoorBikeData(this.currentData);

      this.subscribers.forEach((callback) => {
        callback(buffer);
      });
    }, 250);
  }

  stopDataUpdates() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
      console.log('Stopped data updates');
      this.emit('log', 'Stopped data updates');
    }
  }

  /**
   * Build Indoor Bike Data characteristic buffer
   * Matches the working emulator format exactly
   */
  buildIndoorBikeData(data) {
    const buffer = Buffer.alloc(9);

    // Flags: 0x0244
    //   Bit 0 = 0: Speed IS present (INVERTED LOGIC!)
    //   Bit 2 = 1: Cadence present (0x04)
    //   Bit 6 = 1: Power present (0x40)
    //   Bit 9 = 1: Heart Rate present (0x200)
    const flags = 0x0244;
    buffer.writeUInt16LE(flags, 0);

    // Instantaneous Speed (km/h * 100, resolution 0.01 km/h)
    const speed = Math.round((data.speed || 0) * 100);
    buffer.writeUInt16LE(speed, 2);

    // Instantaneous Cadence (rpm * 2, resolution 0.5 RPM)
    const cadence = Math.round((data.cadence || 0) * 2);
    buffer.writeUInt16LE(cadence, 4);

    // Instantaneous Power (watts, signed int16)
    buffer.writeInt16LE(data.power || 0, 6);

    // Heart Rate (BPM, uint8)
    buffer.writeUInt8(data.heartRate || 0, 8);

    return buffer;
  }

  start() {
    if (!bleno) {
      this.status = 'error';
      this.emit('status', 'error');
      this.emit('log', 'Bleno not available');
      return;
    }

    this.status = 'starting';
    this.emit('status', 'starting');

    if (bleno.state === 'poweredOn') {
      this.startAdvertising();
    } else {
      this.pendingStart = true;
    }
  }

  stop() {
    if (!bleno) return;

    console.log('Stopping broadcaster...');
    this.pendingStart = false;
    this.stopDataUpdates();
    bleno.stopAdvertising();
    this.status = 'stopped';
    this.emit('status', 'stopped');
  }

  sendData(data) {
    this.currentData = data;
  }
}

// =============================================================================
// PYTHON BROADCASTER (Windows fallback)
// =============================================================================

class PythonBroadcaster extends EventEmitter {
  constructor() {
    super();
    this.process = null;
    this.status = 'stopped';
  }

  start() {
    if (this.process) {
      console.log('Broadcaster already running');
      return;
    }

    const isWindows = process.platform === 'win32';
    const pythonCmd = isWindows
      ? path.join(PYTHON_VENV, 'Scripts', 'python.exe')
      : path.join(PYTHON_VENV, 'bin', 'python');

    console.log(`Starting Python broadcaster: ${pythonCmd} ${PYTHON_SCRIPT}`);
    this.emit('log', 'Starting Python broadcaster...');

    this.process = spawn(pythonCmd, [PYTHON_SCRIPT], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
    });

    const rl = readline.createInterface({ input: this.process.stdout });
    rl.on('line', (line) => {
      try {
        const msg = JSON.parse(line);
        if (msg.status) {
          this.status = msg.status;
          this.emit('status', msg.status);
        }
        if (msg.log) {
          this.emit('log', msg.log);
        }
      } catch (e) {
        console.log(`[Python] ${line}`);
      }
    });

    this.process.stderr.on('data', (data) => {
      console.error(`[Python Error] ${data.toString().trim()}`);
      this.emit('log', `Error: ${data.toString().trim()}`);
    });

    this.process.on('close', (code) => {
      console.log(`Broadcaster exited with code ${code}`);
      this.process = null;
      this.status = 'stopped';
      this.emit('status', 'stopped');
    });

    this.process.on('error', (err) => {
      console.error(`Failed to start broadcaster: ${err.message}`);
      this.emit('log', `Failed to start: ${err.message}`);
    });
  }

  stop() {
    if (this.process) {
      this.process.stdin.write(JSON.stringify({ command: 'stop' }) + '\n');
      setTimeout(() => {
        if (this.process) {
          this.process.kill();
          this.process = null;
        }
      }, 1000);
    }
  }

  sendData(data) {
    if (this.process && this.process.stdin.writable) {
      this.process.stdin.write(JSON.stringify(data) + '\n');
    }
  }
}

// =============================================================================
// BROADCASTER FACTORY
// =============================================================================

function createBroadcaster() {
  // Use bleno on macOS/Linux, Python on Windows
  if ((process.platform === 'darwin' || process.platform === 'linux') && bleno) {
    console.log('Using Bleno broadcaster (macOS/Linux)');
    return new BlenoBroadcaster();
  } else {
    console.log('Using Python broadcaster (Windows or fallback)');
    return new PythonBroadcaster();
  }
}

function startBroadcaster() {
  if (broadcaster) {
    console.log('Broadcaster already exists');
    return;
  }

  broadcaster = createBroadcaster();

  broadcaster.on('status', (status) => {
    mainWindow?.webContents.send('broadcaster-status', status);
  });

  broadcaster.on('log', (message) => {
    mainWindow?.webContents.send('broadcaster-log', message);
  });

  broadcaster.start();
}

function stopBroadcaster() {
  if (broadcaster) {
    broadcaster.stop();
    broadcaster = null;
  }
}

function sendDataToBroadcaster(data) {
  if (broadcaster) {
    broadcaster.sendData(data);
  }
}

// =============================================================================
// IPC HANDLERS
// =============================================================================

ipcMain.on('broadcaster-start', () => {
  startBroadcaster();
});

ipcMain.on('broadcaster-stop', () => {
  stopBroadcaster();
});

ipcMain.on('broadcaster-send-data', (event, data) => {
  sendDataToBroadcaster(data);
});

// =============================================================================
// WINDOW
// =============================================================================

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 750,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.webContents.openDevTools();

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// =============================================================================
// APP LIFECYCLE
// =============================================================================

app.on('ready', createWindow);

app.on('window-all-closed', () => {
  stopBroadcaster();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  stopBroadcaster();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
