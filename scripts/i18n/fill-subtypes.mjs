#!/usr/bin/env node
/**
 * Fill English subTypes for cards whose authored sub-types are Traditional Chinese.
 *
 * Sub-types are a small closed vocabulary, so one mapping table covers every card. The
 * table follows docs/i18n-glossary.md §9 plus the names already shipped in core/st01a.
 *
 * Usage: node scripts/i18n/fill-subtypes.mjs [--dry-run]
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const REPO = path.resolve(import.meta.dirname, '..', '..');
const LIBRARY = path.join(REPO, 'packages/engine/src/library');
const DIRECTORIES = ['core', 'st01a', 'workbook', 'development'].map(set => path.join(LIBRARY, 'cards', set))
  .concat([path.join(LIBRARY, 'tokens')]);
const DRY_RUN = process.argv.includes('--dry-run');

/** Authored sub-type -> English. Values already in English map to themselves. */
const SUBTYPE_MAP = {
  炎獸: 'Flame Beast',
  炎兵: 'Flame Soldier',
  幽爾: 'Yuer',
  地界: 'Land',
  蒼巨人: 'Azure Giant',
  幻影木偶: 'Phantom Puppet',
  上使: 'Emissary',
  冰龍: 'Ice Dragon',
};

function translate(term) {
  const mapped = SUBTYPE_MAP[term];
  if (mapped) return mapped;
  /* Already-English sub-types (Equipment, Dragon, RPS, Test, …) pass through. */
  if (/^[\x20-\x7E]+$/.test(term)) return term;
  return null;
}

let filled = 0;
const unmapped = new Set();
for (const directory of DIRECTORIES) {
  if (!fs.existsSync(directory)) continue;
  for (const file of fs.readdirSync(directory).filter(name => name.endsWith('.json'))) {
    const target = path.join(directory, file);
    const definition = JSON.parse(fs.readFileSync(target, 'utf8'));
    const authored = Array.isArray(definition.subTypes) ? definition.subTypes : [];
    if (!authored.length) continue;
    const existing = definition.translations?.en?.subTypes;
    if (Array.isArray(existing) && existing.length === authored.length) continue;
    const translated = authored.map(term => {
      const value = translate(term);
      if (value === null) unmapped.add(term);
      return value;
    });
    if (translated.some(value => value === null)) continue;
    const english = definition.translations?.en;
    if (!english?.name) continue;
    definition.translations = { ...definition.translations, en: { ...english, subTypes: translated } };
    if (!DRY_RUN) fs.writeFileSync(target, JSON.stringify(definition, null, 2) + '\n', 'utf8');
    filled += 1;
    console.log('[subtypes] ' + definition.id + ': ' + authored.join(', ') + ' -> ' + translated.join(', '));
  }
}

console.log((DRY_RUN ? '[dry-run] would fill ' : 'filled ') + filled + ' cards');
if (unmapped.size) console.log('unmapped terms: ' + [...unmapped].join(', '));
