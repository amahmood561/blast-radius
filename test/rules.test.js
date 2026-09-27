import { test } from "node:test";
import assert from "node:assert/strict";
import { normalize, evaluate, record, DESTRUCTIVE } from "../src/rules.js";
import { blank } from "../src/state.js";
import { DEFAULTS } from "../src/config.js";

const cfg = () => JSON.parse(JSON.stringify(DEFAULTS));
const never = () => false;
const always = () => true;
const write = (p) => normalize({ tool_name: "Write", tool_input: { file_path: p } });
const edit = (p) => normalize({ tool_name: "Edit", tool_input: { file_path: p } });

test("an ordinary edit is allowed and stays silent", () => {
  const r = evaluate(edit("src/a.ts"), cfg(), blank("s"), "p", { fileExists: never });
  assert.equal(r.decision, "allow");
  assert.deepEqual(r.violations, []);
});

test("a protected path is denied however small the change", () => {
  const r = evaluate(write(".env"), cfg(), blank("s"), "p", { fileExists: never });
  assert.equal(r.decision, "deny");
  assert.equal(r.violations[0].rule, "protected");
});

test("build output is ignored entirely, not merely allowed", () => {
  const r = evaluate(write("dist/bundle.js"), cfg(), blank("s"), "p", { fileExists: always });
  assert.equal(r.decision, "allow");
  assert.equal(r.counts.turnFiles, 0);
});

test("the 40-file refactor trips the per-turn limit", () => {
  const c = cfg();
  const state = blank("s");
  let denied = null;
  for (let i = 0; i < 40; i++) {
    const ev = edit(`src/mod${i}.ts`);
    const r = evaluate(ev, c, state, "p", { fileExists: never });
    if (r.decision === "deny") { denied = { i, r }; break; }
    record(ev, state, "p");
  }
  assert.ok(denied, "should have stopped before 40 files");
  assert.equal(denied.i, c.limits.filesPerTurn, "stops on the file that exceeds the limit");
  assert.equal(denied.r.violations[0].rule, "filesPerTurn");
});

test("a blocked write is not counted against the budget", () => {
  const c = cfg();
  c.limits.filesPerTurn = 1;
  const state = blank("s");
  const a = edit("src/a.ts");
  assert.equal(evaluate(a, c, state, "p", { fileExists: never }).decision, "allow");
  record(a, state, "p");
  const b = edit("src/b.ts");
  assert.equal(evaluate(b, c, state, "p", { fileExists: never }).decision, "deny");
  // b was refused, so the counter must still reflect one file
  assert.equal(state.turns.p.writes.length, 1);
});

test("limits are per turn, so a new turn starts fresh", () => {
  const c = cfg();
  c.limits.filesPerTurn = 2;
  const state = blank("s");
  for (const p of ["a", "b"]) record(edit(`src/${p}.ts`), state, "turn1");
  const r = evaluate(edit("src/c.ts"), c, state, "turn2", { fileExists: never });
  assert.equal(r.decision, "allow");
});

test("overwriting an existing unread file is denied; reading it first is not", () => {
  const c = cfg();
  const state = blank("s");
  assert.equal(evaluate(write("src/a.ts"), c, state, "p", { fileExists: always }).decision, "deny");

  record(normalize({ tool_name: "Read", tool_input: { file_path: "src/a.ts" } }), state, "p");
  assert.equal(evaluate(write("src/a.ts"), c, state, "p", { fileExists: always }).decision, "allow");
});

test("creating a new file is not an unread overwrite", () => {
  const r = evaluate(write("src/new.ts"), cfg(), blank("s"), "p", { fileExists: never });
  assert.equal(r.decision, "allow");
});

test("destructive shell commands are denied", () => {
  const bash = (command) => normalize({ tool_name: "Bash", tool_input: { command } });
  for (const command of [
    "rm -rf ./build",
    "rm -fr /tmp/x",
    "git reset --hard HEAD~3",
    "git clean -fd",
    "git push --force origin main",
    "psql -c 'DROP TABLE users'",
  ]) {
    const r = evaluate(bash(command), cfg(), blank("s"), "p", { fileExists: never });
    assert.equal(r.decision, "deny", `should deny: ${command}`);
  }
});

test("ordinary shell commands are left alone", () => {
  const bash = (command) => normalize({ tool_name: "Bash", tool_input: { command } });
  for (const command of ["npm test", "git status", "rm file.txt", "git push origin main", "ls -alrt"]) {
    const r = evaluate(bash(command), cfg(), blank("s"), "p", { fileExists: never });
    assert.equal(r.decision, "allow", `should allow: ${command}`);
  }
});

test("--force-with-lease is not treated as a force push", () => {
  const ev = normalize({ tool_name: "Bash", tool_input: { command: "git push --force-with-lease" } });
  assert.equal(evaluate(ev, cfg(), blank("s"), "p", { fileExists: never }).decision, "allow");
});

test("an active override lifts the guard and says so", () => {
  const state = blank("s");
  state.override = { expiresAt: new Date(Date.now() + 60_000).toISOString() };
  const r = evaluate(write(".env"), cfg(), state, "p", { fileExists: never });
  assert.equal(r.decision, "allow");
  assert.equal(r.lifted, true);
});

test("an expired override does not lift the guard", () => {
  const state = blank("s");
  state.override = { expiresAt: new Date(Date.now() - 1000).toISOString() };
  assert.equal(evaluate(write(".env"), cfg(), state, "p", { fileExists: never }).decision, "deny");
});

test("every destructive pattern carries an explanation", () => {
  for (const d of DESTRUCTIVE) assert.ok(d.what && d.what.length > 3);
});
