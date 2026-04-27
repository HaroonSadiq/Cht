// FlowBot Assistant — floating chat widget.
// Self-contained: builds its own DOM, owns its state, no framework.
// Knowledge base lives below — edit it to update the assistant.

(function () {
  'use strict';
  if (window.__fbaLoaded) return;
  window.__fbaLoaded = true;

  // ─── Knowledge base ───────────────────────────────────────
  // Each entry: tags (lowercased keywords for matching) + answer (HTML allowed).
  const KB = [
    {
      id: 'product',
      title: 'What does FlowBot do?',
      tags: ['what', 'flowbot', 'product', 'about', 'do', 'does', 'service', 'overview'],
      answer:
        '<p><strong>FlowBot turns Facebook & Instagram comments into private DM conversations.</strong></p>' +
        '<p>When someone comments your trigger keyword on a post, FlowBot publicly replies and instantly sends them a DM with whatever you set up — a link, coupon, info pack, anything.</p>' +
        '<p>Result: you stop manually replying to every comment, and your customers get answers in seconds.</p>',
    },
    {
      id: 'flow',
      title: 'How does the comment-to-DM flow work?',
      tags: ['how', 'work', 'works', 'flow', 'comment', 'dm', 'trigger', 'mechanic', 'process', 'steps'],
      answer:
        '<p>The flow runs in 4 steps:</p>' +
        '<ol>' +
        '<li><strong>Connect</strong> your Facebook Page through Facebook Login for Business.</li>' +
        '<li><strong>Set a rule</strong> — pick a keyword (e.g. "PRICE") and write the DM you want sent.</li>' +
        '<li><strong>Customer comments</strong> the keyword on any of your posts.</li>' +
        '<li><strong>FlowBot replies publicly</strong> ("Just sent you a DM 👀") and DMs them privately — all within ~10 seconds.</li>' +
        '</ol>',
    },
    {
      id: 'connect',
      title: 'How do I connect my Facebook page?',
      tags: ['connect', 'facebook', 'page', 'integrate', 'login', 'oauth', 'authorize', 'link'],
      answer:
        '<p>From your <a href="/dashboard">FlowBot dashboard</a>:</p>' +
        '<ol>' +
        '<li>Click <strong>Connect Facebook Page</strong>.</li>' +
        '<li>Sign in with the Facebook account that admins your Page.</li>' +
        '<li>Grant the requested permissions (we explain each one).</li>' +
        '<li>Pick which Page to automate.</li>' +
        '</ol>' +
        '<p>FlowBot subscribes to your Page\'s comment + message webhooks automatically. No code, no copy-pasting tokens.</p>',
    },
    {
      id: 'permissions',
      title: 'What permissions do you need?',
      tags: ['permissions', 'scopes', 'access', 'data', 'request', 'meta', 'facebook', 'instagram'],
      answer:
        '<p>We request 6 Facebook permissions, each used for one specific thing:</p>' +
        '<ul>' +
        '<li><strong>pages_show_list</strong> — to list the Pages you can connect</li>' +
        '<li><strong>pages_manage_metadata</strong> — to subscribe your Page to webhooks</li>' +
        '<li><strong>pages_read_engagement</strong> — to receive comment events</li>' +
        '<li><strong>pages_read_user_content</strong> — to read the comment text and match keywords</li>' +
        '<li><strong>pages_manage_engagement</strong> — to post the public reply</li>' +
        '<li><strong>pages_messaging</strong> — to send the DM</li>' +
        '</ul>' +
        '<p>We never read messages outside the comment-to-DM flow, and we never post anything you didn\'t configure.</p>',
    },
    {
      id: 'platforms',
      title: 'Which platforms do you support?',
      tags: ['platforms', 'support', 'instagram', 'tiktok', 'whatsapp', 'channels'],
      answer:
        '<p><strong>Today:</strong> Facebook Pages, Instagram Business accounts, and TikTok.</p>' +
        '<p><strong>Coming soon:</strong> WhatsApp Business.</p>' +
        '<p>Each integration uses the platform\'s official API — no scraping, no unofficial tricks.</p>',
    },
    {
      id: 'pricing',
      title: 'How much does FlowBot cost?',
      tags: ['pricing', 'cost', 'price', 'plan', 'tier', 'free', 'paid', 'subscription', 'monthly'],
      answer:
        '<p>FlowBot is <strong>$49/month</strong> for the Pro plan, which covers:</p>' +
        '<ul>' +
        '<li>Unlimited Facebook & Instagram pages</li>' +
        '<li>Unlimited comment-to-DM rules</li>' +
        '<li>Unlimited DMs (within Meta\'s rate limits)</li>' +
        '<li>Real-time analytics + activity feed</li>' +
        '</ul>' +
        '<p>You can cancel anytime from your dashboard.</p>',
    },
    {
      id: 'data-handling',
      title: 'How do you handle my data?',
      tags: ['data', 'privacy', 'handle', 'store', 'secure', 'security', 'gdpr', 'safe', 'protect'],
      answer:
        '<p>We treat your data with the same care we\'d want for our own:</p>' +
        '<ul>' +
        '<li><strong>Access tokens</strong> are AES-256-GCM encrypted at rest</li>' +
        '<li><strong>Webhook payloads</strong> are HMAC-verified and rejected if signatures don\'t match</li>' +
        '<li><strong>No selling, no ads</strong> — your data is never shared with third parties</li>' +
        '<li><strong>Deletion is one click</strong> — disconnect anytime and we wipe everything</li>' +
        '</ul>' +
        '<p>Full details in our <a href="/privacy">Privacy Policy</a>.</p>',
    },
    {
      id: 'delete-data',
      title: 'How do I delete my data?',
      tags: ['delete', 'remove', 'data', 'account', 'wipe', 'erase', 'right', 'gdpr'],
      answer:
        '<p>Three ways to remove your data from FlowBot:</p>' +
        '<ol>' +
        '<li><strong>Disconnect from your dashboard</strong> — instant deletion of that integration.</li>' +
        '<li><strong>Remove FlowBot from Facebook Settings</strong> → Business Integrations. Facebook notifies us automatically and we delete within 30 days.</li>' +
        '<li><strong>Email us</strong> at <a href="mailto:mharoonsadiq8@gmail.com">mharoonsadiq8@gmail.com</a>.</li>' +
        '</ol>' +
        '<p>You can verify the deletion at <a href="/data-deletion-status">/data-deletion-status</a>.</p>',
    },
    {
      id: 'cancel',
      title: 'How do I cancel my subscription?',
      tags: ['cancel', 'unsubscribe', 'stop', 'end', 'terminate', 'downgrade', 'subscription'],
      answer:
        '<p>Cancel anytime from your <a href="/dashboard">dashboard</a> → Settings → Billing.</p>' +
        '<p>Your access continues through the end of the current billing period. No long-term contracts, no cancellation fees.</p>',
    },
    {
      id: 'terms',
      title: 'What are the terms of service?',
      tags: ['terms', 'tos', 'service', 'agreement', 'legal', 'rules', 'conditions'],
      answer:
        '<p>The full <a href="/terms">Terms of Service</a> covers: acceptable use, data ownership, payment terms, liability, and termination.</p>' +
        '<p>The short version: <strong>your data is yours, our service is metered fairly, we won\'t mess you around, you don\'t use FlowBot for spam or anything that violates Meta\'s policies.</strong></p>',
    },
    {
      id: 'compliance',
      title: 'Are you Meta-approved?',
      tags: ['meta', 'approved', 'review', 'compliance', 'verified', 'official', 'sanctioned'],
      answer:
        '<p>FlowBot is built using Meta\'s official Graph API and Facebook Login for Business — the same APIs ManyChat and Chatfuel use.</p>' +
        '<p>The app is currently in <strong>Meta App Review</strong>. Once approved, FlowBot is publicly available to any Facebook Page admin without restrictions.</p>',
    },
    {
      id: 'spam',
      title: 'Will I get banned for spamming?',
      tags: ['spam', 'ban', 'banned', 'limit', 'rate', 'block', 'policy', 'violate'],
      answer:
        '<p>FlowBot follows Meta\'s 24-hour Standard Messaging window — you can only DM users who interacted with your Page in the last 24 hours.</p>' +
        '<p>We also rate-limit outbound DMs to stay well below Meta\'s thresholds. If you set up rules within Meta\'s rules, you\'re safe.</p>' +
        '<p>What\'ll get you banned: messaging users who never opted in, or sending content that violates Meta\'s Community Standards.</p>',
    },
    {
      id: 'support',
      title: 'How do I get support?',
      tags: ['support', 'help', 'contact', 'team', 'human', 'email', 'reach'],
      answer:
        '<p>Email <a href="mailto:mharoonsadiq8@gmail.com">mharoonsadiq8@gmail.com</a> — we respond within 24 hours.</p>' +
        '<p>For urgent webhook or delivery issues, include your integration ID and a timestamp.</p>',
    },
    {
      id: 'company',
      title: 'Who runs FlowBot?',
      tags: ['who', 'company', 'team', 'owner', 'founder', 'haroon', 'pakistan', 'business'],
      answer:
        '<p>FlowBot is operated by <strong>Muhammad Haroon Sadiq</strong>, based in Pakistan.</p>' +
        '<p>Reach the team at <a href="mailto:mharoonsadiq8@gmail.com">mharoonsadiq8@gmail.com</a>.</p>',
    },
  ];

  // Default chips to surface on first open. Mix of product + terms intent.
  const STARTER_CHIPS = ['product', 'flow', 'pricing', 'data-handling', 'delete-data', 'permissions'];

  // ─── Matching ─────────────────────────────────────────────
  function tokenize(s) {
    return (s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean);
  }

  function findBest(query) {
    const tokens = tokenize(query);
    if (!tokens.length) return null;
    let best = null, bestScore = 0;
    for (const entry of KB) {
      let score = 0;
      const tagSet = new Set(entry.tags);
      for (const tok of tokens) if (tagSet.has(tok)) score += 2;
      // Title-substring fallback (handles partial words like "deleti" in "delete")
      const title = entry.title.toLowerCase();
      for (const tok of tokens) if (tok.length >= 4 && title.includes(tok)) score += 1;
      if (score > bestScore) { bestScore = score; best = entry; }
    }
    return bestScore >= 2 ? best : null;
  }

  function relatedSuggestions(query, exclude) {
    const tokens = tokenize(query);
    const scored = KB
      .filter((e) => e.id !== exclude)
      .map((e) => {
        let s = 0;
        const tagSet = new Set(e.tags);
        for (const t of tokens) if (tagSet.has(t)) s += 2;
        return { e, s };
      })
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 3)
      .map((x) => x.e);
    return scored;
  }

  // ─── DOM construction ─────────────────────────────────────
  const TOGGLE_HTML = `
    <span class="pulse"></span>
    <span class="badge"></span>
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
    </svg>`;

  const CLOSE_ICON = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>`;
  const SEND_ICON  = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13"/><path d="m22 2-7 20-4-9-9-4 20-7z"/></svg>`;

  function el(tag, attrs, html) {
    const e = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      if (k === 'class') e.className = attrs[k];
      else if (k === 'on') for (const ev in attrs.on) e.addEventListener(ev, attrs.on[ev]);
      else e.setAttribute(k, attrs[k]);
    }
    if (html != null) e.innerHTML = html;
    return e;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }

  function build() {
    const toggle = el('button', { class: 'fba-toggle', 'aria-label': 'Open FlowBot Assistant' }, TOGGLE_HTML);
    const panel  = el('div',    { class: 'fba-panel', role: 'dialog', 'aria-label': 'FlowBot Assistant' });

    const head = el('div', { class: 'fba-head' }, `
      <div class="agent-avatar">FB</div>
      <div class="meta">
        <h3>FlowBot Assistant</h3>
        <p><span class="dot"></span> Here to help — ask anything</p>
      </div>
      <button class="close" aria-label="Close">${CLOSE_ICON}</button>
    `);

    const body  = el('div', { class: 'fba-body', id: 'fba-body' });
    const chips = el('div', { class: 'fba-chips', id: 'fba-chips' });
    const inputRow = el('form', { class: 'fba-input-row', id: 'fba-form' });
    inputRow.innerHTML = `
      <input id="fba-input" type="text" placeholder="Ask about pricing, terms, how it works…" autocomplete="off" />
      <button type="submit" aria-label="Send">${SEND_ICON}</button>
    `;
    const foot = el('div', { class: 'fba-foot' }, 'Powered by FlowBot · Replies are pre-curated by our team');

    panel.appendChild(head);
    panel.appendChild(body);
    panel.appendChild(chips);
    panel.appendChild(inputRow);
    panel.appendChild(foot);

    document.body.appendChild(toggle);
    document.body.appendChild(panel);

    return { toggle, panel, body, chips, inputRow, head };
  }

  function pushMsg(body, html, who) {
    const m = el('div', { class: 'fba-msg ' + who }, html);
    body.appendChild(m);
    body.scrollTop = body.scrollHeight;
    return m;
  }

  function pushTyping(body) {
    const t = el('div', { class: 'fba-typing' }, '<span></span><span></span><span></span>');
    body.appendChild(t);
    body.scrollTop = body.scrollHeight;
    return t;
  }

  function renderChips(chipsEl, ids, onClick) {
    chipsEl.innerHTML = '';
    ids.forEach((id) => {
      const entry = KB.find((e) => e.id === id);
      if (!entry) return;
      const c = el('button', { class: 'fba-chip', type: 'button' }, escapeHtml(entry.title));
      c.addEventListener('click', () => onClick(entry));
      chipsEl.appendChild(c);
    });
  }

  // ─── Wire up ──────────────────────────────────────────────
  function init() {
    const { toggle, panel, body, chips, inputRow } = build();
    let opened = false;

    function open() {
      panel.classList.add('open');
      toggle.classList.add('open');
      opened = true;
      if (body.children.length === 0) seedWelcome();
      setTimeout(() => document.getElementById('fba-input')?.focus(), 250);
    }
    function close() { panel.classList.remove('open'); toggle.classList.remove('open'); }

    toggle.addEventListener('click', () => (opened ? close() : open()));
    panel.querySelector('.close').addEventListener('click', close);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && opened) close(); });

    function seedWelcome() {
      pushMsg(body,
        '<p><strong>Hi! I\'m the FlowBot Assistant.</strong></p>' +
        '<p>I can explain how FlowBot works, our terms, pricing, and how we handle your data. Tap a topic below or type a question.</p>',
        'bot');
      renderChips(chips, STARTER_CHIPS, answerEntry);
    }

    function answerEntry(entry) {
      pushMsg(body, escapeHtml(entry.title), 'user');
      const typing = pushTyping(body);
      setTimeout(() => {
        typing.remove();
        pushMsg(body, entry.answer, 'bot');
        // Surface follow-up suggestions excluding the one just answered.
        const suggestions = KB
          .filter((e) => e.id !== entry.id && e.id !== 'support')
          .sort(() => Math.random() - .5)
          .slice(0, 3)
          .map((e) => e.id);
        renderChips(chips, suggestions, answerEntry);
      }, 420 + Math.random() * 280);
    }

    function answerQuery(text) {
      const q = text.trim();
      if (!q) return;
      pushMsg(body, escapeHtml(q), 'user');
      const typing = pushTyping(body);
      setTimeout(() => {
        typing.remove();
        const match = findBest(q);
        if (match) {
          pushMsg(body, match.answer, 'bot');
          const related = relatedSuggestions(q, match.id);
          renderChips(chips, related.length ? related.map((e) => e.id) : STARTER_CHIPS.slice(0, 3), answerEntry);
        } else {
          // Fallback — surface a few likely-relevant topics + offer email.
          pushMsg(body,
            '<p>I don\'t have a pre-written answer for that one. A few topics that might be related:</p>' +
            '<p>If none of these fit, email <a href="mailto:mharoonsadiq8@gmail.com">mharoonsadiq8@gmail.com</a> and a human will reply within 24 hours.</p>',
            'bot');
          renderChips(chips, STARTER_CHIPS.slice(0, 4).concat('support'), answerEntry);
        }
      }, 500 + Math.random() * 300);
    }

    inputRow.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = document.getElementById('fba-input');
      const v = input.value;
      input.value = '';
      answerQuery(v);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
