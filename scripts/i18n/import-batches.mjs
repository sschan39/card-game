#!/usr/bin/env node
/**
 * Import translation batches from finished sub-agent transcripts.
 *
 * The translators ran as read-only sub-agents, so their answers live in the session's
 * `subagents/<ref>.jsonl`. Reading them here keeps the payload out of the parent's
 * context: only the per-batch card count is printed.
 *
 * Usage: node scripts/i18n/import-batches.mjs
 * Output: scripts/i18n/batches/<batch>.json
 */
import fs from 'node:fs';
import path from 'node:path';

const REPO = path.resolve(import.meta.dirname, '..', '..');
const OUT = path.join(REPO, 'scripts/i18n/batches');
const SUBAGENTS = process.env.REASONIX_SUBAGENTS
  ?? 'C:/Users/cuant/AppData/Roaming/reasonix/projects/c--my_projects_-3383 aise project/sessions/subagents';

/** batch name -> sub-agent reference that produced it. */
const BATCHES = {
  'workbook-1': 'sa_20261117_121142_000000000_b5e0275de891',
  'workbook-2': 'sa_20261117_121142_000000000_b8a008d45075',
  'workbook-3': 'sa_20261117_121142_000000000_dec961c1946b',
  'workbook-4': 'sa_20261117_121142_000000000_4af9451c6e72',
  'workbook-5': 'sa_20261117_121142_000000000_1cb3419d76e4',
  development: 'sa_20261117_121142_000000000_bd4c234d4e40',
};

/** Last assistant message text in a transcript; earlier ones are drafts. */
function lastAssistantText(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(line => line.trim());
  let text = '';
  for (const line of lines) {
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    if (entry.role !== 'assistant') continue;
    if (typeof entry.content === 'string') text = entry.content;
    else if (Array.isArray(entry.content)) {
      const joined = entry.content.filter(part => typeof part?.text === 'string').map(part => part.text).join('\n');
      if (joined) text = joined;
    }
  }
  return text;
}

/** Last fenced ```json block, falling back to the first `{` in the text. */
function extractJson(text) {
  const fenced = [...text.matchAll(/```json\s*([\s\S]*?)```/g)];
  const body = fenced.length ? fenced[fenced.length - 1][1] : text.slice(text.indexOf('{'));
  return JSON.parse(body);
}

fs.mkdirSync(OUT, { recursive: true });
let failed = 0;
for (const [batch, ref] of Object.entries(BATCHES)) {
  const file = path.join(SUBAGENTS, ref + '.jsonl');
  if (!fs.existsSync(file)) { console.error('[batch] missing transcript for ' + batch + ': ' + ref); failed += 1; continue; }
  try {
    const translations = extractJson(lastAssistantText(file));
    fs.writeFileSync(path.join(OUT, batch + '.json'), JSON.stringify(translations, null, 2) + '\n', 'utf8');
    console.log('[batch] ' + batch + ': ' + Object.keys(translations).length + ' cards');
  } catch (error) {
    console.error('[batch] ' + batch + ': ' + error.message);
    failed += 1;
  }
}
if (failed) process.exitCode = 1;
