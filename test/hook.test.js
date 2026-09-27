import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { mergeSettings, init } from "../src/install.js";

const BIN = fileURLToPath(new URL("../bin/blastradius.js", import.meta.url));
let sandbox, stateDir;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), "br-sandbox-"));
  stateDir = mkdtempSync(join(tmpdir(), "br-state-"));
});

const run = (args, payload, cwd = sandbox) =>
  execFileSync("node", [BIN, ...args], {
    input: payload === undefined ? "" : JSON.stringify(payload),
    encoding: "utf8",
    cwd,
    env: { ...process.env, BLASTRADIUS_STATE_DIR: stateDir },
  });

const call = (tool_name, tool_input, extra = {}) =>
  run(["hook"], { session_id: "s1", prompt_id: "p1", cwd: sandbox, tool_name, tool_input, ...extra });

test("an ordinary edit produces no output at all", () => {
  assert.equal(call("Edit", { file_path: join(sandbox, "src/a.ts") }).trim(), "");
});

test("a protected path is denied with a readable damage report", () => {
  const out = JSON.parse(call("Write", { file_path: join(sandbox, ".env") }));
  assert.equal(out.hookSpecificOutput.permissionDecision, "deny");
  const reason = out.hookSpecificOutput.permissionDecisionReason;
  assert.match(reason, /BLAST RADIUS/);
  assert.match(reason, /Protected path/);
  assert.match(reason, /blastradius allow/);
});

test("absolute paths from the tool call are reported relative to cwd", () => {
  const out = JSON.parse(call("Write", { file_path: join(sandbox, ".env") }));
  const reason = out.hookSpecificOutput.permissionDecisionReason;
  assert.match(reason, /^\s+\.env$/m, "the offending file is listed relative to cwd");
  assert.ok(
    !reason.includes(join(sandbox, ".env")),
    "the file itself must not be listed as an absolute path",
  );
});

test("counters persist across separate hook invocations", () => {
  for (let i = 0; i < 3; i++) call("Edit", { file_path: join(sandbox, `src/f${i}.ts`) });
  const status = run(["status", "--session", "s1"], undefined);
  assert.match(status, /written\s+3 files/);
});

test("the turn limit trips across invocations, like a real session", () => {
  writeFileSync(join(sandbox, ".blastradius.json"), JSON.stringify({ limits: { filesPerTurn: 3 } }));
  for (let i = 0; i < 3; i++) {
    assert.equal(call("Edit", { file_path: join(sandbox, `src/f${i}.ts`) }).trim(), "");
  }
  const out = JSON.parse(call("Edit", { file_path: join(sandbox, "src/f3.ts") }));
  assert.equal(out.hookSpecificOutput.permissionDecision, "deny");
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /4 files this turn, limit is 3/);
});

test("allow lifts the guard, rearm puts it back", () => {
  const denied = JSON.parse(call("Write", { file_path: join(sandbox, ".env") }));
  assert.equal(denied.hookSpecificOutput.permissionDecision, "deny");

  run(["allow", "--session", "s1"], undefined);
  const lifted = call("Write", { file_path: join(sandbox, ".env") });
  assert.match(lifted, /override active/);
  assert.ok(!lifted.includes('"deny"'));

  run(["rearm", "--session", "s1"], undefined);
  const rearmed = JSON.parse(call("Write", { file_path: join(sandbox, ".env") }));
  assert.equal(rearmed.hookSpecificOutput.permissionDecision, "deny");
});

test("a malformed config denies rather than silently disabling the guard", () => {
  writeFileSync(join(sandbox, ".blastradius.json"), "{ not json");
  const out = JSON.parse(call("Edit", { file_path: join(sandbox, "src/a.ts") }));
  assert.equal(out.hookSpecificOutput.permissionDecision, "deny");
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /not valid JSON/);
});

test("unparseable stdin exits cleanly without blocking", () => {
  const out = execFileSync("node", [BIN, "hook"], {
    input: "not json at all",
    encoding: "utf8",
    cwd: sandbox,
    env: { ...process.env, BLASTRADIUS_STATE_DIR: stateDir },
  });
  assert.equal(out.trim(), "");
});

test("an unrelated tool is ignored", () => {
  assert.equal(call("WebFetch", { url: "https://example.com" }).trim(), "");
});

test("check exits non-zero on a protected path and zero otherwise", () => {
  run(["check", "src/a.ts"], undefined);
  assert.throws(() => run(["check", ".env"], undefined), /Command failed|status 1/);
});

test("init writes both files and registers the hook", () => {
  const written = init(sandbox);
  assert.equal(written.length, 2);
  const settings = JSON.parse(readFileSync(join(sandbox, ".claude", "settings.json"), "utf8"));
  assert.match(settings.hooks.PreToolUse[0].hooks[0].command, /blastradius hook/);
  assert.ok(existsSync(join(sandbox, ".blastradius.json")));
});

test("init preserves hooks that are already there and is idempotent", () => {
  const existing = {
    hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "other-tool" }] }] },
    permissions: { allow: ["Bash(ls:*)"] },
  };
  const once = mergeSettings(existing, "blastradius hook");
  const twice = mergeSettings(once, "blastradius hook");
  assert.equal(twice.hooks.PreToolUse.length, 2, "must not stack duplicate entries");
  assert.equal(twice.hooks.PreToolUse[0].hooks[0].command, "other-tool");
  assert.deepEqual(twice.permissions, existing.permissions);
});
