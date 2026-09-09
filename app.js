// app.js - Professional Real-Time Energy Monitor Client
let currentTheme = localStorage.getItem('theme') || 'dark';
document.documentElement.setAttribute('data-theme', currentTheme);

function updateThemeUI() {
  const icon = document.getElementById('themeIcon');
  const label = document.getElementById('themeLabel');
  if (currentTheme === 'dark') {
    if (icon) icon.textContent = '☀️';
    if (label) label.textContent = 'Light Mode';
  } else {
    if (icon) icon.textContent = '🌙';
    if (label) label.textContent = 'Dark Mode';
  }
}
updateThemeUI();

function toggleTheme() {
  currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', currentTheme);
  localStorage.setItem('theme', currentTheme);
  updateThemeUI();
  updateChartColors();
}

// Global State
let currentChannel = 'voltage';
let timeWindowSec = 15;
let isPaused = false;
let historyRange = '7d';
let historyField = 'voltage';

let waveformData = []; // [{timestamp, voltage, current, power}]
let liveChart = null;
let historyChart = null;
let lastSeenTime = Date.now();

// Channel configuration
const channelCfg = {
  voltage: { label: 'Voltage', unit: 'V', color: '#00f2fe', max: 260, min: 200 },
  current: { label: 'Current', unit: 'A', color: '#3b82f6', max: 10, min: 0 },
  power: { label: 'Power', unit: 'W', color: '#ff9800', max: 2500, min: 0 },
  frequency: { label: 'Frequency', unit: 'Hz', color: '#00e676', max: 55, min: 45 }
};

// Initialize Chart.js Real-time Waveform
function initLiveChart() {
  const ctx = document.getElementById('liveWaveformChart');
  if (!ctx) return;

  const isDark = currentTheme === 'dark';
  const gridColor = isDark ? 'rgba(36, 52, 84, 0.4)' : 'rgba(203, 213, 225, 0.6)';
  const textColor = isDark ? '#94a3b8' : '#475569';

  liveChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [{
        label: 'Voltage (V)',
        data: [],
        borderColor: '#00f2fe',
        backgroundColor: 'rgba(0, 242, 254, 0.1)',
        borderWidth: 2.5,
        tension: 0.35,
        pointRadius: 0,
        fill: true
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: {
        mode: 'index',
        intersect: false
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: isDark ? '#131b2e' : '#ffffff',
          titleColor: isDark ? '#f1f5f9' : '#0f172a',
          bodyColor: isDark ? '#f1f5f9' : '#0f172a',
          borderColor: isDark ? '#243454' : '#cbd5e1',
          borderWidth: 1,
          displayColors: false,
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${ctx.raw} ${channelCfg[currentChannel].unit}`
          }
        }
      },
      scales: {
        x: {
          grid: { color: gridColor, drawBorder: false },
          ticks: { color: textColor, font: { family: 'JetBrains Mono', size: 10 }, maxTicksLimit: 8 }
        },
        y: {
          grid: { color: gridColor, drawBorder: false },
          ticks: { color: textColor, font: { family: 'JetBrains Mono', size: 10 } }
        }
      }
    }
  });
}

// Initialize 7-Day History Chart
function initHistoryChart() {
  const ctx = document.getElementById('historyChart');
  if (!ctx) return;

  const isDark = currentTheme === 'dark';
  const gridColor = isDark ? 'rgba(36, 52, 84, 0.4)' : 'rgba(203, 213, 225, 0.6)';
  const textColor = isDark ? '#94a3b8' : '#475569';

  historyChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [{
        label: 'Historical Data',
        data: [],
        borderColor: '#00e676',
        backgroundColor: 'rgba(0, 230, 118, 0.1)',
        borderWidth: 2,
        tension: 0.3,
        pointRadius: 2,
        fill: true
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: isDark ? '#131b2e' : '#ffffff',
          titleColor: isDark ? '#f1f5f9' : '#0f172a',
          bodyColor: isDark ? '#f1f5f9' : '#0f172a',
          borderColor: isDark ? '#243454' : '#cbd5e1',
          borderWidth: 1
        }
      },
      scales: {
        x: {
          grid: { color: gridColor },
          ticks: { color: textColor, font: { family: 'JetBrains Mono', size: 10 }, maxTicksLimit: 10 }
        },
        y: {
          grid: { color: gridColor },
          ticks: { color: textColor, font: { family: 'JetBrains Mono', size: 10 } }
        }
      }
    }
  });
}

function updateChartColors() {
  const isDark = currentTheme === 'dark';
  const gridColor = isDark ? 'rgba(36, 52, 84, 0.4)' : 'rgba(203, 213, 225, 0.6)';
  const textColor = isDark ? '#94a3b8' : '#475569';

  if (liveChart) {
    liveChart.options.scales.x.grid.color = gridColor;
    liveChart.options.scales.x.ticks.color = textColor;
    liveChart.options.scales.y.grid.color = gridColor;
    liveChart.options.scales.y.ticks.color = textColor;
    liveChart.update('none');
  }
  if (historyChart) {
    historyChart.options.scales.x.grid.color = gridColor;
    historyChart.options.scales.x.ticks.color = textColor;
    historyChart.options.scales.y.grid.color = gridColor;
    historyChart.options.scales.y.ticks.color = textColor;
    historyChart.update('none');
  }
}

// Waveform Controls
function setWaveformChannel(chan, btn) {
  currentChannel = chan;
  if (btn && btn.parentElement) {
    btn.parentElement.querySelectorAll('button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  }
  if (liveChart) {
    liveChart.data.datasets[0].label = channelCfg[chan].label;
    liveChart.data.datasets[0].borderColor = channelCfg[chan].color;
    liveChart.data.datasets[0].backgroundColor = `${channelCfg[chan].color}22`;
  }
}

function setScopeWindow(sec, btn) {
  timeWindowSec = sec;
  if (btn && btn.parentElement) {
    btn.parentElement.querySelectorAll('button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  }
}

function toggleWaveformPause() {
  isPaused = !isPaused;
  const btn = document.getElementById('pauseBtn');
  if (btn) {
    btn.innerHTML = isPaused ? '<i data-lucide="play"></i> <span>Resume</span>' : '<i data-lucide="pause"></i> <span>Pause</span>';
    lucide.createIcons();
  }
}

// History Controls
function loadHistoryRange(range, btn) {
  historyRange = range;
  if (btn && btn.parentElement) {
    btn.parentElement.querySelectorAll('button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  }
  fetchHistoryData();
}

function setHistoryField(field, btn) {
  historyField = field;
  if (btn && btn.parentElement) {
    btn.parentElement.querySelectorAll('button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  }
  fetchHistoryData();
}

function fetchHistoryData() {
  const deviceId = 'ESP32-001';
  Promise.all([
    fetch(`/api/devices/${deviceId}/history?range=${historyRange}&field=${historyField}`).then(r => r.json()),
    fetch(`/api/devices/${deviceId}/statistics?range=${historyRange}&field=${historyField}`).then(r => r.json())
  ]).then(([historyRes, statsRes]) => {
    if (historyRes && historyRes.data && historyChart) {
      const labels = historyRes.data.map(pt => {
        const d = new Date(pt.timestamp);
        return `${d.getMonth()+1}/${d.getDate()} ${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
      });
      const values = historyRes.data.map(pt => pt.value);
      const cfg = channelCfg[historyField] || channelCfg.voltage;

      historyChart.data.labels = labels;
      historyChart.data.datasets[0].data = values;
      historyChart.data.datasets[0].label = `${cfg.label} (${cfg.unit})`;
      historyChart.data.datasets[0].borderColor = cfg.color;
      historyChart.data.datasets[0].backgroundColor = `${cfg.color}15`;
      historyChart.update();
    }

    if (statsRes) {
      const unit = (channelCfg[historyField] || channelCfg.voltage).unit;
      const c = document.getElementById('statCurrent');
      const min = document.getElementById('statMin');
      const max = document.getElementById('statMax');
      const avg = document.getElementById('statAvg');
      if (c) c.textContent = `${statsRes.current} ${unit}`;
      if (min) min.textContent = `${statsRes.min} ${unit}`;
      if (max) max.textContent = `${statsRes.max} ${unit}`;
      if (avg) avg.textContent = `${statsRes.avg} ${unit}`;
    }
  }).catch(err => console.error('Error fetching history:', err));
}

function exportHistoricalCSV() {
  window.location.href = `/api/devices/ESP32-001/export?range=${historyRange}`;
}

// WebSocket Telemetry Connection
function setupWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws`;
  const socket = new WebSocket(wsUrl);

  socket.onopen = () => {
    console.log('[WebSocket] Connected to', wsUrl);
    updateStatusBadge('ONLINE');
  };

  socket.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'telemetry') {
        lastSeenTime = Date.now();
        const data = msg.data;

        // 1. Update 4 Cards
        const v = document.getElementById('valVoltage');
        const c = document.getElementById('valCurrent');
        const p = document.getElementById('valPower');
        const f = document.getElementById('valFreq');
        if (v) v.textContent = data.voltage.toFixed(1);
        if (c) c.textContent = data.current.toFixed(2);
        if (p) p.textContent = data.power.toFixed(1);
        if (f) f.textContent = data.frequency.toFixed(1);

        // 2. Append to rolling waveform buffer
        if (!isPaused) {
          waveformData.push({
            timestamp: msg.timestamp,
            time: new Date(msg.timestamp).toTimeString().split(' ')[0],
            voltage: data.voltage,
            current: data.current,
            power: data.power
          });

          // Trim to max 150 points (~75s)
          if (waveformData.length > 150) {
            waveformData.shift();
          }

          // Filter by selected window (15s, 30s, 60s)
          const cutoff = msg.timestamp - (timeWindowSec * 1000);
          const windowed = waveformData.filter(pt => pt.timestamp >= cutoff);

          if (liveChart) {
            liveChart.data.labels = windowed.map(pt => pt.time);
            liveChart.data.datasets[0].data = windowed.map(pt => pt[currentChannel]);
            liveChart.update('none');
          }
        }

        // 3. Update footer
        const footerRssi = document.getElementById('footerRssi');
        if (footerRssi && data.rssi !== undefined) {
          footerRssi.textContent = `${data.rssi} dBm`;
        }
      }
    } catch (e) {
      // ignore
    }
  };

  socket.onclose = () => {
    console.warn('[WebSocket] Disconnected. Reconnecting in 3s...');
    updateStatusBadge('RECONNECTING');
    setTimeout(setupWebSocket, 3000);
  };
}

function updateStatusBadge(status) {
  const badge = document.getElementById('connectionBadge');
  const txt = document.getElementById('connectionText');
  const footerTxt = document.getElementById('footerStatusText');
  const footerDot = document.getElementById('footerDot');

  if (status === 'ONLINE') {
    if (badge) badge.className = 'badge badge-success';
    if (txt) txt.textContent = 'ONLINE';
    if (footerTxt) { footerTxt.textContent = 'ONLINE'; footerTxt.style.color = 'var(--accent-green)'; }
    if (footerDot) footerDot.style.background = '#00e676';
  } else {
    if (badge) badge.className = 'badge badge-sim';
    if (txt) txt.textContent = 'RECONNECTING...';
    if (footerTxt) { footerTxt.textContent = 'RECONNECTING'; footerTxt.style.color = 'var(--accent-orange)'; }
    if (footerDot) footerDot.style.background = '#ff9800';
  }
}

// Timer for last seen delta ticker
setInterval(() => {
  const elapsed = (Date.now() - lastSeenTime) / 1000;
  const deltaStr = elapsed < 1 ? `${Math.round(elapsed * 10)}00ms` : `${elapsed.toFixed(1)}s`;
  const liveTime = document.getElementById('liveTime');
  const footerLastData = document.getElementById('footerLastData');
  if (liveTime) liveTime.textContent = `Last: ${deltaStr}`;
  if (footerLastData) footerLastData.textContent = deltaStr;

  if (elapsed > 15) {
    updateStatusBadge('OFFLINE');
  }
}, 200);

// Init on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  lucide.createIcons();
  initLiveChart();
  initHistoryChart();
  fetchHistoryData();
  setupWebSocket();
});
