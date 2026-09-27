// The damage report is the product. Most of the time you will read it and say
// "yes, that's right" — the value is that you read it at all.

const RULE_TITLES = {
  protected: "Protected path",
  unreadOverwrite: "Overwriting an unread file",
  filesPerTurn: "Turn is wider than expected",
  filesPerSession: "Session is wider than expected",
  bashDestructive: "Destructive command",
};

const list = (paths, max = 12) => {
  const shown = paths.slice(0, max).map((p) => "    " + p);
  if (paths.length > max) shown.push(`    … and ${paths.length - max} more`);
  return shown.join("\n");
};

export function damageReport({ violations, counts }, { cwd } = {}) {
  const lines = ["BLAST RADIUS — tool call stopped", ""];

  for (const v of violations) {
    lines.push(`  ${RULE_TITLES[v.rule] ?? v.rule}: ${v.detail}`);
    if (Array.isArray(v.subject)) lines.push(list(v.subject));
    else if (v.subject) lines.push("    " + v.subject);
    lines.push("");
  }

  lines.push(`  This turn: ${counts.turnFiles}/${counts.limitTurn} files · ` +
             `this session: ${counts.sessionFiles}/${counts.limitSession} files`);
  if (cwd) lines.push(`  Working directory: ${cwd}`);
  lines.push("");
  lines.push("  Stop and tell the user exactly what is listed above. Do not retry,");
  lines.push("  and do not work around this by splitting the change into smaller calls.");
  lines.push("  If the user confirms they want it, they run:  blastradius allow");
  return lines.join("\n");
}

export function statusReport(state, config) {
  const turns = Object.entries(state.turns);
  const lines = [
    `session   ${state.sessionId ?? "(none)"}`,
    `started   ${state.startedAt}`,
    `config    ${config._source}`,
    `written   ${state.writes.length} files this session (limit ${config.limits.filesPerSession})`,
    `read      ${state.reads.length} files this session`,
    `turns     ${turns.length}`,
  ];
  if (state.override) {
    const live = new Date(state.override.expiresAt) > new Date();
    lines.push(`override  ${live ? "ACTIVE until " + state.override.expiresAt : "expired"}`);
  } else {
    lines.push("override  none — guard is armed");
  }
  const widest = turns.sort((a, b) => b[1].writes.length - a[1].writes.length)[0];
  if (widest && widest[1].writes.length) {
    lines.push("", `widest turn  ${widest[1].writes.length} files:`);
    lines.push(list(widest[1].writes));
  }
  return lines.join("\n");
}
