/**
 * PulseIoT - ESP32 Energy Monitor & Waveform Studio Logic
 * Supporting Multi-Tab Navigation, Pure Sinusoidal Oscilloscope, 7-Day Retention, & Dual Light/Dark Themes
 */

// Application State
const state = {
  currentTheme: 'dark',
  isSimulating: false,
  windowTimeSec: 15,
  wsConnected: false,
  ws: null,
  
  // Waveform display: 'sine' (Pure AC Sine Oscilloscope) or 'trend' (RMS Time-Series)
  waveformDisplayMode: 'sine',
  activeWaveformChannel: 'dual', // 'dual' | 'voltage' | 'current' | 'power'
  scopeCycles: 2,                // 2, 4, 8 cycles
  isWaveformPaused: false,

  // Scope canvas animation
  scopeCanvas: null,
  scopeCtx: null,
  scopePhase: 0,

  // Charts & Database
  liveChart: null,
  historyChart: null,
  db: null,
  cumulativeWh: 0.0,
  lastTimestamp: Date.now(),
  peakCurrent: 0.00,
  liveDataBuffer: [],
  historyDataCache: [],

  // Live telemetry metrics (initialized to 0, awaiting real ESP32 transmission)
  vRms: 0.0,
  iRms: 0.0,
  pWatts: 0.0,
  freq: 0.0,
  pf: 0.0
};

// Metric Colors
const COLORS = {
  voltage: '#f59e0b',
  current: '#00f2fe',
  power: '#00e676',
  frequency: '#a855f7',
  grid: 'rgba(30, 41, 59, 0.6)',
  gridDotted: 'rgba(71, 85, 105, 0.8)'
};

// Initialize Application
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  if (window.lucide) lucide.createIcons();
  updateClock();
  setInterval(updateClock, 1000);

  initIndexedDB(() => {
    initScopeCanvas();
    initLiveChart();
    initHistoryChart();
    attemptWebSocketConnection();
  });
});

// Clock Display
function updateClock() {
  const now = new Date();
  const el = document.getElementById('liveTime');
  if (el) el.textContent = now.toLocaleTimeString();
}

// ----------------------------------------------------
// 0. THEME SWITCHER (LIGHT / DARK)
// ----------------------------------------------------
function initTheme() {
  const saved = localStorage.getItem('pulseiot_theme') || 'dark';
  applyTheme(saved);
}

function toggleTheme() {
  const next = state.currentTheme === 'dark' ? 'light' : 'dark';
  applyTheme(next);
}

function applyTheme(theme) {
  state.currentTheme = theme;
  localStorage.setItem('pulseiot_theme', theme);
  document.documentElement.setAttribute('data-theme', theme);

  const icon = document.getElementById('themeIcon');
  const label = document.getElementById('themeLabel');
  if (icon && label) {
    if (theme === 'light') {
      icon.textContent = '🌙';
      label.textContent = 'Dark Mode';
    } else {
      icon.textContent = '☀️';
      label.textContent = 'Light Mode';
    }
  }

  // Update scope colors for theme
  if (theme === 'light') {
    COLORS.voltage = '#d97706';
    COLORS.current = '#0284c7';
    COLORS.power = '#059669';
    COLORS.grid = 'rgba(203, 213, 225, 0.7)';
    COLORS.gridDotted = 'rgba(100, 116, 139, 0.8)';
  } else {
    COLORS.voltage = '#ff9800';
    COLORS.current = '#00f2fe';
    COLORS.power = '#00e676';
    COLORS.grid = 'rgba(30, 41, 59, 0.6)';
    COLORS.gridDotted = 'rgba(71, 85, 105, 0.8)';
  }

  if (state.scopeCanvas) drawOscilloscope();
  updateChartsTheme();
}

function updateChartsTheme() {
  const isLight = state.currentTheme === 'light';
  const gridColor = isLight ? 'rgba(203, 213, 225, 0.6)' : 'rgba(255, 255, 255, 0.05)';
  const tickColor = isLight ? '#475569' : '#64748b';

  [state.liveChart, state.historyChart].forEach(chart => {
    if (!chart || !chart.options) return;
    if (chart.options.scales.x) {
      chart.options.scales.x.grid.color = gridColor;
      chart.options.scales.x.ticks.color = tickColor;
    }
    if (chart.options.scales.y) {
      chart.options.scales.y.grid.color = gridColor;
    }
    chart.update('none');
  });
}

// ----------------------------------------------------
// 1. NAVIGATION TAB SWITCHER
// ----------------------------------------------------
function switchTab(tabId, btn) {
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));

  const target = document.getElementById(tabId);
  if (target) target.classList.add('active');
  if (btn) btn.classList.add('active');

  if (tabId === 'historyTab') {
    fetchHistoryRange('7d');
  }

  // Redraw canvas scope if entering liveTab
  if (tabId === 'liveTab' && state.scopeCanvas) {
    setTimeout(resizeScopeCanvas, 50);
  }
}

// ----------------------------------------------------
// 2. PURE SINUSOIDAL OSCILLOSCOPE CANVAS ENGINE
// ----------------------------------------------------
function initScopeCanvas() {
  state.scopeCanvas = document.getElementById('scopeCanvas');
  if (!state.scopeCanvas) return;
  state.scopeCtx = state.scopeCanvas.getContext('2d');

  window.addEventListener('resize', resizeScopeCanvas);
  resizeScopeCanvas();

  renderScopeLoop();
}

function resizeScopeCanvas() {
  if (!state.scopeCanvas) return;
  const rect = state.scopeCanvas.parentElement.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  state.scopeCanvas.width = rect.width * dpr;
  state.scopeCanvas.height = rect.height * dpr;
  state.scopeCtx.scale(dpr, dpr);
}

function renderScopeLoop() {
  if (!state.isWaveformPaused && state.waveformDisplayMode === 'sine') {
    state.scopePhase += 0.05;
    if (state.scopePhase > Math.PI * 2) {
      state.scopePhase -= Math.PI * 2;
    }
    drawOscilloscope();
  }

  requestAnimationFrame(renderScopeLoop);
}

function drawOscilloscope() {
  const canvas = state.scopeCanvas;
  if (!canvas) return;
  const ctx = state.scopeCtx;
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.width / dpr;
  const height = canvas.height / dpr;

  ctx.clearRect(0, 0, width, height);

  // 1. Draw Reticle Grid
  ctx.save();
  ctx.lineWidth = 1;
  ctx.strokeStyle = COLORS.grid;

  const divX = 10;
  const divY = 8;
  const stepX = width / divX;
  const stepY = height / divY;

  for (let x = 0; x <= width; x += stepX) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = 0; y <= height; y += stepY) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  // Dotted Center Ground Axis
  const centerY = height / 2;
  const centerX = width / 2;

  ctx.strokeStyle = COLORS.gridDotted;
  ctx.setLineDash([4, 4]);

  ctx.beginPath();
  ctx.moveTo(0, centerY);
  ctx.lineTo(width, centerY);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(centerX, 0);
  ctx.lineTo(centerX, height);
  ctx.stroke();

  ctx.setLineDash([]);
  ctx.restore();

  // Zero reference label
  ctx.font = '10px JetBrains Mono';
  ctx.fillStyle = '#64748b';
  ctx.fillText('0V / 0A (GND)', 8, centerY - 6);

  // 2. Math parameters for Pure Sine Waves
  const cycles = state.scopeCycles;
  const phaseShift = Math.acos(Math.min(1.0, Math.max(0.0, state.pf)));

  const maxVScale = 400;
  const vPeak = state.vRms * Math.SQRT2;
  const vAmpPixels = (vPeak / maxVScale) * (centerY * 0.82);

  const maxIScale = 10;
  const iPeak = state.iRms * Math.SQRT2;
  const iAmpPixels = (iPeak / maxIScale) * (centerY * 0.78);

  const chan = state.activeWaveformChannel;

  // 3. Draw Voltage Sine Wave
  if (chan === 'dual' || chan === 'voltage') {
    ctx.save();
    ctx.beginPath();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = COLORS.voltage;
    ctx.shadowColor = 'rgba(255, 152, 0, 0.4)';
    ctx.shadowBlur = 6;

    for (let x = 0; x < width; x++) {
      const angle = (x / width) * (Math.PI * 2 * cycles) + state.scopePhase;
      const y = centerY - Math.sin(angle) * vAmpPixels;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = COLORS.voltage;
    ctx.font = 'bold 11px JetBrains Mono';
    ctx.fillText(vPeak > 0 ? `CH1: VOLTAGE SINE [${vPeak.toFixed(1)}Vpk]` : `CH1: VOLTAGE SINE [WAITING FOR ESP32]`, 12, 22);
  }

  // 4. Draw Current Sine Wave
  if (chan === 'dual' || chan === 'current') {
    ctx.save();
    ctx.beginPath();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = COLORS.current;
    ctx.shadowColor = 'rgba(0, 242, 254, 0.4)';
    ctx.shadowBlur = 6;

    for (let x = 0; x < width; x++) {
      const angle = (x / width) * (Math.PI * 2 * cycles) + state.scopePhase - phaseShift;
      const y = centerY - Math.sin(angle) * iAmpPixels;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();

    const yPos = (chan === 'dual') ? 38 : 22;
    ctx.fillStyle = COLORS.current;
    ctx.font = 'bold 11px JetBrains Mono';
    ctx.fillText(iPeak > 0 ? `CH2: CURRENT SINE [${iPeak.toFixed(2)}Apk]` : `CH2: CURRENT SINE [0.00Apk]`, 12, yPos);
  }

  // 5. Draw Instantaneous Power Wave
  if (chan === 'power') {
    ctx.save();
    ctx.beginPath();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = COLORS.power;
    ctx.shadowColor = 'rgba(0, 230, 118, 0.4)';
    ctx.shadowBlur = 6;

    const pPeak = vPeak * iPeak;
    const pAmpPixels = (pPeak / (maxVScale * maxIScale * 0.4)) * (centerY * 0.8);

    for (let x = 0; x < width; x++) {
      const vAngle = (x / width) * (Math.PI * 2 * cycles) + state.scopePhase;
      const iAngle = vAngle - phaseShift;
      const instantaneous = Math.sin(vAngle) * Math.sin(iAngle);
      const y = centerY - instantaneous * pAmpPixels;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = COLORS.power;
    ctx.font = 'bold 11px JetBrains Mono';
    ctx.fillText(`CH3: INSTANTANEOUS POWER WAVE [${state.pWatts.toFixed(0)}W]`, 12, 22);
  }
}

function updateScopeHud() {
  const elVp = document.getElementById('hudVpeak');
  const elVpp = document.getElementById('hudVpp');
  const elIp = document.getElementById('hudIpeak');
  const elT = document.getElementById('hudPeriod');
  const elPh = document.getElementById('hudPhase');

  if (state.vRms === 0 && state.iRms === 0) {
    if (elVp) elVp.textContent = `0.0 V`;
    if (elVpp) elVpp.textContent = `0.0 V`;
    if (elIp) elIp.textContent = `0.00 A`;
    if (elT) elT.textContent = `-- ms`;
    if (elPh) elPh.textContent = `--`;
    return;
  }

  const vPeak = state.vRms * Math.SQRT2;
  const vPp = vPeak * 2;
  const iPeak = state.iRms * Math.SQRT2;
  const periodMs = (1000 / (state.freq || 50)).toFixed(2);
  const phaseDeg = (Math.acos(Math.min(1.0, Math.max(0.0, state.pf))) * (180 / Math.PI)).toFixed(1);

  if (elVp) elVp.textContent = `±${vPeak.toFixed(1)} V`;
  if (elVpp) elVpp.textContent = `${vPp.toFixed(1)} V`;
  if (elIp) elIp.textContent = `±${iPeak.toFixed(2)} A`;
  if (elT) elT.textContent = `${periodMs} ms`;
  if (elPh) elPh.textContent = `${phaseDeg}° (${state.pf >= 0.99 ? 'In Phase' : 'Lagging'})`;
}

// Controls for Oscilloscope
function setWaveformMode(mode) {
  state.waveformDisplayMode = mode;
  const btnSine = document.getElementById('btnScopeSine');
  const btnTrend = document.getElementById('btnScopeTrend');
  const scopeCanvas = document.getElementById('scopeCanvas');
  const liveChart = document.getElementById('liveChart');
  const cycleGroup = document.getElementById('cycleBtnGroup');
  const trendGroup = document.getElementById('trendWindowGroup');
  const badge = document.getElementById('scopeModeBadge');

  if (mode === 'sine') {
    if (btnSine) btnSine.classList.add('active');
    if (btnTrend) btnTrend.classList.remove('active');
    if (scopeCanvas) scopeCanvas.style.display = 'block';
    if (liveChart) liveChart.style.display = 'none';
    if (cycleGroup) cycleGroup.style.display = 'inline-flex';
    if (trendGroup) trendGroup.style.display = 'none';
    if (badge) badge.textContent = 'PURE AC SINE (50 Hz)';
    drawOscilloscope();
  } else {
    if (btnSine) btnSine.classList.remove('active');
    if (btnTrend) btnTrend.classList.add('active');
    if (scopeCanvas) scopeCanvas.style.display = 'none';
    if (liveChart) liveChart.style.display = 'block';
    if (cycleGroup) cycleGroup.style.display = 'none';
    if (trendGroup) trendGroup.style.display = 'inline-flex';
    if (badge) badge.textContent = 'RMS ROLLING TREND';
    if (state.liveChart) state.liveChart.update('none');
  }
}

function setScopeChannel(channel) {
  state.activeWaveformChannel = channel;
  const btns = {
    dual: document.getElementById('btnChanDual'),
    voltage: document.getElementById('btnChanV'),
    current: document.getElementById('btnChanI'),
    power: document.getElementById('btnChanP')
  };
  Object.keys(btns).forEach(k => {
    if (btns[k]) btns[k].classList.toggle('active', k === channel);
  });
  drawOscilloscope();
}

function setScopeCycles(cycles, btn) {
  state.scopeCycles = cycles;
  if (btn && btn.parentElement) {
    btn.parentElement.querySelectorAll('.btn-sm').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  }
  drawOscilloscope();
}

function setWindowTime(seconds, btn) {
  state.windowTimeSec = seconds;
  if (btn && btn.parentElement) {
    btn.parentElement.querySelectorAll('.btn-sm').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  }
}

function toggleWaveformPause() {
  state.isWaveformPaused = !state.isWaveformPaused;
  const btn = document.getElementById('pauseBtn');
  if (btn) {
    btn.innerHTML = state.isWaveformPaused 
      ? `<i data-lucide="play"></i> Resume` 
      : `<i data-lucide="pause"></i> Pause`;
    if (window.lucide) lucide.createIcons();
  }
}

// ----------------------------------------------------
// 3. INDEXEDDB STORAGE ENGINE
// ----------------------------------------------------
function initIndexedDB(callback) {
  const request = indexedDB.open('PulseIoT_EnergyDB', 1);

  request.onupgradeneeded = (e) => {
    const db = e.target.result;
    if (!db.objectStoreNames.contains('telemetry')) {
      const store = db.createObjectStore('telemetry', { keyPath: 'id', autoIncrement: true });
      store.createIndex('timestamp', 'timestamp', { unique: false });
    }
  };

  request.onsuccess = (e) => {
    state.db = e.target.result;
    // Wipe legacy sample data so database starts completely clean
    try {
      const transaction = state.db.transaction(['telemetry'], 'readwrite');
      transaction.objectStore('telemetry').clear();
    } catch (e) {}
    updateStorageProgress();
    if (callback) callback();
  };

  request.onerror = (err) => {
    console.error('IndexedDB error:', err);
    if (callback) callback();
  };
}

function saveTelemetryRecord(data) {
  if (!state.db) return;
  const transaction = state.db.transaction(['telemetry'], 'readwrite');
  transaction.objectStore('telemetry').add(data);
  updateStorageProgress();
}

function purgeOldRecords() {
  if (!state.db) return;
  const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
  const transaction = state.db.transaction(['telemetry'], 'readwrite');
  const store = transaction.objectStore('telemetry');
  const index = store.index('timestamp');
  const range = IDBKeyRange.upperBound(sevenDaysAgo);

  index.openCursor(range).onsuccess = (e) => {
    const cursor = e.target.result;
    if (cursor) {
      cursor.delete();
      cursor.continue();
    }
  };
}

function updateStorageProgress() {
  if (!state.db) return;
  const transaction = state.db.transaction(['telemetry'], 'readonly');
  transaction.objectStore('telemetry').count().onsuccess = (e) => {
    const count = e.target.result;
    const txt = `${count.toLocaleString()} pts archived | Retention: 7 Days (Auto-Purging)`;
    const el = document.getElementById('storageCountText');
    const bar = document.getElementById('storageProgressBar');
    if (el) el.textContent = txt;
    if (bar) bar.style.width = `${Math.min(100, Math.max(5, (count / 4000) * 100)).toFixed(1)}%`;
  };
}

// ----------------------------------------------------
// 4. CHART.JS TREND & HISTORY CHARTS
// ----------------------------------------------------
function initLiveChart() {
  const ctx = document.getElementById('liveChart');
  if (!ctx) return;
  
  state.liveChart = new Chart(ctx.getContext('2d'), {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          label: 'Voltage (V)',
          data: [],
          borderColor: '#ff9800',
          backgroundColor: 'rgba(255, 152, 0, 0.08)',
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.3,
          fill: true,
          yAxisID: 'yVoltage'
        },
        {
          label: 'Current (A)',
          data: [],
          borderColor: '#00f2fe',
          backgroundColor: 'rgba(0, 242, 254, 0.05)',
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.3,
          fill: false,
          yAxisID: 'yCurrent'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      scales: {
        x: {
          grid: { color: 'rgba(255, 255, 255, 0.05)' },
          ticks: {
            color: '#64748b',
            font: { family: 'JetBrains Mono', size: 10 },
            maxTicksLimit: 6,
            maxRotation: 0,
            autoSkip: true
          }
        },
        yVoltage: {
          type: 'linear', position: 'left', min: 180, max: 270,
          ticks: { color: '#ff9800' }
        },
        yCurrent: {
          type: 'linear', position: 'right', min: 0, max: 20,
          ticks: { color: '#00f2fe' }, grid: { drawOnChartArea: false }
        }
      }
    }
  });
}

function initHistoryChart() {
  const ctx = document.getElementById('historyChart');
  if (!ctx) return;
  
  state.historyChart = new Chart(ctx.getContext('2d'), {
    type: 'line',
    data: {
      labels: [],
      datasets: [{
        label: 'Active Power (Watts)',
        data: [],
        borderColor: '#00e676',
        backgroundColor: 'rgba(0, 230, 118, 0.12)',
        borderWidth: 2,
        fill: true,
        tension: 0.35
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          grid: { color: 'rgba(255, 255, 255, 0.05)' },
          ticks: {
            color: '#64748b',
            font: { family: 'JetBrains Mono', size: 10 },
            maxTicksLimit: 6,
            maxRotation: 0,
            autoSkip: true
          }
        },
        y: { ticks: { color: '#00e676' } }
      }
    }
  });

  fetchHistoryRange('7d');
}

// ----------------------------------------------------
// 5. LIVE TELEMETRY DOM UPDATE
// ----------------------------------------------------
function pushTelemetryToUI(data) {
  state.vRms = data.voltage;
  state.iRms = data.current;
  state.pWatts = data.power;
  state.freq = data.frequency;
  state.pf = data.pf;

  // DOM elements update
  const elV = document.getElementById('valVoltage');
  const elVs = document.getElementById('valVoltageSub');
  const elI = document.getElementById('valCurrent');
  const elIp = document.getElementById('valCurrentPeak');
  const elP = document.getElementById('valPower');
  const elAp = document.getElementById('valApparentPower');
  const elE = document.getElementById('valEnergy');
  const elEw = document.getElementById('valEnergyWh');
  const elF = document.getElementById('valFreq');
  const elPf = document.getElementById('valPF');
  const elPfp = document.getElementById('valPFPct');

  if (elV) elV.textContent = data.voltage.toFixed(1);
  if (elVs) elVs.textContent = data.frequency.toFixed(1);
  if (elI) elI.textContent = data.current.toFixed(2);
  
  if (data.current > state.peakCurrent) {
    state.peakCurrent = data.current;
    if (elIp) elIp.textContent = state.peakCurrent.toFixed(2);
  }

  if (elP) elP.textContent = data.power.toFixed(1);
  if (elAp) elAp.textContent = (data.voltage * data.current).toFixed(0);
  if (elE) elE.textContent = (data.energy / 1000).toFixed(3);
  if (elEw) elEw.textContent = data.energy.toFixed(1);
  if (elF) elF.textContent = data.frequency.toFixed(1);
  if (elPf) elPf.textContent = data.pf.toFixed(2);
  if (elPfp) elPfp.textContent = Math.round(data.pf * 100);

  updateScopeHud();

  // Chart update: Strictly retain ONLY the last 15 seconds
  if (state.liveChart && state.waveformDisplayMode === 'trend') {
    const now = data.timestamp;
    const cutoff = now - (15 * 1000); // exactly 15 seconds
    const timestampStr = new Date(now).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });

    state.liveDataBuffer.push({
      timestamp: now,
      timeStr: timestampStr,
      voltage: data.voltage,
      current: data.current
    });

    // Drop any data older than past 15 seconds
    while (state.liveDataBuffer.length > 0 && state.liveDataBuffer[0].timestamp < cutoff) {
      state.liveDataBuffer.shift();
    }

    state.liveChart.data.labels = state.liveDataBuffer.map(d => d.timeStr);
    state.liveChart.data.datasets[0].data = state.liveDataBuffer.map(d => d.voltage);
    state.liveChart.data.datasets[1].data = state.liveDataBuffer.map(d => d.current);
    state.liveChart.update('none');
  }

  saveTelemetryRecord(data);
}

// ----------------------------------------------------
// 6. WEBSOCKET ENGINE (REAL ESP32 TELEMETRY ONLY)
// ----------------------------------------------------
function attemptWebSocketConnection() {
  const wsUrl = `ws://${window.location.host || 'localhost:3000'}`;
  try {
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      state.wsConnected = true;
      const b = document.getElementById('connectionBadge');
      const t = document.getElementById('connectionText');
      if (b) b.className = 'badge badge-success';
      if (t) t.textContent = 'WSS LIVE (CONNECTED)';
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        const data = msg.data || msg;
        if (data.voltage !== undefined) {
          state.isSimulating = false; // Real hardware detected!
          const simBadge = document.getElementById('simBadge');
          const simText = document.getElementById('simText');
          if (simBadge) simBadge.className = 'badge';
          if (simText) simText.textContent = 'ESP32 HARDWARE LIVE';
          pushTelemetryToUI(data);
        }
      } catch (err) {
        console.error('Error parsing WS message:', err);
      }
    };

    ws.onclose = () => {
      state.wsConnected = false;
      setTimeout(attemptWebSocketConnection, 3000);
    };
  } catch (e) {
    console.log('Running in local mode');
  }
}

// ----------------------------------------------------
// 7. HISTORY & DATA AGGREGATION
// ----------------------------------------------------
async function fetchHistoryRange(rangeStr, btnElement) {
  if (btnElement && btnElement.parentElement) {
    btnElement.parentElement.querySelectorAll('.btn-sm').forEach(b => b.classList.remove('active'));
    btnElement.classList.add('active');
  }

  try {
    const res = await fetch(`/api/history?range=${rangeStr}`);
    if (res.ok) {
      const json = await res.json();
      if (json.data && json.data.length > 0) {
        renderHistoryRecords(json.data);
        return;
      }
    }
  } catch (e) {
    console.log('Fetching from local IndexedDB...');
  }

  if (!state.db) return;
  let days = 7;
  if (rangeStr === '1d') days = 1;
  if (rangeStr === '3d') days = 3;

  const startTime = Date.now() - (days * 24 * 60 * 60 * 1000);
  const transaction = state.db.transaction(['telemetry'], 'readonly');
  const index = transaction.objectStore('telemetry').index('timestamp');

  index.getAll(IDBKeyRange.lowerBound(startTime)).onsuccess = (e) => {
    renderHistoryRecords(e.target.result);
  };
}

function renderHistoryRecords(records) {
  if (!records || records.length === 0 || !state.historyChart) return;

  const sampled = records.filter((_, idx) => idx % Math.max(1, Math.floor(records.length / 80)) === 0);
  const labels = sampled.map(r => {
    const d = new Date(r.timestamp);
    return `${d.getMonth() + 1}/${d.getDate()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  });

  state.historyChart.data.labels = labels;
  state.historyChart.data.datasets[0].data = sampled.map(r => r.power);
  state.historyChart.update();

  const powers = records.map(r => r.power);
  const currents = records.map(r => r.current);
  const voltages = records.map(r => r.voltage);

  const maxPower = Math.max(...powers);
  const avgCurrent = (currents.reduce((a, b) => a + b, 0) / currents.length).toFixed(2);
  const totalEnergy = Math.max(1, ((records[records.length - 1].energy - records[0].energy) / 1000)).toFixed(1);
  const minVolt = Math.min(...voltages).toFixed(0);
  const maxVolt = Math.max(...voltages).toFixed(0);

  const elP = document.getElementById('histPeakPower');
  const elI = document.getElementById('histAvgCurrent');
  const elE = document.getElementById('histTotalEnergy');
  const elV = document.getElementById('histVoltRange');

  if (elP) elP.textContent = Math.round(maxPower).toLocaleString();
  if (elI) elI.textContent = avgCurrent;
  if (elE) elE.textContent = totalEnergy;
  if (elV) elV.textContent = `${minVolt} - ${maxVolt}`;
}

function clearHistoryData() {
  if (!confirm('Are you sure you want to clear stored telemetry history?')) return;
  const transaction = state.db.transaction(['telemetry'], 'readwrite');
  transaction.objectStore('telemetry').clear().onsuccess = () => {
    alert('Database history cleared.');
    fetchHistoryRange('7d');
    updateStorageProgress();
  };
}

// ----------------------------------------------------
// 8. EXPORT UTILITIES & CODE COPY
// ----------------------------------------------------
function exportDataCSV() {
  if (!state.db) return;
  const transaction = state.db.transaction(['telemetry'], 'readonly');
  transaction.objectStore('telemetry').getAll().onsuccess = (e) => {
    const data = e.target.result;
    if (!data || data.length === 0) {
      alert('No data available to export.');
      return;
    }

    let csv = 'Timestamp,ISO_Date,Voltage_V,Current_A,Power_W,Energy_Wh,Frequency_Hz,PowerFactor\n';
    data.forEach(r => {
      csv += `${r.timestamp},${new Date(r.timestamp).toISOString()},${r.voltage},${r.current},${r.power},${r.energy},${r.frequency},${r.pf}\n`;
    });

    const link = document.createElement('a');
    link.href = 'data:text/csv;charset=utf-8,' + encodeURI(csv);
    link.download = `ESP32_Energy_Telemetry_${Date.now()}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };
}

function exportDataJSON() {
  if (!state.db) return;
  const transaction = state.db.transaction(['telemetry'], 'readonly');
  transaction.objectStore('telemetry').getAll().onsuccess = (e) => {
    const data = e.target.result;
    const link = document.createElement('a');
    link.href = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(data, null, 2));
    link.download = `ESP32_Energy_Telemetry_${Date.now()}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };
}

function copyCode(elementId) {
  const codeText = document.getElementById(elementId).innerText;
  navigator.clipboard.writeText(codeText).then(() => {
    alert('Code copied to clipboard!');
  });
}
