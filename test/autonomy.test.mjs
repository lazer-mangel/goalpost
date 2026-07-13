import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync } from "node:fs";
import { join } from "node:path";
import { makeRepo, state, task, findTask, GREEN, CLI } from "./helpers.mjs";

// ---------------------------------------------------------------------------
// spec — scaffold a spec from the template, pre-filled from the goal contract
// ---------------------------------------------------------------------------

test("spec scaffolds specs/<id>.md from the template and links it to the task", () => {
  const repo = makeRepo({
    state: state({ tasks: [task({ id: "auth-v1", name: "Session auth", success_criteria: ["login works"], verification: ["npm test -- auth"] })] }),
  });
  const r = repo.run(["spec", "auth-v1"]);
  assert.equal(r.code, 0);
  const spec = repo.read(".goalpost/specs/auth-v1.md");
  assert.match(spec, /Session auth/); // {{name}} filled
  assert.match(spec, /login works/); // {{success_criteria}} filled
  assert.match(spec, /npm test -- auth/); // {{verification}} filled
  assert.equal(findTask(repo, "auth-v1").spec, "specs/auth-v1.md");
  assert.ok(repo.readJournal().some((e) => e.event === "spec_created" && e.task === "auth-v1"));
});

test("spec refuses to overwrite an existing spec file", () => {
  const repo = makeRepo({
    state: state({ tasks: [task({ id: "a", spec: "specs/a.md" })] }),
    specs: { "specs/a.md": "# Hand-written spec" },
  });
  const r = repo.run(["spec", "a"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /exists/i);
  assert.equal(repo.read(".goalpost/specs/a.md"), "# Hand-written spec");
});

// ---------------------------------------------------------------------------
// claim — the single "go" verb: next + point + start, atomically
// ---------------------------------------------------------------------------

test("claim resolves next workable, points, starts, and prints the goal contract", () => {
  const repo = makeRepo({
    state: state({
      tasks: [task({ id: "a", status: "done" }), task({ id: "b", name: "Beta build", depends_on: ["a"], success_criteria: ["beta shipped"] })],
    }),
  });
  const r = repo.run(["claim"]);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /Beta build/);
  assert.match(r.stdout, /beta shipped/);
  const st = repo.readState();
  assert.equal(st.current, "b");
  assert.equal(findTask(repo, "b").status, "in_progress");
  assert.ok(repo.readJournal().some((e) => e.event === "claimed" && e.task === "b"));
});

test("claim <id> claims a specific task", () => {
  const repo = makeRepo({ state: state({ tasks: [task({ id: "a" }), task({ id: "b" })] }) });
  assert.equal(repo.run(["claim", "b"]).code, 0);
  assert.equal(repo.readState().current, "b");
  assert.equal(findTask(repo, "b").status, "in_progress");
});

test("claim refuses while the pointer task is still in_progress (no task-stacking)", () => {
  const repo = makeRepo({
    state: state({ current: "a", tasks: [task({ id: "a", status: "in_progress" }), task({ id: "b" })] }),
  });
  const r = repo.run(["claim"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /in_progress/);
  assert.equal(repo.readState().current, "a"); // untouched
  assert.equal(findTask(repo, "b").status, "todo");
});

test("claim --json emits the full task object", () => {
  const repo = makeRepo({ state: state({ tasks: [task({ id: "a" })] }) });
  const r = repo.run(["claim", "--json"]);
  assert.equal(r.code, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.id, "a");
  assert.equal(out.status, "in_progress");
});

test("claim fails when nothing is workable", () => {
  const repo = makeRepo({ state: state({ tasks: [task({ id: "a", status: "done" })] }) });
  assert.equal(repo.run(["claim"]).code, 1);
});

test("claim respects the requireSpec grounding gate", () => {
  const repo = makeRepo({ config: { requireSpec: true }, state: state({ tasks: [task({ id: "a" })] }) });
  const r = repo.run(["claim"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /spec/i);
});

// ---------------------------------------------------------------------------
// prompt — the self-contained mission brief
// ---------------------------------------------------------------------------

test("prompt emits a self-contained mission brief with contract, spec, and rules", () => {
  const repo = makeRepo({
    state: state({
      current: "a",
      tasks: [
        task({
          id: "a",
          name: "Session auth",
          status: "in_progress",
          success_criteria: ["login works end to end"],
          verification: ["npm test -- auth"],
          write_scope: ["src/auth/**"],
          spec: "specs/a.md",
        }),
      ],
    }),
    specs: { "specs/a.md": "# Auth spec\nUse session cookies, not JWT." },
  });
  const r = repo.run(["prompt"]);
  assert.equal(r.code, 0);
  const out = r.stdout;
  assert.match(out, /Session auth/);
  assert.match(out, /login works end to end/);
  assert.match(out, /npm test -- auth/); // loop exit
  assert.match(out, /Use session cookies, not JWT/); // spec inlined
  assert.match(out, /src\/auth\/\*\*/); // write scope
  assert.match(out, /goalpost done a --result/); // closing instruction
  assert.match(out, /goalpost block/); // escape hatch
  assert.match(out, /never hand-edit/i); // state rule
});

test("prompt <id> targets a specific task; fails on unknown id", () => {
  const repo = makeRepo({ state: state({ tasks: [task({ id: "a", name: "Alpha" }), task({ id: "b", name: "Beta" })] }) });
  assert.match(repo.run(["prompt", "b"]).stdout, /Beta/);
  assert.equal(repo.run(["prompt", "nope"]).code, 1);
});

test("prompt with no pointer and no id falls back to next workable", () => {
  const repo = makeRepo({ state: state({ tasks: [task({ id: "a", name: "Alpha" })] }) });
  const r = repo.run(["prompt"]);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /Alpha/);
});

// ---------------------------------------------------------------------------
// run — the closed loop: claim → agent → verify closure → advance
// ---------------------------------------------------------------------------

/**
 * The fake agent is a real script that receives the mission prompt as $1 and
 * drives the REAL CLI, exactly like a compliant agent session would.
 */
function fakeAgent(repo, body) {
  const path = join(repo.root, "fake-agent.sh");
  repo.write("fake-agent.sh", `#!/bin/bash\nset -e\nCLI="${process.execPath} ${CLI}"\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
}

test("run --once claims, spawns the agent, confirms closure, exits 0", () => {
  const repo = makeRepo({ state: state({ tasks: [task({ id: "a" })] }) });
  const agent = fakeAgent(repo, `$CLI done a --result "done by fake agent"`);
  const r = repo.run(["run", "--once"], { env: { GOALPOST_AGENT_COMMAND: `${agent} {prompt}` } });
  assert.equal(r.code, 0);
  assert.equal(findTask(repo, "a").status, "done");
});

test("run reads the agent command from config.agent.command", () => {
  const repo = makeRepo({ state: state({ tasks: [task({ id: "a" })] }) });
  const agent = fakeAgent(repo, `$CLI done a --result "done via config"`);
  repo.write(".goalpost/config.json", JSON.stringify({ agent: { command: `${agent} {prompt}` } }));
  const r = repo.run(["run", "--once"]);
  assert.equal(r.code, 0);
  assert.equal(findTask(repo, "a").status, "done");
});

test("run passes the mission prompt to the agent via {prompt}", () => {
  const repo = makeRepo({ state: state({ tasks: [task({ id: "a", name: "UniqueTaskName42" })] }) });
  const agent = fakeAgent(
    repo,
    `echo "$1" > received-prompt.txt\n$CLI done a --result "captured prompt"`,
  );
  const r = repo.run(["run", "--once"], { env: { GOALPOST_AGENT_COMMAND: `${agent} {prompt}` } });
  assert.equal(r.code, 0);
  assert.match(repo.read("received-prompt.txt"), /UniqueTaskName42/);
});

test("run stops with failure when the agent leaves the task open", () => {
  const repo = makeRepo({ state: state({ tasks: [task({ id: "a" })] }) });
  const agent = fakeAgent(repo, `echo "did some work, wandered off"`);
  const r = repo.run(["run", "--once"], { env: { GOALPOST_AGENT_COMMAND: `${agent} {prompt}` } });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /a/); // names the task it gave up on
  assert.equal(findTask(repo, "a").status, "in_progress"); // truthfully left open
});

test("run stops when the agent exits non-zero", () => {
  const repo = makeRepo({ state: state({ tasks: [task({ id: "a" })] }) });
  const agent = fakeAgent(repo, `exit 3`);
  const r = repo.run(["run", "--once"], { env: { GOALPOST_AGENT_COMMAND: `${agent} {prompt}` } });
  assert.equal(r.code, 1);
});

test("run stops cleanly when the agent blocks the task", () => {
  const repo = makeRepo({ state: state({ tasks: [task({ id: "a" }), task({ id: "b" })] }) });
  const agent = fakeAgent(repo, `$CLI block a --on "need vendor key"`);
  const r = repo.run(["run", "--max", "5"], { env: { GOALPOST_AGENT_COMMAND: `${agent} {prompt}` } });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /need vendor key/);
  assert.equal(findTask(repo, "b").status, "todo"); // did not barrel on past a block
});

test("run --max N loops across tasks until none are workable", () => {
  const repo = makeRepo({
    state: state({ tasks: [task({ id: "a" }), task({ id: "b", depends_on: ["a"] })] }),
  });
  // Agent closes whatever the pointer currently is.
  const agent = fakeAgent(repo, `ID=$($CLI status --json | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).current.id))")\n$CLI done "$ID" --result "closed by loop"`);
  const r = repo.run(["run", "--max", "5"], { env: { GOALPOST_AGENT_COMMAND: `${agent} {prompt}` } });
  assert.equal(r.code, 0);
  assert.equal(findTask(repo, "a").status, "done");
  assert.equal(findTask(repo, "b").status, "done");
  assert.match(r.stdout, /no workable task/i);
});

test("run --max caps iterations even when work remains", () => {
  const repo = makeRepo({
    state: state({ tasks: [task({ id: "a" }), task({ id: "b" }), task({ id: "c" })] }),
  });
  const agent = fakeAgent(repo, `ID=$($CLI status --json | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).current.id))")\n$CLI done "$ID" --result "closed"`);
  const r = repo.run(["run", "--max", "2"], { env: { GOALPOST_AGENT_COMMAND: `${agent} {prompt}` } });
  assert.equal(r.code, 0);
  const st = repo.readState();
  assert.equal(st.tasks.filter((t) => t.status === "done").length, 2);
});

test("run --dry-run prints the plan without spawning anything or mutating state", () => {
  const repo = makeRepo({ state: state({ tasks: [task({ id: "a" })] }) });
  const r = repo.run(["run", "--once", "--dry-run"], { env: { GOALPOST_AGENT_COMMAND: `echo {prompt}` } });
  assert.equal(r.code, 0);
  assert.match(r.stdout, /a/);
  assert.equal(findTask(repo, "a").status, "todo"); // untouched
  assert.equal(repo.readState().current, null);
});

test("run without an agent command fails with guidance", () => {
  const repo = makeRepo({ state: state({ tasks: [task({ id: "a" })] }) });
  const r = repo.run(["run", "--once"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /agent\.command/);
});
