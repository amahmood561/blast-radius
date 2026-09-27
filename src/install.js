import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { DEFAULTS, CONFIG_FILE } from "./config.js";

export const MATCHER = "Read|Write|Edit|MultiEdit|NotebookEdit|Bash";

export const hookEntry = (command) => ({
  matcher: MATCHER,
  hooks: [{ type: "command", command, timeout: 10, statusMessage: "Checking blast radius..." }],
});

const isOurs = (entry) =>
  entry?.hooks?.some((h) => typeof h.command === "string" && h.command.includes("blastradius"));

/** Merge our PreToolUse entry into a settings object without clobbering others. */
export function mergeSettings(settings, command) {
  const next = { ...settings };
  next.hooks = { ...(next.hooks || {}) };
  const list = Array.isArray(next.hooks.PreToolUse) ? [...next.hooks.PreToolUse] : [];
  const at = list.findIndex(isOurs);
  if (at >= 0) list[at] = hookEntry(command);
  else list.push(hookEntry(command));
  next.hooks.PreToolUse = list;
  return next;
}

export function init(cwd, { command = "blastradius hook", settingsPath } = {}) {
  const written = [];

  const cfgPath = join(cwd, CONFIG_FILE);
  if (!existsSync(cfgPath)) {
    const { limits, protected: prot, rules, ignore } = DEFAULTS;
    writeFileSync(cfgPath, JSON.stringify({ limits, protected: prot, rules, ignore }, null, 2) + "\n");
    written.push(cfgPath);
  }

  const sPath = settingsPath || join(cwd, ".claude", "settings.json");
  let settings = {};
  if (existsSync(sPath)) {
    try {
      settings = JSON.parse(readFileSync(sPath, "utf8"));
    } catch (err) {
      throw new Error(`${sPath} is not valid JSON, refusing to overwrite it: ${err.message}`);
    }
  }
  mkdirSync(dirname(sPath), { recursive: true });
  writeFileSync(sPath, JSON.stringify(mergeSettings(settings, command), null, 2) + "\n");
  written.push(sPath);

  return written;
}
