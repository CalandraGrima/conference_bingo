/* Builds a stack of printable bingo cards and opens the browser's print window ("Save as PDF" makes the PDF).
   The cards are drawn in #print-area, which is off screen normally and is the only thing shown when printing.
   Works with plain black borders and no background colours, so it prints the same on any printer. */
(function (root) {
  'use strict';

  var PER_PAGE = { 1: true, 2: true, 4: true };

  function el(tag, className, text) {
    var e = document.createElement(tag);
    if (className) e.className = className;
    if (text != null) e.textContent = text;
    return e;
  }

  function freeCell(o) {
    var c = el('div', 'p-cell free');
    if (o.logo) {
      var img = el('img');
      img.src = o.logo;
      img.alt = '';
      c.appendChild(img);
    } else {
      c.appendChild(el('span', 'free-text', 'FREE'));
    }
    return c;
  }

  // Fit every different term once, in squares the same size as the printed ones. Cards then reuse the sizes,
  // so even 100 cards need only a few dozen measurements.
  function measure(o, perPage) {
    var terms = {};
    o.cards.forEach(function (card) { card.forEach(function (t) { if (t !== null) terms[t] = true; }); });
    var list = Object.keys(terms);
    var page = el('div', 'print-page pp-' + perPage);
    var card = el('div', 'print-card');
    var grid = el('div', 'p-grid');
    var cells = list.map(function (t) {
      var c = el('div', 'p-cell');
      c.appendChild(el('span', null, t));
      grid.appendChild(c);
      return c;
    });
    card.appendChild(grid);
    page.appendChild(card);
    o.area.appendChild(page);
    o.fit(cells);   // the same shrink-to-fit the on-screen squares use
    var sizes = {};
    list.forEach(function (t, i) { sizes[t] = { size: cells[i].style.fontSize, wrap: cells[i].style.overflowWrap }; });
    o.area.removeChild(page);
    return sizes;
  }

  function buildCard(o, terms, number, sizes) {
    var card = el('div', 'print-card');
    if (o.wordmark) {
      var mark = el('img', 'p-wordmark');
      mark.src = o.wordmark;
      mark.alt = '';
      card.appendChild(mark);
    }
    card.appendChild(el('h2', 'p-title', o.title));
    var grid = el('div', 'p-grid');
    terms.forEach(function (t, i) {
      if (i === o.freeIndex) { grid.appendChild(freeCell(o)); return; }
      var c = el('div', 'p-cell');
      c.appendChild(el('span', null, t));
      var fit = sizes[t];
      if (fit && fit.size) c.style.fontSize = fit.size;
      if (fit && fit.wrap) c.style.overflowWrap = fit.wrap;
      grid.appendChild(c);
    });
    card.appendChild(grid);
    card.appendChild(el('p', 'p-foot', o.listName + '  ·  seed ' + o.seed + '  ·  card ' + number + ' of ' + o.cards.length));
    return card;
  }

  function waitForImages(area) {
    var pending = Array.prototype.map.call(area.querySelectorAll('img'), function (img) {
      if (img.complete) return Promise.resolve();
      return new Promise(function (resolve) { img.onload = img.onerror = resolve; });
    });
    return Promise.all(pending);
  }

  function clear(area) {
    document.body.classList.remove('printing');
    area.textContent = '';
  }

  /* o: { area, cards (lists of 25 terms, null in the centre), perPage (1, 2 or 4), title, listName, seed,
          logo, wordmark, fit (function that shrinks text to fit a list of squares), freeIndex }
     Resolves once the print window has been opened. */
  function print(o) {
    var perPage = PER_PAGE[o.perPage] ? o.perPage : 2;
    var area = o.area;
    area.textContent = '';
    var ready = document.fonts && document.fonts.load
      ? Promise.all([document.fonts.load('400 16px "Barlow Condensed"'), document.fonts.load('600 16px "Barlow Condensed"')]).catch(function () {})
      : Promise.resolve();
    return ready.then(function () {
      var sizes = measure(o, perPage);
      var page = null;
      o.cards.forEach(function (terms, i) {
        if (!page || page.children.length >= perPage) {
          page = el('div', 'print-page pp-' + perPage);
          area.appendChild(page);
        }
        page.appendChild(buildCard(o, terms, i + 1, sizes));
      });
      return waitForImages(area);
    }).then(function () {
      return new Promise(function (resolve) {
        // The cards stay in place until the print window is done (or the next print starts), then are cleared.
        var done = function () { window.removeEventListener('afterprint', done); clear(area); };
        window.addEventListener('afterprint', done);
        document.body.classList.add('printing');
        // Let the page lay out once more before the print window takes its snapshot.
        requestAnimationFrame(function () { setTimeout(function () { window.print(); resolve(); }, 50); });
      });
    });
  }

  root.BingoPrint = { print: print };
})(window);
