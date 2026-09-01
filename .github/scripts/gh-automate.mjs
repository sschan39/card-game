#!/usr/bin/env node
// gh-automate.mjs
// Zero-dependency GitHub automation: git operations via isomorphic-git (pure JS,
// no git binary required) + GitHub REST API for issues/PRs.
//
// Usage:
//   node .github/scripts/gh-automate.mjs <command> [args...]
//
// Commands:
//   init-repo          Clone (or init) the repo into ./.gh-workspace
//   commit-and-push    Stage all changes, commit, push to the configured branch
//   create-issue       --title "..." [--body "..."] [--labels a,b]
//   list-issues        [--state open]
//   close-issue        --number N [--reason completed]
//   create-pr          --title "..." --base main [--head <branch>] [--body "..."]
//   list-prs           [--state open]
//   merge-pr           --number N [--method squash]
//
// Configuration (in this order): CLI flags > .gh-automate.json > env vars.
//   Env: GH_TOKEN (required for write/POST), GH_OWNER, GH_REPO, GIT_USER, GIT_EMAIL
//
// Works entirely without a system git binary thanks to isomorphic-git.

import git from 'isomorphic-git';
import http from 'isomorphic-git/http/node';
import * as fs from 'fs';
import * as path from 'path';
import * as url from 'url';

const __dirname = url.fileURLToPath(new URL('.', import.meta.url));
const REPO_DIR = process.env.GH_WORKDIR || path.resolve(__dirname, '..', '..');

// isomorphic-git needs an explicit fs plugin on every call.
const gitFs = { fs, http };

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function loadConfig() {
  const file = path.resolve(path.dirname(__dirname), '..', '.gh-automate.json');
  let fileCfg = {};
  try {
    fileCfg = JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    // no file config — env only
  }
  return {
    token: process.env.GH_TOKEN || fileCfg.token || '',
    owner: process.env.GH_OWNER || fileCfg.owner || '',
    repo: process.env.GH_REPO || fileCfg.repo || '',
    branch: process.env.GH_BRANCH || fileCfg.branch || 'main',
    gitUser: process.env.GIT_USER || fileCfg.gitUser || 'github-actions[bot]',
    gitEmail: process.env.GIT_EMAIL || fileCfg.gitEmail || '41898282+github-actions[bot]@users.noreply.github.com',
  };
}

function parseArgs(argv) {
  const opts = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) {
        opts[a.slice(2, eq)] = a.slice(eq + 1);
      } else {
        opts[a.slice(2)] = argv[i + 1];
        i++;
      }
    } else {
      positional.push(a);
    }
  }
  return { opts, positional };
}

// ---------------------------------------------------------------------------
// GitHub REST helper
// ---------------------------------------------------------------------------

async function gh(pathname, { method = 'GET', body } = {}) {
  const { token, owner, repo } = loadConfig();
  if (!owner || !repo) throw new Error('GH_OWNER and GH_REPO must be set (env or .gh-automate.json)');
  const headers = {
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'card-game-gh-automate',
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';

  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}${pathname}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub API ${res.status} ${method} ${pathname}: ${text.slice(0, 300)}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

// ---------------------------------------------------------------------------
// Git helpers (isomorphic-git)
// ---------------------------------------------------------------------------

async function ensureRepo(cfg) {
  // Operate directly on the project directory (REPO_DIR = project root).
  const gitDir = path.join(REPO_DIR, '.git');
  if (!fs.existsSync(gitDir)) {
    if (!cfg.owner) throw new Error('Cannot init repo: GH_OWNER not set');
    await git.init({ ...gitFs, dir: REPO_DIR, defaultBranch: cfg.branch });
    console.log(`Initialized git repo at ${REPO_DIR} (branch ${cfg.branch})`);
  }

  // Ensure the origin remote points at the configured repository.
  const remoteUrl = `https://github.com/${cfg.owner}/${cfg.repo}.git`;
  const remotes = await git.listRemotes({ ...gitFs, dir: REPO_DIR });
  const origin = remotes.find((r) => r.remote === 'origin');
  if (!origin) {
    await git.addRemote({ ...gitFs, dir: REPO_DIR, remote: 'origin', url: remoteUrl });
    console.log(`Added origin remote: ${remoteUrl}`);
  } else if (origin.url !== remoteUrl) {
    await git.removeRemote({ ...gitFs, dir: REPO_DIR, remote: 'origin' });
    await git.addRemote({ ...gitFs, dir: REPO_DIR, remote: 'origin', url: remoteUrl });
    console.log(`Updated origin remote -> ${remoteUrl}`);
  }
  return;
}

async function commitAndPush(cfg, baseDir = process.cwd()) {
  await ensureRepo(cfg);
  // Stage all changes in the project directory and commit/push.
  const { opts } = parseArgs(process.argv.slice(3));
  const message = opts.message || opts.m || 'chore: automated update';

  const statusInfo = await git.statusMatrix({ ...gitFs, dir: REPO_DIR });
  const toStage = statusInfo.filter(([, head, workdir]) => workdir !== 0);
  if (toStage.length === 0) {
    console.log('No changes to commit (workdir clean).');
    // still try push (fast-forward remote)
    await pushQuiet(cfg);
    return;
  }
  await git.add({ ...gitFs, dir: REPO_DIR, filepath: '.' });
  await git.commit({
    ...gitFs,
    dir: REPO_DIR,
    message,
    author: { name: cfg.gitUser, email: cfg.gitEmail },
    committer: { name: cfg.gitUser, email: cfg.gitEmail },
  });
  console.log(`Committed ${toStage.length} file(s): ${message}`);
  await pushQuiet(cfg);
}

async function pushQuiet(cfg) {
  try {
    await git.push({
      ...gitFs,
      dir: REPO_DIR,
      remote: 'origin',
      ref: cfg.branch,
      onAuth: () => ({ username: cfg.gitUser, password: cfg.token || '' }),
    });
    console.log(`Pushed to origin/${cfg.branch}`);
  } catch (e) {
    console.error(`Push failed (is GH_TOKEN set and branch writable?): ${e.message}`);
    process.exitCode = 1;
  }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function main() {
  const cmd = process.argv[2];
  const { opts, positional } = parseArgs(process.argv.slice(3));
  const cfg = loadConfig();

  switch (cmd) {
    case 'init-repo':
      await ensureRepo(cfg);
      console.log(`Workspace ready at ${REPO_DIR}`);
      break;

    case 'commit-and-push':
      await commitAndPush(cfg);
      break;

    case 'create-issue': {
      const title = opts.title || positional[0] || '';
      if (!title) throw new Error('create-issue requires --title');
      const body = opts.body || '';
      const labels = (opts.labels || '').split(',').filter(Boolean);
      const issue = await gh('/issues', {
        method: 'POST',
        body: { title, body, labels },
      });
      console.log(`Created issue #${issue.number}: ${issue.html_url}`);
      break;
    }

    case 'list-issues': {
      const state = opts.state || 'open';
      const issues = await gh(`/issues?state=${state}&per_page=25`);
      if (issues.length === 0) {
        console.log('No issues.');
        break;
      }
      for (const i of issues) {
        console.log(`#${i.number} [${i.state}] ${i.title} — ${i.labels.map((l) => l.name).join(',')}`);
      }
      break;
    }

    case 'close-issue': {
      const number = Number(opts.number || positional[0]);
      if (!number) throw new Error('close-issue requires --number');
      const state_reason = opts.reason || 'completed';
      const issue = await gh(`/issues/${number}`, {
        method: 'PATCH',
        body: { state: 'closed', state_reason },
      });
      console.log(`Closed issue #${number}: ${issue.html_url}`);
      break;
    }

    case 'create-pr': {
      const title = opts.title || positional[0] || '';
      const base = opts.base || 'main';
      const head = opts.head || cfg.branch;
      if (!title) throw new Error('create-pr requires --title');
      const body = opts.body || '';
      const pr = await gh('/pulls', {
        method: 'POST',
        body: { title, body, head, base },
      });
      console.log(`Created PR #${pr.number}: ${pr.html_url}`);
      break;
    }

    case 'list-prs': {
      const state = opts.state || 'open';
      const prs = await gh(`/pulls?state=${state}&per_page=25`);
      if (prs.length === 0) {
        console.log('No PRs.');
        break;
      }
      for (const p of prs) {
        console.log(`#${p.number} [${p.state}] ${p.title} (${p.head.ref} -> ${p.base.ref})`);
      }
      break;
    }

    case 'merge-pr': {
      const number = Number(opts.number || positional[0]);
      if (!number) throw new Error('merge-pr requires --number');
      const method = opts.method || 'squash';
      await gh(`/pulls/${number}/merge`, { method: 'PUT', body: { merge_method: method } });
      console.log(`Merged PR #${number} via ${method}`);
      break;
    }

    default:
      console.error(`Unknown command: ${cmd}`);
      console.error('Try: init-repo, commit-and-push, create-issue, list-issues, close-issue, create-pr, list-prs, merge-pr');
      // eslint-disable-next-line no-undef
      process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(`Error: ${e.message}`);
  // eslint-disable-next-line no-undef
  process.exitCode = 1;
});