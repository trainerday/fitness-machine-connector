/**
 * Mock Test - Preload Script
 *
 * Exposes IPC methods to the renderer securely.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  broadcasterStart: () => ipcRenderer.send('broadcaster-start'),
  broadcasterStop: () => ipcRenderer.send('broadcaster-stop'),
  broadcasterSendData: (data) => ipcRenderer.send('broadcaster-send-data', data),

  onBroadcasterStatus: (callback) => {
    ipcRenderer.on('broadcaster-status', (event, status) => callback(status));
  },

  onBroadcasterLog: (callback) => {
    ipcRenderer.on('broadcaster-log', (event, message) => callback(message));
  },
});
