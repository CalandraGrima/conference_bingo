/* Draws the whole bingo card as a PNG image, for "Share as image".
   Always uses a light look so it reads well in any chat app, whatever theme the person is using. */
(function (root) {
  'use strict';

  var FONT = '"Barlow Condensed", system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
  var W = 1080, PAD = 48, GAP = 12, SIZE = 5;
  // Clean black and white, matching the site's light theme. Ticked squares are light green.
  var COLOURS = {
    bg: '#fafafa', surface: '#ffffff', text: '#111111', muted: '#5c5c5c',
    ink: '#111111', paper: '#ffffff', marked: '#c9f0d9', tick: '#14532d', bingo: '#ff9f1c', full: '#4ade80'
  };

  function loadImage(src) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { resolve(null); };
      img.src = src;
    });
  }

  function roundedRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  // Split text into words, also allowing a line break after a slash (so "ChatGPT/Claude/etc" can wrap).
  function tokenize(text) {
    var tokens = [];
    text.split(' ').forEach(function (word) {
      var parts = word.match(/[^\/]+\/?|\//g) || [word];
      parts.forEach(function (part, i) { tokens.push({ text: part, space: i === 0 && tokens.length > 0 }); });
    });
    return tokens;
  }

  // Break text into lines no wider than maxW. A single word wider than maxW is broken by letter.
  function wrap(ctx, text, maxW) {
    var lines = [], line = '';
    function push() { if (line) lines.push(line); line = ''; }
    tokenize(text).forEach(function (tok) {
      var candidate = line ? line + (tok.space ? ' ' : '') + tok.text : tok.text;
      if (ctx.measureText(candidate).width <= maxW) { line = candidate; return; }
      push();
      if (ctx.measureText(tok.text).width <= maxW) { line = tok.text; return; }
      Array.from(tok.text).forEach(function (ch) {
        if (ctx.measureText(line + ch).width > maxW) push();
        line += ch;
      });
    });
    push();
    return lines;
  }

  // The biggest font size (down to a minimum) at which the text fits the box without splitting a word.
  // Only if even the smallest size can't manage that does a very long word get broken by letter.
  function fitText(ctx, text, boxW, boxH) {
    var size, lines, widest;
    var tokens = tokenize(text);
    for (size = 36; size >= 14; size--) {
      ctx.font = '400 ' + size + 'px ' + FONT;
      widest = Math.max.apply(null, tokens.map(function (t) { return ctx.measureText(t.text).width; }));
      if (widest > boxW) continue;
      lines = wrap(ctx, text, boxW);
      if (lines.length * size * 1.2 <= boxH) return { size: size, lines: lines };
    }
    ctx.font = '400 14px ' + FONT;
    return { size: 14, lines: wrap(ctx, text, boxW) };
  }

  function fitSingleLine(ctx, text, weight, maxSize, maxW) {
    var size = maxSize;
    ctx.font = weight + ' ' + size + 'px ' + FONT;
    while (size > 20 && ctx.measureText(text).width > maxW) {
      size -= 2;
      ctx.font = weight + ' ' + size + 'px ' + FONT;
    }
    return size;
  }

  /* o: { title, card, lineIds, status, count, logoUrl, footer }
     Resolves to a PNG Blob. */
  // Make sure Barlow Condensed (including any accented letters in the terms) is loaded before drawing.
  function fontsReady(o) {
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    var text = o.title + o.footer + o.card.terms.join('');
    return Promise.all([
      document.fonts.load('400 24px "Barlow Condensed"', text),
      document.fonts.load('700 24px "Barlow Condensed"', text)
    ]).catch(function () { /* fall back to the system font */ });
  }

  function render(o) {
    return Promise.all([o.logoUrl ? loadImage(o.logoUrl) : null, o.siteLogoUrl ? loadImage(o.siteLogoUrl) : null, fontsReady(o)]).then(function (results) {
      var logo = results[0], siteLogo = results[1];
      return draw(o, logo, siteLogo).catch(function () { return draw(o, null, null); });   // retry without the logos if the browser refuses them
    });
  }

  function draw(o, logo, siteLogo) {
    var cell = (W - 2 * PAD - (SIZE - 1) * GAP) / SIZE;
    var gridH = SIZE * cell + (SIZE - 1) * GAP;
    // The wide wordmark (if there is one) goes above the title.
    var markW = 0, markH = 0;
    if (siteLogo && siteLogo.naturalWidth && siteLogo.naturalHeight) {
      markW = Math.min(520, W - 2 * PAD);
      markH = Math.round(markW * siteLogo.naturalHeight / siteLogo.naturalWidth);
    }
    var off = markH ? markH + 24 : 0;
    var headerH = 170 + off, footerH = 80;
    var H = Math.round(PAD + headerH + gridH + footerH + PAD / 2);

    var canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = COLOURS.bg;
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    if (markH) ctx.drawImage(siteLogo, (W - markW) / 2, PAD, markW, markH);

    // Title
    ctx.fillStyle = COLOURS.text;
    ctx.font = '600 ' + fitSingleLine(ctx, o.title, 600, 60, W - 2 * PAD) + 'px ' + FONT;
    ctx.fillText(o.title, W / 2, PAD + off + 40);

    // Status line, in an orange pill when there is a bingo
    var line = o.count + '/25 squares  ·  ' + o.status;
    var hasBingo = o.lineIds.length > 0;
    ctx.font = '700 34px ' + FONT;
    var textW = ctx.measureText(line).width;
    if (hasBingo) {
      ctx.fillStyle = o.count === 25 ? COLOURS.full : COLOURS.bingo;   // green once the whole card is done
      roundedRect(ctx, (W - textW) / 2 - 28, PAD + off + 82, textW + 56, 58, 29);
      ctx.fill();
    }
    ctx.fillStyle = hasBingo ? COLOURS.ink : COLOURS.muted;
    ctx.fillText(line, W / 2, PAD + off + 112);

    // Squares
    var inLine = {};
    var LINES = root.BingoCore.LINES;
    o.lineIds.forEach(function (id) { LINES[id].forEach(function (i) { inLine[i] = true; }); });
    var top = PAD + headerH;

    o.card.terms.forEach(function (term, i) {
      var x = PAD + (i % SIZE) * (cell + GAP);
      var y = top + Math.floor(i / SIZE) * (cell + GAP);
      var marked = o.card.marked[i];
      var free = term === null;

      ctx.fillStyle = free ? COLOURS.paper : marked ? COLOURS.marked : COLOURS.surface;
      ctx.fillRect(x, y, cell, cell);   // square corners
      ctx.strokeStyle = COLOURS.ink;
      ctx.lineJoin = 'miter';
      ctx.lineWidth = 4;   // every square has the same thin border
      ctx.strokeRect(x, y, cell, cell);

      if (free) {
        var pad = 14, box = cell - 2 * pad;
        if (logo) {
          var scale = Math.min(box / logo.naturalWidth, box / logo.naturalHeight) || 1;
          var w = (logo.naturalWidth || box) * scale, h = (logo.naturalHeight || box) * scale;
          ctx.drawImage(logo, x + (cell - w) / 2, y + (cell - h) / 2, w, h);
        } else {
          ctx.fillStyle = COLOURS.ink;
          ctx.font = '700 40px ' + FONT;
          ctx.fillText('FREE', x + cell / 2, y + cell / 2);
        }
        return;
      }

      // Marked squares keep the top strip free for the tick, so it never overlaps the words.
      var side = 14, bottom = 16;
      var textTop = marked ? 38 : 16, textH = cell - textTop - bottom;
      var fit = fitText(ctx, term, cell - 2 * side, textH);
      ctx.fillStyle = COLOURS.text;
      ctx.font = '400 ' + fit.size + 'px ' + FONT;
      var lh = fit.size * 1.2;
      var startY = y + textTop + textH / 2 - (fit.lines.length * lh) / 2 + lh / 2;
      fit.lines.forEach(function (l, k) { ctx.fillText(l, x + cell / 2, startY + k * lh); });

      if (inLine[i]) {   // the word BINGO next to the tick
        ctx.save();
        ctx.fillStyle = COLOURS.tick;
        ctx.font = '700 22px ' + FONT;
        ctx.textAlign = 'right';
        ctx.fillText('BINGO', x + cell - 50, y + 25);
        ctx.restore();
      }

      if (marked) {   // a tick as well as the colour
        ctx.strokeStyle = COLOURS.tick;
        ctx.lineWidth = 5;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(x + cell - 38, y + 24);
        ctx.lineTo(x + cell - 30, y + 32);
        ctx.lineTo(x + cell - 15, y + 15);
        ctx.stroke();
      }
    });

    // Footer
    ctx.fillStyle = COLOURS.muted;
    ctx.font = '400 28px ' + FONT;
    ctx.fillText(o.footer, W / 2, top + gridH + 46);

    return new Promise(function (resolve, reject) {
      try {
        canvas.toBlob(function (blob) { blob ? resolve(blob) : reject(new Error('Could not make the image')); }, 'image/png');
      } catch (e) { reject(e); }
    });
  }

  root.BingoImage = { render: render };
})(window);
