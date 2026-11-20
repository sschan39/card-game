#!/usr/bin/env node
/**
 * Apply one batch of card translations.
 *
 * Translations are kept in this script rather than hand-edited into 164 JSON files:
 * one reviewable table, and JSON.stringify keeps the authored files valid. Existing
 * translations are merged, so re-running a batch is safe.
 *
 * Usage: node scripts/i18n/apply-translations.mjs <batch-name>
 * Batches: core-tokens, st01a, development, workbook-1..n
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const REPO = path.resolve(import.meta.dirname, '..', '..');
const LIBRARY = path.join(REPO, 'packages/engine/src/library');
const SET_DIRECTORIES = ['core', 'st01a', 'workbook', 'development'];

/** id -> English text. `name` is required; the rest overrides only what it names. */
const BATCHES = {
  'core-tokens': {
    'broken-fireball': {
      name: 'Shattered Fireball',
      rulesText: 'When this card is revealed by a Beast effect, you may add it to your hand.\nSpeed: deal 3 damage to the opposing player.',
    },
    'empire-servant': { name: 'Empire Servant', rulesText: '\u2460 Tap: add one fire energy.' },
    'flame-fangs': { name: 'Blaze Fangs', rulesText: 'Speed: destroy one of the opponent\u2019s lands. Then draw a card.' },
    'land-red': {
      name: 'Bloodfire Mountain',
      rulesText: 'This card is exempt from the deck copy limit. \u2460 Tap: add one fire energy.',
    },
    'musketeer-infantry': { name: 'Musketeer Private' },
    'worlds-rebel': {
      name: 'Rebel of the Worlds Empire',
      rulesText: '\u2460 On attack: destroy one of the opponent\u2019s Relics or lands. This effect cannot trigger a Chain.',
    },
    'token-angel-1-1': {
      name: 'Angel Token',
      subTypes: ['Emissary'],
      rulesText: 'A 1/1 Emissary token with no abilities.',
    },
    'token-phantom-stitch-monster': {
      name: 'Phantom Stitched Monster',
      rulesText: 'On attack, you may special summon one Phantom Puppet Creature from your graveyard.',
    },
  },
  st01a: {
    'achilles-blood-temple': {
      name: 'Achilles\u2019 Bloodfire Temple',
      rulesText: 'When summoned, destroy the Creature on the opponent\u2019s field with the lowest remaining life; you choose on a tie. Whenever a Beast Creature you control attacks, place three Scorch counters on one Creature or Relic the opponent controls. (A Relic is destroyed once its Scorch reaches its total energy.)',
    },
    'achilles-minion': {
      name: 'Achilles\u2019 Minion',
      rulesText: '\u2460 When summoned; Scorch 1: you may place one Scorch counter on a Creature or Relic the opponent controls. (A Creature is destroyed once its Scorch reaches its current power plus toughness.) (A Relic is destroyed once its Scorch reaches its total energy.)',
    },
    'andu-gittes': {
      name: 'Flame Triarch Andu Gittes',
      rulesText: 'When this card is revealed by a Beast Creature effect, you may discard this card. Then, Scorch 2: place two Scorch counters on a Creature or Relic the opponent controls. Then draw a card. (A Relic is destroyed once its Scorch reaches its total energy.)',
    },
    'awakened-blood-mountain': {
      name: 'Awakened Bloodfire Mountain',
      rulesText: 'When this card is revealed by a Beast effect, you may add it to your hand. \u2460 When the opposing player\u2019s life decreases, you may draw a card.',
    },
    'bloodrage-maadini': {
      name: 'Bloodrage Maadini of the Six Sovereigns',
      rulesText: '\u2460 When summoned, if all your Creatures are Yul: deal 4 damage to all opponent Creatures, then this card permanently gains +3/+3. \u2461 Your Yul Creatures get +3 power.',
    },
    chiron: {
      name: 'Flame Triarch Chiron',
      rulesText: 'When summoned, when attacking, and when destroyed and put into the graveyard, place two Scorch counters on one Creature or Relic the opponent controls. (A Relic is destroyed once its Scorch reaches its total energy.)',
    },
    'flame-ballista': {
      name: 'Blaze Ballista',
      rulesText: 'Speed, tap and pay 1 fire energy: place 1 Scorch counter on a Creature or Relic the opponent controls. (A Relic is destroyed once its Scorch reaches its total energy.)',
    },
    'flame-emperor-achilles': {
      name: 'Flame Emperor Achilles',
      rulesText: '\u2460 When a Beast Creature you control attacks, you may reveal the top 3 cards of your deck, count the Beast Creatures and Flame Soldier spells among them, and place that many Scorch counters on a Creature or Relic the opponent controls; put the revealed cards on the bottom of your deck in any order, then process revealed effects. \u2461 When this card attacks, deal damage equal to the total Scorch counters on the opponent\u2019s field \u00d7 3 to the opposing player or one Creature (a single instance of damage; for now choose player or Creature). (A Relic is destroyed once its Scorch reaches its total energy.)',
    },
    'flame-mercenary': {
      name: 'Flame Mercenary',
      rulesText: 'Speed: discard this card from your hand, destroy one special-summoned creature the opponent controls, then draw a card.',
    },
    'ignition-wolf': {
      name: 'Ignition Wolf',
      rulesText: '\u2460 When summoned; Scorch 3: you may place three Scorch counters on a Creature or Relic the opponent controls. This effect cannot be placed on a card that already has Scorch counters. (A Creature is destroyed once its Scorch reaches its current power plus toughness.) (A Relic is destroyed once its Scorch reaches its total energy.)',
    },
    'red-wolf': {
      name: 'Red Wolf',
      rulesText: 'When it enters: you may reveal the top three cards of your deck, choose one Beast card from them and add it to your hand (except Red Wolf), and put the rest on the bottom of your deck in any order; then process revealed effects.',
    },
    'rise-of-power': {
      name: 'Rise to Power',
      rulesText: 'Main: draw two cards. If a Beast Creature is on the field, draw one additional card.',
    },
    'strong-ignition-wolf': {
      name: 'Fierce Assault Rageflame Wolf',
      rulesText: 'Your creatures\u2019 summons and effects cannot trigger a Chain. Each time you place a Scorch counter, draw a card; the same event triggers only once.',
    },
    'wise-ignition-wolf': {
      name: 'Wise Rageflame Wolf',
      rulesText: 'Your creatures\u2019 summons and effects cannot trigger a Chain. Speed: discard this card from your hand, place 2 Scorch counters on a Creature or Relic the opponent controls. (A Relic is destroyed once its Scorch reaches its total energy.)',
    },
    'wolf-king-keps': {
      name: 'Keps, the Blaze Wolf King',
      rulesText: '\u2460 Once per turn, when it enters: destroy a Creature or Relic the opponent controls. When it is destroyed successfully, draw a card.',
    },
    'worlds-flameblade': {
      name: 'Flameblade of the Worlds',
      rulesText: 'Equipment: during your main phase, you may equip it to or move it to your Creature for free. The equipped Creature gets +2 power. When the equipped Creature attacks, draw a card, then deal 2 damage to one opponent Creature.',
    },
    'worlds-pyromancer': {
      name: 'Pyromancer of the Worlds',
      rulesText: '\u2460 When a Yul Creature you control attacks, deal 2 damage to one opponent Creature. Then draw a card.',
    },
  },
};

function findDefinition(id) {
  for (const set of SET_DIRECTORIES) {
    const candidate = path.join(LIBRARY, 'cards', set, `${id}.json`);
    if (fs.existsSync(candidate)) return candidate;
  }
  /* Token files drop the `token-` prefix (id `token-angel-1-1` -> angel-1-1.json). */
  for (const name of [id, id.replace(/^token-/, '')]) {
    const token = path.join(LIBRARY, 'tokens', `${name}.json`);
    if (fs.existsSync(token)) return token;
  }
  return null;
}

function main() {
  const name = process.argv[2];
  /* A batch is either inline in this file or a JSON file under scripts/i18n/batches. */
  const fileBatch = path.join(REPO, 'scripts/i18n/batches', name + '.json');
  const batch = BATCHES[name] ?? (fs.existsSync(fileBatch) ? JSON.parse(fs.readFileSync(fileBatch, 'utf8')) : undefined);
  if (!batch) {
    console.error(`Unknown batch "${name}". Known: ${Object.keys(BATCHES).join(', ')}`);
    process.exitCode = 1;
    return;
  }
  let written = 0;
  for (const [id, translation] of Object.entries(batch)) {
    const file = findDefinition(id);
    if (!file) {
      console.error(`  missing definition: ${id}`);
      process.exitCode = 1;
      continue;
    }
    const definition = JSON.parse(fs.readFileSync(file, 'utf8'));
    /* Merge into the existing English entry: a later batch may add only `modes` or
       `prompts` without repeating the name and rules text it already has. */
    definition.translations = {
      ...(definition.translations ?? {}),
      en: { ...(definition.translations?.en ?? {}), ...translation },
    };
    fs.writeFileSync(file, `${JSON.stringify(definition, null, 2)}\n`, 'utf8');
    written += 1;
  }
  console.log(`applied ${written}/${Object.keys(batch).length} translations from batch "${name}"`);
}

main();
