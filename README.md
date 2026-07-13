# goalpost

A goal-contract roadmap loop for agentic development. Zero dependencies, one JSON file, and a rule that changes everything: **a task cannot be closed unless its own verification commands pass.**

```
plan → add task → spec → claim → agent works → done (verification gate) → advance → repeat
```

Goalpost is not a task tracker. It's a gate. You (or an agent) define each task as a small contract — success criteria, shell commands that prove them, optionally a file scope — and the CLI enforces the loop: one live pointer, evidence-bearing closure, no hand-edited state. Point any coding agent at it and say "pick up what's next and do it."

## Why

Agent sessions are great executors and terrible bookkeepers. They claim things are done that aren't, wander out of scope, and lose the thread between sessions. Goalpost moves the bookkeeping into a CLI that can't be sweet-talked:

- **`done` runs the task's own verification commands and refuses on red.** "Looks done" doesn't close a task; passing commands do.
- **One pointer.** `current` names the single live goal. Every session — human or agent — starts aimed at the same thing.
- **The CLI is the only writer.** State mutates through `start` / `done` / `block` / `point`, never by hand. A generated `ROADMAP.md` stays in sync automatically, with a CI diff gate to prove it.
- **No model calls, ever.** Goalpost never talks to an LLM. Your agent session is the executor; goalpost is the harness around it. That keeps it agnostic across Claude Code, Codex, Cursor, or a human with a terminal.

## Quickstart

```bash
npx goalpost init            # scaffold .goalpost/ + ROADMAP.md
npx goalpost claim           # point + start the next workable task
# ...do the work...
npx goalpost done <id> --result "what you verified"   # runs the gate
```

Add real work:

```bash
goalpost add auth-v1 \
  --name "Session auth end to end" \
  --criteria "login works with expired-token refresh" \
  --verify "npm test -- auth" \
  --verify "npm run typecheck" \
  --depends db-schema \
  --write-scope "src/auth/**" --write-scope "test/auth/**"

goalpost spec auth-v1        # scaffold a spec, pre-filled from the contract
```

No criteria or no verification command? `add` refuses. A task without a goal contract isn't a task.

## The loop, in commands

| Command | What it does |
|---|---|
| `claim [<id>]` | The "go" verb: resolves the next workable task, points at it, starts it, prints the contract. Refuses if the pointer task is still in progress — no silent task-stacking. |
| `done <id> --result ".."` | Checks dependencies, runs the task's verification commands from the repo root, **refuses on the first red**, requires evidence. `--advance` (or `autoAdvance` in config) then points at the next workable task. |
| `block <id> --on ".."` | Park a task with an explicit reason. |
| `point <id>` / `point --next` | Move the live pointer. The only other way it moves. |
| `next` / `status [--brief]` / `show <id>` | Read-only: what's next, where things stand, one task in full. |
| `add` / `spec <id>` | Create goal contracts; scaffold a spec markdown pre-filled from the contract. |
| `check [--strict]` | One CI verb: schema, dangling specs, pointer sanity, markdown freshness. Liveness warnings (stale tasks, ready-but-idle work) are soft unless `--strict`. |
| `generate [--check]` | (Re)render `ROADMAP.md`. Every mutation already does this; `--check` is the CI diff gate that catches hand-edits. |
| `compact` | Roll old done-task bodies into an archive, leaving stubs. `show` still resolves them transparently. |

Every mutation appends to `.goalpost/journal.jsonl` — an append-only event log of the roadmap's real history.

## Wiring up an agent

The autonomy ladder — adopt one rung at a time:

**1. Goal injection (start here).** Every session opens knowing the live goal.

```bash
goalpost init --claude      # Claude Code: SessionStart brief + PreToolUse write guard + Stop nudge
goalpost init --agents-md   # Codex / Cursor / anything that reads AGENTS.md
```

`status --brief` is a ~10-line plain-text payload with stable `[goalpost]` prefixes, safe to inject into any harness.

**2. Scoped sessions.** Give tasks a `write_scope`. The `guard` command runs as a Claude Code PreToolUse hook and blocks edits outside the current task's scope (exit 2), and always blocks hand-edits of goalpost state and the generated markdown — for any agent, on any task.

**3. One-shot missions.** `goalpost prompt` emits a self-contained mission brief — contract, verification commands, inlined spec, operating rules — for any agent CLI:

```bash
claude -p "$(goalpost prompt)"
```

**4. The closed loop.** When you trust the rails:

```bash
# .goalpost/config.json
{ "agent": { "command": "claude -p {prompt}" } }

goalpost run --once        # claim → agent → verify closure → stop
goalpost run --max 5       # keep going while tasks close cleanly
```

`run` spawns your configured agent command with the mission prompt, then audits the outcome: the task must have gone `done` *through the CLI's verification gate* (state + journal both say so). An agent that wanders off, exits non-zero, or blocks the task stops the loop with the reason. `--dry-run` shows what would happen.

## The data

Everything lives in `.goalpost/`, committed to your repo:

```
.goalpost/
  config.json      # settings — yours to edit
  goalpost.json    # state — the CLI's, not yours
  journal.jsonl    # append-only event history
  archive.json     # compacted done-task bodies
  specs/           # one markdown spec per task that needs one
  templates/spec.md
ROADMAP.md         # generated, human-readable, never hand-edited
```

A task is a goal contract:

```jsonc
{
  "id": "auth-v1",
  "name": "Session auth end to end",
  "milestone": "mvp",                          // optional grouping label
  "status": "todo",                            // todo | in_progress | done | blocked
  "depends_on": ["db-schema"],
  "spec": "specs/auth-v1.md",                  // optional; requireSpec makes it a start gate
  "success_criteria": ["login works with expired-token refresh"],
  "verification": ["npm test -- auth"],        // the loop exit — done runs these
  "write_scope": ["src/auth/**"],              // optional; enforced by the guard hook
  "result": null                               // evidence, set only by done
}
```

Config knobs (`.goalpost/config.json`, all optional): `markdown` (snapshot path), `staleDays` (liveness threshold), `requireSpec` (grounding gate: no spec, no start), `autoAdvance` (done moves the pointer), `compact.keepRecent` / `compact.pin`, `agent.command`.

## CI

```yaml
- run: npx goalpost check   # schema + pointer sanity + markdown diff gate
```

## Requirements

Node 18+. No dependencies — runtime or dev. macOS/Linux; Windows is best-effort.

## License

MIT
