document.addEventListener('DOMContentLoaded', () => {
  const nav = document.getElementById('main-nav');
  const gitaBar = document.getElementById('gita-quote-bar');
  const hero = document.getElementById('hero-section');
  const heroBg = document.getElementById('mayurya-bg');
  const pagePetals = document.getElementById('petals-container');
  const menuToggle = document.getElementById('menu-toggle');
  const navLinks = document.getElementById('nav-links');
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const fab = document.getElementById('chatbot-fab');
  const panel = document.getElementById('chatbot-panel');
  const closeBtn = document.getElementById('chatbot-close');
  const clearBtn = document.getElementById('chatbot-clear');
  const input = document.getElementById('chatbot-input');
  const sendBtn = document.getElementById('chatbot-send');
  const msgBox = document.getElementById('chatbot-msgs');
  const suggestionButtons = Array.from(document.querySelectorAll('[data-chat-prompt]'));

  const heroMotion = {
    scrollOffset: 0,
    moveX: 0,
    moveY: 0,
  };

  function syncHeroBg() {
    if (!heroBg) return;
    heroBg.style.transform = `scale(1.08) translate3d(${heroMotion.moveX}px, ${heroMotion.moveY + heroMotion.scrollOffset}px, 0)`;
  }

  if (nav) {
    let lastScrollY = window.scrollY;
    window.addEventListener('scroll', () => {
      const currentY = window.scrollY;
      const heroHeight = hero ? hero.offsetHeight * 0.15 : 120;
      nav.classList.toggle('scrolled', currentY > heroHeight);

      if (currentY > lastScrollY + 6 && currentY > 110) {
        nav.classList.add('nav-hidden');
      } else if (currentY < lastScrollY - 4 || currentY <= 24) {
        nav.classList.remove('nav-hidden');
      }

      if (gitaBar) {
        gitaBar.classList.toggle('gita-soft-scrolled', currentY > 24);
      }

      if (heroBg) {
        heroMotion.scrollOffset = Math.max(-18, currentY * -0.06);
        syncHeroBg();
      }

      lastScrollY = currentY;
    }, { passive: true });
  }

  if (hero && heroBg && !prefersReducedMotion) {
    hero.addEventListener('mousemove', (event) => {
      const rect = hero.getBoundingClientRect();
      const offsetX = (event.clientX - rect.left - rect.width / 2) / rect.width;
      const offsetY = (event.clientY - rect.top - rect.height / 2) / rect.height;
      heroMotion.moveX = offsetX * 14;
      heroMotion.moveY = offsetY * 12;
      syncHeroBg();
    });

    hero.addEventListener('mouseleave', () => {
      heroMotion.moveX = 0;
      heroMotion.moveY = 0;
      syncHeroBg();
    });
  }

  if (menuToggle && navLinks) {
    menuToggle.addEventListener('click', () => navLinks.classList.toggle('open'));
    navLinks.querySelectorAll('a').forEach((anchor) => {
      anchor.addEventListener('click', () => navLinks.classList.remove('open'));
    });
  }

  // ── Lightweight markdown → HTML renderer ──────────────────────────────
  // Handles: **bold**, *italic*, `code`, bullet lists, and line breaks.
  // Keeps output safe by escaping HTML first.
  function renderMarkdown(raw) {
    const esc = raw
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    return esc
      // Bold & italic
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      // Inline code
      .replace(/`(.+?)`/g, '<code>$1</code>')
      // Numbered lists  "1. Foo"
      .replace(/^\d+\.\s+(.+)$/gm, '<li>$1</li>')
      // Bullet lists "- Foo" or "• Foo"
      .replace(/^[-•]\s+(.+)$/gm, '<li>$1</li>')
      // Wrap consecutive <li> elements in a <ul>
      .replace(/(<li>.*<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`)
      // Horizontal rule
      .replace(/^---$/gm, '<hr>')
      // Line breaks (double newline → paragraph break)
      .replace(/\n\n/g, '</p><p>')
      .replace(/\n/g, '<br>');
  }

  function appendMsg(text, who) {
    if (!msgBox) return;
    const wrapper = document.createElement('div');
    wrapper.className = `chat-msg ${who}`;

    const message = document.createElement('p');
    if (who === 'bot') {
      message.innerHTML = renderMarkdown(text);
    } else {
      message.textContent = text;
    }
    wrapper.appendChild(message);

    const stamp = document.createElement('small');
    stamp.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    wrapper.appendChild(stamp);

    msgBox.appendChild(wrapper);
    msgBox.scrollTop = msgBox.scrollHeight;
  }

  function showTyping() {
    if (!msgBox || document.getElementById('typing-indicator')) return;
    const indicator = document.createElement('div');
    indicator.className = 'typing-dots';
    indicator.id = 'typing-indicator';
    indicator.innerHTML = '<span></span><span></span><span></span>';
    msgBox.appendChild(indicator);
    msgBox.scrollTop = msgBox.scrollHeight;
  }

  function hideTyping() {
    const indicator = document.getElementById('typing-indicator');
    if (indicator) indicator.remove();
  }

  // ── Persistent session ID keying Mayurya's server-side memory ─────────
  function newSessionId() {
    return (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  function getSessionId() {
    let sid = localStorage.getItem('mayurya_session_id');
    if (!sid) {
      sid = newSessionId();
      localStorage.setItem('mayurya_session_id', sid);
    }
    return sid;
  }

  // Mayurya can offer a button that jumps to the page it just talked about.
  function appendAction(action) {
    if (!msgBox || !action || action.type !== 'navigate' || !action.url) return;
    const link = document.createElement('a');
    link.className = 'chat-action';
    link.href = action.url;
    link.textContent = action.label || 'Open';
    msgBox.appendChild(link);
    msgBox.scrollTop = msgBox.scrollHeight;
  }

  async function getBotResponse(message) {
    showTyping();

    try {
      const response = await fetch('/api/chatbot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, session_id: getSessionId() }),
      });

      hideTyping();

      if (!response.ok) {
        // 404 means the proxy route is missing (dev build without Flask running).
        if (response.status === 404) {
          appendMsg(
            'Mayurya AI is not yet connected in this preview. Restart the Flask server so the n8n agent can respond.',
            'bot'
          );
          return;
        }
        let errorMessage = "Sorry, I couldn't process that right now.";
        try {
          const errorBody = await response.json();
          errorMessage = errorBody.error || errorMessage;
        } catch (_) { /* ignore */ }
        appendMsg(errorMessage, 'bot');
        return;
      }

      const payload = await response.json();
      appendMsg(payload.response || 'I am ready to help with your next travel question.', 'bot');
      appendAction(payload.action);
    } catch (_) {
      hideTyping();
      appendMsg('Connection issue detected. Please try again in a moment.', 'bot');
    }
  }

  function sendMessage(presetText) {
    if (!msgBox) return;
    const text = (presetText || input?.value || '').trim();
    if (!text) return;
    appendMsg(text, 'user');
    if (input) input.value = '';
    getBotResponse(text);
  }

  window.askBot = function askBot(question) {
    if (!panel || !input) return;
    panel.classList.add('open');
    input.value = question;
    input.focus();
    sendMessage(question);
  };

  if (fab && panel) {
    fab.addEventListener('click', () => {
      panel.classList.toggle('open');
      if (panel.classList.contains('open') && input) input.focus();
    });
  }

  if (closeBtn && panel) {
    closeBtn.addEventListener('click', () => panel.classList.remove('open'));
  }

  if (clearBtn && msgBox) {
    clearBtn.addEventListener('click', () => {
      // A fresh session id is what drops the server-side conversation memory.
      localStorage.setItem('mayurya_session_id', newSessionId());
      msgBox.innerHTML = '';
      appendMsg('Chat cleared. Ask Mayurya anything.', 'bot');
    });
  }

  if (sendBtn) {
    sendBtn.addEventListener('click', () => sendMessage());
  }

  if (input) {
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') sendMessage();
    });
  }

  suggestionButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const prompt = button.dataset.chatPrompt || '';
      if (!prompt) return;
      if (panel) panel.classList.add('open');
      if (input) input.focus();
      sendMessage(prompt);
    });
  });

  if (!document.getElementById('global-loader')) {
    const loader = document.createElement('div');
    loader.id = 'global-loader';
    loader.className = 'page-loader';
    loader.innerHTML = '<div class="loader-logo">SAFAR</div>';
    document.body.prepend(loader);
  }

  if (!document.getElementById('custom-cursor')) {
    const cursor = document.createElement('div');
    cursor.id = 'custom-cursor';
    cursor.className = 'custom-cursor';
    document.body.appendChild(cursor);
  }

  const loader = document.getElementById('global-loader');
  if (loader) {
    window.setTimeout(() => {
      loader.classList.add('hidden');
      window.setTimeout(() => {
        loader.style.display = 'none';
      }, 800);
    }, 500);
  }

  const cursor = document.getElementById('custom-cursor');
  if (cursor && !prefersReducedMotion) {
    document.addEventListener('mousemove', (event) => {
      cursor.style.left = `${event.clientX}px`;
      cursor.style.top = `${event.clientY}px`;
    });

    document.querySelectorAll('a, button, .card, .card-3d, .travel-action-card, input, select').forEach((element) => {
      element.addEventListener('mouseenter', () => cursor.classList.add('hovering'));
      element.addEventListener('mouseleave', () => cursor.classList.remove('hovering'));
    });
  }

  const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('active', 'visible');
      }
    });
  }, { threshold: 0.14, rootMargin: '0px 0px -40px 0px' });

  document.querySelectorAll('.reveal, .hero-v2').forEach((element) => revealObserver.observe(element));

  document.querySelectorAll('.card-3d').forEach((card) => {
    card.addEventListener('mousemove', (event) => {
      const rect = card.getBoundingClientRect();
      const rotateY = ((event.clientX - rect.left) / rect.width - 0.5) * 18;
      const rotateX = ((event.clientY - rect.top) / rect.height - 0.5) * -18;
      card.style.transform =
        `perspective(1200px) rotateY(${rotateY}deg) rotateX(${rotateX}deg) translateY(-6px) scale(1.02)`;
    });

    card.addEventListener('mouseleave', () => {
      card.style.transform = '';
    });
  });

  document.querySelectorAll('[data-tilt]').forEach((element) => {
    element.addEventListener('mousemove', (event) => {
      const rect = element.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;
      const rotateX = ((y - centerY) / centerY) * -10;
      const rotateY = ((x - centerX) / centerX) * 10;
      element.style.transform =
        `perspective(1200px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-4px)`;
    });

    element.addEventListener('mouseleave', () => {
      element.style.transform = '';
    });
  });

  (function initMayuryaCanvas() {
    const canvas = document.getElementById('mayurya-shard-canvas');
    if (!canvas || prefersReducedMotion) return;

    const ctx = canvas.getContext('2d');
    const particles = [];
    let width = 0;
    let height = 0;

    function resizeCanvas() {
      width = canvas.width = canvas.parentElement?.offsetWidth || window.innerWidth;
      height = canvas.height = canvas.parentElement?.offsetHeight || window.innerHeight;
    }

    function buildParticles() {
      particles.length = 0;
      for (let index = 0; index < 72; index += 1) {
        particles.push({
          x: Math.random() * width,
          y: Math.random() * height,
          size: 1 + Math.random() * 2.6,
          driftX: (Math.random() - 0.5) * 0.6,
          driftY: 0.2 + Math.random() * 0.8,
          hue: [38, 168, 190][Math.floor(Math.random() * 3)],
          alpha: 0.2 + Math.random() * 0.4,
        });
      }
    }

    function draw() {
      ctx.clearRect(0, 0, width, height);
      particles.forEach((particle) => {
        particle.y += particle.driftY;
        particle.x += particle.driftX;

        if (particle.y > height + 20) particle.y = -10;
        if (particle.x < -20) particle.x = width + 10;
        if (particle.x > width + 20) particle.x = -10;

        ctx.beginPath();
        ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${particle.hue}, 100%, 65%, ${particle.alpha})`;
        ctx.shadowBlur = 18;
        ctx.shadowColor = `hsla(${particle.hue}, 100%, 60%, ${particle.alpha})`;
        ctx.fill();
      });

      window.requestAnimationFrame(draw);
    }

    resizeCanvas();
    buildParticles();
    window.addEventListener('resize', () => {
      resizeCanvas();
      buildParticles();
    }, { passive: true });
    draw();
  })();

  (function spawnPetals() {
    if (prefersReducedMotion || !pagePetals) return;

    function makePetal() {
      const petal = document.createElement('span');
      petal.className = 'petal page-petal';
      petal.textContent = '✦';
      petal.style.left = `${Math.random() * 100}vw`;
      petal.style.bottom = `${Math.random() * 44 - 20}vh`;
      petal.style.opacity = `${0.2 + Math.random() * 0.45}`;
      petal.style.fontSize = `${0.8 + Math.random() * 1.2}rem`;
      petal.style.animationDuration = `${10 + Math.random() * 14}s`;
      petal.style.animationDelay = `${Math.random() * 4}s`;
      pagePetals.appendChild(petal);
      window.setTimeout(() => petal.remove(), 22000);
    }

    for (let index = 0; index < 18; index += 1) makePetal();
    window.setInterval(makePetal, 1100);
  })();
});
