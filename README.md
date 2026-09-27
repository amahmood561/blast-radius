# blast-radius

**A backstop for coding agents. It stays quiet for small changes and stops the run when the
scope suddenly isn't small.**

Your agent is in accept-edits mode. You approved edits 1 through 6 without reading them
closely. Edits 7 through 40 go through on the same momentum, and one of them is `wrangler.toml`.

`blast-radius` is the thing that notices.

```
BLAST RADIUS — tool call stopped

  Turn is wider than expected: 16 files this turn, limit is 15
    src/mod1.ts
    src/mod2.ts
    … and 14 more

  Protected path: matches protected pattern wrangler.*
    wrangler.toml

  This turn: 16/15 files · this session: 22/60 files

  Stop and tell the user exactly what is listed above. Do not retry,
  and do not work around this by splitting the change into smaller calls.
  If the user confirms they want it, they run:  blastradius allow
```

---

## This is not another permission prompt

Claude Code already asks before individual edits. That is a **per-action** question, and
because it fires constantly, people turn it off — and then there is no backstop at all.

`blast-radius` asks a **cumulative** question instead.

| A permission prompt asks | blast-radius asks |
|---|---|
| "May I edit `auth.ts`?" | "Are you aware this turn has now rewritten 38 files?" |
| Per action, binary | Per turn and per session, aggregate |
| Fires constantly | Should fire roughly never |

A guard that fires on every edit gets uninstalled in a day. One that fires twice a month gets
trusted. **If this tool is noisy for you, its limits are wrong — raise them.**

---

## Install

> **Not on npm yet.** Install from source until it is:

```bash
git clone https://github.com/amahmood561/blast-radius
cd blast-radius && npm link       # puts `blastradius` on your PATH

cd your-project
blastradius init
```

`init` does exactly two things, and nothing else:

1. Writes `.blastradius.json` with the default limits (skipped if one already exists).
2. Adds one `PreToolUse` entry to `.claude/settings.json`, preserving every hook already
   there. Running it twice replaces its own entry rather than stacking a duplicate.

Restart Claude Code afterwards so it loads the hook.

To point the hook at a checkout instead of a global install:

```bash
blastradius init --command "node /path/to/blast-radius/bin/blastradius.js hook"
```

Requires Node 18+. **Zero dependencies** — a guard that fails because one of its dependencies
broke is worse than no guard, so it uses nothing but the Node standard library.

---

## The five rules, exactly

Every rule is off-by-default-safe: if `blast-radius` cannot decide, it allows the call.

| Rule | Fires when | Default |
|---|---|---|
| `filesPerTurn` | distinct files written in **one user turn** exceeds the limit | 15 |
| `filesPerSession` | distinct files written since the session began exceeds the limit | 60 |
| `protected` | the path matches a protected glob — regardless of how small the change is | see below |
| `unreadOverwrite` | `Write` targets an **existing** file that was never read this session | on |
| `bashDestructive` | the shell command matches a known-destructive pattern | on |

Default protected globs: `**/.env*`, `.github/workflows/**`, `**/migrations/**`,
`wrangler.*`, `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`.

Default destructive commands: `rm -rf`, `git reset --hard`, `git clean -f`,
`git checkout -- .`, `git push --force` (but **not** `--force-with-lease`), SQL `DROP` /
`TRUNCATE`, `dd of=`, `mkfs`, and the classic fork bomb.

Paths matching `ignore` are neither counted nor blocked. Build output is not blast radius.
Default: `node_modules/`, `dist/`, `build/`, `.git/`, `.next/`, `coverage/`.

---

## Config

`.blastradius.json` at the repo root. **JSON, not YAML** — that is what keeps the dependency
count at zero.

```json
{
  "limits": {
    "filesPerTurn": 15,
    "filesPerSession": 60,
    "deletionsPerTurn": 3
  },
  "protected": [
    "**/.env*",
    ".github/workflows/**",
    "**/migrations/**",
    "wrangler.*"
  ],
  "rules": {
    "unreadOverwrite": true,
    "bashDestructive": true
  },
  "ignore": ["node_modules/**", "dist/**", ".git/**"]
}
```

Globs support `*`, `**`, `?` and `{a,b}`. A pattern containing **no** `/` also matches the
basename at any depth, the way `.gitignore` behaves — so `package-lock.json` catches
`apps/api/package-lock.json`. A pattern **with** a `/` is anchored to the repo root.

A malformed `.blastradius.json` **denies** rather than silently disabling the guard. A guard
that quietly switches itself off is worse than one that is loudly broken.

---

## When it fires

Claude Code's hook API offers `allow` and `deny` and nothing in between — there is no "ask the
user". So `blast-radius` denies, and hands the agent a report it is told to relay to you
verbatim.

You then decide:

```bash
blastradius allow              # lift the guard for 10 minutes
blastradius allow --minutes 2  # or less
blastradius rearm              # put it back before that expires
```

An override is deliberately **time-boxed and session-wide**, not a per-file bypass. The point
is that a human looked once, not that each individual file got waved through.

While an override is active, calls that would have been stopped are allowed and annotated in
the transcript, so the lift is visible rather than silent.

---

## Commands

```
blastradius init [--command <cmd>]   write config and register the hook
blastradius hook                     hook entry point; reads the tool call on stdin
blastradius check <paths...>         evaluate paths with no session — for git hooks and CI
blastradius status                   counters for the current session
blastradius allow [--minutes 10]     lift the guard, after a human has looked
blastradius rearm                    cancel an active override
blastradius reset                    clear session counters
```

`check` exits `1` and prints the report if the paths would be blocked, so it drops into a
pre-commit hook:

```bash
#!/bin/sh
git diff --cached --name-only | xargs blastradius check
```

---

## What it does NOT do

Being explicit, because a security-shaped tool that overstates itself is worse than useless:

- **It is not a sandbox.** It sees tool calls Claude Code routes through hooks. An agent that
  shells out to `python -c "open('.env','w')"` writes to `.env`, and `blast-radius` sees a
  `Bash` call it has no opinion about.
- **It does not inspect diff content.** It counts files and matches paths. A one-line change
  and a full rewrite count the same.
- **It cannot undo anything.** It runs *before* a tool call. Anything already written is
  already written — that is what `git` is for.
- **It does not detect prompt injection, secret exfiltration, or malicious intent.** It has no
  model in it. It is counting and glob-matching, and nothing more.
- **It slightly over-counts.** Counting happens when a call is allowed, not when it succeeds.
  A tool call that is allowed and then fails still counts against the turn.
- **`deletionsPerTurn` is in the config but not yet enforced.** No tool in the current surface
  reports a deletion distinctly from a `Bash` command. Listed here rather than quietly pretending.

If you want content inspection or true isolation, you want a sandbox. This is a seatbelt, not
a roll cage.

---

## How state works

Counters live in `$TMPDIR/blast-radius/<session_id>.json`, outside your repo, so the guard
never dirties a working tree. Override with `BLASTRADIUS_STATE_DIR`.

"Turn" means one user prompt, keyed on the `prompt_id` Claude Code supplies. Start a new
message and the per-turn counter resets; the per-session counter does not.

Corrupt state files are discarded and rebuilt rather than wedging the session.

---

## Development

```bash
git clone https://github.com/amahmood561/blast-radius
cd blast-radius
npm test          # 32 tests, no dependencies, no network
```

The rule engine (`src/rules.js`) is a pure function of `(event, config, state)`, so every rule
is tested without spawning a process. `test/hook.test.js` spawns the real binary with real
hook JSON on stdin against a temp sandbox.

---

## Why

Most agent failures are not the model being stupid. They are the harness having no opinion
about scope. The model asked to "clean up imports" is doing what it was told when it rewrites
forty files — nothing in the system ever said how wide "clean up" was allowed to be.

MIT.
