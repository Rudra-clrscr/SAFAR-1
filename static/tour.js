/* ═══════════════════════════════════════════════════════════
   SAFAR Website Tour — guided walkthrough of features + the
   Airavat / Garuda / Mayurya architecture. Vanilla JS, no deps.
   Continues across pages via localStorage so a visitor can be
   walked from Home → Groups → AI Assistant → Safety → Dashboard
   → Identity Ledger in one guided flow.
   ═══════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  const SEEN_KEY = 'safar_tour_seen';
  const CONTINUE_KEY = 'safar_tour_continue';

  const TOURS = {
    home: [
      {
        center: true,
        eyebrow: 'Welcome',
        title: 'Take a 60-second tour of SAFAR',
        text: "See how group travel planning and real-time tourist safety fit together — and meet the three systems running underneath.",
      },
      {
        selector: '#nav-links',
        eyebrow: 'Navigate',
        title: 'Your command bar',
        text: 'Browse travel groups, check the blockchain Identity Ledger, or talk to the AI Assistant from anywhere on the site.',
      },
      {
        selector: '#search-widget',
        eyebrow: 'Start here',
        title: 'Search groups, destinations & safety',
        text: 'Three tabs in one widget — find a travel squad, browse destinations, or check a location\'s live safety score.',
      },
      {
        selector: '#feature-group-travel',
        eyebrow: 'Feature',
        title: 'Travel Squads',
        text: 'Create or join a group, plan a shared destination, and coordinate through real-time group chat.',
      },
      {
        selector: '#feature-tourist-safety',
        eyebrow: 'Feature',
        title: 'Tourist Safety',
        text: 'Live GPS tracking, geo-fenced safety zones, anomaly detection, and a one-tap panic button.',
      },
      {
        selector: '#animals-section',
        eyebrow: 'Architecture',
        title: 'Three systems power SAFAR',
        text: 'Airavat secures identity, Garuda handles live tracking & response, and Mayurya is the AI copilot. Let\'s meet them.',
      },
      {
        selector: '#animal-airavat',
        eyebrow: 'Airavat',
        title: 'Blockchain Security System',
        text: 'Every verified identity, permit, and travel record is written to an immutable ledger — viewable at /blockchain.',
      },
      {
        selector: '#animal-garuda',
        eyebrow: 'Garuda',
        title: 'Tracking & Response System',
        text: 'Monitors live GPS, enforces geo-fences, flags anomalies, and triggers SOS alerts — this is your Safety Dashboard.',
      },
      {
        selector: '#animal-mayurya',
        eyebrow: 'Mayurya',
        title: 'AI Travel Assistant',
        text: 'Ask Mayurya for destination ideas, itineraries, or how any SAFAR feature works — powered by Gemini.',
      },
      {
        selector: '#chatbot-fab',
        eyebrow: 'Try it now',
        title: 'Mayurya is one click away',
        text: 'This chat button follows you around the site — click it anytime you have a question.',
      },
      {
        center: true,
        eyebrow: 'Next stop',
        title: 'See a travel group in action',
        text: 'Continue the tour into Groups to see how squads are created and joined.',
        continueTo: { page: 'groups', href: '/groups', label: 'Continue to Groups →' },
      },
    ],

    groups: [
      {
        center: true,
        eyebrow: 'Sangha · Groups',
        title: 'This is the group workspace',
        text: 'Create a new travel squad or discover and join one that\'s already forming.',
      },
      {
        selector: '#group-create-panel',
        eyebrow: 'Create',
        title: 'Start a new squad',
        text: 'Name your group, pick a destination, and set its type (Public/Private) and size — SAFAR handles the rest.',
      },
      {
        selector: '#groups-explore-panel',
        eyebrow: 'Discover',
        title: 'Search & filter groups',
        text: 'Filter live groups by name or type to find travelers already headed where you\'re going.',
      },
      {
        selector: '#groups-list',
        eyebrow: 'Join',
        title: 'Every card is a live group',
        text: 'Click any group to view its details, chat, and request to join.',
      },
      {
        center: true,
        eyebrow: 'Next stop',
        title: 'Plan your trip with AI',
        text: 'Continue into the Mayurya AI Assistant for destination ideas and itinerary help.',
        continueTo: { page: 'travel', href: '/travel', label: 'Continue to AI Assistant →' },
      },
    ],

    travel: [
      {
        center: true,
        eyebrow: 'Mayurya · AI Assistant',
        title: 'Meet Mayurya, powered by Gemini',
        text: 'Your AI travel copilot — ask about destinations, budgets, itineraries, or how any SAFAR feature works.',
      },
      {
        selector: '#ta-destinations',
        eyebrow: 'Quick start',
        title: 'One-tap prompts',
        text: 'Tap a quick-action tile to jump straight into destinations, safety, groups, or trip planning.',
      },
      {
        selector: '#chatbot-panel, #chatbot-fab',
        eyebrow: 'Chat',
        title: 'Ask anything, anytime',
        text: 'Type a question below or click the chat bubble — Mayurya replies in real time.',
      },
      {
        center: true,
        eyebrow: 'Next stop',
        title: 'Check your Safety Dashboard',
        text: 'Continue into Garuda — SAFAR\'s live tracking and emergency response system.',
        continueTo: { page: 'profile', href: '/profile', label: 'Continue to Safety Dashboard →' },
      },
    ],

    profile: [
      {
        center: true,
        eyebrow: 'Garuda · Safety Dashboard',
        title: 'Your live safety cockpit',
        text: 'Real-time location, safety scoring, geo-fenced zones, and one-tap SOS — all in one place.',
      },
      {
        selector: '#score-ring, #score-num',
        eyebrow: 'Safety Score',
        title: 'Calculated in real time',
        text: 'Your score reacts to location, movement patterns, and proximity to monitored zones.',
      },
      {
        selector: '#userMap, #gps-status',
        eyebrow: 'Live tracking',
        title: 'GPS on the map',
        text: 'Your position updates continuously so your travel group and SAFAR\'s monitoring can see it live.',
      },
      {
        selector: '#garuda-zone-list, #zone-count',
        eyebrow: 'Geo-fencing',
        title: 'Monitored safety zones',
        text: 'SAFAR flags high-risk areas before you enter them, based on live zone data.',
      },
      {
        selector: '#panic-btn',
        eyebrow: 'Emergency',
        title: 'One-tap SOS',
        text: 'Instantly alerts your emergency contacts with your exact location. Hardware/IoT panic devices can trigger this too.',
      },
      {
        center: true,
        eyebrow: 'Next stop',
        title: 'See your personal hub',
        text: 'Continue into your Dashboard for a quick look at your profile and current group.',
        continueTo: { page: 'user_dashboard', href: '/user', label: 'Continue to My Dashboard →' },
      },
    ],

    user_dashboard: [
      {
        center: true,
        eyebrow: 'My Dashboard',
        title: 'Your personal hub',
        text: 'A quick snapshot of your profile and whichever travel group you\'re currently part of.',
      },
      {
        selector: '.profile-card',
        eyebrow: 'Profile',
        title: 'Your account at a glance',
        text: 'Edit your phone, gender, and bio here — or add a Safety Profile if you haven\'t yet.',
      },
      {
        selector: '.my-group-card',
        eyebrow: 'Current group',
        title: 'Your active travel squad',
        text: 'See fellow members and jump straight into the group chat — or find a new group if you\'re not in one yet.',
      },
      {
        center: true,
        eyebrow: 'Last stop',
        title: 'See the Identity Ledger',
        text: 'Continue into Airavat — SAFAR\'s blockchain-backed record of every verified action.',
        continueTo: { page: 'blockchain', href: '/blockchain', label: 'Continue to Identity Ledger →' },
      },
    ],

    blockchain: [
      {
        center: true,
        eyebrow: 'Airavat · Identity Ledger',
        title: 'A trust layer for every action',
        text: 'KYC verifications, group creation, and safety alerts are all written to an immutable ledger.',
      },
      {
        selector: '#stat-blocks, #stat-health',
        eyebrow: 'Ledger health',
        title: 'Live chain statistics',
        text: 'Total blocks recorded and the current integrity status of the chain.',
      },
      {
        selector: '#console, #ledger',
        eyebrow: 'Explore',
        title: 'Browse the live ledger',
        text: 'Query and inspect individual blocks to see exactly what was recorded and when.',
      },
      {
        center: true,
        eyebrow: 'Tour complete',
        title: 'That\'s the full picture',
        text: 'Groups for planning, Garuda for safety, Mayurya for AI help, and Airavat holding the trust layer underneath it all. Explore freely from here.',
      },
    ],
  };

  let steps = [];
  let stepIndex = 0;
  let currentPage = null;

  let blockerEl, spotEl, tooltipEl;

  function ensureDom() {
    if (blockerEl) return;
    blockerEl = document.createElement('div');
    blockerEl.id = 'safar-tour-blocker';

    spotEl = document.createElement('div');
    spotEl.id = 'safar-tour-spot';

    tooltipEl = document.createElement('div');
    tooltipEl.id = 'safar-tour-tooltip';

    document.body.appendChild(blockerEl);
    document.body.appendChild(spotEl);
    document.body.appendChild(tooltipEl);

    document.addEventListener('keydown', onKeydown);
    window.addEventListener('resize', () => renderStep(stepIndex, true), { passive: true });
  }

  function onKeydown(event) {
    if (!steps.length) return;
    if (event.key === 'Escape') end(true);
    else if (event.key === 'ArrowRight' || event.key === 'Enter') advance(1);
    else if (event.key === 'ArrowLeft') advance(-1);
  }

  function findFirstMatch(selectorList) {
    if (!selectorList) return null;
    const selectors = selectorList.split(',').map((s) => s.trim());
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  function buildTooltipContent(step) {
    tooltipEl.innerHTML = '';
    tooltipEl.classList.toggle('centered', !!step.center);

    if (step.eyebrow) {
      const eyebrow = document.createElement('div');
      eyebrow.className = 'safar-tour-eyebrow';
      eyebrow.textContent = step.eyebrow;
      tooltipEl.appendChild(eyebrow);
    }

    const title = document.createElement('div');
    title.className = 'safar-tour-title';
    title.textContent = step.title || '';
    tooltipEl.appendChild(title);

    const text = document.createElement('p');
    text.className = 'safar-tour-text';
    text.textContent = step.text || '';
    tooltipEl.appendChild(text);

    const footer = document.createElement('div');
    footer.className = 'safar-tour-footer';

    const dots = document.createElement('div');
    dots.className = 'safar-tour-dots';
    steps.forEach((_, i) => {
      const dot = document.createElement('span');
      dot.className = 'safar-tour-dot' + (i === stepIndex ? ' active' : '');
      dots.appendChild(dot);
    });
    footer.appendChild(dots);

    const btns = document.createElement('div');
    btns.className = 'safar-tour-btns';

    if (step.continueTo) {
      const skip = document.createElement('button');
      skip.className = 'safar-tour-btn safar-tour-btn-skip';
      skip.textContent = 'End tour';
      skip.addEventListener('click', () => end(true));
      btns.appendChild(skip);

      const go = document.createElement('button');
      go.className = 'safar-tour-btn safar-tour-btn-next';
      go.textContent = step.continueTo.label;
      go.addEventListener('click', () => {
        localStorage.setItem(CONTINUE_KEY, step.continueTo.page);
        localStorage.setItem(SEEN_KEY, '1');
        window.location.href = step.continueTo.href;
      });
      btns.appendChild(go);
    } else {
      const skip = document.createElement('button');
      skip.className = 'safar-tour-btn safar-tour-btn-skip';
      skip.textContent = 'Skip';
      skip.addEventListener('click', () => end(true));
      btns.appendChild(skip);

      if (stepIndex > 0) {
        const prev = document.createElement('button');
        prev.className = 'safar-tour-btn safar-tour-btn-prev';
        prev.textContent = 'Back';
        prev.addEventListener('click', () => advance(-1));
        btns.appendChild(prev);
      }

      const next = document.createElement('button');
      next.className = 'safar-tour-btn safar-tour-btn-next';
      next.textContent = stepIndex === steps.length - 1 ? 'Done' : 'Next';
      next.addEventListener('click', () => {
        if (stepIndex === steps.length - 1) end(true);
        else advance(1);
      });
      btns.appendChild(next);
    }

    footer.appendChild(btns);
    tooltipEl.appendChild(footer);
  }

  function positionAround(rect) {
    const margin = 14;
    const tw = tooltipEl.offsetWidth;
    const th = tooltipEl.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let top, left;
    const spaceBelow = vh - rect.bottom;
    const spaceAbove = rect.top;

    if (spaceBelow >= th + margin || spaceBelow >= spaceAbove) {
      top = Math.min(rect.bottom + margin, vh - th - margin);
    } else {
      top = Math.max(margin, rect.top - th - margin);
    }
    top = Math.max(margin, top);

    left = rect.left + rect.width / 2 - tw / 2;
    left = Math.max(margin, Math.min(left, vw - tw - margin));

    tooltipEl.style.top = `${top}px`;
    tooltipEl.style.left = `${left}px`;
  }

  function renderStep(index, resizeOnly) {
    const step = steps[index];
    if (!step) return;

    if (!resizeOnly) buildTooltipContent(step);

    if (step.center || !step.selector) {
      spotEl.classList.add('no-target');
      spotEl.style.top = '50%';
      spotEl.style.left = '50%';
      spotEl.style.width = '0px';
      spotEl.style.height = '0px';
      tooltipEl.classList.add('centered');
      return;
    }

    const target = findFirstMatch(step.selector);
    if (!target) {
      // Target not on page (conditional render) — skip forward.
      if (!resizeOnly) advance(1, true);
      return;
    }

    target.scrollIntoView({ block: 'center', behavior: 'smooth' });

    window.setTimeout(() => {
      const rect = target.getBoundingClientRect();
      const pad = 8;
      spotEl.classList.remove('no-target');
      spotEl.style.top = `${rect.top - pad}px`;
      spotEl.style.left = `${rect.left - pad}px`;
      spotEl.style.width = `${rect.width + pad * 2}px`;
      spotEl.style.height = `${rect.height + pad * 2}px`;
      positionAround(rect);
    }, resizeOnly ? 0 : 120);
  }

  function advance(delta, skipEmpty) {
    const nextIndex = stepIndex + delta;
    if (nextIndex < 0) return;
    if (nextIndex >= steps.length) {
      end(true);
      return;
    }
    stepIndex = nextIndex;
    renderStep(stepIndex);
  }

  function end(markSeen) {
    steps = [];
    stepIndex = 0;
    if (blockerEl) blockerEl.remove();
    if (spotEl) spotEl.remove();
    if (tooltipEl) tooltipEl.remove();
    blockerEl = spotEl = tooltipEl = null;
    document.removeEventListener('keydown', onKeydown);
    if (markSeen) localStorage.setItem(SEEN_KEY, '1');
  }

  function start(pageKey) {
    const pageSteps = TOURS[pageKey];
    if (!pageSteps || !pageSteps.length) return;
    end(false);
    ensureDom();
    steps = pageSteps;
    stepIndex = 0;
    currentPage = pageKey;
    renderStep(0);
  }

  function showFirstVisitPrompt(pageKey) {
    if (document.getElementById('safar-tour-prompt')) return;
    const prompt = document.createElement('div');
    prompt.id = 'safar-tour-prompt';
    prompt.innerHTML = `
      <h4>New to SAFAR? 👋</h4>
      <p>Take a 60-second guided tour of group travel, safety tracking, and the AI assistant.</p>
      <div class="safar-tour-btns">
        <button class="safar-tour-btn safar-tour-btn-skip" id="safar-tour-prompt-dismiss">Not now</button>
        <button class="safar-tour-btn safar-tour-btn-next" id="safar-tour-prompt-start">Take the tour</button>
      </div>
    `;
    document.body.appendChild(prompt);

    document.getElementById('safar-tour-prompt-dismiss').addEventListener('click', () => {
      localStorage.setItem(SEEN_KEY, '1');
      prompt.remove();
    });
    document.getElementById('safar-tour-prompt-start').addEventListener('click', () => {
      localStorage.setItem(SEEN_KEY, '1');
      prompt.remove();
      start(pageKey);
    });
  }

  window.SafarTour = { start, TOURS };

  document.addEventListener('DOMContentLoaded', () => {
    const page = document.body.dataset.page;
    if (!page || !TOURS[page]) return;

    const triggerBtn = document.getElementById('tour-trigger-btn');
    if (triggerBtn) {
      triggerBtn.addEventListener('click', () => start(page));
    }

    const continuePage = localStorage.getItem(CONTINUE_KEY);
    if (continuePage === page) {
      localStorage.removeItem(CONTINUE_KEY);
      window.setTimeout(() => start(page), 300);
      return;
    }

    if (page === 'home' && !localStorage.getItem(SEEN_KEY)) {
      window.setTimeout(() => showFirstVisitPrompt(page), 1200);
    }
  });
})();
