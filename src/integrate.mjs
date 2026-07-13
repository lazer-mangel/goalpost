import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

const BRIEF_CMD = "npx -y goalpost status --brief 2>/dev/null || true";
const GUARD_CMD = "npx -y goalpost guard";
// The Stop nudge re-surfaces open state when a session ends; it must never block.
const STOP_CMD = "npx -y goalpost status 2>/dev/null || true";

function addHook(hooks, event, matcher, command) {
  const entries = (hooks[event] ??= []);
  if (JSON.stringify(entries).includes(command)) return; // already wired
  const entry = { hooks: [{ type: "command", command }] };
  if (matcher) entry.matcher = matcher;
  entries.push(entry);
}

/** Merge goalpost hooks into .claude/settings.json without clobbering anything. */
export function wireClaudeSettings(root) {
  const path = join(root, ".claude", "settings.json");
  const settings = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
  settings.hooks ??= {};
  addHook(settings.hooks, "SessionStart", null, BRIEF_CMD);
  addHook(settings.hooks, "PreToolUse", "Edit|Write|MultiEdit|NotebookEdit", GUARD_CMD);
  addHook(settings.hooks, "Stop", null, STOP_CMD);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(settings, null, 2) + "\n");
  return path;
}

const BLOCK_START = "<!-- goalpost:start -->";
const BLOCK_END = "<!-- goalpost:end -->";

const AGENTS_BLOCK = `${BLOCK_START}
## Goalpost roadmap loop

This repository's live goal is tracked by goalpost.

- Start every session with \`npx -y goalpost status --brief\` to load the current goal.
- Pick up work with \`goalpost claim\` — it points and starts the next workable task.
- Close ONLY via \`goalpost done <id> --result "<evidence>"\` — it runs the task's own
  verification commands and refuses on red. Never claim completion in prose.
- Stuck? \`goalpost block <id> --on "<what you need>"\` and stop.
- Never hand-edit .goalpost/goalpost.json or the generated roadmap markdown; state
  moves only through the CLI (start/done/block/point).
${BLOCK_END}`;

/** Insert or replace the managed block in AGENTS.md, preserving everything else. */
export function wireAgentsMd(root) {
  const path = join(root, "AGENTS.md");
  let content = existsSync(path) ? readFileSync(path, "utf8") : "";
  const start = content.indexOf(BLOCK_START);
  const end = content.indexOf(BLOCK_END);
  if (start !== -1 && end !== -1) {
    content = content.slice(0, start) + AGENTS_BLOCK + content.slice(end + BLOCK_END.length);
  } else {
    content = content.trimEnd() + (content.trim() ? "\n\n" : "") + AGENTS_BLOCK + "\n";
  }
  writeFileSync(path, content);
  return path;
}

/** Convert a glob pattern (supports **, *, ?) to a RegExp over posix paths. */
export function globToRegExp(pattern) {
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        re += ".*";
        i++;
        if (pattern[i + 1] === "/") i++; // "src/**/x" — ** swallows the slash
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${re}$`);
}

export function matchesScope(relPath, patterns) {
  return patterns.some((p) => globToRegExp(p).test(relPath));
}
