#!/usr/bin/env node
// Checks terms.txt before you publish it.
//   Needs at least 24 different terms  -> error (exit code 1)
//   Terms over maxTermLength           -> warning (they still work, but show in small text)
//   Duplicate terms                    -> warning (duplicates are removed from the cards)
//
// Run it from the project folder:   node scripts/check-terms.js
// Or point it at another folder:    node scripts/check-terms.js path/to/folder
// On GitHub it runs automatically (see .github/workflows/check-terms.yml) and the warnings
// show up as yellow annotations on the commit.
'use strict';
const fs = require('fs');
const path = require('path');

const NEEDED = 24;
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const onGitHub = process.env.GITHUB_ACTIONS === 'true';

let config = '';
try { config = fs.readFileSync(path.join(root, 'config.js'), 'utf8'); } catch (e) { /* use defaults */ }
const maxMatch = /maxTermLength:\s*(\d+)/.exec(config);
const fileMatch = /termsFile:\s*"([^"]+)"/.exec(config);
const max = maxMatch ? Number(maxMatch[1]) : 50;
const termsFile = fileMatch ? fileMatch[1] : 'terms.txt';

let text;
try {
  text = fs.readFileSync(path.join(root, termsFile), 'utf8');
} catch (e) {
  console.error('Could not read ' + termsFile + ' in ' + root);
  process.exit(1);
}

const seen = new Map();   // lower-cased term -> line number of the first copy
let warnings = 0;
function warn(line, title, message) {
  warnings++;
  if (onGitHub) console.log('::warning file=' + termsFile + ',line=' + line + ',title=' + title + '::' + message);
  else console.log('Warning: ' + termsFile + ' line ' + line + ': ' + message);
}

text.replace(/^﻿/, '').split(/\r?\n/).forEach((raw, index) => {
  const line = index + 1;
  const term = raw.replace(/\s+/g, ' ').trim();
  if (!term || term.startsWith('#')) return;
  const key = term.toLowerCase();
  if (seen.has(key)) {
    warn(line, 'Duplicate term', '"' + term + '" repeats line ' + seen.get(key) + ' and will be ignored.');
    return;
  }
  seen.set(key, line);
  const length = Array.from(term).length;
  if (length > max) {
    warn(line, 'Term too long', '"' + term + '" is ' + length + ' characters (limit ' + max + '). It will be shown in small text, so consider shortening it.');
  }
});

const unique = seen.size;
console.log(unique + ' different terms in ' + termsFile + '; ' + warnings + ' warning' + (warnings === 1 ? '' : 's') + '.');
if (unique < NEEDED) {
  const message = 'Only ' + unique + ' different terms; at least ' + NEEDED + ' are needed to fill a card.';
  if (onGitHub) console.log('::error file=' + termsFile + ',title=Not enough terms::' + message);
  else console.error('Error: ' + message);
  process.exit(1);
}
