# GitHub Automation

This repo ships a zero-dependency automation harness for working with GitHub
without requiring a system `git` binary or a locally cloned checkout.

## Requirements

- Node.js 18+ (uses the global `fetch` and `isomorphic-git`).
- A GitHub **Personal Access Token** (`GH_TOKEN`) with `repo` scope for any
  *write* operation (commit/push, create/close issues, PRs, merges). Public
  reads (e.g. `list-issues`) work without a token.

## Setup

Create `.gh-automate.json` (git-ignored) or export env vars:

```bash
export GH_TOKEN=github_pat_...
export GH_OWNER=sschan39
export GH_REPO=card-game
export GH_BRANCH=main
```

A template lives at [`.gh-automate.json.example`](../.gh-automate.json.example).

## Usage

Run everything through the npm script:

```bash
npm run gh -- <command> [--flag value ...]
```

| Command | Flags | Description |
|---|---|---|
| `init-repo` | — | Clone (or sync) the configured repo into `.gh-workspace` |
| `commit-and-push` | `--message "..."` | Stage all changes, commit, push to `GH_BRANCH` |
| `create-issue` | `--title`, `--body`, `--labels a,b` | Open a new issue |
| `list-issues` | `--state open` | List issues (default open) |
| `close-issue` | `--number N`, `--reason completed` | Close an issue |
| `create-pr` | `--title`, `--base main`, `--head <branch>`, `--body` | Open a pull request |
| `list-prs` | `--state open` | List pull requests (default open) |
| `merge-pr` | `--number N`, `--method squash` | Merge a PR |

## Examples

```bash
# Commit and push the current working tree
npm run gh -- commit-and-push --message "fix: resolve phase-advance stall"

# Open a bug issue
npm run gh -- create-issue --title "Bug: X does not Y" --body "Details..." --labels bug

# Open a PR from the fix-branch to main
npm run gh -- create-pr --title "fix: resolve phase-advance stall" --base main --head fix-branch --body "Closes #12"
```

## Notes

- Git operations run via `isomorphic-git` (pure JS) into `.gh-workspace/`, which
  is git-ignored. No system `git` is required.
- The REST layer requires `GH_OWNER` and `GH_REPO`; the token is used as an
  HTTPS password for push and as a `Bearer` token for the API.