#!/usr/bin/env node
// Checks every premade list (lists/lists.json) before you publish it.
//   Needs at least 24 different terms  -> error (exit code 1)
//   Terms over maxTermLength           -> warning (they still work, but show in small text)
//   Duplicate terms                    -> warning (duplicates are removed from the cards)
//   Missing terms file or logo         -> error
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
const max = maxMatch ? Number(maxMatch[1]) : 50;

const listsDir = path.join(root, 'lists');
let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(path.join(listsDir, 'lists.json'), 'utf8'));
} catch (e) {
  console.error('Could not read lists/lists.json in ' + root + ': ' + e.message);
  process.exit(1);
}
const lists = Array.isArray(manifest.lists) ? manifest.lists : [];
if (!lists.length) { console.error('lists/lists.json has no lists.'); process.exit(1); }

let failed = false;
function annotate(level, file, line, title, message) {
  if (onGitHub) console.log('::' + level + ' file=' + file + (line ? ',line=' + line : '') + ',title=' + title + '::' + message);
  else console.log((level === 'error' ? 'Error: ' : 'Warning: ') + file + (line ? ' line ' + line : '') + ': ' + message);
  if (level === 'error') failed = true;
}

const ids = new Set();
if (manifest.default && !lists.some((l) => l.id === manifest.default)) {
  annotate('error', 'lists/lists.json', 0, 'Unknown default', '"default" is "' + manifest.default + '" but no list has that id.');
}

lists.forEach((list) => {
  const label = list.id || list.name || '(no id)';
  if (!list.id || !/^[a-z0-9-]+$/i.test(list.id)) annotate('error', 'lists/lists.json', 0, 'Bad id', 'List "' + label + '" needs an id made of letters, numbers and dashes.');
  else if (ids.has(list.id)) annotate('error', 'lists/lists.json', 0, 'Duplicate id', 'More than one list has the id "' + list.id + '".');
  ids.add(list.id);
  ['name', 'title', 'terms'].forEach((key) => {
    if (!list[key]) annotate('error', 'lists/lists.json', 0, 'Missing ' + key, 'List "' + label + '" has no "' + key + '".');
  });
  if (list.logo && !fs.existsSync(path.join(listsDir, list.logo))) {
    annotate('error', 'lists/lists.json', 0, 'Missing logo', 'List "' + label + '": logo file lists/' + list.logo + ' was not found.');
  }
  if (!list.terms) return;

  const termsFile = 'lists/' + list.terms;
  let text;
  try {
    text = fs.readFileSync(path.join(listsDir, list.terms), 'utf8');
  } catch (e) {
    annotate('error', termsFile, 0, 'Missing terms file', 'Could not read ' + termsFile + '.');
    return;
  }

  const seen = new Map();   // lower-cased term -> line number of the first copy
  let warnings = 0;
  text.replace(/^﻿/, '').split(/\r?\n/).forEach((raw, index) => {
    const line = index + 1;
    const term = raw.replace(/\s+/g, ' ').trim();
    if (!term || term.startsWith('#')) return;
    const key = term.toLowerCase();
    if (seen.has(key)) {
      warnings++;
      annotate('warning', termsFile, line, 'Duplicate term', '"' + term + '" repeats line ' + seen.get(key) + ' and will be ignored.');
      return;
    }
    seen.set(key, line);
    const length = Array.from(term).length;
    if (length > max) {
      warnings++;
      annotate('warning', termsFile, line, 'Term too long', '"' + term + '" is ' + length + ' characters (limit ' + max + '). It will be shown in small text, so consider shortening it.');
    }
  });

  const unique = seen.size;
  console.log(label + ': ' + unique + ' different terms in ' + termsFile + '; ' + warnings + ' warning' + (warnings === 1 ? '' : 's') + '.');
  if (unique < NEEDED) {
    annotate('error', termsFile, 0, 'Not enough terms', 'Only ' + unique + ' different terms; at least ' + NEEDED + ' are needed to fill a card.');
  }
});

if (failed) process.exit(1);
