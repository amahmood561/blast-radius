#!/usr/bin/env node
import { existsSync } from "node:fs";
import { loadConfig } from "../src/config.js";
import { load, save, setOverride, clearOverride, latestSession, reset, blank } from "../src/state.js";
import { normalize, evaluate, record } from "../src/rules.js";
import { damageReport, statusReport } from "../src/report.js";
import { handle, readStdin } from "../src/hook.js";
import { init } from "../src/install.js";

const [, , cmd = "help", ...rest] = process.argv;
const flag = (name, fallback) => {
  const i = rest.indexOf("--" + name);
  return i >= 0 ? rest[i + 1] : fallback;
};

const HELP = `blast-radius — a backstop for coding agents

  blastradius init [--command <cmd>]   write .blastradius.json and register the hook
  blastradius hook                     hook entry point; reads the tool call on stdin
  blastradius check <paths...>         evaluate paths without a session (pre-commit, CI)
  blastradius status                   counters for the current session
  blastradius allow [--minutes 10]     lift the guard briefly, after a human has looked
  blastradius rearm                    cancel an active override
  blastradius reset                    clear session counters

Docs: https://github.com/amahmood561/blast-radius`;

async function main() {
  if (cmd === "hook") {
    let payload;
    try {
      payload = JSON.parse((await readStdin()) || "{}");
    } catch {
      process.exit(0); // Unparseable input is not the agent's fault. Stay out of the way.
    }
    const out = handle(payload);
    if (out) process.stdout.write(JSON.stringify(out));
    process.exit(0);
  }

  if (cmd === "init") {
    const written = init(process.cwd(), { command: flag("command", "blastradius hook") });
    console.log("blast-radius armed.\n");
    for (const w of written) console.log("  wrote  " + w);
    console.log("\nRestart Claude Code so it picks up the hook.");
    return;
  }

  if (cmd === "check") {
    const paths = rest.filter((a) => !a.startsWith("--"));
    if (!paths.length) return console.log("nothing to check");
    const config = loadConfig();
    const state = blank("cli");
    const event = { kind: "write", write: true, paths };
    const result = evaluate(event, config, state, "cli", { fileExists: existsSync });
    if (result.decision === "deny") {
      console.error(damageReport(result, { cwd: process.cwd() }));
      process.exit(1);
    }
    console.log(`ok — ${paths.length} file(s) within limits`);
    return;
  }

  if (cmd === "status") {
    const id = flag("session", latestSession());
    console.log(statusReport(load(id), loadConfig()));
    return;
  }

  if (cmd === "allow") {
    const id = flag("session", latestSession());
    if (!id) return console.log("no session found — nothing to lift");
    const minutes = Number(flag("minutes", 10));
    save(id, setOverride(load(id), minutes));
    console.log(`guard lifted for ${minutes} minutes on session ${id}.`);
    console.log("Re-arm early with:  blastradius rearm");
    return;
  }

  if (cmd === "rearm") {
    const id = flag("session", latestSession());
    if (!id) return console.log("no session found");
    save(id, clearOverride(load(id)));
    console.log("guard re-armed.");
    return;
  }

  if (cmd === "reset") {
    const id = flag("session", latestSession());
    if (id) reset(id);
    console.log("counters cleared.");
    return;
  }

  console.log(HELP);
}

main().catch((err) => {
  console.error("blast-radius: " + err.message);
  process.exit(1);
});
