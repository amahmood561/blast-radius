import { test } from "node:test";
import assert from "node:assert/strict";
import { matches, matchesAny } from "../src/glob.js";

test("* does not cross a directory boundary", () => {
  assert.equal(matches("src/a.js", "src/*.js"), true);
  assert.equal(matches("src/deep/a.js", "src/*.js"), false);
});

test("** crosses directories and may match nothing", () => {
  assert.equal(matches(".env", "**/.env*"), true);
  assert.equal(matches("apps/web/.env.local", "**/.env*"), true);
  assert.equal(matches("db/migrations/001.sql", "**/migrations/**"), true);
  assert.equal(matches("src/index.ts", "**/migrations/**"), false);
});

test("a pattern with no slash also matches the basename at any depth", () => {
  assert.equal(matches("package-lock.json", "package-lock.json"), true);
  assert.equal(matches("apps/api/package-lock.json", "package-lock.json"), true);
});

test("a pattern with a slash is anchored and does not match by basename", () => {
  assert.equal(matches("nested/.github/workflows/ci.yml", ".github/workflows/**"), false);
  assert.equal(matches(".github/workflows/ci.yml", ".github/workflows/**"), true);
});

test("braces and dots are handled literally", () => {
  assert.equal(matches("wrangler.toml", "wrangler.*"), true);
  assert.equal(matches("wranglerXtoml", "wrangler.*"), false);
  assert.equal(matches("a.spec.ts", "*.{spec,test}.ts"), true);
  assert.equal(matches("a.other.ts", "*.{spec,test}.ts"), false);
});

test("absolute-style separators normalise", () => {
  assert.equal(matches("./src/a.js", "src/*.js"), true);
  assert.equal(matchesAny("node_modules/x/y.js", ["node_modules/**"]), true);
});
