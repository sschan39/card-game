import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    card: { type: 'string', multiple: true },
    strict: { type: 'boolean' },
    report: { type: 'string' },
    recipe: { type: 'string' },
  },
});
const ids = [...new Set([...(values.card ?? []), ...positionals])];
if (ids.some(id => !/^[a-z0-9][a-z0-9_-]{0,127}$/.test(id))) {
  throw new Error('Pass card IDs as arguments, or use --card CARD_ID.');
}
if (values.recipe !== undefined && ids.length !== 1) {
  throw new Error('--recipe requires exactly one card ID.');
}
if (values.recipe && values.report && resolve(values.recipe) === resolve(values.report)) {
  throw new Error('--recipe and --report need different output files.');
}

const root = fileURLToPath(new URL('../', import.meta.url));
const vitest = fileURLToPath(new URL('./vitest.mjs', import.meta.resolve('vitest/package.json')));
const temporary = mkdtempSync(join(tmpdir(), 'card-game-test-'));
const report = join(temporary, 'report.json');
try {
  const result = spawnSync(process.execPath, [vitest, 'run', 'tests/library/per-card.test.ts'], {
    cwd: root,
    env: {
      ...process.env,
      CARD_TEST_IDS: ids.join(','),
      CARD_TEST_STRICT: values.strict ? '1' : '0',
      CARD_TEST_REPORT: report,
      CARD_TEST_RECIPE: values.recipe ? '1' : '0',
    },
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;

  let cards;
  try {
    cards = JSON.parse(readFileSync(report, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    console.error('Card tests ended before a report could be written.');
    process.exitCode = 1;
  }
  if (cards) {
    const counts = new Map();
    for (const card of cards) counts.set(card.status, (counts.get(card.status) ?? 0) + 1);
    console.log('Card results: ' + [...counts].map(([status, count]) => `${count} ${status}`).join(', '));
    for (const card of cards) {
      if (ids.length || card.status === 'failed' || card.status === 'removed') {
        const missing = card.missing.length ? ' (' + card.missing.join(', ') + ')' : '';
        console.log(`${card.id}: ${card.status}${missing}`);
      }
    }
    if (values.report) {
      const output = resolve(values.report);
      mkdirSync(dirname(output), { recursive: true });
      copyFileSync(report, output);
      console.log('Report: ' + output);
    }
    if (values.recipe) {
      if (!cards[0]?.recipe) {
        console.error('No starting board is available for this card.');
        process.exitCode = 1;
      } else {
        const output = resolve(values.recipe);
        mkdirSync(dirname(output), { recursive: true });
        writeFileSync(output, JSON.stringify(cards[0].recipe, null, 2) + '\n');
        console.log('Test Room recipe: ' + output);
      }
    }
  }
} finally {
  try { unlinkSync(report); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  rmdirSync(temporary);
}
