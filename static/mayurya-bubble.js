/**
 * mayurya-bubble.js — Self-contained Mayurya AI floating chat bubble.
 * Drop this script into any SAFAR page. It will inject its own HTML and CSS,
 * connect to /api/chatbot, and maintain memory via localStorage session_id.
 * Safe to include on travel.html — it auto-detects and skips if a panel exists.
 */
(function () {
  'use strict';

  // Don't inject on pages that already have the full Mayurya panel (travel.html)
  if (document.getElementById('chatbot-panel') || document.getElementById('mayurya-bubble-panel')) {
    return;
  }

  // ── Session ID (persists across pages, keys server-side memory) ──────────
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

  // ── Markdown renderer (bold, italic, code, bullets, line breaks) ─────────
  function renderMarkdown(raw) {
    const esc = raw
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    return esc
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`(.+?)`/g, '<code>$1</code>')
      .replace(/^\d+\.\s+(.+)$/gm, '<li>$1</li>')
      .replace(/^[-•]\s+(.+)$/gm, '<li>$1</li>')
      .replace(/(<li>[\s\S]*?<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`)
      .replace(/^---$/gm, '<hr>')
      // The bubble background lives on the <p> itself, so a split would
      // render one reply as two stacked boxes.
      .replace(/\n{2,}/g, '<br><br>')
      .replace(/\n/g, '<br>');
  }

  // ── Inject CSS ────────────────────────────────────────────────────────────
  const style = document.createElement('style');
  style.id = 'mayurya-bubble-styles';
  style.textContent = `
    #mayurya-bubble-fab {
      position: fixed; bottom: 28px; right: 28px; z-index: 9998;
      display: flex; align-items: center; gap: 10px;
      background: linear-gradient(135deg, #0e9e8a 0%, #09756a 100%);
      color: #fff; border: none; border-radius: 56px;
      padding: 12px 20px 12px 14px; cursor: pointer;
      box-shadow: 0 4px 28px rgba(14,158,138,.5), 0 2px 8px rgba(0,0,0,.45);
      transition: transform .2s, box-shadow .2s;
      font-family: 'Inter', system-ui, sans-serif;
    }
    #mayurya-bubble-fab:hover {
      transform: translateY(-3px) scale(1.04);
      box-shadow: 0 8px 36px rgba(14,158,138,.6), 0 2px 8px rgba(0,0,0,.45);
    }
    #mayurya-bubble-fab .mb-fab-icon { font-size: 1.3rem; line-height: 1; }
    #mayurya-bubble-fab .mb-fab-name { font-size: .85rem; font-weight: 700; letter-spacing: .02em; display: block; }
    #mayurya-bubble-fab .mb-fab-sub  { font-size: .68rem; opacity: .75; display: block; }

    #mayurya-bubble-panel {
      position: fixed; bottom: 100px; right: 28px; z-index: 9999;
      width: 370px; max-height: 540px;
      display: flex; flex-direction: column;
      border-radius: 20px;
      background: rgba(10,10,18,.94);
      backdrop-filter: blur(28px); -webkit-backdrop-filter: blur(28px);
      border: 1px solid rgba(14,158,138,.2);
      box-shadow: 0 12px 52px rgba(0,0,0,.7), 0 0 0 1px rgba(255,255,255,.04);
      transform: translateY(18px) scale(.96); opacity: 0; pointer-events: none;
      transition: transform .25s cubic-bezier(.4,0,.2,1), opacity .25s;
      font-family: 'Inter', system-ui, sans-serif;
    }
    #mayurya-bubble-panel.mb-open {
      transform: translateY(0) scale(1); opacity: 1; pointer-events: all;
    }

    .mb-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 15px 16px 13px;
      border-bottom: 1px solid rgba(255,255,255,.07);
      flex-shrink: 0;
    }
    .mb-header-meta { display: flex; flex-direction: column; gap: 1px; }
    .mb-live {
      display: flex; align-items: center; gap: 5px;
      font-size: .65rem; color: rgba(255,255,255,.45);
      text-transform: uppercase; letter-spacing: .08em;
    }
    .mb-live-dot {
      width: 6px; height: 6px; border-radius: 50%;
      background: #0e9e8a; box-shadow: 0 0 7px #0e9e8a;
      animation: mb-pulse 2.2s ease-in-out infinite;
    }
    @keyframes mb-pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
    .mb-title  { font-size: 1rem; font-weight: 700; color: #fff; line-height: 1.2; }
    .mb-byline { font-size: .68rem; color: rgba(255,255,255,.38); }
    .mb-ctrl   { display: flex; gap: 4px; }
    .mb-ctrl button {
      background: rgba(255,255,255,.06); border: none;
      color: rgba(255,255,255,.45); width: 28px; height: 28px;
      border-radius: 8px; cursor: pointer; font-size: .82rem;
      transition: background .15s, color .15s;
    }
    .mb-ctrl button:hover { background: rgba(255,255,255,.13); color: #fff; }

    .mb-suggestions {
      display: flex; gap: 6px; padding: 10px 14px 0;
      overflow-x: auto; flex-shrink: 0;
      scrollbar-width: none;
    }
    .mb-suggestions::-webkit-scrollbar { display: none; }
    .mb-chip {
      white-space: nowrap; font-size: .7rem; padding: 5px 11px;
      border-radius: 20px; border: 1px solid rgba(14,158,138,.35);
      background: rgba(14,158,138,.1); color: rgba(255,255,255,.75);
      cursor: pointer; transition: background .15s, border-color .15s;
      font-family: inherit;
    }
    .mb-chip:hover { background: rgba(14,158,138,.22); border-color: rgba(14,158,138,.6); color: #fff; }

    .mb-messages {
      flex: 1; overflow-y: auto; padding: 12px 14px 8px;
      display: flex; flex-direction: column; gap: 10px;
      min-height: 200px; max-height: 340px;
      scrollbar-width: thin; scrollbar-color: rgba(14,158,138,.3) transparent;
    }
    .mb-messages::-webkit-scrollbar { width: 3px; }
    .mb-messages::-webkit-scrollbar-thumb { background: rgba(14,158,138,.3); border-radius: 3px; }

    .mb-msg { display: flex; flex-direction: column; max-width: 86%; }
    .mb-msg.mb-user { align-self: flex-end; align-items: flex-end; }
    .mb-msg.mb-bot  { align-self: flex-start; align-items: flex-start; }
    .mb-msg p {
      margin: 0; padding: 9px 13px; border-radius: 14px;
      font-size: .82rem; line-height: 1.58; word-break: break-word;
    }
    .mb-msg.mb-user p {
      background: linear-gradient(135deg, #0e9e8a, #09756a);
      color: #fff; border-bottom-right-radius: 4px;
    }
    .mb-msg.mb-bot p {
      background: rgba(255,255,255,.07);
      color: rgba(255,255,255,.87);
      border: 1px solid rgba(255,255,255,.07);
      border-bottom-left-radius: 4px;
    }
    .mb-msg p ul  { margin: 6px 0 0 16px; padding: 0; }
    .mb-msg p li  { margin-bottom: 3px; }
    .mb-msg p code {
      background: rgba(255,255,255,.1); padding: 1px 5px;
      border-radius: 4px; font-size: .77rem;
    }
    .mb-msg p hr { border: none; border-top: 1px solid rgba(255,255,255,.1); margin: 6px 0; }
    .mb-msg small { font-size: .6rem; color: rgba(255,255,255,.25); margin-top: 3px; padding: 0 3px; }

    .mb-action {
      align-self: flex-start; text-decoration: none;
      font-size: .76rem; font-weight: 600; padding: 8px 14px;
      border-radius: 11px; color: #fff;
      background: linear-gradient(135deg, #0e9e8a, #09756a);
      box-shadow: 0 3px 14px rgba(14,158,138,.35);
      transition: transform .15s, box-shadow .15s;
    }
    .mb-action:hover { transform: translateY(-1px); box-shadow: 0 6px 20px rgba(14,158,138,.5); }

    .mb-typing-wrap { align-self: flex-start; }
    .mb-typing {
      display: flex; align-items: center; gap: 4px;
      padding: 9px 13px; background: rgba(255,255,255,.07);
      border: 1px solid rgba(255,255,255,.07);
      border-radius: 14px; border-bottom-left-radius: 4px;
    }
    .mb-typing span {
      width: 6px; height: 6px; border-radius: 50%;
      background: rgba(14,158,138,.85);
      animation: mb-bounce 1.2s ease-in-out infinite;
    }
    .mb-typing span:nth-child(2) { animation-delay: .16s; }
    .mb-typing span:nth-child(3) { animation-delay: .32s; }
    @keyframes mb-bounce {
      0%,60%,100% { transform: translateY(0); opacity: .6; }
      30% { transform: translateY(-5px); opacity: 1; }
    }

    .mb-input-row {
      display: flex; align-items: center; gap: 8px;
      padding: 11px 13px; border-top: 1px solid rgba(255,255,255,.07);
      flex-shrink: 0;
    }
    .mb-input-row input {
      flex: 1; background: rgba(255,255,255,.06);
      border: 1px solid rgba(255,255,255,.1); border-radius: 10px;
      color: #fff; font-size: .81rem; padding: 9px 12px;
      outline: none; font-family: inherit;
      transition: border-color .15s;
    }
    .mb-input-row input:focus { border-color: rgba(14,158,138,.55); }
    .mb-input-row input::placeholder { color: rgba(255,255,255,.22); }
    .mb-send {
      width: 35px; height: 35px; flex-shrink: 0;
      background: linear-gradient(135deg, #0e9e8a, #09756a);
      border: none; border-radius: 10px; color: #fff;
      cursor: pointer; display: flex; align-items: center; justify-content: center;
      transition: transform .15s, box-shadow .15s;
    }
    .mb-send:hover { transform: scale(1.09); box-shadow: 0 4px 18px rgba(14,158,138,.45); }
    .mb-send:disabled { opacity: .45; cursor: default; transform: none; }

    @media (max-width: 480px) {
      #mayurya-bubble-panel { width: calc(100vw - 20px); right: 10px; bottom: 84px; }
      #mayurya-bubble-fab   { right: 10px; bottom: 14px; }
    }
  `;
  document.head.appendChild(style);

  // ── Inject HTML ───────────────────────────────────────────────────────────
  const root = document.createElement('div');
  root.id = 'mayurya-bubble-root';
  root.innerHTML = `
    <button id="mayurya-bubble-fab" aria-label="Open Mayurya AI assistant" aria-expanded="false">
      <span class="mb-fab-icon">🦚</span>
      <span>
        <span class="mb-fab-name">Mayurya</span>
        <span class="mb-fab-sub">Ask anything</span>
      </span>
    </button>

    <div id="mayurya-bubble-panel" role="dialog" aria-modal="true" aria-label="Mayurya AI Chat">
      <div class="mb-header">
        <div class="mb-header-meta">
          <span class="mb-live"><span class="mb-live-dot"></span>Live assistant</span>
          <span class="mb-title">Mayurya AI</span>
          <span class="mb-byline">Travel planning, safety &amp; platform help</span>
        </div>
        <div class="mb-ctrl">
          <button id="mb-clear" aria-label="Clear chat" title="Clear chat">↺</button>
          <button id="mb-close" aria-label="Close chat" title="Close">✕</button>
        </div>
      </div>

      <div class="mb-suggestions">
        <button class="mb-chip" data-prompt="Suggest a 3-day Jaipur itinerary">🗺️ Jaipur itinerary</button>
        <button class="mb-chip" data-prompt="What safety tips should I know in Goa?">🛡️ Goa safety</button>
        <button class="mb-chip" data-prompt="Estimate my budget for a trip to Manali">💰 Budget help</button>
        <button class="mb-chip" data-prompt="Find hotels in Kerala under ₹2000">🏨 Hotels</button>
      </div>

      <div class="mb-messages" id="mb-messages"></div>

      <div class="mb-input-row">
        <input type="text" id="mb-input" placeholder="Ask me anything about travel…" autocomplete="off" aria-label="Chat message">
        <button class="mb-send" id="mb-send" aria-label="Send message">
          <svg width="15" height="15" fill="currentColor" viewBox="0 0 24 24">
            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
          </svg>
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(root);

  // ── DOM refs ──────────────────────────────────────────────────────────────
  const fab     = document.getElementById('mayurya-bubble-fab');
  const panel   = document.getElementById('mayurya-bubble-panel');
  const closeBtn = document.getElementById('mb-close');
  const clearBtn = document.getElementById('mb-clear');
  const input   = document.getElementById('mb-input');
  const sendBtn = document.getElementById('mb-send');
  const msgBox  = document.getElementById('mb-messages');
  const chips   = Array.from(document.querySelectorAll('.mb-chip'));

  // ── State ─────────────────────────────────────────────────────────────────
  let isOpen    = false;
  let isWaiting = false;

  // ── Helpers ───────────────────────────────────────────────────────────────
  function appendMsg(text, who) {
    const wrap = document.createElement('div');
    wrap.className = 'mb-msg mb-' + who;
    const p = document.createElement('p');
    if (who === 'bot') { p.innerHTML = renderMarkdown(text); }
    else { p.textContent = text; }
    wrap.appendChild(p);
    const ts = document.createElement('small');
    ts.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    wrap.appendChild(ts);
    msgBox.appendChild(wrap);
    msgBox.scrollTop = msgBox.scrollHeight;
  }

  // Mayurya can offer a button that jumps to the page it just talked about.
  function appendAction(action) {
    if (!action || action.type !== 'navigate' || !action.url) return;
    const link = document.createElement('a');
    link.className = 'mb-action';
    link.href = action.url;
    link.textContent = action.label || 'Open';
    msgBox.appendChild(link);
    msgBox.scrollTop = msgBox.scrollHeight;
  }

  function showTyping() {
    if (document.getElementById('mb-typing')) return;
    const wrap = document.createElement('div');
    wrap.className = 'mb-typing-wrap';
    wrap.id = 'mb-typing-wrap';
    wrap.innerHTML = '<div class="mb-typing" id="mb-typing"><span></span><span></span><span></span></div>';
    msgBox.appendChild(wrap);
    msgBox.scrollTop = msgBox.scrollHeight;
  }

  function hideTyping() {
    const el = document.getElementById('mb-typing-wrap');
    if (el) el.remove();
  }

  function setWaiting(val) {
    isWaiting = val;
    sendBtn.disabled = val;
    input.disabled = val;
  }

  function openPanel() {
    isOpen = true;
    panel.classList.add('mb-open');
    fab.setAttribute('aria-expanded', 'true');
    if (msgBox.children.length === 0) {
      appendMsg(
        "Hi! I'm Mayurya — your SAFAR travel and safety assistant. I can help with:\n- Destination discovery & itineraries\n- Budget estimation\n- Hotel and restaurant search\n- Safety guidance\n- SAFAR platform help\n\nWhat's on your mind?",
        'bot'
      );
    }
    input.focus();
  }

  function closePanel() {
    isOpen = false;
    panel.classList.remove('mb-open');
    fab.setAttribute('aria-expanded', 'false');
  }

  // ── Chat logic ─────────────────────────────────────────────────────────────
  async function sendMessage(presetText) {
    if (isWaiting) return;
    const text = (presetText || input.value || '').trim();
    if (!text) return;

    appendMsg(text, 'user');
    input.value = '';
    setWaiting(true);
    showTyping();

    try {
      const res = await fetch('/api/chatbot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, session_id: getSessionId() }),
      });
      hideTyping();

      if (!res.ok) {
        appendMsg("Sorry, I couldn't connect to the assistant right now. Please try again.", 'bot');
        return;
      }

      const data = await res.json();
      appendMsg(data.response || "I'm ready to help with your travel questions.", 'bot');
      appendAction(data.action);
    } catch (_) {
      hideTyping();
      appendMsg('Connection issue detected. Please try again in a moment.', 'bot');
    } finally {
      setWaiting(false);
    }
  }

  // ── Events ────────────────────────────────────────────────────────────────
  fab.addEventListener('click', () => isOpen ? closePanel() : openPanel());
  closeBtn.addEventListener('click', closePanel);

  clearBtn.addEventListener('click', () => {
    // A fresh session id is what drops the server-side conversation memory.
    localStorage.setItem('mayurya_session_id', newSessionId());
    msgBox.innerHTML = '';
    appendMsg("Chat cleared. What can I help you with?", 'bot');
  });

  sendBtn.addEventListener('click', () => sendMessage());
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) sendMessage(); });

  chips.forEach((chip) => {
    chip.addEventListener('click', () => {
      if (!isOpen) openPanel();
      sendMessage(chip.dataset.prompt);
    });
  });

  // Close panel on outside click
  document.addEventListener('click', (e) => {
    if (isOpen && !root.contains(e.target)) closePanel();
  });

  // Escape key closes panel
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen) closePanel();
  });
})();
