/**
 * Mock Test - Electron Main Process
 *
 * Spawns the Python FTMS broadcaster and handles IPC with the renderer.
 */

const { app, BrowserWindow, ipcMain } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const readline = require('readline');

// Python paths
const PYTHON_SCRIPT = path.join(__dirname, '..', 'python', 'ftms_broadcaster.py');
const PYTHON_VENV = path.join(__dirname, '..', 'python', 'venv');

let mainWindow = null;
let pythonProcess = null;

// =============================================================================
// PYTHON BROADCASTER
// =============================================================================

function startBroadcaster() {
  if (pythonProcess) {
    console.log('Broadcaster already running');
    return;
  }

  const isWindows = process.platform === 'win32';
  const pythonCmd = isWindows
    ? path.join(PYTHON_VENV, 'Scripts', 'python.exe')
    : path.join(PYTHON_VENV, 'bin', 'python');

  console.log(`Starting broadcaster: ${pythonCmd} ${PYTHON_SCRIPT}`);

  pythonProcess = spawn(pythonCmd, [PYTHON_SCRIPT], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
  });

  // Handle stdout
  const rl = readline.createInterface({ input: pythonProcess.stdout });
  rl.on('line', (line) => {
    try {
      const msg = JSON.parse(line);
      if (msg.status) {
        mainWindow?.webContents.send('broadcaster-status', msg.status);
      }
      if (msg.log) {
        mainWindow?.webContents.send('broadcaster-log', msg.log);
      }
    } catch (e) {
      console.log(`[Python] ${line}`);
    }
  });

  // Handle stderr
  pythonProcess.stderr.on('data', (data) => {
    console.error(`[Python Error] ${data.toString().trim()}`);
    mainWindow?.webContents.send('broadcaster-log', `Error: ${data.toString().trim()}`);
  });

  // Handle exit
  pythonProcess.on('close', (code) => {
    console.log(`Broadcaster exited with code ${code}`);
    pythonProcess = null;
    mainWindow?.webContents.send('broadcaster-status', 'stopped');
  });

  pythonProcess.on('error', (err) => {
    console.error(`Failed to start broadcaster: ${err.message}`);
    mainWindow?.webContents.send('broadcaster-log', `Failed to start: ${err.message}`);
  });
}

function stopBroadcaster() {
  if (pythonProcess) {
    pythonProcess.stdin.write(JSON.stringify({ command: 'stop' }) + '\n');
    setTimeout(() => {
      if (pythonProcess) {
        pythonProcess.kill();
        pythonProcess = null;
      }
    }, 1000);
  }
}

function sendDataToBroadcaster(data) {
  if (pythonProcess && pythonProcess.stdin.writable) {
    pythonProcess.stdin.write(JSON.stringify(data) + '\n');
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
