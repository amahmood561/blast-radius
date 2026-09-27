import { existsSync } from "node:fs";
import { relative, isAbsolute } from "node:path";
import { matchesAny, firstMatch } from "./glob.js";
import { turn, overrideActive } from "./state.js";

// Bash commands that can destroy work outright. Deliberately short: every entry
// has to be something a person would want stopped even when they asked for it.
export const DESTRUCTIVE = [
  { re: /\brm\s+(-[a-zA-Z]*\s+)*-[a-zA-Z]*[rR][a-zA-Z]*f|\brm\s+(-[a-zA-Z]*\s+)*-[a-zA-Z]*f[a-zA-Z]*[rR]/, what: "recursive force delete (rm -rf)" },
  { re: /\bgit\s+reset\s+--hard\b/, what: "git reset --hard discards uncommitted work" },
  { re: /\bgit\s+clean\s+-[a-zA-Z]*f/, what: "git clean -f deletes untracked files" },
  { re: /\bgit\s+checkout\s+--\s+\./, what: "git checkout -- . discards all local changes" },
  { re: /\bgit\s+push\s+(-[a-zA-Z]*\s+)*--force\b(?!-with-lease)/, what: "git push --force overwrites remote history" },
  { re: /\bDROP\s+(TABLE|DATABASE|SCHEMA)\b/i, what: "SQL DROP" },
  { re: /\btruncate\s+table\b/i, what: "SQL TRUNCATE" },
  { re: /\bdd\s+[^|]*\bof=/, what: "dd writing to a device" },
  { re: /\bmkfs(\.\w+)?\b/, what: "filesystem format" },
  { re: /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/, what: "fork bomb" },
];

// Map a Claude Code tool call onto something the rules can reason about.
export function normalize({ tool_name, tool_input = {} }, cwd = process.cwd()) {
  const rel = (p) => {
    if (!p) return null;
    const r = isAbsolute(p) ? relative(cwd, p) : p;
    return r.replace(/\\/g, "/").replace(/^\.\//, "");
  };
  switch (tool_name) {
    case "Read":
      return { kind: "read", paths: [rel(tool_input.file_path)].filter(Boolean) };
    case "Write":
      return { kind: "write", write: true, paths: [rel(tool_input.file_path)].filter(Boolean) };
    case "Edit":
    case "MultiEdit":
      return { kind: "edit", paths: [rel(tool_input.file_path)].filter(Boolean) };
    case "NotebookEdit":
      return { kind: "edit", paths: [rel(tool_input.notebook_path)].filter(Boolean) };
    case "Bash":
      return { kind: "bash", command: tool_input.command || "", paths: [] };
    default:
      return { kind: "other", paths: [] };
  }
}

const uniq = (a) => [...new Set(a)];

/**
 * Pure decision function. Returns { decision, violations, counts } where
 * decision is "allow" (stay silent) or "deny". Never throws on bad input —
 * a guard that crashes is a guard that is about to be uninstalled.
 */
export function evaluate(event, config, state, promptId, opts = {}) {
  const { fileExists = existsSync } = opts;
  const t = turn(state, promptId);
  const violations = [];

  const paths = (event.paths || []).filter((p) => !matchesAny(p, config.ignore));
  const mutating = event.kind === "write" || event.kind === "edit";

  if (event.kind === "bash") {
    for (const d of DESTRUCTIVE) {
      if (config.rules.bashDestructive && d.re.test(event.command)) {
        violations.push({ rule: "bashDestructive", detail: d.what, subject: event.command.trim().slice(0, 200) });
        break;
      }
    }
  }

  if (mutating) {
    for (const p of paths) {
      const hit = firstMatch(p, config.protected);
      if (hit) violations.push({ rule: "protected", detail: `matches protected pattern ${hit}`, subject: p });

      if (config.rules.unreadOverwrite && event.write && fileExists(p) && !state.reads.includes(p)) {
        violations.push({
          rule: "unreadOverwrite",
          detail: "overwrites an existing file that was never read this session",
          subject: p,
        });
      }
    }

    const turnAfter = uniq([...t.writes, ...paths]);
    if (turnAfter.length > config.limits.filesPerTurn) {
      violations.push({
        rule: "filesPerTurn",
        detail: `${turnAfter.length} files this turn, limit is ${config.limits.filesPerTurn}`,
        subject: turnAfter,
      });
    }

    const sessionAfter = uniq([...state.writes, ...paths]);
    if (sessionAfter.length > config.limits.filesPerSession) {
      violations.push({
        rule: "filesPerSession",
        detail: `${sessionAfter.length} files this session, limit is ${config.limits.filesPerSession}`,
        subject: sessionAfter,
      });
    }
  }

  const lifted = overrideActive(state);
  const decision = violations.length && !lifted ? "deny" : "allow";

  return {
    decision,
    lifted: Boolean(lifted && violations.length),
    violations,
    counts: {
      turnFiles: uniq([...t.writes, ...(mutating ? paths : [])]).length,
      sessionFiles: uniq([...state.writes, ...(mutating ? paths : [])]).length,
      limitTurn: config.limits.filesPerTurn,
      limitSession: config.limits.filesPerSession,
    },
  };
}

// Recording happens only when the call is going through, so a blocked write is
// not counted against the budget it just failed to fit into.
export function record(event, state, promptId) {
  const t = turn(state, promptId);
  const paths = event.paths || [];
  if (event.kind === "read") {
    state.reads = uniq([...state.reads, ...paths]);
  } else if (event.kind === "write" || event.kind === "edit") {
    state.writes = uniq([...state.writes, ...paths]);
    t.writes = uniq([...t.writes, ...paths]);
  }
  return state;
}
