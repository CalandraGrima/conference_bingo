/* Pure bingo logic: no page access and no storage, so it can be tested on its own.
   Works in the browser (window.BingoCore) and in Node. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BingoCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SIZE = 5;
  var CELLS = SIZE * SIZE;
  var FREE = 12;            // centre square
  var NEEDED = CELLS - 1;   // terms needed to fill a card

  // Every row, column and diagonal as a list of square indexes.
  var LINES = (function () {
    var lines = [], i, j, row, col, d1 = [], d2 = [];
    for (i = 0; i < SIZE; i++) {
      row = []; col = [];
      for (j = 0; j < SIZE; j++) { row.push(i * SIZE + j); col.push(j * SIZE + i); }
      lines.push(row, col);
      d1.push(i * SIZE + i);
      d2.push(i * SIZE + (SIZE - 1 - i));
    }
    lines.push(d1, d2);
    return lines;
  })();

  // Turn the text of a terms file into a clean list: skips blanks and # comments, removes duplicates.
  function parseTerms(text) {
    var seen = Object.create(null), out = [];
    String(text).replace(/^﻿/, '').split(/\r?\n/).forEach(function (line) {
      var t = line.replace(/\s+/g, ' ').trim();
      if (!t || t.charAt(0) === '#') return;
      var key = t.toLowerCase();
      if (seen[key]) return;
      seen[key] = true;
      out.push(t);
    });
    return out;
  }

  // Fisher-Yates shuffle. rng() must return a number in [0, 1).
  function shuffle(list, rng) {
    var a = list.slice(), i, j, t;
    for (i = a.length - 1; i > 0; i--) {
      j = Math.floor(rng() * (i + 1));
      t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  // Seeded random numbers, so the same seed always gives the same cards.
  // hashSeed turns any text into a 32-bit number (cyrb128-style mixing); mulberry32 turns that number into rng().
  function hashSeed(text) {
    var h = 1779033703 ^ String(text).length, i, c;
    for (i = 0; i < String(text).length; i++) {
      c = String(text).charCodeAt(i);
      h = Math.imul(h ^ c, 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^ (h >>> 16)) >>> 0;
  }

  function seededRng(seed) {
    var a = hashSeed(seed);
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Card number n (1, 2, 3...) of a seed. The on-screen card with a seed is card 1, so it matches
  // the first printed card made from the same seed and list.
  function cardRng(seed, n) { return seededRng(String(seed) + '#' + n); }

  // A card stores the actual terms (not a seed), so editing a list later never changes a card in play.
  // idRng (optional) makes the card's id, so seeded cards still get ids that are different from each other.
  function makeCard(terms, rng, idRng) {
    if (terms.length < NEEDED) throw new Error('At least ' + NEEDED + ' different terms are needed.');
    var picked = shuffle(terms, rng).slice(0, NEEDED), cells = [], marked = [], i;
    for (i = 0; i < CELLS; i++) {
      if (i === FREE) { cells.push(null); marked.push(true); }
      else { cells.push(picked.shift()); marked.push(false); }
    }
    return {
      id: Date.now().toString(36) + Math.floor((idRng || rng)() * 1e9).toString(36),
      terms: cells,
      marked: marked,
      reported: { started: false, lines: [], full: false }   // lines = ids of lines already counted
    };
  }

  function isValidCard(card) {
    if (!card || !Array.isArray(card.terms) || !Array.isArray(card.marked)) return false;
    if (card.terms.length !== CELLS || card.marked.length !== CELLS) return false;
    for (var i = 0; i < CELLS; i++) {
      if (i === FREE) { if (card.terms[i] !== null || card.marked[i] !== true) return false; }
      else if (typeof card.terms[i] !== 'string' || typeof card.marked[i] !== 'boolean') return false;
    }
    return true;
  }

  function markedCount(marked) {
    var n = 0;
    for (var i = 0; i < marked.length; i++) if (marked[i]) n++;
    return n;
  }

  // Which lines are completely marked, as indexes into LINES (0 to 11).
  function completedLineIds(marked) {
    var ids = [];
    LINES.forEach(function (line, id) {
      if (line.every(function (i) { return marked[i]; })) ids.push(id);
    });
    return ids;
  }

  // The same lines, as lists of square indexes.
  function completedLines(marked) {
    return completedLineIds(marked).map(function (id) { return LINES[id]; });
  }

  // Terms longer than max characters, which end up in small text on a card.
  function findLongTerms(terms, max) {
    return terms.filter(function (t) { return Array.from(t).length > max; });
  }

  // "BINGO!" for one completed line, "3 BINGOS!" for more, "" for none.
  function bingoLabel(lineCount) {
    return lineCount === 0 ? '' : lineCount === 1 ? 'BINGO!' : lineCount + ' BINGOS!';
  }

  // "Full card!", "BINGO!", "3 BINGOS!" or "No bingo yet".
  function statusLabel(marked) {
    var lines = completedLineIds(marked).length;
    if (markedCount(marked) === CELLS) return 'Full card!';
    return lines > 0 ? bingoLabel(lines) : 'No bingo yet';
  }

  function plural(n, one, many) { return n.toLocaleString('en-US') + ' ' + (n === 1 ? one : many); }

  // GoatCounter returns counts as formatted strings such as "1,234".
  function parseCount(value) {
    var digits = String(value == null ? '' : value).replace(/[^0-9]/g, '');
    return digits === '' ? null : Number(digits);
  }

  // The Wordle-style text people paste into chats.
  // o: { title, card, totals, global, url, freeEmoji }
  function buildShareText(o) {
    var marked = o.card.marked;
    var n = markedCount(marked);
    var lines = completedLines(marked).length;
    var freeEmoji = o.freeEmoji || '⭐';
    var status = statusLabel(marked);

    var out = [o.title + ' ' + n + '/' + CELLS, status, ''];
    for (var r = 0; r < SIZE; r++) {
      var row = '';
      for (var c = 0; c < SIZE; c++) {
        var i = r * SIZE + c;
        row += i === FREE ? freeEmoji : marked[i] ? '🟩' : '⬜';
      }
      out.push(row);
    }

    var extra = [];
    var t = o.totals;
    if (t && t.cardsStarted >= 2) {
      extra.push('My cards: ' + t.cardsStarted + ' played · ' + plural(t.bingos, 'bingo', 'bingos') + ' · ' + t.fullCards + ' full');
    }
    var g = o.global;
    if (g) {
      var parts = [];
      if (g.player != null) parts.push(plural(g.player, 'player', 'players'));
      if (g.started != null) parts.push(plural(g.started, 'card played', 'cards played'));
      if (g.bingo != null) parts.push(plural(g.bingo, 'bingo', 'bingos'));
      if (g.full != null) parts.push(plural(g.full, 'full card', 'full cards'));
      if (parts.length) extra.push('Everyone so far: ' + parts.join(' · '));
    }
    if (extra.length) out.push('');
    out = out.concat(extra);
    if (o.url) out.push('', o.url);
    return out.join('\n');
  }

  return {
    SIZE: SIZE, CELLS: CELLS, FREE: FREE, NEEDED: NEEDED, LINES: LINES,
    parseTerms: parseTerms, shuffle: shuffle, hashSeed: hashSeed, seededRng: seededRng, cardRng: cardRng, makeCard: makeCard, isValidCard: isValidCard,
    markedCount: markedCount, completedLines: completedLines, completedLineIds: completedLineIds,
    findLongTerms: findLongTerms, bingoLabel: bingoLabel, statusLabel: statusLabel, parseCount: parseCount,
    buildShareText: buildShareText
  };
});
