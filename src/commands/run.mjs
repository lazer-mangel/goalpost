import { spawnSync } from "node:child_process";
import { openStore, fail } from "../store.mjs";
import { parseArgs } from "../args.mjs";
import { nextWorkable, findTask } from "../model.mjs";
import { performClaim } from "../transitions.mjs";
import { buildPrompt } from "../prompt.mjs";

/**
 * The closed loop: claim → spawn the configured agent with the mission
 * prompt → verify the task actually closed through the gate → advance.
 * The CLI never talks to a model; the agent command is the user's choice.
 */
export function run(argv) {
  const { flags } = parseArgs(argv, ["once", "dry-run"]);
  const store = openStore();

  const agentCommand = process.env.GOALPOST_AGENT_COMMAND ?? store.config.agent.command;
  if (!agentCommand) {
    fail(
      "no agent command configured — set agent.command in .goalpost/config.json (e.g. \"claude -p {prompt}\") or GOALPOST_AGENT_COMMAND",
    );
  }

  const max = flags.once ? 1 : Number.parseInt(flags.max ?? "1", 10);
  if (!Number.isInteger(max) || max < 1) fail(`invalid --max: ${flags.max}`);

  for (let i = 0; i < max; i++) {
    const candidate = nextWorkable(store.state);
    if (!candidate) {
      console.log("no workable task — loop complete");
      return 0;
    }

    if (flags["dry-run"]) {
      console.log(`[dry-run] would claim ${candidate.id} — ${candidate.name}`);
      console.log(`[dry-run] would run: ${agentCommand.replace("{prompt}", "<mission prompt>")}`);
      return 0;
    }

    const task = performClaim(store, undefined);
    const prompt = buildPrompt(store, task);
    console.log(`[goalpost run] ${i + 1}/${max}: ${task.id} — ${task.name}`);

    // Token-level substitution so the prompt survives quotes and newlines.
    const tokens = agentCommand.split(/\s+/).map((t) => (t.includes("{prompt}") ? t.replace("{prompt}", prompt) : t));
    const res = spawnSync(tokens[0], tokens.slice(1), { cwd: store.root, stdio: ["ignore", "inherit", "inherit"] });
    if (res.error) fail(`agent command failed to start: ${res.error.message}`);
    if (res.status !== 0) fail(`agent exited with status ${res.status} on task ${task.id} — stopping the loop`);

    // The agent mutated state through the CLI; reload and audit the outcome.
    store.reload();
    const after = findTask(store.state, task.id);
    const closed = store.readJournal().some((e) => e.event === "done" && e.task === task.id);

    if (after?.status === "blocked") {
      fail(`task ${task.id} was blocked by the agent — waiting on: ${after.waiting_on ?? "unknown"}`);
    }
    if (after?.status !== "done" || !closed) {
      fail(
        `task ${task.id} was left ${after?.status ?? "missing"} — the agent did not close it through \`goalpost done\`; stopping the loop`,
      );
    }
    console.log(`[goalpost run] closed ${task.id}`);
  }
  const remaining = nextWorkable(store.state);
  console.log(remaining ? `reached --max with work remaining (next: ${remaining.id})` : "no workable task — loop complete");
  return 0;
}
