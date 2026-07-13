#!/usr/bin/env node
import { GoalpostError } from "../src/store.mjs";

const COMMANDS = {
  init: () => import("../src/commands/init.mjs"),
  status: () => import("../src/commands/status.mjs"),
  next: () => import("../src/commands/next.mjs"),
  show: () => import("../src/commands/show.mjs"),
  add: () => import("../src/commands/add.mjs"),
  start: () => import("../src/commands/start.mjs"),
  done: () => import("../src/commands/done.mjs"),
  block: () => import("../src/commands/block.mjs"),
  point: () => import("../src/commands/point.mjs"),
  spec: () => import("../src/commands/spec.mjs"),
  claim: () => import("../src/commands/claim.mjs"),
  prompt: () => import("../src/commands/prompt.mjs"),
  run: () => import("../src/commands/run.mjs"),
  guard: () => import("../src/commands/guard.mjs"),
  compact: () => import("../src/commands/compact.mjs"),
  generate: () => import("../src/commands/generate.mjs"),
  check: () => import("../src/commands/check.mjs"),
};

const HELP = `goalpost — a goal-contract roadmap loop for agents and humans

usage: goalpost <command> [args]

  init [--claude] [--agents-md]   scaffold .goalpost/ in this repo
  status [--brief] [--json]       pointer, open lanes, liveness
  next [--json]                   the next workable task (read-only)
  claim [<id>] [--json]           point + start the next task, atomically
  add <id> --name .. --criteria .. --verify ..   create a goal contract
  spec <id>                       scaffold a spec from the template
  start <id>                      todo/blocked → in_progress
  done <id> --result ".."         run verification; refuse on red; close
  block <id> --on ".."            park a task with a reason
  point <id> | --next             move the live pointer
  show <id> [--json] [--spec]     inspect a task or milestone
  prompt [<id>]                   emit a self-contained mission brief
  run [--max N|--once] [--dry-run]  claim → agent → verify closure → advance
  guard [paths...]                write-scope hook (exit 2 blocks)
  compact                         archive old done bodies
  generate [--check]              (re)write the roadmap markdown
  check [--strict]                validate everything; CI gate
`;

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
    process.stdout.write(HELP);
    return 0;
  }
  const loader = COMMANDS[cmd];
  if (!loader) {
    console.error(`goalpost: unknown command "${cmd}" — run \`goalpost help\``);
    return 1;
  }
  const mod = await loader();
  return (await mod.run(rest)) ?? 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    if (err instanceof GoalpostError) {
      console.error(`goalpost: ${err.message}`);
      process.exit(err.exitCode ?? 1);
    }
    console.error(err);
    process.exit(1);
  });
