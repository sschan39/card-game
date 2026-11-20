#!/usr/bin/env node
/**
 * Report cards whose authored subTypes have no English translation yet.
 *
 * Prints the affected ids and a term frequency table, so the sub-type vocabulary can be
 * translated once instead of card by card.
 *
 * Usage: node scripts/i18n/report-missing-subtypes.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const REPO = path.resolve(import.meta.dirname, '..', '..');
const LIBRARY = path.join(REPO, 'packages/engine/src/library');
const DIRECTORIES = ['core', 'st01a', 'workbook', 'development'].map(set => path.join(LIBRARY, 'cards', set))
  .concat([path.join(LIBRARY, 'tokens')]);

const rows = [];
const terms = new Map();
for (const directory of DIRECTORIES) {
  if (!fs.existsSync(directory)) continue;
  for (const file of fs.readdirSync(directory).filter(name => name.endsWith('.json'))) {
    const definition = JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'));
    const authored = Array.isArray(definition.subTypes) ? definition.subTypes : [];
    if (!authored.length) continue;
    const translated = definition.translations?.en?.subTypes;
    if (Array.isArray(translated) && translated.length === authored.length) continue;
    rows.push({ id: definition.id, directory: path.basename(directory), authored });
    for (const term of authored) terms.set(term, (terms.get(term) ?? 0) + 1);
  }
}

console.log('cards missing subTypes: ' + rows.length);
for (const row of rows) console.log('  ' + row.directory + '/' + row.id + ': ' + row.authored.join(', '));
console.log('=== term frequency ===');
for (const [term, count] of [...terms].sort((left, right) => right[1] - left[1])) {
  console.log('  ' + term + ': ' + count);
}
