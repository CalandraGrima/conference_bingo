(function () {
  'use strict';

  const C = window.BINGO_CONFIG || {};
  const Core = window.BingoCore;

  const STORAGE_KEY = 'conference-bingo:v1';
  const THEME_KEY = 'conference-bingo:theme';   // "light" or "dark"; no value means follow the device
  // GoatCounter event names. A card is counted once, each line is counted once per card,
  // and "new-player" is sent once per device.
  const EVENTS = { player: 'new-player', started: 'card-started', bingo: 'bingo', full: 'full-card' };
  // The conference this build is for (see "edition" in config.js). Saved cards and totals are tagged with it,
  // and when it changes, everyone's saved data from the previous conference is discarded on their next visit.
  const EDITION = String(C.edition || '').trim();
  let editionReset = false;   // true when this visit threw away a previous conference's data
  const CODE = /^[a-z0-9-]+$/i.test(C.goatcounterCode || '') ? C.goatcounterCode : '';

  const $ = (id) => document.getElementById(id);
  let els = {};
  let state = null;          // { card, totals, player }
  let terms = null;
  let globalTotals = null;   // { player, started, bingo, full } from GoatCounter, when available
  let cells = [];
  let storageOk = true;
  let toastTimer = null;
  let lastBanner = '';
  let imageCache = null;     // { key, blob }: the card image, prepared ahead so sharing can start straight from a tap
  let imageTimer = null;

  // ---------- helpers ----------
  function rng() {
    if (window.crypto && crypto.getRandomValues) {
      const b = new Uint32Array(1);
      crypto.getRandomValues(b);
      return b[0] / 4294967296;
    }
    return Math.random();
  }
  const fmt = (n) => (n == null ? '–' : Number(n).toLocaleString());

  // ---------- storage (localStorage only: no cookies) ----------
  function probeStorage() {
    try {
      localStorage.setItem('__probe', '1');
      localStorage.removeItem('__probe');
      return true;
    } catch (e) { return false; }
  }

  function normalise(s) {
    const t = s.totals || {};
    s.totals = {
      cardsStarted: Number(t.cardsStarted) || 0,
      bingos: Number(t.bingos) || Number(t.bingoCards) || 0,
      fullCards: Number(t.fullCards) || 0
    };
    s.player = !!s.player;
    const r = Object.assign({ started: false, full: false }, s.card.reported);
    // Older saved cards remembered only "had a bingo": treat lines already complete as counted.
    if (!Array.isArray(r.lines)) r.lines = r.bingo ? Core.completedLineIds(s.card.marked) : [];
    delete r.bingo;
    s.card.reported = r;
    // Finished cards kept on this device (a snapshot of each card at the moment it was completed).
    s.completed = (Array.isArray(s.completed) ? s.completed : []).filter((c) =>
      c && typeof c.id === 'string' && Array.isArray(c.terms) && c.terms.length === Core.CELLS);
    if (r.full) saveCompleted(s, s.card);
    return s;
  }

  function readState() {
    if (!storageOk) return null;
    try {
      const s = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (s && Core.isValidCard(s.card)) {
        if (EDITION && s.edition !== EDITION) {   // saved during an earlier conference: start from zero
          localStorage.removeItem(STORAGE_KEY);
          editionReset = true;
          return null;
        }
        return normalise(s);
      }
    } catch (e) { /* fall through to a fresh start */ }
    return null;
  }

  function saveState() {
    if (!storageOk || !state) return;
    state.edition = EDITION;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      storageOk = false;
      showStorageNotice();
    }
  }

  function showStorageNotice() {
    showNotice('Your browser is not letting this page save progress (private browsing?), so your card will be lost when you close this tab.');
  }

  // ---------- GoatCounter: anonymous counts, switched off by Do Not Track / Global Privacy Control ----------
  function optedOut() {
    const n = navigator;
    return n.doNotTrack === '1' || window.doNotTrack === '1' || n.msDoNotTrack === '1' || n.globalPrivacyControl === true;
  }
  const trackingOn = () => !!CODE && !optedOut();

  const pending = [];
  function loadGoatCounter() {
    if (!trackingOn()) return;
    const s = document.createElement('script');
    s.async = true;
    s.dataset.goatcounter = 'https://' + CODE + '.goatcounter.com/count';
    s.src = 'https://gc.zgo.at/count.js';
    s.onload = () => pending.splice(0).forEach((send) => send());
    document.head.appendChild(s);
  }

  function track(name) {
    if (!trackingOn()) return;
    // no_session makes every call count, not just the first one from a visitor.
    const send = () => window.goatcounter.count({ path: name, title: name, event: true, no_session: true });
    if (window.goatcounter && typeof window.goatcounter.count === 'function') send();
    else pending.push(send);
  }

  async function fetchOne(name, ms) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    try {
      const res = await fetch('https://' + CODE + '.goatcounter.com/counter/' + encodeURIComponent(name) + '.json', { signal: ctrl.signal });
      if (!res.ok) return null;
      return Core.parseCount((await res.json()).count);
    } catch (e) {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async function fetchGlobal() {
    if (!trackingOn()) return null;
    const keys = Object.keys(EVENTS);
    const values = await Promise.all(keys.map((k) => fetchOne(EVENTS[k], 5000)));
    const out = {};
    let any = false;
    keys.forEach((k, i) => { if (values[i] != null) { out[k] = values[i]; any = true; } });
    globalTotals = any ? out : null;
    return globalTotals;
  }

  // ---------- terms ----------
  async function ensureTerms() {
    if (!terms) {
      let text;
      try {
        const res = await fetch(C.termsFile || 'terms.txt', { cache: 'no-cache' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        text = await res.text();
      } catch (e) {
        if (location.protocol === 'file:') {
          throw new Error('Browsers won’t let this page read the terms file when it is opened straight from a file. ' +
            'In this folder, run “python3 -m http.server 8000” and open http://localhost:8000 instead (or publish the site to GitHub Pages).');
        }
        throw new Error('Couldn’t load the list of terms. Check your connection and try again.');
      }
      terms = Core.parseTerms(text);
      reportTermProblems();
    }
    if (terms.length < Core.NEEDED) {
      const found = terms.length;
      terms = null;
      throw new Error('The terms file has only ' + found + ' different terms; at least ' + Core.NEEDED + ' are needed.');
    }
    return terms;
  }

  // ---------- light / dark theme ----------
  const THEME_LABELS = { auto: 'Auto', light: 'Light', dark: 'Dark' };
  const NEXT_THEME = { auto: 'light', light: 'dark', dark: 'auto' };

  function currentTheme() {
    const t = document.documentElement.dataset.theme;
    return t === 'light' || t === 'dark' ? t : 'auto';
  }

  function applyTheme(theme) {
    if (theme === 'auto') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    els.theme.textContent = 'Theme: ' + THEME_LABELS[theme];
    els.theme.setAttribute('aria-label', 'Colour theme: ' + THEME_LABELS[theme] + '. Tap to change.');
  }

  function cycleTheme() {
    const next = NEXT_THEME[currentTheme()];
    applyTheme(next);
    try {
      if (next === 'auto') localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, next);
    } catch (e) { /* the choice just won't be remembered */ }
  }

  // ---------- term warnings ----------
  // Terms that are too long still work, but their text is shrunk to fit. Warn in the browser console
  // always, and show a visible list when the address ends in ?check (handy after editing terms.txt).
  function reportTermProblems() {
    const max = Number(C.maxTermLength) || 50;
    const long = Core.findLongTerms(terms, max);
    if (long.length) {
      console.warn('Conference Bingo: ' + long.length + ' of ' + terms.length + ' terms are longer than ' + max +
        ' characters and will show in small text:\n' + long.map((t) => '  (' + Array.from(t).length + ') ' + t).join('\n'));
    }
    if (/[?&]check(=|&|$)/.test(location.search)) showCheck(long, max);
  }

  function showCheck(long, max) {
    $('check').hidden = false;
    $('check-summary').textContent = long.length
      ? long.length + ' of ' + terms.length + ' terms are longer than ' + max + ' characters. They still work, but their text is shrunk to fit and may be hard to read on a phone. Consider shortening:'
      : 'All ' + terms.length + ' terms are ' + max + ' characters or fewer.';
    const list = $('check-list');
    list.textContent = '';
    long.slice().sort((a, b) => Array.from(b).length - Array.from(a).length).forEach((t) => {
      const li = document.createElement('li');
      li.textContent = t + ' (' + Array.from(t).length + ' characters)';
      list.appendChild(li);
    });
  }

  // ---------- rendering ----------
  function showNotice(msg) { els.notice.textContent = msg; els.notice.hidden = false; }
  function hideNotice() { els.notice.hidden = true; }

  function buildGrid() {
    els.card.textContent = '';
    cells = [];
    if (state) {
      state.card.terms.forEach((term, i) => {
        let el;
        if (i === Core.FREE) {
          el = document.createElement('div');
          el.className = 'cell free';
          const img = document.createElement('img');
          img.src = C.logo || 'logo.png';
          img.alt = (C.logoAlt || 'Conference logo') + ' (free space)';
          img.decoding = 'async';
          el.appendChild(img);
        } else {
          el = document.createElement('button');
          el.type = 'button';
          el.className = 'cell';
          const span = document.createElement('span');
          span.textContent = term;
          el.appendChild(span);
          el.addEventListener('click', () => toggle(i));
        }
        els.card.appendChild(el);
        cells.push(el);
      });
    }
    fitText();
    updateView();
  }

  // Shrink the text in any square whose term doesn't fit, so nothing is clipped.
  // Very long terms end up small (see maxTermLength in config.js).
  function fitText(list) {
    const overflows = (el) => el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1;
    (list || cells).forEach((el) => {
      if (el.classList.contains('free')) return;   // the logo square has no text to fit
      el.style.fontSize = '';
      el.style.overflowWrap = '';
      let size = parseFloat(getComputedStyle(el).fontSize);
      while (size > 7.5 && overflows(el)) {
        size -= 0.5;
        el.style.fontSize = size + 'px';
      }
      // Last resort for a single very long word: break it rather than clip it.
      if (overflows(el)) el.style.overflowWrap = 'anywhere';
    });
  }

  function updateView() {
    const have = !!state;
    els.share.disabled = !have;
    els.shareImage.disabled = !have;
    updateStats();
    if (!have) {
      els.banner.hidden = true;
      els.progress.textContent = '';
      return;
    }

    const card = state.card;
    const lines = Core.completedLines(card.marked);
    const inLine = new Set([].concat.apply([], lines));
    const changed = [];   // squares whose bingo state changed, so their text needs refitting (the label takes room)
    cells.forEach((el, i) => {
      if (el.classList.contains('in-line') !== inLine.has(i)) changed.push(el);
      el.classList.toggle('in-line', inLine.has(i));
      if (i !== Core.FREE) el.setAttribute('aria-pressed', card.marked[i] ? 'true' : 'false');
    });
    if (changed.length) fitText(changed);

    const n = Core.markedCount(card.marked);
    let banner = '';
    if (n === Core.CELLS) banner = 'Full card! Every square is marked.';
    else banner = Core.bingoLabel(lines.length);
    els.banner.textContent = banner;
    els.banner.classList.toggle('full', n === Core.CELLS);
    els.banner.hidden = !banner;
    if (banner && banner !== lastBanner) {
      els.banner.classList.remove('pop');
      void els.banner.offsetWidth;   // restart the animation
      els.banner.classList.add('pop');
    }
    lastBanner = banner;

    els.progress.textContent = n + ' of ' + Core.CELLS + ' squares marked (the free space counts)';
    scheduleImage();
  }

  function updateStats() {
    const t = state ? state.totals : { cardsStarted: 0, bingos: 0, fullCards: 0 };
    $('my-started').textContent = fmt(t.cardsStarted);
    $('my-bingo').textContent = fmt(t.bingos);
    $('my-full').textContent = fmt(t.fullCards);
    renderCompleted();
    $('global-box').hidden = !globalTotals;
    if (globalTotals) {
      $('g-player').textContent = fmt(globalTotals.player);
      $('g-started').textContent = fmt(globalTotals.started);
      $('g-bingo').textContent = fmt(globalTotals.bingo);
      $('g-full').textContent = fmt(globalTotals.full);
    }
  }

  // ---------- toast ----------
  function showToast(msg, actionLabel, onAction, ms) {
    clearTimeout(toastTimer);
    els.toastMsg.textContent = msg;
    els.toastAction.hidden = !actionLabel;
    els.toastAction.textContent = actionLabel || '';
    els.toastAction.onclick = actionLabel ? () => { hideToast(); onAction(); } : null;
    els.toast.hidden = false;
    toastTimer = setTimeout(hideToast, ms || 4000);
  }
  function hideToast() { clearTimeout(toastTimer); els.toast.hidden = true; }

  // ---------- playing ----------
  function toggle(i) {
    if (!state || i === Core.FREE) return;
    const card = state.card;
    card.marked[i] = !card.marked[i];
    hideToast();   // marking a square ends the undo window for a reroll
    if (card.marked[i]) milestones(card);
    saveState();
    updateView();
  }

  function saveCompleted(s, card) {
    if (s.completed.some((c) => c.id === card.id)) return;
    s.completed.push({ id: card.id, terms: card.terms.slice(), at: Date.now() });
  }

  // Each milestone is counted once, so unticking and re-ticking can't inflate the totals.
  function milestones(card) {
    const r = card.reported;
    if (!r.started) {
      r.started = true;
      state.totals.cardsStarted++;
      track(EVENTS.started);
      if (!state.player) { state.player = true; track(EVENTS.player); }
    }
    // Every completed line is a bingo, counted once per line per card (so re-ticking a square never recounts).
    Core.completedLineIds(card.marked).forEach((id) => {
      if (r.lines.indexOf(id) !== -1) return;
      r.lines.push(id);
      state.totals.bingos++;
      track(EVENTS.bingo);
    });
    if (!r.full && Core.markedCount(card.marked) === Core.CELLS) {
      r.full = true;
      state.totals.fullCards++;
      saveCompleted(state, card);
      track(EVENTS.full);
    }
  }

  async function doReroll() {
    try {
      await ensureTerms();
    } catch (e) {
      if (state) showToast(e.message, null, null, 6000);
      else showNotice(e.message);
      return;
    }
    if (storageOk) hideNotice();   // keep the "can't save" warning if that's what is showing
    const prev = state ? state.card : null;
    const hadMarks = prev && Core.markedCount(prev.marked) > 1;
    const wasFinished = !!(prev && prev.reported.full);
    const card = Core.makeCard(terms, rng);
    if (!state) state = normalise({ card: card, totals: {}, player: false });
    else state.card = card;
    lastBanner = '';
    saveState();
    buildGrid();
    if (hadMarks) {
      showToast(wasFinished ? 'New card ready. Your finished card still counts and is saved under Completed cards.' : 'New card ready.', 'Undo', () => {
        state.card = prev;
        lastBanner = '';
        saveState();
        buildGrid();
      }, wasFinished ? 14000 : 10000);
    }
  }

  // Delete this device's card, totals and completed cards, and deal a fresh card. Only the light/dark choice stays.
  async function clearAll() {
    const wasPlayer = !!(state && state.player);   // keep this one flag, so the combined "players" count doesn't count the device twice
    try { if (storageOk) localStorage.removeItem(STORAGE_KEY); } catch (e) { /* nothing to remove */ }
    state = null;
    imageCache = null;
    lastBanner = '';
    hideToast();
    await doReroll();
    if (state && wasPlayer) { state.player = true; saveState(); }
    updateStats();
    if (state) showToast('All your cards and totals on this device were cleared. Here is a fresh card.', null, null, 8000);
  }
  function askClear() {
    const dlg = $('clear-confirm');
    if (typeof dlg.showModal !== 'function') {
      if (window.confirm('Clear all your cards, totals and completed cards from this device? This can\'t be undone.')
        && window.confirm('Are you sure? Everything on this device will be deleted for good.')) clearAll();
      return;
    }
    dlg.returnValue = '';
    dlg.showModal();
  }
  function askReroll() {
    if (!state) { doReroll(); return; }
    const finished = state.card.reported.full;   // a card that was completed, even if a square has since been unticked
    const mine = Core.markedCount(state.card.marked) - 1;   // the free space doesn't count
    if (!finished && mine <= 0) { doReroll(); return; }
    if (typeof els.confirm.showModal !== 'function') {
      const text = finished
        ? 'Start a new card? Your finished card keeps counting towards your score and stays saved under Completed cards.'
        : 'Start a new card? Your current card and its ' + mine + ' marked squares will be lost.';
      if (window.confirm(text)) doReroll();
      return;
    }
    els.confirmLost.hidden = finished;
    els.confirmDone.hidden = !finished;
    els.confirmCount.textContent = mine + (mine === 1 ? ' marked square' : ' marked squares');
    els.confirm.returnValue = '';
    els.confirm.showModal();
  }

  // ---------- sharing ----------
  function legacyCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { /* ignore */ }
    ta.remove();
    return ok;
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(() => true, () => legacyCopy(text));
    }
    return Promise.resolve(legacyCopy(text));
  }

  function copyAndToast(text) {
    copyText(text).then((ok) => {
      showToast(ok ? 'Copied! Paste it anywhere to share.' : 'Sorry, this browser wouldn’t let me copy it.', null, null, 5000);
    });
  }

  function onShare() {
    if (!state) return;
    // Everything here is synchronous so the browser still treats it as a direct tap
    // (Safari refuses to open the share sheet otherwise). The combined totals are
    // fetched when the page loads, and are simply left out if they aren't there.
    const text = Core.buildShareText({
      title: C.title || 'Conference Bingo',
      card: state.card,
      totals: state.totals,
      global: globalTotals,
      url: C.shareUrl || (location.origin + location.pathname),
      freeEmoji: C.freeEmoji || '⭐'
    });
    const canShare = navigator.share && window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    if (canShare) {
      navigator.share({ text: text }).catch((e) => { if (!e || e.name !== 'AbortError') copyAndToast(text); });
    } else {
      copyAndToast(text);
    }
  }

  // ---------- completed cards ----------
  const dateText = (at) => new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

  function renderCompleted() {
    const list = state ? state.completed.slice().reverse() : [];   // newest first
    $('completed-box').hidden = list.length === 0;
    $('completed-heading').textContent = 'Completed cards (' + list.length + ')';
    const ul = $('completed-list');
    ul.textContent = '';
    list.forEach((entry) => {
      const li = document.createElement('li');
      const label = document.createElement('span');
      label.textContent = 'Completed ' + dateText(entry.at);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn';
      btn.textContent = 'View';
      btn.addEventListener('click', () => openCompleted(entry));
      li.append(label, btn);
      ul.appendChild(li);
    });
  }

  let viewEntry = null;
  let viewImage = null;   // { id, blob }, prepared when the card is opened so sharing can start straight from a tap

  function renderEntryImage(entry) {
    return window.BingoImage.render({
      title: C.title || 'Conference Bingo',
      card: { terms: entry.terms, marked: Array(Core.CELLS).fill(true) },
      lineIds: Core.LINES.map((_, i) => i),
      count: Core.CELLS,
      status: 'Full card!',
      logoUrl: new URL(C.logo || 'logo.png', location.href).href,
      siteLogoUrl: C.siteLogo ? new URL(C.siteLogo, location.href).href : '',
      footer: (C.shareUrl || (location.origin + location.pathname)).replace(/^https?:\/\//, '').replace(/\/$/, '')
    });
  }

  function openCompleted(entry) {
    if (typeof els.view.showModal !== 'function') return;
    viewEntry = entry;
    viewImage = null;
    $('view-date').textContent = 'Completed ' + dateText(entry.at);
    const grid = $('view-grid');
    grid.textContent = '';
    const viewCells = entry.terms.map((term, i) => {
      const el = document.createElement('div');
      el.className = i === Core.FREE ? 'cell free' : 'cell done';
      if (i === Core.FREE) {
        const img = document.createElement('img');
        img.src = C.logo || 'logo.png';
        img.alt = (C.logoAlt || 'Conference logo') + ' (free space)';
        el.appendChild(img);
      } else {
        const span = document.createElement('span');
        span.textContent = term;
        el.appendChild(span);
      }
      grid.appendChild(el);
      return el;
    });
    els.view.showModal();
    fitText(viewCells.filter((el, i) => i !== Core.FREE));
    if (window.BingoImage) {
      renderEntryImage(entry).then((blob) => { if (viewEntry === entry) viewImage = { id: entry.id, blob: blob }; }, () => {});
    }
  }

  function shareCompleted() {
    if (!viewEntry || !window.BingoImage) return;
    if (viewImage && viewImage.id === viewEntry.id) { deliverImage(viewImage.blob); return; }
    renderEntryImage(viewEntry).then(deliverImage, () => showToast('Sorry, the image couldn’t be made.', null, null, 5000));
  }

  // ---------- sharing as an image ----------
  const cardKey = () => state.card.id + ':' + state.card.marked.map((m) => (m ? 1 : 0)).join('');

  function renderCardImage() {
    const card = state.card;
    const url = C.shareUrl || (location.origin + location.pathname);
    return window.BingoImage.render({
      title: C.title || 'Conference Bingo',
      card: card,
      lineIds: Core.completedLineIds(card.marked),
      count: Core.markedCount(card.marked),
      status: Core.statusLabel(card.marked),
      logoUrl: new URL(C.logo || 'logo.png', location.href).href,
      siteLogoUrl: C.siteLogo ? new URL(C.siteLogo, location.href).href : '',
      footer: url.replace(/^https?:\/\//, '').replace(/\/$/, '')
    });
  }

  // Draw the image shortly after each change, so it is ready the moment someone taps the button.
  // (Safari only opens the share sheet straight from a tap, so we can't wait for drawing then.)
  function scheduleImage() {
    clearTimeout(imageTimer);
    if (!state || !window.BingoImage) return;
    imageTimer = setTimeout(async () => {
      const key = cardKey();
      if (imageCache && imageCache.key === key) return;
      try {
        const blob = await renderCardImage();
        if (state && key === cardKey()) imageCache = { key: key, blob: blob };
      } catch (e) { /* the button will try again when tapped */ }
    }, 300);
  }

  function downloadImage(blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'conference-bingo.png';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    showToast('Image saved to your downloads.', null, null, 4000);
  }

  function deliverImage(blob) {
    const file = new File([blob], 'conference-bingo.png', { type: 'image/png' });
    const touch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    if (touch && navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: C.title || 'Conference Bingo' })
        .catch((e) => { if (!e || e.name !== 'AbortError') downloadImage(blob); });
      return;
    }
    downloadImage(blob);
  }

  function onShareImage() {
    if (!state || !window.BingoImage) return;
    if (imageCache && imageCache.key === cardKey()) { deliverImage(imageCache.blob); return; }
    // Not ready yet (very quick tap after a change): draw it now.
    els.shareImage.disabled = true;
    renderCardImage().then(deliverImage, () => showToast('Sorry, the image couldn’t be made.', null, null, 5000))
      .then(() => { els.shareImage.disabled = !state; });
  }

  // ---------- acknowledgements and GitHub link ----------
  function setupFooter() {
    const isWebAddress = (u) => typeof u === 'string' && /^https?:\/\//i.test(u);
    (Array.isArray(C.acknowledgements) ? C.acknowledgements : []).forEach((item) => {
      const text = typeof item === 'string' ? item : item && item.text;
      if (!text) return;
      const li = document.createElement('li');
      if (item && isWebAddress(item.url)) {
        const a = document.createElement('a');
        a.href = item.url;
        a.rel = 'noopener';
        a.textContent = text;
        li.appendChild(a);
      } else {
        li.textContent = text;
      }
      $('ack-list').appendChild(li);
    });
    if (isWebAddress(C.githubUrl)) {
      $('github-link').href = C.githubUrl;
      $('site-footer').hidden = false;
      $('ack-octicons').hidden = false;   // credit for the GitHub logo, shown whenever the logo is
    }
  }

  // ---------- start-up ----------
  async function init() {
    els = {
      notice: $('notice'), banner: $('banner'), card: $('card'), progress: $('progress'),
      confirmLost: $('confirm-lost'), confirmDone: $('confirm-done'), view: $('view'),
      theme: $('theme'), share: $('share'), shareImage: $('share-image'), reroll: $('reroll'), confirm: $('confirm'), confirmCount: $('confirm-count'),
      toast: $('toast'), toastMsg: $('toast-msg'), toastAction: $('toast-action')
    };

    if (C.title) { document.title = C.title; $('title').textContent = C.title; }
    if (C.siteLogo) {
      const mark = $('site-logo');
      mark.src = C.siteLogo;
      mark.alt = C.siteLogoAlt || 'Conference Bingo';
      mark.hidden = false;
    }
    $('subtitle').textContent = C.subtitle || '';
    $('counting-note').hidden = !CODE;
    $('ack-goatcounter').hidden = !CODE;
    setupFooter();

    applyTheme(currentTheme());
    els.theme.addEventListener('click', cycleTheme);
    els.share.addEventListener('click', onShare);
    $('view-share').addEventListener('click', shareCompleted);
    $('view-close').addEventListener('click', () => els.view.close());
    els.shareImage.addEventListener('click', onShareImage);
    els.reroll.addEventListener('click', askReroll);
    els.confirm.addEventListener('close', () => { if (els.confirm.returnValue === 'new') doReroll(); });
    $('clear-data').addEventListener('click', askClear);
    // Two questions before anything is deleted: "Clear everything", then "Are you sure?".
    $('clear-confirm').addEventListener('close', () => {
      if ($('clear-confirm').returnValue !== 'clear') return;
      $('clear-sure').returnValue = '';
      $('clear-sure').showModal();
    });
    $('clear-sure').addEventListener('close', () => { if ($('clear-sure').returnValue === 'clear') clearAll(); });

    // Pick up changes made in another tab.
    window.addEventListener('storage', (e) => {
      if (e.key === THEME_KEY) {
        applyTheme(e.newValue === 'light' || e.newValue === 'dark' ? e.newValue : 'auto');
        return;
      }
      if (e.key !== STORAGE_KEY) return;
      state = readState();
      lastBanner = '';
      buildGrid();
    });

    let resizeTimer = null;
    window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => fitText(), 150); });
    if (document.fonts) {
      // Barlow Condensed arrives a moment after the page; re-fit the text once it has.
      document.fonts.addEventListener('loadingdone', () => fitText());
      document.fonts.ready.then(() => fitText());
    }

    storageOk = probeStorage();
    if (!storageOk) showStorageNotice();
    state = readState();
    buildGrid();

    loadGoatCounter();
    if (trackingOn()) fetchGlobal().then(updateStats);

    try {
      await ensureTerms();
    } catch (e) {
      if (!state) showNotice(e.message);   // a saved card still works without the term list
      return;
    }
    if (!state) {
      await doReroll();
      if (editionReset) {
        showToast('A new conference has started, so your old card, totals and completed cards were cleared. Here is a fresh card.', null, null, 12000);
      }
    }
  }

  init();
})();
