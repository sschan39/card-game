#!/usr/bin/env node
/**
 * Replace card artwork from Scryfall.
 *
 * The local filename is kept (`<card-id>.jpg`), so `card-art.ts` needs no edit: only
 * the bytes and the provenance entry in `manifest.json` change. Candidates already used
 * by another card are skipped, so two cards never share one illustration.
 *
 * Usage: node scripts/card-art/fetch-art.mjs [card-id ...]
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const REPO = path.resolve(import.meta.dirname, '..', '..');
const ART = path.join(REPO, 'packages/ui/src/assets/card-art');
const MANIFEST = path.join(ART, 'manifest.json');

/** Query per card: colour + type, matching the style of the existing placeholder set. */
const TARGETS = {
  'bloodrage-maadini': { query: 'c:br t:legendary t:creature', note: 'legendary+color:br' },
  fireball: { query: 'c:r t:instant', note: 'instant+color:r' },
  'raging-sea-power': { query: 'c:u t:sorcery', note: 'sorcery+color:u' },
};

const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const used = new Set(Object.values(manifest).map(entry => entry.scryfallId));
const requested = process.argv.slice(2);
const ids = requested.length ? requested : Object.keys(TARGETS);

async function search(query) {
  const url = 'https://api.scryfall.com/cards/search?q=' + encodeURIComponent(query + ' -is:digital')
    + '&unique=art&order=random';
  const response = await fetch(url, { headers: { 'User-Agent': 'card-game-local-art', Accept: 'application/json' } });
  if (!response.ok) throw new Error('search failed: ' + response.status);
  const body = await response.json();
  return body.data ?? [];
}

async function main() {
  for (const id of ids) {
    const target = TARGETS[id];
    if (!target) throw new Error('No query configured for ' + id);
    const candidates = await search(target.query);
    const pick = candidates.find(card => !used.has(card.id) && card.image_uris?.normal);
    if (!pick) throw new Error('No unused candidate for ' + id);
    used.add(pick.id);
    const image = await fetch(pick.image_uris.normal, {
      headers: { 'User-Agent': 'card-game-local-art', Accept: 'image/jpeg' },
    });
    if (!image.ok) throw new Error('image failed: ' + image.status + ' ' + pick.image_uris.normal);
    const bytes = Buffer.from(await image.arrayBuffer());
    fs.writeFileSync(path.join(ART, id + '.jpg'), bytes);
    manifest[id] = {
      ...manifest[id],
      mtgName: pick.name,
      mtgSet: pick.set,
      scryfallId: pick.id,
      source: pick.scryfall_uri ?? 'https://scryfall.com/card/' + pick.set + '/' + pick.collector_number,
      file: id + '.jpg',
      bytes: bytes.length,
      matchedVia: target.note,
    };
    console.log('[art] ' + id + ' <- ' + pick.name + ' (' + pick.set + ') ' + bytes.length + ' bytes');
  }
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  console.log('[art] manifest updated');
}

main().catch(error => { console.error('[art] ' + error.message); process.exitCode = 1; });
