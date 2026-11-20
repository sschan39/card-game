#!/usr/bin/env node
/**
 * Card translation coverage for the i18n work.
 *
 * Reads the authored card JSON directly (the engine's catalogue is TypeScript, and
 * this script must run outside the build) and reports, per card, which of the five
 * translatable surfaces are covered in a locale: name, rulesText, subTypes, mode
 * labels and choice prompts.
 *
 * Mode labels and choice prompts are measured against what the card actually
 * declares — a card with three modes needs three translated labels, not "any".
 *
 * Usage: node scripts/i18n/card-coverage.mjs [--locale en] [--json]
 * Exit code 1 when a card is incomplete, so CI can gate on it.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const REPO = path.resolve(import.meta.dirname, '..', '..');
const CARD_ROOT = path.join(REPO, 'packages/engine/src/library');
const SETS = ['core', 'st01a', 'workbook', 'development'];

const args = process.argv.slice(2);
const locale = args.includes('--locale') ? args[args.indexOf('--locale') + 1] : 'en';
const asJson = args.includes('--json');

function stamp() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return {
    date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    time: `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`,
  };
}

/** Every mode id and choice id the card declares, wherever they are nested. */
function declaredIds(definition) {
  const modeIds = new Set();
  const choiceIds = new Set();
  const seen = new Set();
  const visit = (value) => {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value.modes)) {
      for (const mode of value.modes) if (mode && typeof mode.id === 'string') modeIds.add(mode.id);
    }
    const choice = value.choice;
    if (choice && typeof choice === 'object' && typeof choice.id === 'string') choiceIds.add(choice.id);
    for (const child of Object.values(value)) visit(child);
  };
  visit(definition);
  return { modeIds, choiceIds };
}

function listDefinitions() {
  const files = [];
  for (const set of SETS) {
    const directory = path.join(CARD_ROOT, 'cards', set);
    if (!fs.existsSync(directory)) continue;
    for (const name of fs.readdirSync(directory)) {
      if (name.endsWith('.json')) files.push({ set, file: path.join(directory, name) });
    }
  }
  const tokenDirectory = path.join(CARD_ROOT, 'tokens');
  if (fs.existsSync(tokenDirectory)) {
    for (const name of fs.readdirSync(tokenDirectory)) {
      if (name.endsWith('.json')) files.push({ set: 'tokens', file: path.join(tokenDirectory, name) });
    }
  }
  return files;
}

function audit(entry) {
  const definition = JSON.parse(fs.readFileSync(entry.file, 'utf8'));
  const translation = definition.translations?.[locale];
  const { modeIds, choiceIds } = declaredIds(definition);
  const authoredSubTypes = Array.isArray(definition.subTypes) ? definition.subTypes : [];
  const translatedModes = translation?.modes ?? {};
  const translatedPrompts = translation?.prompts ?? {};

  const missingModes = [...modeIds].filter((id) => !translatedModes[id]);
  const missingPrompts = [...choiceIds].filter((id) => !translatedPrompts[id]);
  const subTypesOk = authoredSubTypes.length === 0
    || (Array.isArray(translation?.subTypes) && translation.subTypes.length === authoredSubTypes.length);
  /* A card whose authored rules text is empty has nothing to translate; counting it as
     missing would make a fully translated set look incomplete. */
  const authoredRulesText = typeof definition.rulesText === 'string' && definition.rulesText.trim().length > 0;

  return {
    id: definition.id ?? path.basename(entry.file, '.json'),
    set: entry.set,
    name: Boolean(translation?.name?.trim()),
    rulesText: !authoredRulesText || Boolean(translation?.rulesText?.trim()),
    subTypes: subTypesOk,
    modes: missingModes.length === 0,
    prompts: missingPrompts.length === 0,
    missing: [
      translation?.name?.trim() ? '' : 'name',
      !authoredRulesText || translation?.rulesText?.trim() ? '' : 'rulesText',
      subTypesOk ? '' : 'subTypes',
      missingModes.length ? `modes(${missingModes.join('|')})` : '',
      missingPrompts.length ? `prompts(${missingPrompts.join('|')})` : '',
    ].filter(Boolean).join(' '),
    modeCount: modeIds.size,
    promptCount: choiceIds.size,
  };
}

function main() {
  const started = process.hrtime.bigint();
  console.log(`[1/3] auditing ${locale} translations`);
  const rows = listDefinitions().map(audit).sort((a, b) => a.set.localeCompare(b.set) || a.id.localeCompare(b.id));
  const surfaces = ['name', 'rulesText', 'subTypes', 'modes', 'prompts'];
  const covered = Object.fromEntries(surfaces.map((key) => [key, rows.filter((row) => row[key]).length]));
  const complete = rows.filter((row) => row.missing === '').length;

  console.log('[2/3] summary');
  console.log(`      definitions ${rows.length} · complete ${complete} (${((complete / rows.length) * 100).toFixed(1)}%)`);
  for (const key of surfaces) console.log(`      ${key.padEnd(9)} ${covered[key]}/${rows.length}`);
  console.log(`      mode labels ${rows.reduce((sum, row) => sum + row.modeCount, 0)} · choice prompts ${rows.reduce((sum, row) => sum + row.promptCount, 0)}`);

  const { date, time } = stamp();
  const directory = path.join(REPO, 'output', date, time);
  fs.mkdirSync(directory, { recursive: true });
  const target = path.join(directory, `card-i18n-coverage-${locale}.csv`);
  const header = 'id,set,name,rulesText,subTypes,modes,prompts,missing';
  const body = rows.map((row) => [row.id, row.set, row.name, row.rulesText, row.subTypes, row.modes, row.prompts, `"${row.missing}"`].join(','));
  fs.writeFileSync(target, `${[header, ...body].join('\n')}\n`, 'utf8');
  if (asJson) fs.writeFileSync(path.join(directory, `card-i18n-coverage-${locale}.json`), JSON.stringify(rows, null, 2), 'utf8');

  const elapsed = Number(process.hrtime.bigint() - started) / 1e6;
  console.log(`[3/3] wrote ${path.relative(REPO, target).replace(/\\/g, '/')} in ${elapsed.toFixed(0)}ms`);
  if (complete !== rows.length) {
    console.log(`      incomplete: ${rows.length - complete} card(s) — see the missing column`);
    process.exitCode = 1;
  }
}

main();
