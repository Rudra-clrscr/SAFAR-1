document.addEventListener('DOMContentLoaded', () => {
  const widgets = Array.from(document.querySelectorAll('[data-nav-widget], .garuda-navigation-panel'));
  if (!widgets.length) return;

  const hasLeaflet = typeof window.L !== 'undefined';
  const widgetState = new WeakMap();
  const defaultCenter = [22.9734, 78.6569];
  const defaultZoom = 5;
  // CARTO now stamps "API KEY REQUIRED" across unauthenticated basemap tiles,
  // so the route map uses the keyless OSM standard layer instead.
  const lightTiles = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

  function formatDistance(distanceKm) {
    if (distanceKm == null || Number.isNaN(Number(distanceKm))) return '';
    const value = Number(distanceKm);
    return value < 1 ? `${Math.round(value * 1000)} m` : `${value.toFixed(1)} km`;
  }

  function formatDuration(durationMin) {
    if (durationMin == null || Number.isNaN(Number(durationMin))) return '';
    const value = Number(durationMin);
    return `${value.toFixed(value >= 10 ? 0 : 1)} min`;
  }

  function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const toRad = (deg) => (deg * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function computeBearing(lat1, lon1, lat2, lon2) {
    const toRad = (deg) => (deg * Math.PI) / 180;
    const toDeg = (rad) => (rad * 180) / Math.PI;
    const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
    const x =
      Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
      Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));
    return (toDeg(Math.atan2(y, x)) + 360) % 360;
  }

  /* ---------------------------------------------------------------------
   * Map matching. A raw GPS fix is projected onto the route line the way a
   * navigator rides its arrow along the road, so progress, the active
   * manoeuvre and the distance to the next turn come from real travelled
   * distance instead of a nearest-vertex guess.
   * ------------------------------------------------------------------- */

  const EARTH_RADIUS_M = 6371000;
  const DEG_TO_RAD = Math.PI / 180;

  function metresBetween(lat1, lon1, lat2, lon2) {
    return haversine(lat1, lon1, lat2, lon2) * 1000;
  }

  function formatMetres(metres) {
    if (metres == null || !Number.isFinite(Number(metres))) return '';
    const value = Number(metres);
    if (value < 950) return `${Math.max(0, Math.round(value / 10) * 10)} m`;
    return `${(value / 1000).toFixed(value < 9500 ? 1 : 0)} km`;
  }

  function formatSeconds(seconds) {
    if (seconds == null || !Number.isFinite(Number(seconds))) return '';
    const total = Math.max(0, Math.round(Number(seconds)));
    if (total < 60) return `${total} sec`;
    const minutes = Math.round(total / 60);
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    return `${hours} hr ${minutes % 60} min`;
  }

  function formatArrivalClock(seconds) {
    if (!Number.isFinite(Number(seconds))) return '';
    const arrival = new Date(Date.now() + Number(seconds) * 1000);
    return arrival.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function buildRouteIndex(routeCoords) {
    const coords = routeCoords || [];
    const cumulative = new Array(coords.length).fill(0);
    for (let i = 1; i < coords.length; i += 1) {
      cumulative[i] = cumulative[i - 1]
        + metresBetween(coords[i - 1][0], coords[i - 1][1], coords[i][0], coords[i][1]);
    }
    return { coords, cumulative, totalM: cumulative[coords.length - 1] || 0 };
  }

  // OSRM step distances sum to the route length, so a running total puts every
  // manoeuvre at a known point along the line without re-walking its geometry.
  function buildStepIndex(steps) {
    const starts = [];
    let running = 0;
    (steps || []).forEach((step) => {
      starts.push(running);
      running += Number(step.distance_m) || 0;
    });
    return { starts, totalM: running };
  }

  function projectOnSegment(lat, lon, aLat, aLon, bLat, bLon) {
    // Flat-earth locally: over one road segment the error sits far below GPS
    // noise, and it keeps the per-fix maths to a handful of multiplications.
    const scale = Math.cos(aLat * DEG_TO_RAD);
    const ax = 0;
    const ay = 0;
    const bx = (bLon - aLon) * scale;
    const by = bLat - aLat;
    const px = (lon - aLon) * scale;
    const py = lat - aLat;

    const segLenSq = (bx - ax) * (bx - ax) + (by - ay) * (by - ay);
    const t = segLenSq > 0
      ? Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / segLenSq))
      : 0;

    return {
      lat: aLat + (bLat - aLat) * t,
      lon: aLon + (bLon - aLon) * t,
      t,
    };
  }

  /**
   * Nearest point on the route to a fix.
   * The search starts as a window around the last match so a route that loops
   * back on itself cannot teleport progress backwards; it widens to the whole
   * line only when nothing close turns up.
   */
  function projectOnRoute(index, lat, lon, lastSegment = -1) {
    const coords = index.coords || [];
    if (coords.length < 2) return null;

    const scan = (from, to) => {
      let best = null;
      for (let i = Math.max(0, from); i < Math.min(coords.length - 1, to); i += 1) {
        const a = coords[i];
        const b = coords[i + 1];
        const point = projectOnSegment(lat, lon, a[0], a[1], b[0], b[1]);
        const offsetM = metresBetween(lat, lon, point.lat, point.lon);
        if (!best || offsetM < best.offsetM) {
          const segmentLength = index.cumulative[i + 1] - index.cumulative[i];
          best = {
            lat: point.lat,
            lon: point.lon,
            offsetM,
            segment: i,
            alongM: index.cumulative[i] + segmentLength * point.t,
          };
        }
      }
      return best;
    };

    let best = lastSegment >= 0 ? scan(lastSegment - 20, lastSegment + 150) : null;
    if (!best || best.offsetM > 120) {
      const wide = scan(0, coords.length - 1);
      if (wide && (!best || wide.offsetM < best.offsetM)) best = wide;
    }
    return best;
  }

  function stepIndexForAlong(stepIndex, alongM) {
    const starts = (stepIndex && stepIndex.starts) || [];
    if (!starts.length) return -1;
    let index = 0;
    while (index + 1 < starts.length && starts[index + 1] <= alongM) index += 1;
    return index;
  }

  function distanceToNextManoeuvre(state, alongM, stepIndex) {
    const starts = (state.stepIndex && state.stepIndex.starts) || [];
    if (stepIndex < 0 || stepIndex + 1 >= starts.length) {
      return Math.max(0, (state.routeIndex?.totalM || 0) - alongM);
    }
    return Math.max(0, starts[stepIndex + 1] - alongM);
  }

  function remainingSeconds(state, alongM, stepIndex) {
    const steps = state.steps || [];
    const starts = (state.stepIndex && state.stepIndex.starts) || [];
    const totalM = state.routeIndex?.totalM || 0;

    if (!steps.length || !starts.length) {
      const totalS = Number(state.routeSummary?.duration_s)
        || (Number(state.routeSummary?.duration_min) || 0) * 60;
      if (!totalM) return totalS;
      return totalS * Math.max(0, 1 - alongM / totalM);
    }

    let seconds = 0;
    for (let i = Math.max(0, stepIndex); i < steps.length; i += 1) {
      const duration = Number(steps[i].duration_s) || 0;
      if (i === stepIndex) {
        const length = Number(steps[i].distance_m) || 0;
        const travelled = Math.min(length, Math.max(0, alongM - (starts[i] || 0)));
        seconds += length > 0 ? duration * (1 - travelled / length) : duration;
      } else {
        seconds += duration;
      }
    }
    return seconds;
  }

  /** The "in 300 m, turn left onto MG Road" line, phrased by how close it is. */
  function describeManoeuvre(state, stepIndex, distanceM, arrived) {
    const steps = state.steps || [];
    if (arrived) return 'You have arrived';

    const upcoming = steps[stepIndex + 1] || steps[stepIndex];
    if (!upcoming) return 'Continue to your destination';

    const instruction = upcoming.instruction || 'Continue';
    if (!Number.isFinite(distanceM)) return instruction;
    if (distanceM <= 25) return `Now: ${instruction}`;
    return `In ${formatMetres(distanceM)}, ${instruction.charAt(0).toLowerCase()}${instruction.slice(1)}`;
  }

  function arrivalThresholdM(state) {
    return state.travelMode === 'walking' ? 20 : 40;
  }

  function snapThresholdM(state) {
    return state.travelMode === 'walking' ? 25 : 45;
  }

  /** Smooth the compass so the arrow does not twitch while standing still. */
  function smoothHeading(previousDeg, nextDeg, weight = 0.35) {
    if (!Number.isFinite(previousDeg)) return nextDeg;
    const delta = ((((nextDeg - previousDeg) % 360) + 540) % 360) - 180;
    return ((previousDeg + delta * weight) % 360 + 360) % 360;
  }

  function findWidgetElement(widget, selectors) {
    for (const selector of selectors) {
      const el = widget.querySelector(selector);
      if (el) return el;
    }
    return null;
  }

  function getState(widget) {
    if (widgetState.has(widget)) return widgetState.get(widget);

    const mapEl = findWidgetElement(widget, ['[data-nav-map]']);
    const state = {
      map: null,
      routeHalo: null,
      routeLayer: null,
      startMarker: null,
      destinationMarker: null,
      currentMarker: null,
      watchId: null,
      followEnabled: true,
      travelMode: 'driving',
      lastTarget: '',
      reroutePending: false,
      lastRerouteAt: 0,
      routeCoords: [],
      routeIndex: null,
      stepIndex: null,
      matchSegment: -1,
      offRouteHits: 0,
      live: null,
      suggestEl: null,
      suggestTimer: null,
      suggestQuery: '',
      suggestions: [],
      didYouMeanEl: null,
      candidates: [],
      steps: [],
      routeSummary: null,
      activeStepIndex: -1,
      lastPosition: null,
      headingDeg: 0,
      guideExpanded: false,
      stepMarkers: [],
      destinationLink: null,
      drawnCoords: [],
      revealTimer: null,
      revealIndex: 0,
      revealComplete: false,
      threeD: { enabled: false, ready: false, busy: false, map: null, el: null, markers: [], currentMarker: null },
      guideIndex: -1,
      guidePlaying: false,
      guideTimer: null,
      guideActive: false,
      mapEl,
    };

    if (mapEl && hasLeaflet) {
      state.map = window.L.map(mapEl, {
        zoomControl: true,
        scrollWheelZoom: false,
        preferCanvas: true,
      }).setView(defaultCenter, defaultZoom);

      window.L.tileLayer(lightTiles, {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 19,
      }).addTo(state.map);

      window.setTimeout(() => state.map.invalidateSize(), 120);
      window.addEventListener('resize', () => {
        state.map?.invalidateSize();
        if (state.threeD.enabled) state.threeD.map?.resize();
      }, { passive: true });
    }

    widgetState.set(widget, state);
    return state;
  }

  function clearWatch(state) {
    if (state.watchId != null && navigator.geolocation?.clearWatch) {
      navigator.geolocation.clearWatch(state.watchId);
    }
    state.watchId = null;
  }

  async function getOrigin() {
    if (!navigator.geolocation) return null;

    try {
      const position = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 9000,
          maximumAge: 15000,
        });
      });
      return {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      };
    } catch (_) {
      return null;
    }
  }

  function removeLayer(map, layer) {
    if (map && layer) map.removeLayer(layer);
  }

  function getInput(widget) {
    return findWidgetElement(widget, ['[data-nav-input]', '#nav-destination']);
  }

  function getGoBtn(widget) {
    return findWidgetElement(widget, ['[data-nav-go]', '#nav-route-btn']);
  }

  function getClearBtn(widget) {
    return findWidgetElement(widget, ['[data-nav-clear]', '#nav-clear-btn']);
  }

  function getOpenBtn(widget) {
    return findWidgetElement(widget, ['[data-nav-open]', '#nav-open-btn']);
  }

  function getStepsList(widget) {
    return findWidgetElement(widget, ['[data-nav-steps]', '#nav-steps']);
  }

  function getSummaryEl(widget) {
    return findWidgetElement(widget, ['[data-nav-summary]', '#nav-summary']);
  }

  function getStateEl(widget) {
    return findWidgetElement(widget, ['[data-nav-state]', '#nav-route-state']);
  }

  function getFollowBtn(widget) {
    return findWidgetElement(widget, ['[data-nav-follow]', '#nav-follow-btn']);
  }

  function getCenterBtn(widget) {
    return findWidgetElement(widget, ['[data-nav-center]']);
  }

  function getCurrentTitle(widget) {
    return findWidgetElement(widget, ['[data-nav-current]']);
  }

  function getCurrentSub(widget) {
    return findWidgetElement(widget, ['[data-nav-current-sub]']);
  }

  function getModeButtons(widget) {
    return Array.from(widget.querySelectorAll('[data-nav-mode]'));
  }

  function getSheetState(widget) {
    return findWidgetElement(widget, ['[data-nav-sheet-state]']);
  }

  function getSheetTitle(widget) {
    return findWidgetElement(widget, ['[data-nav-sheet-title]']);
  }

  function getSheetSubtitle(widget) {
    return findWidgetElement(widget, ['[data-nav-sheet-subtitle]']);
  }

  function getSheetMeta(widget) {
    return findWidgetElement(widget, ['[data-nav-sheet-meta]']);
  }

  function getSheetProgress(widget) {
    return findWidgetElement(widget, ['[data-nav-sheet-progress]']);
  }

  function getGuidePanel(widget) {
    return findWidgetElement(widget, ['[data-nav-guide-panel]']);
  }

  function getGuideToggle(widget) {
    return findWidgetElement(widget, ['[data-nav-guide-toggle]']);
  }

  function getGuidePrevBtn(widget) {
    return findWidgetElement(widget, ['[data-nav-guide-prev]']);
  }

  function getGuideNextBtn(widget) {
    return findWidgetElement(widget, ['[data-nav-guide-next]']);
  }

  function getGuidePlayBtn(widget) {
    return findWidgetElement(widget, ['[data-nav-guide-play]']);
  }

  function getGuideCounter(widget) {
    return findWidgetElement(widget, ['[data-nav-guide-counter]']);
  }

  function setFollowButton(widget, enabled) {
    const followBtn = getFollowBtn(widget);
    if (!followBtn) return;
    followBtn.classList.toggle('active', enabled);
    followBtn.textContent = enabled ? 'Following' : 'Follow Me';
  }

  function setModeButtons(widget, mode) {
    getModeButtons(widget).forEach((btn) => {
      const active = btn.dataset.navMode === mode;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function setLiveCard(widget, title, subtitle) {
    const currentTitle = getCurrentTitle(widget);
    const currentSub = getCurrentSub(widget);
    if (currentTitle) currentTitle.textContent = title;
    if (currentSub) currentSub.textContent = subtitle;
  }

  function setGuideVisibility(widget, expanded) {
    const panel = getGuidePanel(widget);
    const toggle = getGuideToggle(widget);
    const state = getState(widget);
    state.guideExpanded = expanded;
    if (panel) {
      panel.hidden = !expanded;
      panel.classList.toggle('is-collapsed', !expanded);
    }
    if (toggle) {
      toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    }
  }

  function routeStateClass(routeState) {
    const text = String(routeState || '').toLowerCase();
    if (text.includes('recalcul')) return 'rerouting';
    if (text.includes('off')) return 'offroute';
    if (text.includes('on')) return 'locked';
    if (text.includes('plan')) return 'loading';
    if (text.includes('unavail') || text.includes('error')) return 'err';
    return '';
  }

  function setSheet(widget, { stateText, stateClass = '', title, subtitle, meta, progress = 0 }) {
    const stateEl = getSheetState(widget);
    const titleEl = getSheetTitle(widget);
    const subtitleEl = getSheetSubtitle(widget);
    const metaEl = getSheetMeta(widget);
    const progressEl = getSheetProgress(widget);

    if (stateEl) {
      stateEl.textContent = stateText || 'Ready';
      stateEl.className = `nav-planner-bottomsheet-kicker ${stateClass}`.trim();
    }
    if (titleEl) titleEl.textContent = title || 'Turn-by-turn guide';
    if (subtitleEl) subtitleEl.textContent = subtitle || 'Use Drive or Walk mode to preview your route.';
    if (metaEl) metaEl.textContent = meta || 'Route progress will appear here';
    if (progressEl) progressEl.style.width = `${Math.max(0, Math.min(100, progress))}%`;
  }

  function applyRouteStateClass(widget, kind, text) {
    const stateEl = getStateEl(widget);
    const sheetStateEl = getSheetState(widget);
    if (stateEl) {
      stateEl.textContent = text;
      stateEl.className = `nav-planner-state ${kind}`;
    }
    if (sheetStateEl) {
      sheetStateEl.textContent = text;
      sheetStateEl.className = `nav-planner-bottomsheet-kicker ${kind}`;
    }
  }

  function setNextTurn(widget, payload, activeIndex = -1, live = null) {
    const nextEl = findWidgetElement(widget, ['[data-nav-next]']);
    const distanceEl = findWidgetElement(widget, ['[data-nav-distance]']);
    const steps = payload?.route?.steps || [];
    const route = payload?.route;
    const nextStep = steps[Math.max(0, activeIndex + 1)] || steps[0];

    if (nextEl) {
      if (live && live.arrived) {
        nextEl.textContent = 'You have arrived';
      } else if (live && nextStep) {
        // Google-style: the manoeuvre and how far off it is, counting down.
        nextEl.textContent = live.turnInM <= 25
          ? nextStep.instruction
          : `${formatMetres(live.turnInM)} - ${nextStep.instruction}`;
      } else {
        nextEl.textContent = nextStep ? nextStep.instruction : 'Pick a destination to begin';
      }
    }

    if (distanceEl) {
      const parts = [];
      if (live) {
        parts.push(`${formatMetres(live.remainingM)} left`);
        parts.push(`${formatSeconds(live.remainingS)}`);
        const clock = formatArrivalClock(live.remainingS);
        if (clock) parts.push(`arrive ${clock}`);
      } else {
        if (route?.distance_km != null) parts.push(`${formatDistance(route.distance_km)} total`);
        if (route?.duration_min != null) parts.push(`${formatDuration(route.duration_min)} ETA`);
      }
      if (activeIndex >= 0 && steps.length) {
        parts.push(`Step ${Math.min(activeIndex + 1, steps.length)} of ${steps.length}`);
      }
      distanceEl.textContent = parts.join(' | ') || 'Live map will follow your position';
    }
  }

  function renderSteps(listEl, steps, activeIndex = -1, revealed = false) {
    if (!listEl) return;
    if (!steps || !steps.length) {
      listEl.innerHTML = '<li class="nav-planner-empty">Turn-by-turn guidance will appear here once a route is found.</li>';
      return;
    }

    listEl.innerHTML = steps.map((step, index) => {
      const parts = [];
      if (step.distance_m != null) parts.push(formatDistance(step.distance_m / 1000));
      if (step.duration_s != null) parts.push(formatDuration(step.duration_s / 60));
      const meta = parts.filter(Boolean).join(' | ');
      const classes = ['nav-step-item'];
      if (index === activeIndex) classes.push('is-active-step');
      if (revealed) classes.push('is-revealed');
      return `
        <li class="${classes.join(' ')}" data-step-index="${index}" role="button" tabindex="0">
          <span class="nav-step-index">${index + 1}</span>
          <span class="nav-step-body">
            <strong>${step.instruction || 'Continue'}</strong>
            ${meta ? `<span class="nav-planner-step-meta">${meta}</span>` : ''}
          </span>
        </li>
      `;
    }).join('');
  }

  function highlightSteps(widget, activeIndex, scrollIntoView = false) {
    const stepsEl = getStepsList(widget);
    if (!stepsEl) return;
    const items = Array.from(stepsEl.querySelectorAll('li[data-step-index]'));
    items.forEach((item, index) => {
      item.classList.toggle('is-active-step', index === activeIndex);
      if (scrollIntoView && index === activeIndex) {
        item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    });
  }

  /* ---------------------------------------------------------------------
   * Step-by-step reveal: the route is drawn one manoeuvre at a time, each
   * with a numbered pin on the map and its matching line in the guide.
   * ------------------------------------------------------------------- */

  function stepLatLng(state, index) {
    const step = (state.steps || [])[index];
    if (!step) return null;

    if (Number.isFinite(step.latitude) && Number.isFinite(step.longitude)) {
      return [step.latitude, step.longitude];
    }

    const geometry = step.geometry || [];
    if (geometry.length) {
      const [lon, lat] = geometry[0];
      if (Number.isFinite(lat) && Number.isFinite(lon)) return [lat, lon];
    }

    const coords = state.routeCoords || [];
    if (!coords.length) return null;
    const total = Math.max(1, (state.steps || []).length - 1);
    const ratio = total ? index / total : 0;
    return coords[Math.min(coords.length - 1, Math.round(ratio * (coords.length - 1)))];
  }

  function stepSegmentCoords(state, index) {
    const step = (state.steps || [])[index];
    const geometry = step && step.geometry ? step.geometry : [];
    if (geometry.length) {
      return geometry
        .map(([lon, lat]) => [lat, lon])
        .filter((pair) => Number.isFinite(pair[0]) && Number.isFinite(pair[1]));
    }

    // OSRM did not hand back per-step geometry: slice the overview line instead.
    const coords = state.routeCoords || [];
    const steps = state.steps || [];
    if (!coords.length || !steps.length) return [];
    const from = Math.floor((index / steps.length) * (coords.length - 1));
    const to = Math.ceil(((index + 1) / steps.length) * (coords.length - 1));
    return coords.slice(from, Math.max(from + 1, to + 1));
  }

  function makeStepIcon(index, step, kind) {
    const glyph = kind === 'end' ? '<i class="fas fa-flag-checkered"></i>' : String(index + 1);
    const label = String((step && step.instruction) || '').replace(/"/g, '&quot;');
    return window.L.divIcon({
      className: '',
      html: `<div class="nav-step-pin ${kind}" title="${label}">${glyph}</div>`,
      iconSize: [26, 26],
      iconAnchor: [13, 13],
    });
  }

  function clearStepMarkers(state) {
    (state.stepMarkers || []).forEach((marker) => removeLayer(state.map, marker));
    state.stepMarkers = [];
  }

  function cancelReveal(state) {
    if (state.revealTimer) window.clearTimeout(state.revealTimer);
    state.revealTimer = null;
  }

  function addStepMarker(widget, state, index) {
    if (!state.map || !hasLeaflet) return;
    const latLng = stepLatLng(state, index);
    if (!latLng) return;

    const steps = state.steps || [];
    const kind = index === 0 ? 'start' : (index === steps.length - 1 ? 'end' : 'turn');
    const marker = window.L.marker(latLng, {
      icon: makeStepIcon(index, steps[index], kind),
      zIndexOffset: 500 + index,
    }).addTo(state.map);

    marker.bindTooltip(`${index + 1}. ${(steps[index] && steps[index].instruction) || 'Continue'}`, {
      direction: 'top',
      offset: [0, -12],
    });
    marker.on('click', () => focusStep(widget, index));
    state.stepMarkers[index] = marker;
    sync3DMarkers(widget, state);
  }

  function revealStepItem(widget, index) {
    const stepsEl = getStepsList(widget);
    const item = stepsEl ? stepsEl.querySelector(`li[data-step-index="${index}"]`) : null;
    if (item) item.classList.add('is-revealed');
  }

  function extendDrawnLine(state, index) {
    const segment = stepSegmentCoords(state, index);
    if (!segment.length) return;
    state.drawnCoords = state.drawnCoords.concat(segment);
    if (state.routeLayer) state.routeLayer.setLatLngs(state.drawnCoords);
    sync3DRoute(state);
  }

  function revealRouteProgressively(widget, state) {
    const steps = state.steps || [];
    cancelReveal(state);
    state.revealIndex = 0;
    state.revealComplete = false;
    state.drawnCoords = [];
    clearStepMarkers(state);
    if (state.routeLayer) state.routeLayer.setLatLngs([]);

    if (!steps.length) {
      state.revealComplete = true;
      if (state.routeLayer) state.routeLayer.setLatLngs(state.routeCoords || []);
      updateGuideControls(widget, state);
      return;
    }

    // Long routes still finish in a few seconds rather than crawling.
    const interval = Math.max(80, Math.min(320, Math.round(9000 / steps.length)));

    const tick = () => {
      const index = state.revealIndex;
      if (index >= steps.length) {
        state.revealTimer = null;
        state.revealComplete = true;
        if (state.routeLayer) {
          state.routeLayer.setLatLngs(state.routeCoords && state.routeCoords.length ? state.routeCoords : state.drawnCoords);
        }
        applyRouteStateClass(widget, 'ok', 'Route Ready');
        updateGuideControls(widget, state);
        refresh3D(widget, state);
        return;
      }

      extendDrawnLine(state, index);
      addStepMarker(widget, state, index);
      revealStepItem(widget, index);
      state.revealIndex = index + 1;

      applyRouteStateClass(widget, 'loading', `Drawing step ${index + 1} of ${steps.length}`);
      setSheet(widget, {
        stateText: `Step ${index + 1} of ${steps.length}`,
        stateClass: 'loading',
        title: steps[index].instruction || 'Continue',
        subtitle: 'Laying out your route one turn at a time.',
        meta: state.routeSummary
          ? `${formatDistance(state.routeSummary.distance_km)} total | ${formatDuration(state.routeSummary.duration_min)} ETA`
          : 'Route progress will appear here',
        progress: ((index + 1) / steps.length) * 100,
      });
      updateGuideControls(widget, state);

      state.revealTimer = window.setTimeout(tick, interval);
    };

    tick();
  }

  /* ---------------------------------------------------------------------
   * Travel guide: walk the whole route turn by turn, manually or on play.
   * ------------------------------------------------------------------- */

  function setStepMarkerActive(state, index) {
    (state.stepMarkers || []).forEach((marker, markerIndex) => {
      if (!marker) return;
      const element = (marker.getElement && marker.getElement()) || marker._icon;
      const pin = element && element.querySelector ? element.querySelector('.nav-step-pin') : null;
      if (pin) pin.classList.toggle('is-active', markerIndex === index);
    });
  }

  function updateGuideControls(widget, state) {
    const steps = state.steps || [];
    const total = steps.length;
    const counter = getGuideCounter(widget);
    const prevBtn = getGuidePrevBtn(widget);
    const nextBtn = getGuideNextBtn(widget);
    const playBtn = getGuidePlayBtn(widget);
    const toggle = getGuideToggle(widget);

    if (toggle) {
      toggle.disabled = !total;
      toggle.innerHTML = state.guideExpanded
        ? '<i class="fas fa-map-signs"></i> Hide Travel Guide'
        : '<i class="fas fa-map-signs"></i> Travel Guide';
    }
    if (counter) {
      counter.textContent = total
        ? `Step ${Math.min(Math.max(state.guideIndex + 1, 1), total)} of ${total}`
        : 'No route yet';
    }
    if (prevBtn) prevBtn.disabled = !total || state.guideIndex <= 0;
    if (nextBtn) nextBtn.disabled = !total || state.guideIndex >= total - 1;
    if (playBtn) {
      playBtn.disabled = !total;
      playBtn.classList.toggle('is-playing', state.guidePlaying);
      playBtn.innerHTML = state.guidePlaying
        ? '<i class="fas fa-pause"></i> Pause'
        : '<i class="fas fa-play"></i> Play Guide';
    }
  }

  function focusStep(widget, index) {
    const state = getState(widget);
    const steps = state.steps || [];
    if (!steps.length) return;

    const safeIndex = Math.max(0, Math.min(steps.length - 1, index));
    state.guideIndex = safeIndex;
    state.guideActive = true;

    const step = steps[safeIndex];
    const latLng = stepLatLng(state, safeIndex);
    if (latLng && state.map) {
      state.map.flyTo(latLng, Math.max(state.map.getZoom() || defaultZoom, 15), {
        animate: true,
        duration: 0.7,
      });
      const marker = state.stepMarkers[safeIndex];
      if (marker && marker.openTooltip) marker.openTooltip();
    }
    if (latLng) {
      const nextLatLng = stepLatLng(state, Math.min(steps.length - 1, safeIndex + 1));
      const bearing = nextLatLng
        ? computeBearing(latLng[0], latLng[1], nextLatLng[0], nextLatLng[1])
        : null;
      focus3D(state, latLng[0], latLng[1], { bearing, zoom: 16.5 });
    }

    setStepMarkerActive(state, safeIndex);
    set3DStepActive(state, safeIndex);
    highlightSteps(widget, safeIndex, true);

    const metaParts = [];
    if (step.distance_m != null) metaParts.push(formatDistance(step.distance_m / 1000));
    if (step.duration_s != null) metaParts.push(formatDuration(step.duration_s / 60));
    metaParts.push(`Step ${safeIndex + 1} of ${steps.length}`);

    setSheet(widget, {
      stateText: 'Travel guide',
      stateClass: 'locked',
      title: step.instruction || 'Continue',
      subtitle: safeIndex === steps.length - 1
        ? 'This is the final manoeuvre of your trip.'
        : `Next: ${(steps[safeIndex + 1] && steps[safeIndex + 1].instruction) || 'Continue'}`,
      meta: metaParts.join(' | '),
      progress: ((safeIndex + 1) / steps.length) * 100,
    });
    setLiveCard(widget, step.instruction || 'Continue', metaParts.join(' | '));
    updateGuideControls(widget, state);
  }

  function stopGuidePlayback(widget, state) {
    if (state.guideTimer) window.clearInterval(state.guideTimer);
    state.guideTimer = null;
    state.guidePlaying = false;
    updateGuideControls(widget, state);
  }

  function startGuidePlayback(widget, state) {
    const steps = state.steps || [];
    if (!steps.length) return;

    stopGuidePlayback(widget, state);
    state.guidePlaying = true;
    // Playback drives the camera, so live follow stands down until it ends.
    state.followEnabled = false;
    setFollowButton(widget, false);
    clearWatch(state);

    if (state.guideIndex >= steps.length - 1) state.guideIndex = -1;
    focusStep(widget, state.guideIndex + 1);

    state.guideTimer = window.setInterval(() => {
      if (state.guideIndex >= steps.length - 1) {
        stopGuidePlayback(widget, state);
        applyRouteStateClass(widget, 'ok', 'Guide complete');
        return;
      }
      focusStep(widget, state.guideIndex + 1);
    }, 3200);

    updateGuideControls(widget, state);
  }

  function resetGuide(widget, state) {
    stopGuidePlayback(widget, state);
    state.guideIndex = -1;
    state.guideActive = false;
    setStepMarkerActive(state, -1);
    updateGuideControls(widget, state);
  }

  function ensureCurrentMarker(state, lat, lon) {
    if (!state.map || !hasLeaflet) return;
    const icon = window.L.divIcon({
      className: '',
      html: '<div class="nav-current-dot pulse"></div>',
      iconSize: [18, 18],
      iconAnchor: [9, 9],
    });

    if (!state.currentMarker) {
      state.currentMarker = window.L.marker([lat, lon], { icon, zIndexOffset: 2000 }).addTo(state.map);
      window.setTimeout(() => setMarkerHeading(state, state.headingDeg || 0), 0);
    } else {
      state.currentMarker.setLatLng([lat, lon]);
    }
    sync3DCurrent(state, lat, lon);
  }

  function setMarkerHeading(state, headingDeg) {
    if (!state.currentMarker) return;
    const safeHeading = Number.isFinite(Number(headingDeg)) ? ((Number(headingDeg) % 360) + 360) % 360 : 0;
    state.headingDeg = safeHeading;
    const element = state.currentMarker.getElement?.() || state.currentMarker._icon || null;
    if (element) {
      element.style.setProperty('--nav-heading', `${safeHeading}deg`);
    }
    const element3d = state.threeD.currentMarker?.getElement?.();
    if (element3d) element3d.style.setProperty('--nav-heading', `${safeHeading}deg`);
  }

  function focusCurrentLocation(state, lat, lon, forceZoom = false) {
    if (!state.map) return;
    // The travel guide owns the camera while it is walking the route.
    if (state.guidePlaying && !forceZoom) return;
    const targetZoom = state.travelMode === 'walking' ? 16 : 15;
    const zoom = Math.max(state.map.getZoom() || defaultZoom, targetZoom);
    const bearing3d = state.followEnabled ? (state.headingDeg || 0) : null;
    if (forceZoom || state.followEnabled) {
      state.map.flyTo([lat, lon], zoom, { animate: true, duration: 0.65 });
      focus3D(state, lat, lon, { bearing: bearing3d, zoom: targetZoom + 1, duration: 650 });
      return;
    }
    state.map.panTo([lat, lon], { animate: true, duration: 0.45 });
    focus3D(state, lat, lon, { bearing: bearing3d, duration: 450 });
  }

  function getDeviationThresholdKm(state) {
    return state.travelMode === 'walking' ? 0.18 : 0.45;
  }

  function updateNavigationSheet(widget, state, stepIndex, deviationKm = null, routeState = 'Ready', live = null) {
    const route = state.routeSummary;
    const steps = state.steps || [];
    const currentStep = stepIndex >= 0 ? steps[stepIndex] : null;
    const nextStep = steps[Math.max(0, stepIndex + 1)] || steps[0];
    const title = live
      ? describeManoeuvre(state, stepIndex, live.turnInM, live.arrived)
      : (currentStep?.instruction || nextStep?.instruction || (state.followEnabled ? 'Live navigation active' : 'Waiting for a route'));

    const progress = live
      ? live.progress
      : (steps.length > 1 && stepIndex >= 0 ? ((stepIndex + 1) / steps.length) * 100 : (route ? 8 : 0));

    const metaParts = [];
    if (live) {
      metaParts.push(`${formatMetres(live.remainingM)} left`);
      metaParts.push(`${formatSeconds(live.remainingS)} to go`);
      const clock = formatArrivalClock(live.remainingS);
      if (clock) metaParts.push(`arrive ${clock}`);
    } else {
      if (route?.distance_km != null) metaParts.push(`${formatDistance(route.distance_km)} total`);
      if (route?.duration_min != null) metaParts.push(`${formatDuration(route.duration_min)} ETA`);
    }
    if (stepIndex >= 0 && steps.length) metaParts.push(`Step ${Math.min(stepIndex + 1, steps.length)} of ${steps.length}`);
    if (deviationKm != null && Number.isFinite(deviationKm) && deviationKm > 0.03) {
      metaParts.push(`${formatMetres(deviationKm * 1000)} off route`);
    }
    if (!metaParts.length) {
      metaParts.push('Allow location access to follow your trip like Google Maps.');
    }

    setSheet(widget, {
      stateText: routeState,
      stateClass: routeStateClass(routeState),
      title,
      subtitle: state.reroutePending ? 'Recalculating the route from your live position.' : (state.followEnabled ? 'Navigation will keep you centered on the map.' : 'Follow mode is paused.'),
      meta: metaParts.join(' | '),
      progress,
    });
  }

  function clearMap(state, widget = null) {
    cancelReveal(state);
    clearStepMarkers(state);
    removeLayer(state.map, state.routeHalo);
    removeLayer(state.map, state.routeLayer);
    removeLayer(state.map, state.destinationLink);
    removeLayer(state.map, state.startMarker);
    removeLayer(state.map, state.destinationMarker);
    removeLayer(state.map, state.currentMarker);
    state.routeHalo = null;
    state.routeLayer = null;
    state.destinationLink = null;
    state.startMarker = null;
    state.destinationMarker = null;
    state.currentMarker = null;
    state.routeCoords = [];
    state.routeIndex = null;
    state.stepIndex = null;
    state.matchSegment = -1;
    state.offRouteHits = 0;
    state.live = null;
    state.steps = [];
    state.routeSummary = null;
    state.activeStepIndex = -1;
    state.lastPosition = null;
    state.drawnCoords = [];
    state.revealIndex = 0;
    state.revealComplete = false;
    clearWatch(state);
    if (widget) resetGuide(widget, state);
    clear3D(state);
    state.map?.setView(defaultCenter, defaultZoom);
  }

  function updateLiveLocation(widget, state, lat, lon, heading = 0) {
    let displayLat = lat;
    let displayLon = lon;
    let match = null;

    const hasRoute = state.routeIndex && (state.routeIndex.coords || []).length >= 2;
    if (hasRoute) {
      match = projectOnRoute(state.routeIndex, lat, lon, state.matchSegment);
      if (match && match.offsetM <= snapThresholdM(state)) {
        // Ride the road rather than jittering beside it.
        state.matchSegment = match.segment;
        displayLat = match.lat;
        displayLon = match.lon;
      }
    }

    ensureCurrentMarker(state, displayLat, displayLon);
    setMarkerHeading(state, heading);
    focusCurrentLocation(state, displayLat, displayLon);

    // While the route is still drawing itself, or the guide is walking the
    // user through it, the position dot moves but the copy stays put.
    if (state.revealTimer || state.guidePlaying) return;

    if (!hasRoute || !state.steps.length) {
      setLiveCard(widget, 'Live location locked', 'Waiting for route directions.');
      updateNavigationSheet(widget, state, -1, null, state.reroutePending ? 'Recalculating' : 'Ready');
      return;
    }

    if (!match) return;

    const stepIndex = stepIndexForAlong(state.stepIndex, match.alongM);
    const remainingM = Math.max(0, (state.routeIndex.totalM || 0) - match.alongM);
    const remainingS = remainingSeconds(state, match.alongM, stepIndex);
    const turnInM = distanceToNextManoeuvre(state, match.alongM, stepIndex);
    const arrived = remainingM <= arrivalThresholdM(state);

    // One bad fix under a flyover should not rewrite the guidance; a run of them should.
    const offRoute = match.offsetM > getDeviationThresholdKm(state) * 1000;
    state.offRouteHits = offRoute ? (state.offRouteHits || 0) + 1 : 0;

    if (offRoute && state.offRouteHits < 3) {
      // A fix this far off the line matches somewhere arbitrary, so its
      // distances would be nonsense. Hold the last confident guidance instead.
      return;
    }

    const live = {
      remainingM,
      remainingS,
      turnInM,
      arrived,
      offsetM: match.offsetM,
      progress: state.routeIndex.totalM
        ? Math.max(0, Math.min(100, (match.alongM / state.routeIndex.totalM) * 100))
        : 0,
    };

    if (!offRoute) {
      state.live = live;
      state.activeStepIndex = stepIndex;
      highlightSteps(widget, stepIndex);
    }

    if (arrived && !offRoute) {
      state.offRouteHits = 0;
      applyRouteStateClass(widget, 'ok', 'Arrived');
      setLiveCard(widget, 'You have arrived', `${state.lastTarget || 'Destination'} reached.`);
      updateNavigationSheet(widget, state, stepIndex, null, 'Arrived', live);
      setNextTurn(widget, { route: state.routeSummary }, stepIndex, live);
      clearWatch(state);
      return;
    }

    if (state.offRouteHits >= 3) {
      applyRouteStateClass(widget, 'offroute', 'Off route');
      setLiveCard(widget, 'Off route', `${formatMetres(match.offsetM)} from the route — recalculating...`);
      updateNavigationSheet(widget, state, stepIndex, match.offsetM / 1000, 'Off route', live);

      const now = Date.now();
      if (state.lastTarget && !state.reroutePending && (now - state.lastRerouteAt) > 12000) {
        state.reroutePending = true;
        state.lastRerouteAt = now;
        updateNavigationSheet(widget, state, stepIndex, match.offsetM / 1000, 'Recalculating', live);
        window.setTimeout(async () => {
          try {
            await planRoute(widget, state.lastTarget, { originOverride: { latitude: lat, longitude: lon }, reroute: true });
          } finally {
            state.reroutePending = false;
          }
        }, 600);
      }
      return;
    }

    applyRouteStateClass(widget, 'locked', 'On route');
    updateNavigationSheet(widget, state, stepIndex, match.offsetM / 1000, 'On route', live);
    updateLiveCopy(widget, state, stepIndex, live);
  }

  function updateLiveCopy(widget, state, stepIndex = -1, live = null) {
    const route = state.routeSummary;
    const steps = state.steps || [];

    if (live) {
      const title = describeManoeuvre(state, stepIndex, live.turnInM, live.arrived);
      const parts = [
        `${formatMetres(live.remainingM)} left`,
        `${formatSeconds(live.remainingS)} to go`,
      ];
      const clock = formatArrivalClock(live.remainingS);
      if (clock) parts.push(`arrive ${clock}`);
      setLiveCard(widget, title, parts.join(' | '));
      setNextTurn(widget, { route }, stepIndex, live);
      return;
    }

    const currentStep = stepIndex >= 0 ? steps[stepIndex] : null;
    const nextStep = steps[Math.max(0, stepIndex + 1)] || steps[0];
    const title = currentStep?.instruction || nextStep?.instruction || 'Waiting for a route';
    const subtitleParts = [];

    if (route?.distance_km != null) subtitleParts.push(`${formatDistance(route.distance_km)} total`);
    if (route?.duration_min != null) subtitleParts.push(`${formatDuration(route.duration_min)} ETA`);
    if (stepIndex >= 0 && steps.length) subtitleParts.push(`Step ${Math.min(stepIndex + 1, steps.length)} of ${steps.length}`);
    if (!subtitleParts.length) subtitleParts.push('Allow location access to follow your trip like Google Maps.');

    setLiveCard(widget, title, subtitleParts.join(' | '));
    setNextTurn(widget, { route }, stepIndex);
  }

  function startFollowWatch(widget, currentLatLng = null) {
    const state = getState(widget);
    if (!navigator.geolocation || !state.map || !state.followEnabled) return;

    clearWatch(state);
    state.watchId = navigator.geolocation.watchPosition((position) => {
      const lat = position.coords.latitude;
      const lon = position.coords.longitude;
      const accuracy = Number(position.coords.accuracy);

      // A 300 m "fix" from a cell tower would drag the arrow off the road and
      // fake a reroute, so it is dropped unless nothing better has arrived yet.
      if (Number.isFinite(accuracy) && accuracy > 65 && state.lastPosition) return;

      const movedM = state.lastPosition
        ? metresBetween(state.lastPosition.latitude, state.lastPosition.longitude, lat, lon)
        : Infinity;

      let heading = state.headingDeg || 0;
      const rawHeading = Number.isFinite(position.coords.heading) ? position.coords.heading : null;
      if (rawHeading != null && Number.isFinite(position.coords.speed) && position.coords.speed > 0.6) {
        heading = smoothHeading(state.headingDeg, rawHeading);
      } else if (movedM > 6 && state.lastPosition) {
        heading = smoothHeading(
          state.headingDeg,
          computeBearing(state.lastPosition.latitude, state.lastPosition.longitude, lat, lon),
        );
      }

      state.lastPosition = { latitude: lat, longitude: lon, accuracy };
      updateLiveLocation(widget, state, lat, lon, heading);
    }, () => {}, {
      enableHighAccuracy: true,
      maximumAge: 3000,
      timeout: 10000,
    });

    if (currentLatLng) {
      state.lastPosition = { latitude: currentLatLng[0], longitude: currentLatLng[1] };
      updateLiveLocation(widget, state, currentLatLng[0], currentLatLng[1], state.headingDeg || 0);
    }
  }

  function drawMap(widget, payload) {
    const state = getState(widget);
    if (!state.map || !hasLeaflet) return;

    clearMap(state, widget);

    const origin = payload?.origin;
    const destination = payload?.destination;
    const routeCoords = (payload?.route?.coordinates || [])
      .map(([lon, lat]) => [lat, lon])
      .filter((pair) => Number.isFinite(pair[0]) && Number.isFinite(pair[1]));

    state.routeCoords = routeCoords;
    state.steps = payload?.route?.steps || [];
    state.routeSummary = payload?.route || null;
    state.activeStepIndex = -1;
    state.routeIndex = buildRouteIndex(routeCoords);
    state.stepIndex = buildStepIndex(state.steps);
    state.matchSegment = -1;
    state.offRouteHits = 0;
    state.live = null;

    if (routeCoords.length >= 2) {
      state.routeHalo = window.L.polyline(routeCoords, {
        color: '#dbeafe',
        weight: 12,
        opacity: 0.95,
        lineCap: 'round',
        lineJoin: 'round',
      }).addTo(state.map);

      // Starts empty: revealRouteProgressively() grows it one manoeuvre at a time.
      state.routeLayer = window.L.polyline([], {
        color: '#2563eb',
        weight: 6,
        opacity: 0.98,
        lineCap: 'round',
        lineJoin: 'round',
      }).addTo(state.map);
    }

    if (origin && Number.isFinite(origin.latitude) && Number.isFinite(origin.longitude)) {
      state.startMarker = window.L.circleMarker([origin.latitude, origin.longitude], {
        radius: 9,
        color: '#22c55e',
        weight: 3,
        fillColor: '#ffffff',
        fillOpacity: 1,
      }).addTo(state.map).bindPopup('Start');
      ensureCurrentMarker(state, origin.latitude, origin.longitude);
    }

    if (destination && Number.isFinite(destination.latitude) && Number.isFinite(destination.longitude)) {
      state.destinationMarker = window.L.circleMarker([destination.latitude, destination.longitude], {
        radius: 10,
        color: '#ef4444',
        weight: 3,
        fillColor: '#ffffff',
        fillOpacity: 1,
      }).addTo(state.map).bindPopup(destination.label || 'Destination');
    }

    // Geocoders resolve some places (a lake, a hill town) well off the driveable
    // network, so show the last leg on foot rather than leaving a silent gap.
    if (routeCoords.length && destination && Number.isFinite(destination.latitude) && Number.isFinite(destination.longitude)) {
      const lastPoint = routeCoords[routeCoords.length - 1];
      const gapKm = haversine(lastPoint[0], lastPoint[1], destination.latitude, destination.longitude);
      if (gapKm > 0.12) {
        state.destinationLink = window.L.polyline([lastPoint, [destination.latitude, destination.longitude]], {
          color: '#ef4444',
          weight: 3,
          opacity: 0.85,
          dashArray: '6 8',
        }).addTo(state.map).bindTooltip(`${formatDistance(gapKm)} from the nearest road`, { direction: 'top' });
      }
    }

    if (routeCoords.length >= 2) {
      const bounds = window.L.latLngBounds(routeCoords);
      if (origin && Number.isFinite(origin.latitude) && Number.isFinite(origin.longitude)) {
        bounds.extend([origin.latitude, origin.longitude]);
      }
      if (destination && Number.isFinite(destination.latitude) && Number.isFinite(destination.longitude)) {
        bounds.extend([destination.latitude, destination.longitude]);
      }
      state.map.fitBounds(bounds.pad(0.16));
    } else if (destination && Number.isFinite(destination.latitude) && Number.isFinite(destination.longitude)) {
      state.map.flyTo([destination.latitude, destination.longitude], 12, { duration: 1.0 });
    }

    refresh3D(widget, state, { fit: true });
    setNextTurn(widget, payload, -1);
    updateNavigationSheet(widget, state, -1, null, 'Ready');
    renderSteps(getStepsList(widget), state.steps, -1);
    revealRouteProgressively(widget, state);
    startFollowWatch(widget, origin && Number.isFinite(origin.latitude) && Number.isFinite(origin.longitude)
      ? [origin.latitude, origin.longitude]
      : null);
  }

  async function planRoute(widget, destinationText, options = {}) {
    const state = getState(widget);
    const stateEl = getStateEl(widget);
    const summaryEl = getSummaryEl(widget);
    const stepsEl = getStepsList(widget);
    const openBtn = getOpenBtn(widget);
    const input = getInput(widget);
    const target = (destinationText || input?.value || '').trim();

    const setState = (kind, text) => {
      if (!stateEl) return;
      stateEl.textContent = text;
      stateEl.className = `nav-planner-state ${kind}`;
    };

    const setOpenLink = (url) => {
      if (!openBtn) return;
      if (url) {
        openBtn.href = url;
        openBtn.classList.remove('is-disabled');
        openBtn.setAttribute('aria-disabled', 'false');
      } else {
        openBtn.href = '#';
        openBtn.classList.add('is-disabled');
        openBtn.setAttribute('aria-disabled', 'true');
      }
    };

    if (!target) {
      setState('ready', 'Ready');
      if (summaryEl) summaryEl.textContent = 'Enter a destination to begin navigation.';
      setLiveCard(widget, 'Waiting for a route', 'Allow location access to follow your trip like Google Maps.');
      updateNavigationSheet(widget, state, -1, null, 'Ready');
      setNextTurn(widget, null, -1);
      renderSteps(stepsEl, []);
      setOpenLink(null);
      renderDidYouMean(widget, state, []);
      clearMap(state, widget);
      return;
    }

    state.lastTarget = target;
    setState('loading', 'Planning route...');
    if (summaryEl) summaryEl.textContent = `Finding a ${state.travelMode} route to ${target}...`;
    setLiveCard(widget, `${state.travelMode === 'walking' ? 'Walking' : 'Driving'} route preview`, `Finding the best route to ${target}...`);
    updateNavigationSheet(widget, state, -1, null, 'Planning');

    const origin = options.originOverride || await getOrigin();
    try {
      const response = await fetch('/api/navigation/route', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          destination: target,
          origin_lat: origin?.latitude,
          origin_lon: origin?.longitude,
          travel_mode: state.travelMode,
          with_steps: true,
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = payload.error || 'Unable to load navigation right now.';
        setState('err', message);
        if (summaryEl) summaryEl.textContent = message;
        setLiveCard(widget, 'Navigation unavailable', message);
        updateNavigationSheet(widget, state, -1, null, 'Unavailable');
        renderSteps(stepsEl, []);
        setNextTurn(widget, null, -1);
        setOpenLink(null);
        clearMap(state, widget);
        return;
      }

      const destinationLabel = options.labelOverride || payload?.destination?.label || target;
      renderDidYouMean(widget, state, options.labelOverride ? [] : (payload?.candidates || []));
      const route = payload?.route;
      const modeLabel = state.travelMode === 'walking' ? 'Walking' : 'Driving';
      const summaryParts = [`${modeLabel} route ready to ${destinationLabel}.`];
      if (route?.distance_km != null) summaryParts.push(formatDistance(route.distance_km));
      if (route?.duration_min != null) summaryParts.push(formatDuration(route.duration_min));
      if (!route) {
        summaryParts.push('Route preview is ready, but live navigation could not be loaded. Open the external map link below to continue.');
      }

      if (summaryEl) summaryEl.textContent = summaryParts.join(' ');
      state.steps = route?.steps || [];
      state.routeSummary = route || null;
      renderSteps(stepsEl, state.steps, -1);
      setOpenLink(payload?.directions_url || null);
      setState('ok', route ? 'Route Ready' : 'Preview Only');
      if (input) input.value = destinationLabel;
      setLiveCard(widget, `${modeLabel} to ${destinationLabel}`, route ? `${formatDistance(route.distance_km)} total | ${formatDuration(route.duration_min)} ETA` : 'Preview loaded');
      setSheet(widget, {
        stateText: 'Ready',
        stateClass: 'locked',
        title: `${modeLabel} route preview`,
        subtitle: route ? 'Follow the current position to stay on the line.' : 'Preview loaded.',
        meta: route
          ? `${formatDistance(route.distance_km)} total | ${formatDuration(route.duration_min)} ETA`
          : 'Route preview only',
        progress: 10,
      });
      drawMap(widget, payload);
      if (!state.map || !hasLeaflet) {
        renderSteps(stepsEl, state.steps, -1, true);
        updateGuideControls(widget, state);
      }
    } catch (_) {
      setState('err', 'Unable to load navigation right now.');
      if (summaryEl) summaryEl.textContent = 'Unable to load navigation right now.';
      setLiveCard(widget, 'Navigation unavailable', 'Unable to load navigation right now.');
      updateNavigationSheet(widget, state, -1, null, 'Unavailable');
      renderSteps(stepsEl, []);
      setNextTurn(widget, null, -1);
      setOpenLink(null);
      clearMap(state, widget);
    } finally {
      state.reroutePending = false;
    }
  }

  /* ---------------------------------------------------------------------
   * Place search. Nominatim's first hit is often an administrative polygon
   * whose centroid is nowhere a traveller wants dropping, so the backend now
   * ranks candidates and the UI offers them: suggestions while typing, and a
   * "did you mean" row when the chosen one may be the wrong namesake.
   * ------------------------------------------------------------------- */

  function escapeHtml(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function coordText(candidate) {
    return `${Number(candidate.latitude).toFixed(6)},${Number(candidate.longitude).toFixed(6)}`;
  }

  function ensureSuggestBox(widget, state) {
    if (state.suggestEl) return state.suggestEl;
    const input = getInput(widget);
    const host = input?.parentElement;
    if (!host) return null;
    host.classList.add('nav-search-host');
    const box = document.createElement('div');
    box.className = 'nav-suggest';
    box.hidden = true;
    host.appendChild(box);
    state.suggestEl = box;
    return box;
  }

  function hideSuggestions(state) {
    if (state.suggestEl) {
      state.suggestEl.hidden = true;
      state.suggestEl.innerHTML = '';
    }
    state.suggestions = [];
  }

  function renderSuggestions(widget, state, suggestions) {
    const box = ensureSuggestBox(widget, state);
    if (!box) return;
    state.suggestions = suggestions || [];

    if (!state.suggestions.length) {
      hideSuggestions(state);
      return;
    }

    box.innerHTML = state.suggestions.map((item, index) => `
      <button type="button" class="nav-suggest-item" data-suggest-index="${index}">
        <i class="fas fa-location-dot"></i>
        <span>
          <strong>${escapeHtml(item.label)}</strong>
          <small>${escapeHtml(item.full_label || '')}</small>
        </span>
      </button>
    `).join('');
    box.hidden = false;
  }

  async function fetchSuggestions(widget, state, query) {
    const params = new URLSearchParams({ q: query });
    if (state.lastPosition) {
      params.set('lat', state.lastPosition.latitude);
      params.set('lon', state.lastPosition.longitude);
    }
    try {
      const response = await fetch(`/api/navigation/suggest?${params.toString()}`);
      if (!response.ok) return;
      const payload = await response.json().catch(() => ({}));
      // A slower reply for an older keystroke must not overwrite a newer list.
      if (state.suggestQuery !== query) return;
      renderSuggestions(widget, state, payload.suggestions || []);
    } catch (_) {
      hideSuggestions(state);
    }
  }

  function scheduleSuggestions(widget, state, query) {
    if (state.suggestTimer) window.clearTimeout(state.suggestTimer);
    state.suggestQuery = query;
    if (query.length < 3) {
      hideSuggestions(state);
      return;
    }
    state.suggestTimer = window.setTimeout(() => fetchSuggestions(widget, state, query), 320);
  }

  function ensureDidYouMeanBox(widget, state) {
    if (state.didYouMeanEl) return state.didYouMeanEl;
    const summary = getSummaryEl(widget);
    if (!summary || !summary.parentElement) return null;
    const box = document.createElement('div');
    box.className = 'nav-didyoumean';
    box.hidden = true;
    summary.parentElement.insertBefore(box, summary.nextSibling);
    state.didYouMeanEl = box;
    return box;
  }

  function renderDidYouMean(widget, state, candidates) {
    const box = ensureDidYouMeanBox(widget, state);
    if (!box) return;
    state.candidates = candidates || [];

    if (!state.candidates.length) {
      box.hidden = true;
      box.innerHTML = '';
      return;
    }

    box.innerHTML = `<span class="nav-didyoumean-label">Did you mean</span>${state.candidates.map((item, index) => `
      <button type="button" class="nav-didyoumean-chip" data-candidate-index="${index}" title="${escapeHtml(item.full_label || item.label)}">
        ${escapeHtml(item.label)}
      </button>
    `).join('')}`;
    box.hidden = false;
  }

  /* ---------------------------------------------------------------------
   * 3D view: an optional MapLibre GL camera that mirrors the Leaflet route.
   * Leaflet stays the source of truth for route state; this layer only
   * re-renders it with a tilted camera and extruded buildings. It is
   * lazy-loaded, so a user who never taps "3D" never downloads it.
   * ------------------------------------------------------------------- */

  const MAPLIBRE_JS = 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js';
  const MAPLIBRE_CSS = 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css';
  // OpenFreeMap serves the OpenMapTiles schema without an API key.
  const VECTOR_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
  const PITCH_3D = 60;
  let maplibrePromise = null;

  function loadMapLibre() {
    if (window.maplibregl) return Promise.resolve(window.maplibregl);
    if (maplibrePromise) return maplibrePromise;

    maplibrePromise = new Promise((resolve, reject) => {
      if (!document.querySelector('link[data-maplibre-css]')) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = MAPLIBRE_CSS;
        link.dataset.maplibreCss = 'true';
        document.head.appendChild(link);
      }
      const script = document.createElement('script');
      script.src = MAPLIBRE_JS;
      script.async = true;
      script.onload = () => (window.maplibregl
        ? resolve(window.maplibregl)
        : reject(new Error('MapLibre loaded without a global')));
      script.onerror = () => reject(new Error('MapLibre GL could not be downloaded'));
      document.head.appendChild(script);
    }).catch((error) => {
      maplibrePromise = null;
      throw error;
    });

    return maplibrePromise;
  }

  function get3DButton(widget) {
    return findWidgetElement(widget, ['[data-nav-3d]']);
  }

  function set3DButton(widget, { active = false, busy = false, label = null } = {}) {
    const button = get3DButton(widget);
    if (!button) return;
    button.classList.toggle('is-active', active);
    button.classList.toggle('is-busy', busy);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
    button.disabled = busy;
    const text = label || (active ? '2D' : '3D');
    const icon = busy ? 'fa-spinner fa-spin' : (active ? 'fa-map' : 'fa-cube');
    button.innerHTML = '<i class="fas ' + icon + '"></i> ' + text;
  }

  function ensure3DContainer(state) {
    if (state.threeD.el) return state.threeD.el;
    const shell = state.mapEl?.parentElement;
    if (!shell) return null;
    const el = document.createElement('div');
    el.className = 'nav-3d-map';
    el.setAttribute('aria-label', 'Route map in 3D');
    shell.insertBefore(el, state.mapEl.nextSibling);
    state.threeD.el = el;
    return el;
  }

  function toLngLat(pairs) {
    return (pairs || [])
      .filter((pair) => Array.isArray(pair) && Number.isFinite(pair[0]) && Number.isFinite(pair[1]))
      .map(([lat, lon]) => [lon, lat]);
  }

  function setLineSource(map, id, coords, paint) {
    const data = {
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: coords },
    };
    const source = map.getSource(id);
    if (source) {
      source.setData(data);
      return;
    }
    if (coords.length < 2) return;
    map.addSource(id, { type: 'geojson', data });
    map.addLayer({
      id,
      type: 'line',
      source: id,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint,
    });
  }

  function addBuildingExtrusions(map) {
    if (map.getLayer('nav-3d-buildings') || map.getLayer('building-3d')) return;
    if (!map.getSource('openmaptiles')) return;
    try {
      map.addLayer({
        id: 'nav-3d-buildings',
        type: 'fill-extrusion',
        source: 'openmaptiles',
        'source-layer': 'building',
        minzoom: 14,
        paint: {
          'fill-extrusion-color': '#c7d2e4',
          'fill-extrusion-height': ['coalesce', ['get', 'render_height'], ['get', 'height'], 8],
          'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], ['get', 'min_height'], 0],
          'fill-extrusion-opacity': 0.75,
        },
      });
    } catch (_) {
      // A style without an OpenMapTiles building layer simply stays flat.
    }
  }

  function make3DPin(html) {
    const holder = document.createElement('div');
    holder.innerHTML = html;
    return holder.firstElementChild || holder;
  }

  function clear3DMarkers(state) {
    (state.threeD.markers || []).forEach((marker) => marker.remove());
    state.threeD.markers = [];
  }

  function sync3DRoute(state) {
    const view = state.threeD;
    if (!view.ready || !view.map) return;

    const full = toLngLat(state.routeCoords);
    const drawn = state.revealComplete && full.length ? full : toLngLat(state.drawnCoords);

    setLineSource(view.map, 'nav-3d-route-halo', full, {
      'line-color': '#dbeafe',
      'line-width': 14,
      'line-opacity': 0.9,
    });
    setLineSource(view.map, 'nav-3d-route', drawn, {
      'line-color': '#2563eb',
      'line-width': 7,
      'line-opacity': 0.98,
    });
  }

  function set3DStepActive(state, index) {
    (state.threeD.markers || []).forEach((marker, markerIndex) => {
      const pin = marker.getElement?.();
      if (pin && pin.classList && pin.classList.contains('nav-step-pin')) {
        pin.classList.toggle('is-active', markerIndex === index);
      }
    });
  }

  function sync3DMarkers(widget, state) {
    const view = state.threeD;
    if (!view.ready || !view.map || !window.maplibregl) return;

    clear3DMarkers(state);
    const steps = state.steps || [];
    const revealed = state.revealComplete ? steps.length : state.revealIndex;

    steps.slice(0, revealed).forEach((step, index) => {
      const latLng = stepLatLng(state, index);
      if (!latLng) return;
      const kind = index === 0 ? 'start' : (index === steps.length - 1 ? 'end' : 'turn');
      const glyph = kind === 'end' ? '<i class="fas fa-flag-checkered"></i>' : String(index + 1);
      const pin = make3DPin('<div class="nav-step-pin ' + kind + '">' + glyph + '</div>');
      pin.title = (step && step.instruction) || 'Continue';
      pin.addEventListener('click', () => focusStep(widget, index));
      view.markers.push(new window.maplibregl.Marker({ element: pin })
        .setLngLat([latLng[1], latLng[0]])
        .addTo(view.map));
    });

    set3DStepActive(state, state.guideIndex);
  }

  function sync3DCurrent(state, lat, lon) {
    const view = state.threeD;
    if (!view.ready || !view.map || !window.maplibregl) return;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

    if (!view.currentMarker) {
      const dot = make3DPin('<div class="nav-current-dot pulse"></div>');
      view.currentMarker = new window.maplibregl.Marker({ element: dot })
        .setLngLat([lon, lat])
        .addTo(view.map);
    } else {
      view.currentMarker.setLngLat([lon, lat]);
    }

    const element = view.currentMarker.getElement?.();
    if (element) element.style.setProperty('--nav-heading', (state.headingDeg || 0) + 'deg');
  }

  function focus3D(state, lat, lon, options = {}) {
    const view = state.threeD;
    if (!view.ready || !view.map) return;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

    const { bearing = null, zoom = null, duration = 800 } = options;
    view.map.easeTo({
      center: [lon, lat],
      zoom: zoom == null ? Math.max(view.map.getZoom(), 16) : zoom,
      pitch: PITCH_3D,
      bearing: bearing == null ? view.map.getBearing() : bearing,
      duration,
    });
  }

  function fit3DRoute(state) {
    const view = state.threeD;
    if (!view.ready || !view.map || !window.maplibregl) return;
    const coords = toLngLat(state.routeCoords);
    if (coords.length < 2) return;

    const bounds = coords.reduce(
      (acc, coord) => acc.extend(coord),
      new window.maplibregl.LngLatBounds(coords[0], coords[0]),
    );
    view.map.fitBounds(bounds, { padding: 70, pitch: PITCH_3D, duration: 900 });
  }

  // Every hook below is a no-op until the user actually turns the 3D view on.
  function refresh3D(widget, state, options = {}) {
    if (!state.threeD.ready) return;
    sync3DRoute(state);
    sync3DMarkers(widget, state);
    if (state.lastPosition) {
      sync3DCurrent(state, state.lastPosition.latitude, state.lastPosition.longitude);
    }
    if (options.fit) fit3DRoute(state);
  }

  function clear3D(state) {
    const view = state.threeD;
    if (!view.ready || !view.map) return;
    clear3DMarkers(state);
    view.currentMarker?.remove();
    view.currentMarker = null;
    ['nav-3d-route-halo', 'nav-3d-route'].forEach((id) => {
      if (view.map.getLayer(id)) view.map.removeLayer(id);
      if (view.map.getSource(id)) view.map.removeSource(id);
    });
    view.map.easeTo({
      center: [defaultCenter[1], defaultCenter[0]],
      zoom: defaultZoom,
      pitch: PITCH_3D,
      duration: 600,
    });
  }

  function set3DVisible(state, visible) {
    const shell = state.mapEl?.parentElement;
    if (shell) shell.classList.toggle('is-3d-on', visible);
    if (state.threeD.el) state.threeD.el.classList.toggle('is-visible', visible);
  }

  function build3DMap(state) {
    return loadMapLibre().then((maplibregl) => {
      const container = ensure3DContainer(state);
      if (!container) throw new Error('No map shell to mount the 3D view into');

      const center = state.map ? state.map.getCenter() : { lat: defaultCenter[0], lng: defaultCenter[1] };
      const zoom = state.map ? state.map.getZoom() : defaultZoom;
      const map = new maplibregl.Map({
        container,
        style: VECTOR_STYLE,
        center: [center.lng, center.lat],
        zoom,
        pitch: PITCH_3D,
        bearing: state.headingDeg || 0,
        attributionControl: { compact: true },
      });
      map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
      state.threeD.map = map;

      return new Promise((resolve, reject) => {
        let settled = false;
        let styleReady = false;

        const succeed = () => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timer);
          addBuildingExtrusions(map);
          resolve(map);
        };
        const fail = (error) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timer);
          reject(error);
        };

        // A dead tile host would otherwise leave the button spinning forever,
        // but a style that did arrive is already worth showing.
        const timer = window.setTimeout(() => {
          if (styleReady && map.isStyleLoaded()) succeed();
          else fail(new Error('3D map timed out'));
        }, 30000);

        map.on('styledata', () => { styleReady = true; });
        map.once('load', succeed);
        map.on('error', (event) => {
          // Single tile hiccups are routine; only a style that never lands is fatal.
          if (styleReady) return;
          fail((event && event.error) || new Error('3D map failed to load'));
        });
      });
    });
  }

  async function toggle3D(widget) {
    const state = getState(widget);
    const view = state.threeD;
    if (view.busy) return;

    if (view.enabled) {
      view.enabled = false;
      set3DVisible(state, false);
      set3DButton(widget, { active: false });
      state.map?.invalidateSize();
      return;
    }

    view.busy = true;
    set3DButton(widget, { active: false, busy: true, label: 'Loading' });

    try {
      if (!view.ready) {
        await build3DMap(state);
        view.ready = true;
      }
      view.enabled = true;
      set3DVisible(state, true);
      view.map.resize();
      refresh3D(widget, state, { fit: true });
      if (state.lastPosition && state.followEnabled) {
        focus3D(state, state.lastPosition.latitude, state.lastPosition.longitude, {
          bearing: state.headingDeg || 0,
          zoom: state.travelMode === 'walking' ? 17 : 16,
        });
      }
      set3DButton(widget, { active: true });
    } catch (error) {
      console.warn('[navigation] 3D view unavailable:', error);
      view.enabled = false;
      set3DVisible(state, false);
      set3DButton(widget, { active: false, label: '3D' });
      setLiveCard(widget, '3D view unavailable', 'The 3D map could not load, so the flat map stays on.');
    } finally {
      view.busy = false;
    }
  }


  widgets.forEach((widget) => {
    const state = getState(widget);
    const input = getInput(widget);
    const goBtn = getGoBtn(widget);
    const clearBtn = getClearBtn(widget);
    const followBtn = getFollowBtn(widget);
    const centerBtn = getCenterBtn(widget);
    const modeButtons = getModeButtons(widget);
    const chips = Array.from(widget.querySelectorAll('[data-nav-target]'));

    setModeButtons(widget, state.travelMode);
    setFollowButton(widget, true);
    setLiveCard(widget, 'Waiting for a route', 'Allow location access to follow your trip like Google Maps.');
    setSheet(widget, {
      stateText: 'Ready',
      stateClass: 'locked',
      title: 'Turn-by-turn guide',
      subtitle: 'Use Drive or Walk mode to preview your route.',
      meta: 'Route progress will appear here',
      progress: 0,
    });

    const guideToggle = getGuideToggle(widget);
    const guidePrev = getGuidePrevBtn(widget);
    const guideNext = getGuideNextBtn(widget);
    const guidePlay = getGuidePlayBtn(widget);
    const stepsList = getStepsList(widget);

    setGuideVisibility(widget, false);
    updateGuideControls(widget, state);

    guideToggle?.addEventListener('click', () => {
      const currentState = getState(widget);
      const expanded = !currentState.guideExpanded;
      setGuideVisibility(widget, expanded);
      updateGuideControls(widget, currentState);
      if (expanded && currentState.guideIndex < 0 && (currentState.steps || []).length) {
        focusStep(widget, 0);
      }
      if (!expanded) stopGuidePlayback(widget, currentState);
    });

    guidePrev?.addEventListener('click', () => {
      const currentState = getState(widget);
      stopGuidePlayback(widget, currentState);
      focusStep(widget, currentState.guideIndex - 1);
    });

    guideNext?.addEventListener('click', () => {
      const currentState = getState(widget);
      stopGuidePlayback(widget, currentState);
      focusStep(widget, currentState.guideIndex + 1);
    });

    guidePlay?.addEventListener('click', () => {
      const currentState = getState(widget);
      if (currentState.guidePlaying) {
        stopGuidePlayback(widget, currentState);
      } else {
        if (!currentState.guideExpanded) setGuideVisibility(widget, true);
        startGuidePlayback(widget, currentState);
      }
    });

    stepsList?.addEventListener('click', (event) => {
      const item = event.target.closest('li[data-step-index]');
      if (!item) return;
      const currentState = getState(widget);
      stopGuidePlayback(widget, currentState);
      focusStep(widget, Number.parseInt(item.dataset.stepIndex, 10));
    });

    stepsList?.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const item = event.target.closest('li[data-step-index]');
      if (!item) return;
      event.preventDefault();
      const currentState = getState(widget);
      stopGuidePlayback(widget, currentState);
      focusStep(widget, Number.parseInt(item.dataset.stepIndex, 10));
    });

    const view3dBtn = get3DButton(widget);
    set3DButton(widget, { active: false });
    view3dBtn?.addEventListener('click', () => toggle3D(widget));

    goBtn?.addEventListener('click', () => planRoute(widget));
    followBtn?.addEventListener('click', () => {
      const currentState = getState(widget);
      currentState.followEnabled = !currentState.followEnabled;
      setFollowButton(widget, currentState.followEnabled);
      if (currentState.followEnabled) {
        startFollowWatch(widget);
        if (currentState.currentMarker) {
          const latLng = currentState.currentMarker.getLatLng();
          focusCurrentLocation(currentState, latLng.lat, latLng.lng, true);
        }
      } else {
        clearWatch(currentState);
      }
    });

    centerBtn?.addEventListener('click', () => {
      const currentState = getState(widget);
      if (currentState.currentMarker) {
        const latLng = currentState.currentMarker.getLatLng();
        focusCurrentLocation(currentState, latLng.lat, latLng.lng, true);
      } else {
        currentState.map?.setView(defaultCenter, defaultZoom);
      }
    });

    modeButtons.forEach((button) => {
      button.addEventListener('click', () => {
        const currentState = getState(widget);
        const selectedMode = button.dataset.navMode || 'driving';
        if (currentState.travelMode === selectedMode) return;
        currentState.travelMode = selectedMode;
        setModeButtons(widget, selectedMode);
        if (currentState.lastTarget) {
          planRoute(widget, currentState.lastTarget, {
            originOverride: currentState.lastPosition || undefined,
            reroute: false,
          });
        } else {
          setLiveCard(widget, selectedMode === 'walking' ? 'Walking mode ready' : 'Driving mode ready', 'Pick a destination to start navigation.');
          setSheet(widget, {
            stateText: selectedMode === 'walking' ? 'Walking' : 'Driving',
            stateClass: 'locked',
            title: selectedMode === 'walking' ? 'Walking mode ready' : 'Driving mode ready',
            subtitle: 'Pick a destination to start navigation.',
            meta: 'Route progress will appear here',
            progress: 0,
          });
        }
      });
    });

    clearBtn?.addEventListener('click', () => {
      if (input) input.value = '';
      const summaryEl = getSummaryEl(widget);
      const stepsEl = getStepsList(widget);
      const stateEl = getStateEl(widget);
      const openBtn = getOpenBtn(widget);
      if (summaryEl) summaryEl.textContent = 'Enter a destination to begin navigation.';
      renderSteps(stepsEl, []);
      setNextTurn(widget, null, -1);
      setLiveCard(widget, 'Waiting for a route', 'Allow location access to follow your trip like Google Maps.');
      setSheet(widget, {
        stateText: 'Ready',
        stateClass: 'locked',
        title: 'Turn-by-turn guide',
        subtitle: 'Use Drive or Walk mode to preview your route.',
        meta: 'Route progress will appear here',
        progress: 0,
      });
      if (openBtn) {
        openBtn.href = '#';
        openBtn.classList.add('is-disabled');
        openBtn.setAttribute('aria-disabled', 'true');
      }
      if (stateEl) {
        stateEl.textContent = 'Ready';
        stateEl.className = 'nav-planner-state ready';
      }
      const currentState = getState(widget);
      currentState.followEnabled = true;
      currentState.lastTarget = '';
      currentState.routeSummary = null;
      currentState.reroutePending = false;
      currentState.lastRerouteAt = 0;
      setFollowButton(widget, true);
      clearMap(currentState, widget);
      setModeButtons(widget, currentState.travelMode);
    });

    input?.addEventListener('input', () => {
      scheduleSuggestions(widget, getState(widget), (input.value || '').trim());
    });

    input?.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        hideSuggestions(getState(widget));
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        hideSuggestions(getState(widget));
        planRoute(widget);
      }
    });

    input?.addEventListener('blur', () => {
      // Let a click on a suggestion land before the list disappears.
      window.setTimeout(() => hideSuggestions(getState(widget)), 180);
    });

    widget.addEventListener('click', (event) => {
      const currentState = getState(widget);

      const suggestion = event.target.closest('[data-suggest-index]');
      if (suggestion) {
        const item = currentState.suggestions[Number(suggestion.dataset.suggestIndex)];
        hideSuggestions(currentState);
        if (item) {
          if (input) input.value = item.label;
          // Routing straight to the coordinates skips a second geocode, so the
          // pin lands exactly where the suggestion pointed.
          planRoute(widget, coordText(item), { labelOverride: item.label });
        }
        return;
      }

      const candidate = event.target.closest('[data-candidate-index]');
      if (candidate) {
        const item = currentState.candidates[Number(candidate.dataset.candidateIndex)];
        if (item) {
          if (input) input.value = item.label;
          planRoute(widget, coordText(item), { labelOverride: item.label });
        }
      }
    });

    chips.forEach((chip) => {
      chip.addEventListener('click', () => {
        const target = chip.dataset.navTarget || '';
        if (input) input.value = target;
        planRoute(widget, target);
      });
    });

    const deepLinkTarget = new URLSearchParams(window.location.search).get('nav') || '';
    const defaultTarget = deepLinkTarget || widget.dataset.navDefault || '';
    const autoRun = Boolean(deepLinkTarget) || widget.dataset.navAuto === 'true';
    if (defaultTarget) {
      if (input) input.value = defaultTarget;
      if (autoRun) {
        window.setTimeout(() => planRoute(widget, defaultTarget), 450);
      }
    }
  });
});
