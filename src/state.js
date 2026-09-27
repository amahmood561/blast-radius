import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, statSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Counters live outside the repo so the guard never dirties a working tree.
// Override BLASTRADIUS_STATE_DIR in tests.
export const stateDir = () =>
  process.env.BLASTRADIUS_STATE_DIR || join(tmpdir(), "blast-radius");

const safe = (id) => String(id || "nosession").replace(/[^A-Za-z0-9_-]/g, "_");
export const statePath = (sessionId) => join(stateDir(), safe(sessionId) + ".json");

export const blank = (sessionId) => ({
  sessionId: sessionId ?? null,
  startedAt: new Date().toISOString(),
  reads: [],
  writes: [],
  turns: {},
  override: null,
});

export function load(sessionId) {
  const path = statePath(sessionId);
  if (!existsSync(path)) return blank(sessionId);
  try {
    return { ...blank(sessionId), ...JSON.parse(readFileSync(path, "utf8")) };
  } catch {
    // Corrupt state must not wedge the session. Start clean and keep guarding.
    return blank(sessionId);
  }
}

export function save(sessionId, state) {
  mkdirSync(stateDir(), { recursive: true });
  writeFileSync(statePath(sessionId), JSON.stringify(state, null, 2));
  return state;
}

export function turn(state, promptId) {
  const key = promptId || "noturn";
  state.turns[key] ??= { writes: [], deletes: [] };
  return state.turns[key];
}

export const overrideActive = (state, now = Date.now()) =>
  Boolean(state.override && new Date(state.override.expiresAt).getTime() > now);

export function setOverride(state, minutes = 10) {
  state.override = {
    grantedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + minutes * 60_000).toISOString(),
  };
  return state;
}

export const clearOverride = (state) => ((state.override = null), state);

// The most recently touched session, so `blastradius allow` works from a plain
// terminal where there is no session id to pass.
export function latestSession() {
  const dir = stateDir();
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  return files.length ? files[0].f.replace(/\.json$/, "") : null;
}

export function reset(sessionId) {
  const path = statePath(sessionId);
  if (existsSync(path)) rmSync(path);
}
