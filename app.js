(function () {
  'use strict';

  const C = window.BINGO_CONFIG || {};
  const Core = window.BingoCore;

  const STORAGE_KEY = 'conference-bingo:v1';
  const THEME_KEY = 'conference-bingo:theme';   // "light" or "dark"; no value means follow the device
  const PREFS_KEY = 'conference-bingo:prefs';   // which list is chosen, the pasted list and the seed
  const MAX_PRINT = 100;                        // most cards one print job can make
  // GoatCounter event names. A card is counted once, each line is counted once per card,
  // and "new-player" is sent once per device.
  const EVENTS = { player: 'new-player', started: 'card-started', bingo: 'bingo', full: 'full-card' };
  // "squares-2" ... "squares-25": sent once per card as it first reaches that many marked squares (the free space is 1),
  // so the highest one anybody has reached can be found by looking for the highest event with a count.
  const squaresEvent = (n) => 'squares-' + n;
  // The conference this build is for (see "edition" in config.js). Saved cards and totals are tagged with it,
  // and when it changes, everyone's saved data from the previous conference is discarded on their next visit.
  const EDITION = String(C.edition || '').trim();
  let editionReset = false;   // true when this visit threw away a previous conference's data
  const CODE = /^[a-z0-9-]+$/i.test(C.goatcounterCode || '') ? C.goatcounterCode : '';

  const $ = (id) => document.getElementById(id);
  let els = {};
  let state = null;          // { card, totals, player }
  let manifest = null;       // lists/lists.json: { default, lists: [...] }
  const termCache = {};      // premade list id -> parsed terms
  let prefs = { mode: 'premade', listId: '', customText: '', seed: '' };
  let globalTotals = null;   // { player, started, bingo, full, most } from GoatCounter, when available
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
      fullCards: Number(t.fullCards) || 0,
      mostSquares: Number(t.mostSquares) || 0
    };
    s.player = !!s.player;
    const r = Object.assign({ started: false, full: false }, s.card.reported);
    // Older saved cards remembered only "had a bingo": treat lines already complete as counted.
    if (!Array.isArray(r.lines)) r.lines = r.bingo ? Core.completedLineIds(s.card.marked) : [];
    delete r.bingo;
    // Older saved cards didn't track their most squares: count what is ticked now, without sending anything.
    if (typeof r.max !== 'number') r.max = Core.markedCount(s.card.marked);
    s.totals.mostSquares = Math.max(s.totals.mostSquares, r.max);
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
    const [most, ...values] = await Promise.all([fetchMostSquares()].concat(keys.map((k) => fetchOne(EVENTS[k], 5000))));
    const out = {};
    let any = false;
    keys.forEach((k, i) => { if (values[i] != null) { out[k] = values[i]; any = true; } });
    if (most != null) { out.most = most; any = true; }
    globalTotals = any ? out : null;
    return globalTotals;
  }

  // The most squares anyone has had on one card. Each card sends "squares-N" for every level it reaches, so the
  // counts only fall as N rises, and the highest N that has any count can be found in about five lookups.
  async function fetchMostSquares() {
    let lo = 1, hi = Core.CELLS;   // everyone has at least the free space
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      const count = await fetchOne(squaresEvent(mid), 5000);
      if (count) lo = mid; else hi = mid - 1;
    }
    return lo > 1 ? lo : null;
  }

  // ---------- lists and terms ----------
  const listById = (id) => (manifest && manifest.lists.find((l) => l.id === id)) || null;
  const defaultList = () => (manifest && (listById(manifest.default) || manifest.lists[0])) || null;
  const activeList = () => listById(prefs.listId) || defaultList();

  function fileProblem(what) {
    if (location.protocol === 'file:') {
      return new Error('Browsers won’t let this page read ' + what + ' when it is opened straight from a file. ' +
        'In this folder, run “python3 -m http.server 8000” and open http://localhost:8000 instead (or publish the site to GitHub Pages).');
    }
    return new Error('Couldn’t load ' + what + '. Check your connection and try again.');
  }

  async function loadManifest() {
    if (manifest) return manifest;
    let data;
    try {
      const res = await fetch('lists/lists.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      data = await res.json();
    } catch (e) {
      throw fileProblem('the list of conferences');
    }
    const lists = (data && Array.isArray(data.lists) ? data.lists : []).filter((l) => l && l.id && l.name && l.terms);
    if (!lists.length) throw new Error('lists/lists.json has no lists in it.');
    manifest = { default: data.default, lists: lists };
    return manifest;
  }

  async function loadListTerms(list) {
    if (!termCache[list.id]) {
      let text;
      try {
        const res = await fetch('lists/' + list.terms, { cache: 'no-cache' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        text = await res.text();
      } catch (e) {
        throw fileProblem('the terms for ' + list.name);
      }
      const parsed = Core.parseTerms(text);
      reportTermProblems(parsed);
      termCache[list.id] = parsed;
    }
    const found = termCache[list.id];
    if (found.length < Core.NEEDED) {
      delete termCache[list.id];
      throw new Error('The ' + list.name + ' list has only ' + found.length + ' different terms; at least ' + Core.NEEDED + ' are needed.');
    }
    return found;
  }

  const customTerms = () => Core.parseTerms(prefs.customText);

  // What a card remembers about where it came from, so its heading, centre square and shared image stay right
  // even if the premade lists change later.
  function metaForList(list, seed) {
    return { id: list.id, name: list.name, title: list.title || list.name, logo: list.logo ? 'lists/' + list.logo : '',
      logoAlt: list.logoAlt || (list.name + ' logo'), seed: seed || '' };
  }
  function customMeta(seed) {
    return { id: 'custom', name: 'My own list', title: C.customTitle || 'Conference Bingo', logo: '', logoAlt: '', seed: seed || '' };
  }
  // Cards saved before there were several lists have no meta: they were all from the first premade list.
  function metaOf(card) {
    if (card && card.meta) return card.meta;
    const list = defaultList();
    return list ? metaForList(list) : { id: '', name: '', title: C.title || 'Conference Bingo', logo: '', logoAlt: '', seed: '' };
  }

  // The terms and meta for whatever is chosen in "Choose your list". Throws an Error with a readable message.
  async function currentSource(seed) {
    await loadManifest();
    if (prefs.mode === 'custom') {
      const found = customTerms();
      if (found.length < Core.NEEDED) {
        throw new Error('Your list has ' + found.length + ' different squares; at least ' + Core.NEEDED + ' are needed (one per line).');
      }
      return { terms: found, meta: customMeta(seed) };
    }
    const list = activeList();
    return { terms: await loadListTerms(list), meta: metaForList(list, seed) };
  }

  // ---------- saved choices (list, pasted list, seed) ----------
  function readPrefs() {
    if (!storageOk) return;
    try {
      const p = JSON.parse(localStorage.getItem(PREFS_KEY));
      if (p && typeof p === 'object') {
        prefs.mode = p.mode === 'custom' ? 'custom' : 'premade';
        prefs.listId = typeof p.listId === 'string' ? p.listId : '';
        prefs.customText = typeof p.customText === 'string' ? p.customText.slice(0, 20000) : '';
        prefs.seed = typeof p.seed === 'string' ? p.seed.slice(0, 60) : '';
      }
    } catch (e) { /* use the defaults */ }
  }
  function savePrefs() {
    if (!storageOk) return;
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) { /* the choices just won't be remembered */ }
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
  // always, and show a visible list when the address ends in ?check (handy after editing a list in lists/).
  function reportTermProblems(terms) {
    const max = Number(C.maxTermLength) || 50;
    const long = Core.findLongTerms(terms, max);
    if (long.length) {
      console.warn('Conference Bingo: ' + long.length + ' of ' + terms.length + ' terms are longer than ' + max +
        ' characters and will show in small text:\n' + long.map((t) => '  (' + Array.from(t).length + ') ' + t).join('\n'));
    }
    if (/[?&]check(=|&|$)/.test(location.search)) showCheck(terms, long, max);
  }

  function showCheck(terms, long, max) {
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

  // The centre square: the list's logo when it has one, otherwise the word FREE.
  function fillFreeSquare(el, meta) {
    if (meta.logo) {
      const img = document.createElement('img');
      img.src = meta.logo;
      img.alt = (meta.logoAlt || 'Conference logo') + ' (free space)';
      img.decoding = 'async';
      el.appendChild(img);
    } else {
      const word = document.createElement('span');
      word.className = 'free-text';
      word.textContent = 'FREE';
      el.appendChild(word);
    }
  }

  function buildGrid() {
    els.card.textContent = '';
    cells = [];
    updateHeading();
    if (state) {
      const meta = metaOf(state.card);
      state.card.terms.forEach((term, i) => {
        let el;
        if (i === Core.FREE) {
          el = document.createElement('div');
          el.className = 'cell free';
          fillFreeSquare(el, meta);
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

  // Press and hold a square to see it enlarged. It shows while the finger (or mouse button) is down and
  // goes away on release; the release after a hold doesn't tick the square.
  function setupZoom() {
    const HOLD_MS = 450, MOVE_PX = 10;
    const zoom = $('zoom'), box = $('zoom-card');
    let timer = null, shown = false, suppress = false, suppressTimer = null, startX = 0, startY = 0, lastType = '';

    function show(el) {
      const i = cells.indexOf(el);
      if (i < 0 || !state) return;
      box.textContent = '';
      box.classList.toggle('marked', i === Core.FREE || !!state.card.marked[i]);
      if (i === Core.FREE) {
        const img = el.querySelector('img');
        if (img) { const big = img.cloneNode(); big.alt = ''; box.appendChild(big); }
        else box.textContent = 'FREE';
      } else {
        box.textContent = state.card.terms[i];
      }
      zoom.hidden = false;
      shown = true;
    }
    function release() {
      clearTimeout(timer);
      if (!shown) return;
      shown = false;
      zoom.hidden = true;
      suppress = true;   // the click that follows a hold must not tick the square
      clearTimeout(suppressTimer);
      suppressTimer = setTimeout(() => { suppress = false; }, 600);
    }

    els.card.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const el = e.target.closest && e.target.closest('.cell');
      if (!el) return;
      lastType = e.pointerType;
      startX = e.clientX; startY = e.clientY;
      clearTimeout(timer);
      timer = setTimeout(() => show(el), HOLD_MS);
    });
    els.card.addEventListener('pointermove', (e) => {
      if (!shown && timer && Math.hypot(e.clientX - startX, e.clientY - startY) > MOVE_PX) { clearTimeout(timer); timer = null; }
    });
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    window.addEventListener('blur', release);
    // Capture phase, so this runs before the square's own click handler.
    els.card.addEventListener('click', (e) => {
      if (!suppress) return;
      suppress = false;
      e.stopPropagation();
      e.preventDefault();
    }, true);
    // Touch screens open a menu on a long press; keep it away from the squares.
    els.card.addEventListener('contextmenu', (e) => { if (shown || lastType === 'touch' || lastType === 'pen') e.preventDefault(); });
  }

  // The page heading follows the card's own list (premade lists have their own title).
  function updateHeading() {
    $('title').textContent = state ? metaOf(state.card).title : (C.title || 'Conference Bingo');
  }

  function updateSourceLine() {
    if (!state) { els.source.textContent = ''; return; }
    const meta = metaOf(state.card);
    els.source.textContent = 'List: ' + meta.name + (meta.seed ? ' · Seed: ' + meta.seed : '');
  }

  function updateView() {
    const have = !!state;
    els.share.disabled = !have;
    els.shareImage.disabled = !have;
    updateStats();
    updateSourceLine();
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
    const t = state ? state.totals : { cardsStarted: 0, bingos: 0, fullCards: 0, mostSquares: 0 };
    $('my-started').textContent = fmt(t.cardsStarted);
    $('my-bingo').textContent = fmt(t.bingos);
    $('my-full').textContent = fmt(t.fullCards);
    $('my-most').textContent = t.mostSquares > 1 ? t.mostSquares + ' of ' + Core.CELLS : '–';
    renderCompleted();
    $('global-box').hidden = !globalTotals;
    if (globalTotals) {
      $('g-player').textContent = fmt(globalTotals.player);
      $('g-started').textContent = fmt(globalTotals.started);
      $('g-bingo').textContent = fmt(globalTotals.bingo);
      $('g-full').textContent = fmt(globalTotals.full);
      $('g-most').textContent = globalTotals.most != null ? globalTotals.most + ' of ' + Core.CELLS : '–';
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
    s.completed.push({ id: card.id, terms: card.terms.slice(), at: Date.now(), meta: metaOf(card) });
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
    // Each new level of squares on this card is reported once; the free space is the first square, so levels start at 2.
    const squares = Core.markedCount(card.marked);
    if (typeof r.max !== 'number') r.max = 1;
    while (r.max < squares) { r.max++; track(squaresEvent(r.max)); }
    state.totals.mostSquares = Math.max(state.totals.mostSquares || 0, squares);
    if (!r.full && Core.markedCount(card.marked) === Core.CELLS) {
      r.full = true;
      state.totals.fullCards++;
      saveCompleted(state, card);
      track(EVENTS.full);
    }
  }

  // Deal a new card from the list chosen under "Choose your list". The card is card 1 of its seed (like the first
  // printed card), so the same seed and list always give the same card. With no seed typed, a random one is used.
  async function doReroll(seed) {
    // No seed typed: make one up anyway, so any card can be dealt again by typing the seed shown under it.
    const seedText = String(seed || '').trim() || randomSeed();
    let source;
    try {
      source = await currentSource(seedText);
    } catch (e) {
      if (state) showToast(e.message, null, null, 6000);
      else showNotice(e.message);
      return;
    }
    if (storageOk) hideNotice();   // keep the "can't save" warning if that's what is showing
    const prev = state ? state.card : null;
    const hadMarks = prev && Core.markedCount(prev.marked) > 1;
    const wasFinished = !!(prev && prev.reported.full);
    const card = Core.makeCard(source.terms, Core.cardRng(seedText, 1), rng);
    card.meta = source.meta;
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
  let pendingSeed = '';   // the seed to use if the person confirms the new-card question
  function askReroll(seed) {
    pendingSeed = seed || '';
    if (!state) { doReroll(pendingSeed); return; }
    const finished = state.card.reported.full;   // a card that was completed, even if a square has since been unticked
    const mine = Core.markedCount(state.card.marked) - 1;   // the free space doesn't count
    if (!finished && mine <= 0) { doReroll(pendingSeed); return; }
    if (typeof els.confirm.showModal !== 'function') {
      const text = finished
        ? 'Start a new card? Your finished card keeps counting towards your score and stays saved under Completed cards.'
        : 'Start a new card? Your current card and its ' + mine + ' marked squares will be lost.';
      if (window.confirm(text)) doReroll(pendingSeed);
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
    shareEmoji(state.card);
  }

  function shareEmoji(card) {
    // Everything here is synchronous so the browser still treats it as a direct tap
    // (Safari refuses to open the share sheet otherwise). The combined totals are
    // fetched when the page loads, and are simply left out if they aren't there.
    const text = Core.buildShareText({
      title: metaOf(card).title,
      card: card,
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

  const logoUrlOf = (meta) => (meta.logo ? new URL(meta.logo, location.href).href : '');

  function renderEntryImage(entry) {
    const meta = metaOf(entry);
    return window.BingoImage.render({
      title: meta.title,
      card: { terms: entry.terms, marked: Array(Core.CELLS).fill(true) },
      lineIds: Core.LINES.map((_, i) => i),
      count: Core.CELLS,
      status: 'Full card!',
      logoUrl: logoUrlOf(meta),
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
        fillFreeSquare(el, metaOf(entry));
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

  // A completed card has every square marked.
  function shareCompletedEmoji() {
    if (!viewEntry || !state) return;
    shareEmoji({ terms: viewEntry.terms, marked: Array(Core.CELLS).fill(true) });
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
    const meta = metaOf(card);
    return window.BingoImage.render({
      title: meta.title,
      card: card,
      lineIds: Core.completedLineIds(card.marked),
      count: Core.markedCount(card.marked),
      status: Core.statusLabel(card.marked),
      logoUrl: logoUrlOf(meta),
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
      navigator.share({ files: [file], title: $('title').textContent || 'Conference Bingo' })
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

  // ---------- choose your list (premade or pasted), seed ----------
  const clampCount = (v) => Math.min(MAX_PRINT, Math.max(1, Math.floor(Number(v)) || 1));

  const randomSeed = () => Core.randomSeed(rng);

  // Text under the pasted list: how many squares it has, and whether that is enough.
  function describeCustom() {
    const found = customTerms();
    const max = Number(C.maxTermLength) || 50;
    const long = Core.findLongTerms(found, max).length;
    let text = found.length + (found.length === 1 ? ' square' : ' squares');
    if (found.length < Core.NEEDED) text += '. Add ' + (Core.NEEDED - found.length) + ' more (you need at least ' + Core.NEEDED + ' different ones).';
    else text += '. That is enough. ' + (found.length < 40 ? 'More than 40 makes the cards more varied.' : '');
    if (long) text += ' ' + long + (long === 1 ? ' square is' : ' squares are') + ' longer than ' + max + ' characters and will be shown in small text.';
    return { enough: found.length >= Core.NEEDED, text: text };
  }

  function updateListUI() {
    const custom = prefs.mode === 'custom';
    $('custom-pane').hidden = !custom;
    const info = describeCustom();
    $('custom-status').textContent = info.text;
    const ok = custom ? info.enough : true;
    $('make-card').disabled = !ok;
    $('print-btn').disabled = !ok;
    const list = activeList();
    $('list-info').textContent = custom ? 'Press “New card from this list” to deal from the squares you type below.'
      : (list ? 'Press “New card from this list” to deal from it. The centre square shows the ' + list.name + ' logo.' : '');
  }

  const CUSTOM_OPTION = '__custom__';   // the last choice in the list drop-down: "My own list"

  function setupListChooser() {
    const select = $('list-select');
    manifest.lists.forEach((l) => {
      const o = document.createElement('option');
      o.value = l.id;
      o.textContent = l.name;
      select.appendChild(o);
    });
    const own = document.createElement('option');
    own.value = CUSTOM_OPTION;
    own.textContent = 'My own list (type your own squares)';
    select.appendChild(own);
    if (!listById(prefs.listId)) prefs.listId = defaultList().id;
    select.value = prefs.mode === 'custom' ? CUSTOM_OPTION : prefs.listId;
    $('custom-terms').value = prefs.customText;
    $('seed').value = prefs.seed;
    $('seed-details').open = !!prefs.seed;   // stays tucked away unless a seed is already in use
    $('print-count').max = String(MAX_PRINT);

    select.addEventListener('change', () => {
      if (select.value === CUSTOM_OPTION) prefs.mode = 'custom';
      else { prefs.mode = 'premade'; prefs.listId = select.value; }
      savePrefs();
      updateListUI();
    });
    $('custom-terms').addEventListener('input', () => { prefs.customText = $('custom-terms').value; savePrefs(); updateListUI(); });
    $('seed').addEventListener('input', () => { prefs.seed = $('seed').value.slice(0, 60); savePrefs(); });
    $('make-card').addEventListener('click', () => askReroll(prefs.seed.trim()));
    $('print-btn').addEventListener('click', onPrint);
    updateListUI();
  }

  // ---------- printing a stack of cards ----------
  async function onPrint() {
    if (!window.BingoPrint) return;
    const count = clampCount($('print-count').value);
    $('print-count').value = String(count);
    const perPage = Number($('print-per').value) || 2;
    let source;
    try {
      source = await currentSource('');
    } catch (e) {
      showToast(e.message, null, null, 6000);
      return;
    }
    // The first card uses the seed typed at the top (or a made-up one) and each later card gets its own seed worked
    // out from it. Every card has its seed printed on it: typing that seed in gives that card back, and typing the
    // first one gives the whole stack again.
    const seed = prefs.seed.trim() || randomSeed();
    const seeds = Core.seedList(seed, count);
    const cards = seeds.map((s) => Core.makeCard(source.terms, Core.cardRng(s, 1), rng).terms);
    const meta = source.meta;
    $('print-btn').disabled = true;
    showToast('Getting ' + count + (count === 1 ? ' card' : ' cards') + ' ready…', null, null, 3000);
    try {
      await window.BingoPrint.print({
        area: $('print-area'), cards: cards, seeds: seeds, perPage: perPage,
        title: meta.title, logo: meta.logo, logoAlt: meta.logoAlt,
        fit: fitText, freeIndex: Core.FREE
      });
    } catch (e) {
      showToast('Sorry, the printable cards couldn’t be made.', null, null, 5000);
      updateListUI();
      return;
    }
    showToast(count === 1 ? 'Seed for this card: ' + seed : 'Type “' + seed + '” as the seed to make this whole stack again. Each card also shows its own seed.', null, null, 10000);
    updateListUI();   // puts the button back to what the list allows
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
      toast: $('toast'), toastMsg: $('toast-msg'), toastAction: $('toast-action'), source: $('card-source')
    };

    if (C.title) $('title').textContent = C.title;
    if (C.tabTitle || C.title) document.title = C.tabTitle || C.title;
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
    $('view-share-emoji').addEventListener('click', shareCompletedEmoji);
    $('view-close').addEventListener('click', () => els.view.close());
    els.shareImage.addEventListener('click', onShareImage);
    els.reroll.addEventListener('click', () => askReroll(prefs.seed.trim()));   // uses the seed at the top, if there is one
    els.confirm.addEventListener('close', () => { if (els.confirm.returnValue === 'new') doReroll(pendingSeed); });
    $('clear-data').addEventListener('click', askClear);
    setupZoom();
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
    readPrefs();
    loadGoatCounter();
    if (trackingOn()) fetchGlobal().then(updateStats);

    try {
      await loadManifest();   // before the saved card is read: older cards take the first list's logo and title
    } catch (e) {
      state = readState();
      buildGrid();
      showNotice(e.message);
      $('lists-box').hidden = true;
      $('print-box').hidden = true;
      return;
    }
    state = readState();
    buildGrid();
    setupListChooser();

    if (!state) {
      // A first visit deals from the first premade list, unless the person had already chosen a usable list of their own.
      if (prefs.mode === 'custom' && !describeCustom().enough) { prefs.mode = 'premade'; $('list-select').value = prefs.listId; updateListUI(); }
      await doReroll(prefs.seed.trim());
      if (editionReset) {
        showToast('A new conference has started, so your old card, totals and completed cards were cleared. Here is a fresh card.', null, null, 12000);
      }
    }
  }

  init();
})();
