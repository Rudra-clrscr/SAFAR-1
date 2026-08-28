(() => {
  let userMap;
  let userMarker;
  let zoneCache = [];
  let syncTimer = null;
  let currentPosition = null;

  const body = document.body;
  const isPreview = body.dataset.preview === 'true';
  const touristId = body.dataset.touristId || '';
  const dom = {
    gpsStatus: document.getElementById('gps-status'),
    zoneCount: document.getElementById('zone-count'),
    lastLocation: document.getElementById('last-location'),
    lastSync: document.getElementById('last-sync'),
    heroSync: document.getElementById('hero-sync'),
    heroMode: document.getElementById('hero-mode'),
    heroScore: document.getElementById('hero-score'),
    scoreRing: document.getElementById('score-ring'),
    scoreNum: document.getElementById('score-num'),
    responseState: document.getElementById('response-state'),
    panicButton: document.getElementById('panic-btn'),
    iotMode: document.getElementById('iot-mode'),
    blynkToken: document.getElementById('blynk-token'),
    zoneList: document.getElementById('garuda-zone-list'),
    mapContainer: document.getElementById('userMap'),
  };

  const COPY = {
    en: {
      gpsInitializing: 'Initializing GPS link...',
      gpsUnsupported: 'Geolocation not supported',
      gpsDenied: 'GPS permission denied',
      gpsActive: 'GPS active',
      gpsFailed: 'Location sync failed',
      navReady: 'Ready',
      navLoading: 'Planning route...',
      navNeedDestination: 'Enter a destination to begin navigation.',
      navNeedLocation: 'Your current location is not available yet.',
      navFailed: 'Unable to load navigation right now.',
      navPreviewFallback: 'Route preview is ready, but live navigation could not be loaded. Open the external map link below to continue.',
      navOpenMap: 'Open in Google Maps',
      navStepsEmpty: 'Turn-by-turn guidance will appear here once a route is found.',
      firstSyncPending: 'Awaiting first sync',
      liveCoordinatesPending: 'Awaiting live coordinates',
      responseReady: 'Response Ready',
      panicTriggered: 'Panic Triggered',
      mobileMode: 'Mobile',
      iotMode: 'IoT',
      zoneScore: 'Safety score',
      zoneRadius: 'Radius',
      zoneSafe: 'Low Risk',
      zoneWatch: 'Watch Zone',
      zoneRisk: 'High Risk',
      zoneEmpty: 'No monitored zones available.',
      myLocation: 'Your location',
      confirmPanic: 'Send a panic alert to authorities? This will set your safety score to 0.',
      panicSent: 'Panic alert sent. Authorities have been notified.',
      panicHardware: 'Hardware SOS detected. Authorities have been notified.',
      panicFailed: 'Failed to send panic alert.',
      networkError: 'Network error.',
      iotTokenRequired: 'Please enter a Blynk token to enable IoT mode.',
      iotUpdated: 'IoT configuration updated. Cloud sync is active.',
      iotUpdateFailed: 'Unable to update IoT configuration.',
      connectionError: 'Connection error.',
      previewPanic: 'Preview mode: panic flow simulated locally.',
      previewIot: 'Preview mode: IoT settings updated locally.',
      previewGps: 'Preview mode active',
    },
    hi: {
      gpsInitializing: 'GPS लिंक प्रारंभ हो रही है...',
      gpsUnsupported: 'जियोलोकेशन समर्थित नहीं है',
      gpsDenied: 'GPS अनुमति अस्वीकृत',
      gpsActive: 'GPS सक्रिय',
      gpsFailed: 'स्थान सिंक विफल',
      firstSyncPending: 'पहले सिंक की प्रतीक्षा है',
      liveCoordinatesPending: 'लाइव लोकेशन की प्रतीक्षा है',
      responseReady: 'प्रतिक्रिया तैयार',
      panicTriggered: 'पैनिक सक्रिय',
      mobileMode: 'मोबाइल',
      iotMode: 'IoT',
      zoneScore: 'सुरक्षा स्कोर',
      zoneRadius: 'त्रिज्या',
      zoneSafe: 'कम जोखिम',
      zoneWatch: 'निगरानी क्षेत्र',
      zoneRisk: 'उच्च जोखिम',
      zoneEmpty: 'कोई निगरानी क्षेत्र उपलब्ध नहीं है।',
      myLocation: 'आपका स्थान',
      confirmPanic: 'क्या आप अधिकारियों को पैनिक अलर्ट भेजना चाहते हैं? इससे आपका सुरक्षा स्कोर 0 हो जाएगा।',
      panicSent: 'पैनिक अलर्ट भेज दिया गया है। अधिकारियों को सूचित कर दिया गया है।',
      panicHardware: 'हार्डवेयर SOS मिला। अधिकारियों को सूचित कर दिया गया है।',
      panicFailed: 'पैनिक अलर्ट भेजा नहीं जा सका।',
      networkError: 'नेटवर्क त्रुटि।',
      iotTokenRequired: 'IoT मोड सक्षम करने के लिए Blynk टोकन दर्ज करें।',
      iotUpdated: 'IoT कॉन्फ़िगरेशन अपडेट हो गया। क्लाउड सिंक सक्रिय है।',
      iotUpdateFailed: 'IoT कॉन्फ़िगरेशन अपडेट नहीं हो सका।',
      connectionError: 'कनेक्शन त्रुटि।',
    },
    sa: {
      gpsInitializing: 'GPS संयोजनम् आरभ्यते...',
      gpsUnsupported: 'भौगोलिक-स्थान-समर्थनं नास्ति',
      gpsDenied: 'GPS अनुमतिः न दत्ता',
      gpsActive: 'GPS सक्रियम्',
      gpsFailed: 'स्थान-साम्यीकरणं विफलम्',
      firstSyncPending: 'प्रथम-साम्यीकरणस्य प्रतीक्षा अस्ति',
      liveCoordinatesPending: 'जीवन्मान-स्थानस्य प्रतीक्षा अस्ति',
      responseReady: 'प्रत्युत्तरम् सज्जम्',
      panicTriggered: 'आपत्सूचना सक्रियता',
      mobileMode: 'मोबाइल',
      iotMode: 'IoT',
      zoneScore: 'सुरक्षा-सङ्केतः',
      zoneRadius: 'परिधिः',
      zoneSafe: 'न्यून-जोखिमः',
      zoneWatch: 'निरीक्षण-क्षेत्रम्',
      zoneRisk: 'उच्च-जोखिमः',
      zoneEmpty: 'कोऽपि निरीक्षण-क्षेत्रः उपलब्धः नास्ति।',
      myLocation: 'भवतः स्थानम्',
      confirmPanic: 'किम् अधिकारिभ्यः आपत्सूचनां प्रेषयितुम् इच्छथ? एतेन सुरक्षा-सङ्केतः 0 भविष्यति।',
      panicSent: 'आपत्सूचना प्रेषिता। अधिकारिणः सूचिताः।',
      panicHardware: 'हार्डवेयर-SOS प्राप्तः। अधिकारिणः सूचिताः।',
      panicFailed: 'आपत्सूचना प्रेषयितुं न अशक्यत।',
      networkError: 'संजाल-दोषः।',
      iotTokenRequired: 'IoT-रीतिं सक्रियीकर्तुं Blynk-टोकनं निवेशयतु।',
      iotUpdated: 'IoT-विन्यासः अद्यतनितः। मेघ-साम्यीकरणं सक्रियम्।',
      iotUpdateFailed: 'IoT-विन्यासः अद्यतनीकर्तुं न अशक्यत।',
      connectionError: 'संयोजन-दोषः।',
    },
  };

  function lang() {
    return COPY[body.dataset.lang] ? body.dataset.lang : 'en';
  }

  function text(key) {
    return COPY[lang()][key] || COPY.en[key] || key;
  }

  function scoreState(score) {
    if (score > 75) return 'high';
    if (score > 40) return 'medium';
    return 'low';
  }

  function responseState(score) {
    return score <= 0 ? 'panic' : 'ready';
  }

  function formatTime(value) {
    return new Intl.DateTimeFormat(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(value);
  }

  function formatLocation(lat, lon) {
    return `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
  }

  function parseLocationText(raw) {
    if (!raw) return null;
    const match = String(raw).match(/([-+]?\d+(?:\.\d+)?)\s*,\s*([-+]?\d+(?:\.\d+)?)/);
    if (!match) return null;

    const latitude = Number.parseFloat(match[1]);
    const longitude = Number.parseFloat(match[2]);
    if (Number.isNaN(latitude) || Number.isNaN(longitude)) return null;
    return { latitude, longitude };
  }

  function formatRadius(radius) {
    return `${radius} km`;
  }

  function setGPSState(kind, message) {
    if (!dom.gpsStatus) return;
    dom.gpsStatus.textContent = message;
    dom.gpsStatus.className = `garuda-live-pill ${kind}`;
  }

  function updateScore(score) {
    if (dom.scoreNum) dom.scoreNum.textContent = String(score);
    if (dom.heroScore) dom.heroScore.textContent = String(score);
    if (dom.scoreRing) dom.scoreRing.className = `score-ring ${scoreState(score)}`;
    if (dom.responseState) {
      const state = responseState(score);
      dom.responseState.className = `garuda-state-badge ${state}`;
      dom.responseState.textContent = state === 'panic' ? text('panicTriggered') : text('responseReady');
    }
  }

  function updateSyncStamp(value) {
    const stamp = value instanceof Date ? value : new Date(value);
    const formatted = Number.isNaN(stamp.getTime()) ? text('firstSyncPending') : formatTime(stamp);
    if (dom.lastSync) dom.lastSync.textContent = formatted;
    if (dom.heroSync) dom.heroSync.textContent = formatted;
  }

  function updateMode(enabled) {
    if (!dom.heroMode) return;
    dom.heroMode.textContent = enabled ? text('iotMode') : text('mobileMode');
  }

  function renderZones(zones) {
    if (!dom.zoneList) return;
    if (!zones.length) {
      dom.zoneList.innerHTML = `<div class="card garuda-zone-card"><p>${text('zoneEmpty')}</p></div>`;
      return;
    }

    const ranked = [...zones].sort((a, b) => a.regional_score - b.regional_score).slice(0, 6);
    dom.zoneList.innerHTML = ranked.map((zone) => {
      const tone = zone.regional_score > 80 ? 'safe' : zone.regional_score > 45 ? 'watch' : 'risk';
      const toneLabel = tone === 'safe' ? text('zoneSafe') : tone === 'watch' ? text('zoneWatch') : text('zoneRisk');
      return `
        <div class="card garuda-zone-card">
          <h4>${zone.name}</h4>
          <p>${text('zoneRadius')}: ${formatRadius(zone.radius)}</p>
          <p>${text('zoneScore')}: ${zone.regional_score}/100</p>
          <span class="garuda-zone-score ${tone}">${toneLabel}</span>
        </div>
      `;
    }).join('');
  }

  async function fetchZones() {
    const response = await fetch('/api/safety/zones');
    if (!response.ok) return;

    zoneCache = await response.json();
    if (dom.zoneCount) dom.zoneCount.textContent = String(zoneCache.length);
    renderZones(zoneCache);

    if (!userMap) return;
    zoneCache.forEach((zone) => {
      const color = zone.regional_score > 80
        ? '#5ee695'
        : zone.regional_score > 45
          ? '#f0bd74'
          : '#ff7e61';

      L.circle([zone.latitude, zone.longitude], {
        color,
        fillColor: color,
        fillOpacity: 0.14,
        radius: zone.radius * 1000,
      }).addTo(userMap).bindPopup(
        `<strong>${zone.name}</strong><br>${text('zoneScore')}: ${zone.regional_score}/100`,
      );
    });
  }

  function ensureMarker(lat, lon) {
    if (!userMap) return;
    currentPosition = { latitude: lat, longitude: lon };
    if (!userMarker) {
      userMap.setView([lat, lon], 14);
    }

    if (!userMarker) {
      userMarker = L.marker([lat, lon]).addTo(userMap).bindPopup(text('myLocation'));
      return;
    }

    userMarker.setLatLng([lat, lon]);
  }

  async function sendLocation() {
    if (!navigator.geolocation) {
      setGPSState('err', text('gpsUnsupported'));
      return;
    }

    navigator.geolocation.getCurrentPosition(async (position) => {
      const lat = position.coords.latitude;
      const lon = position.coords.longitude;
      const now = new Date();

      ensureMarker(lat, lon);
      if (dom.lastLocation) dom.lastLocation.textContent = formatLocation(lat, lon);
      updateSyncStamp(now);
      setGPSState('ok', `${isPreview ? text('previewGps') : text('gpsActive')} • ${formatTime(now)}`);

      if (isPreview) {
        return;
      }

      try {
        const response = await fetch('/api/safety/update_location', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ latitude: lat, longitude: lon }),
        });

        if (!response.ok) {
          setGPSState('err', text('gpsFailed'));
          return;
        }

        const payload = await response.json();
        updateScore(payload.safety_score);
        updateSyncStamp(new Date());

        if (payload.is_panicking) {
          if (sessionStorage.getItem('panicAlertShown') !== 'true') {
            sessionStorage.setItem('panicAlertShown', 'true');
            alert(text('panicHardware'));
          }
        } else {
          sessionStorage.removeItem('panicAlertShown');
        }
      } catch (_) {
        setGPSState('err', text('gpsFailed'));
      }
    }, () => {
      setGPSState('err', text('gpsDenied'));
    }, { enableHighAccuracy: true });
  }

  async function triggerPanic() {
    if (!window.confirm(text('confirmPanic'))) return;

    if (isPreview) {
      updateScore(0);
      sessionStorage.setItem('panicAlertShown', 'true');
      alert(text('previewPanic'));
      return;
    }

    try {
      const response = await fetch('/api/safety/panic', { method: 'POST' });
      if (!response.ok) {
        alert(text('panicFailed'));
        return;
      }

      updateScore(0);
      sessionStorage.setItem('panicAlertShown', 'true');
      alert(text('panicSent'));
    } catch (_) {
      alert(text('networkError'));
    }
  }

  async function saveIoTConfig() {
    const token = dom.blynkToken ? dom.blynkToken.value.trim() : '';
    const enabled = dom.iotMode ? dom.iotMode.value === 'true' : false;

    if (enabled && !token) {
      alert(text('iotTokenRequired'));
      return;
    }

    if (isPreview) {
      updateMode(enabled);
      body.dataset.iotEnabled = enabled ? 'true' : 'false';
      alert(text('previewIot'));
      return;
    }

    try {
      const response = await fetch('/api/iot/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, enabled }),
      });

      if (!response.ok) {
        alert(text('iotUpdateFailed'));
        return;
      }

      updateMode(enabled);
      body.dataset.iotEnabled = enabled ? 'true' : 'false';
      alert(text('iotUpdated'));
    } catch (_) {
      alert(text('connectionError'));
    }
  }

  function initMap() {
    if (!dom.mapContainer) return;
    userMap = L.map('userMap', { zoomControl: true }).setView([22.9734, 78.6569], 5);
    // CARTO stamps "API KEY REQUIRED" across unauthenticated tiles; OSM is
    // keyless and gets its dark treatment from a CSS filter on the tile pane.
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(userMap);
  }

  function initGarudaCanvas() {
    const canvas = document.getElementById('garuda-sigil-canvas');
    if (!canvas || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const context = canvas.getContext('2d');
    const particles = [];
    let width = 0;
    let height = 0;

    function resize() {
      width = canvas.width = canvas.parentElement?.offsetWidth || window.innerWidth;
      height = canvas.height = canvas.parentElement?.offsetHeight || window.innerHeight;
    }

    function seed() {
      particles.length = 0;
      for (let index = 0; index < 75; index += 1) {
        particles.push({
          x: Math.random() * width,
          y: Math.random() * height,
          size: 1 + Math.random() * 2.8,
          driftX: (Math.random() - 0.5) * 0.45,
          driftY: 0.2 + Math.random() * 0.9,
          hue: [22, 34, 46][Math.floor(Math.random() * 3)],
          alpha: 0.18 + Math.random() * 0.32,
        });
      }
    }

    function draw() {
      context.clearRect(0, 0, width, height);
      particles.forEach((particle) => {
        particle.y += particle.driftY;
        particle.x += particle.driftX;

        if (particle.y > height + 20) particle.y = -10;
        if (particle.x < -20) particle.x = width + 10;
        if (particle.x > width + 20) particle.x = -10;

        context.beginPath();
        context.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
        context.fillStyle = `hsla(${particle.hue}, 100%, 68%, ${particle.alpha})`;
        context.shadowBlur = 18;
        context.shadowColor = `hsla(${particle.hue}, 100%, 65%, ${particle.alpha})`;
        context.fill();
      });

      window.requestAnimationFrame(draw);
    }

    resize();
    seed();
    window.addEventListener('resize', () => {
      resize();
      seed();
    }, { passive: true });
    draw();
  }

  function focusMap() {
    document.getElementById('garuda-operations')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (userMarker && userMap) {
      userMap.flyTo(userMarker.getLatLng(), 14, { duration: 1.2 });
      userMarker.openPopup();
      return;
    }

    sendLocation();
  }

  function scrollToEmergency() {
    document.getElementById('garuda-emergency-panel')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function scrollToIot() {
    document.getElementById('garuda-iot-panel')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function refreshNow() {
    sendLocation();
  }

  function initSocketListener() {
    if (isPreview) return;
    if (typeof io !== 'function' || !touristId) return;
    const socket = io();
    socket.on('hardware_sos_triggered', (data) => {
      if (String(data.tourist_id) !== String(touristId)) return;
      sessionStorage.setItem('panicAlertShown', 'true');
      updateScore(0);
      alert(text('panicHardware'));
    });
  }

  function bindEvents() {
    dom.panicButton?.addEventListener('click', triggerPanic);
    dom.iotMode?.addEventListener('change', () => updateMode(dom.iotMode.value === 'true'));
    document.querySelectorAll('#lang-toggle-btn').forEach((button) => button.addEventListener('click', () => {
      window.setTimeout(() => {
        updateMode((body.dataset.iotEnabled || 'false') === 'true');
        updateScore(parseInt(dom.scoreNum?.textContent || '0', 10));
        renderZones(zoneCache);
      }, 240);
    }));
    window.addEventListener('safar:language-changed', () => {
      updateMode((body.dataset.iotEnabled || 'false') === 'true');
      updateScore(parseInt(dom.scoreNum?.textContent || '0', 10));
      renderZones(zoneCache);
    });
  }

  window.saveIoTConfig = saveIoTConfig;
  window.garudaFocusMap = focusMap;
  window.garudaScrollToEmergency = scrollToEmergency;
  window.garudaScrollToIot = scrollToIot;
  window.garudaRefreshNow = refreshNow;

  window.addEventListener('DOMContentLoaded', async () => {
    setGPSState('init', text('gpsInitializing'));
    updateMode((body.dataset.iotEnabled || 'false') === 'true');
    updateScore(parseInt(body.dataset.initialScore || '0', 10));
    updateSyncStamp(text('firstSyncPending'));
    if (dom.lastLocation && !dom.lastLocation.textContent.trim()) {
      dom.lastLocation.textContent = text('liveCoordinatesPending');
    }

    initMap();
    initGarudaCanvas();
    bindEvents();
    initSocketListener();

    try {
      await fetchZones();
    } catch (_) {
      renderZones([]);
    }

    sendLocation();
    syncTimer = window.setInterval(sendLocation, 15000);
  });

  window.addEventListener('beforeunload', () => {
    if (syncTimer) window.clearInterval(syncTimer);
  });
})();
