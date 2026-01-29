/**
 * Mock Test - Renderer
 *
 * Generates mock fitness data and sends it to the FTMS broadcaster.
 */

// =============================================================================
// MOCK DATA GENERATOR
// =============================================================================

class MockDataGenerator {
  constructor() {
    this.reset();
  }

  reset() {
    this.elapsedTime = 0;
    this.totalDistance = 0;
    this.totalCalories = 0;
    this.basePower = 150;
    this.baseCadence = 80;
    this.baseHeartRate = 120;
  }

  generate() {
    // Slowly drift base values
    this.basePower += this.randomRange(-5, 5);
    this.basePower = this.clamp(this.basePower, 50, 350);

    this.baseCadence += this.randomRange(-2, 2);
    this.baseCadence = this.clamp(this.baseCadence, 60, 120);

    this.baseHeartRate += this.randomRange(-1, 1);
    this.baseHeartRate = this.clamp(this.baseHeartRate, 90, 180);

    // Add noise
    const power = Math.round(this.basePower + this.randomRange(-10, 10));
    const cadence = Math.round(this.baseCadence + this.randomRange(-5, 5));
    const heartRate = Math.round(this.baseHeartRate + this.randomRange(-3, 3));

    // Accumulate
    this.elapsedTime += 1;
    const speedKph = (power / 10) * (cadence / 80);
    this.totalDistance += (speedKph / 3600) * 1000; // meters per second
    this.totalCalories += (power / 150) * 3.5 / 60;

    return {
      power,
      cadence,
      heartRate,
      speed: speedKph,
      distance: Math.round(this.totalDistance),
      calories: Math.round(this.totalCalories),
      elapsedTime: this.elapsedTime,
    };
  }

  randomRange(min, max) {
    return Math.random() * (max - min) + min;
  }

  clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }
}

// =============================================================================
// UI ELEMENTS
// =============================================================================

const mockStatusEl = document.getElementById('mock-status');
const ftmsStatusEl = document.getElementById('ftms-status');
const mockBtn = document.getElementById('mock-btn');
const broadcastBtn = document.getElementById('broadcast-btn');
const logContainer = document.getElementById('log');

// Live data elements
const livePowerEl = document.getElementById('live-power');
const liveCadenceEl = document.getElementById('live-cadence');
const liveHrEl = document.getElementById('live-hr');
const liveSpeedEl = document.getElementById('live-speed');

// FTMS output elements
const ftmsPowerEl = document.getElementById('ftms-power');
const ftmsCadenceEl = document.getElementById('ftms-cadence');
const ftmsHrEl = document.getElementById('ftms-hr');
const ftmsDistanceEl = document.getElementById('ftms-distance');
const ftmsCaloriesEl = document.getElementById('ftms-calories');
const ftmsElapsedEl = document.getElementById('ftms-elapsed');

// Expandable section
const toggleBtn = document.getElementById('toggle-additional');
const additionalFields = document.getElementById('additional-fields');

// =============================================================================
// STATE
// =============================================================================

const generator = new MockDataGenerator();
let mockInterval = null;
let isBroadcasting = false;

// =============================================================================
// LOGGING
// =============================================================================

function log(message) {
  const entry = document.createElement('div');
  entry.className = 'log-entry';
  const time = new Date().toLocaleTimeString();
  entry.textContent = `[${time}] ${message}`;
  logContainer.appendChild(entry);
  logContainer.scrollTop = logContainer.scrollHeight;
}

// =============================================================================
// FORMAT HELPERS
// =============================================================================

function formatDuration(seconds) {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// =============================================================================
// UI UPDATES
// =============================================================================

function updateLiveDisplay(data) {
  livePowerEl.textContent = data.power;
  liveCadenceEl.textContent = data.cadence;
  liveHrEl.textContent = data.heartRate;
  liveSpeedEl.textContent = data.speed.toFixed(1);
}

function updateFtmsDisplay(data) {
  ftmsPowerEl.textContent = data.power;
  ftmsCadenceEl.textContent = data.cadence;
  ftmsHrEl.textContent = data.heartRate;
  ftmsDistanceEl.textContent = data.distance;
  ftmsCaloriesEl.textContent = data.calories;
  ftmsElapsedEl.textContent = formatDuration(data.elapsedTime);
}

function resetDisplays() {
  livePowerEl.textContent = '--';
  liveCadenceEl.textContent = '--';
  liveHrEl.textContent = '--';
  liveSpeedEl.textContent = '--';

  ftmsPowerEl.textContent = '--';
  ftmsCadenceEl.textContent = '--';
  ftmsHrEl.textContent = '--';
  ftmsDistanceEl.textContent = '--';
  ftmsCaloriesEl.textContent = '--';
  ftmsElapsedEl.textContent = '--';
}

// =============================================================================
// MOCK DATA CONTROL
// =============================================================================

function startMockData() {
  if (mockInterval) return;

  generator.reset();
  log('Starting mock data generation...');

  mockInterval = setInterval(() => {
    const data = generator.generate();

    // Update displays
    updateLiveDisplay(data);
    updateFtmsDisplay(data);

    // Send to broadcaster if broadcasting
    if (isBroadcasting && window.electronAPI) {
      window.electronAPI.broadcasterSendData({
        power: data.power,
        cadence: data.cadence,
        heartRate: data.heartRate,
        distance: data.distance,
        calories: data.calories,
        elapsedTime: data.elapsedTime,
      });
    }
  }, 1000);

  mockStatusEl.textContent = 'Running';
  mockStatusEl.className = 'status-value connected';
  mockBtn.textContent = 'Stop Mock Data';
  log('Mock data started');
}

function stopMockData() {
  if (mockInterval) {
    clearInterval(mockInterval);
    mockInterval = null;
  }

  mockStatusEl.textContent = 'Stopped';
  mockStatusEl.className = 'status-value disconnected';
  mockBtn.textContent = 'Start Mock Data';
  resetDisplays();
  log('Mock data stopped');
}

function toggleMockData() {
  if (mockInterval) {
    stopMockData();
  } else {
    startMockData();
  }
}

// =============================================================================
// BROADCAST CONTROL
// =============================================================================

function startBroadcast() {
  if (!window.electronAPI) {
    log('ERROR: Electron API not available');
    return;
  }

  log('Starting FTMS broadcast...');
  window.electronAPI.broadcasterStart();
  isBroadcasting = true;
  broadcastBtn.textContent = 'Stop Broadcast';
}

function stopBroadcast() {
  if (!window.electronAPI) return;

  log('Stopping FTMS broadcast...');
  window.electronAPI.broadcasterStop();
  isBroadcasting = false;
  broadcastBtn.textContent = 'Start Broadcast';
}

function toggleBroadcast() {
  if (isBroadcasting) {
    stopBroadcast();
  } else {
    startBroadcast();
  }
}

// =============================================================================
// EVENT LISTENERS
// =============================================================================

mockBtn.addEventListener('click', toggleMockData);
broadcastBtn.addEventListener('click', toggleBroadcast);

// Expandable section toggle
let isExpanded = false;
toggleBtn.addEventListener('click', () => {
  isExpanded = !isExpanded;
  additionalFields.style.display = isExpanded ? 'block' : 'none';
  toggleBtn.innerHTML = isExpanded
    ? '<span class="expand-icon" style="display:inline-block;transform:rotate(90deg)">&#9654;</span> Hide additional fields'
    : '<span class="expand-icon">&#9654;</span> Show additional fields';
});

// IPC listeners
if (window.electronAPI) {
  window.electronAPI.onBroadcasterStatus((status) => {
    log(`Broadcaster status: ${status}`);
    ftmsStatusEl.textContent = status.charAt(0).toUpperCase() + status.slice(1);

    if (status === 'advertising' || status === 'connected') {
      ftmsStatusEl.className = 'status-value connected';
    } else if (status === 'stopped' || status === 'error') {
      ftmsStatusEl.className = 'status-value disconnected';
      isBroadcasting = false;
      broadcastBtn.textContent = 'Start Broadcast';
    } else {
      ftmsStatusEl.className = 'status-value warning';
    }
  });

  window.electronAPI.onBroadcasterLog((message) => {
    log(`Broadcaster: ${message}`);
  });
}

// =============================================================================
// INIT
// =============================================================================

log('Ready. Click "Start Mock Data" to generate test data, then "Start Broadcast" to advertise via Bluetooth.');
