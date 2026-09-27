import { loadConfig } from "./config.js";
import { load, save } from "./state.js";
import { normalize, evaluate, record } from "./rules.js";
import { damageReport } from "./report.js";

export function readStdin() {
  return new Promise((resolve) => {
    let buf = "";
    if (process.stdin.isTTY) return resolve("");
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (d) => (buf += d));
    process.stdin.on("end", () => resolve(buf));
  });
}

const allow = () => ({
  hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow" },
});

/**
 * The whole hook as a pure-ish function so it can be tested without a process.
 * Returns the JSON object to print, or null to stay completely silent.
 */
export function handle(payload, { cwd = payload.cwd || process.cwd() } = {}) {
  let config;
  try {
    config = loadConfig(cwd);
  } catch (err) {
    // Malformed config: say so loudly rather than waving the call through.
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: `blast-radius: ${err.message}`,
      },
    };
  }

  const event = normalize(payload, cwd);
  if (event.kind === "other") return null;

  const state = load(payload.session_id);
  const result = evaluate(event, config, state, payload.prompt_id, { });

  if (result.decision === "deny") {
    // Not recorded: a blocked write did not happen, so it does not count.
    save(payload.session_id, state);
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: damageReport(result, { cwd }),
      },
      systemMessage: `blast-radius stopped a ${payload.tool_name} call (${result.violations.map((v) => v.rule).join(", ")})`,
    };
  }

  record(event, state, payload.prompt_id);
  save(payload.session_id, state);

  // Staying silent is the point. Returning "allow" on every call would override
  // the user's own permission settings, which is not this tool's business.
  if (result.lifted) {
    return {
      systemMessage: `blast-radius: override active — allowed a call that would normally stop (${result.violations.map((v) => v.rule).join(", ")})`,
    };
  }
  return null;
}
