import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// Config is JSON, not YAML. That keeps the package at zero dependencies, which
// matters more for a guard than a slightly nicer file format.
export const CONFIG_FILE = ".blastradius.json";

export const DEFAULTS = {
  limits: {
    filesPerTurn: 15,     // distinct files written in one user turn
    filesPerSession: 60,  // distinct files written since the session started
    deletionsPerTurn: 3,
  },
  // Always confirm before touching these, no matter how small the change.
  protected: [
    "**/.env*",
    ".github/workflows/**",
    "**/migrations/**",
    "wrangler.*",
    "package-lock.json",
    "yarn.lock",
    "pnpm-lock.yaml",
  ],
  rules: {
    unreadOverwrite: true,  // block Write to an existing file never read this session
    bashDestructive: true,  // block rm -rf, git reset --hard, and friends
  },
  // Never counted and never blocked. Build output is not blast radius.
  ignore: ["node_modules/**", "dist/**", "build/**", ".git/**", ".next/**", "coverage/**"],
};

export function loadConfig(cwd = process.cwd()) {
  const path = join(cwd, CONFIG_FILE);
  if (!existsSync(path)) return { ...DEFAULTS, _source: "defaults" };
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    // A malformed config must not silently disable the guard.
    throw new Error(`${CONFIG_FILE} is not valid JSON: ${err.message}`);
  }
  return {
    limits: { ...DEFAULTS.limits, ...(parsed.limits || {}) },
    protected: parsed.protected ?? DEFAULTS.protected,
    rules: { ...DEFAULTS.rules, ...(parsed.rules || {}) },
    ignore: parsed.ignore ?? DEFAULTS.ignore,
    _source: path,
  };
}
