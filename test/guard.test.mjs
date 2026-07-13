import { test } from "node:test";
import assert from "node:assert/strict";
import { makeRepo, state, task } from "./helpers.mjs";

// guard is designed to run as a Claude Code PreToolUse hook on Edit|Write.
// Exit codes follow the hook convention: 0 = allow, 2 = block (stderr shown to the agent).

function scopedRepo(extra = {}) {
  return makeRepo({
    state: state({
      current: "a",
      tasks: [task({ id: "a", status: "in_progress", write_scope: ["src/auth/**", "test/auth/**"], ...extra })],
    }),
  });
}

test("guard allows paths inside the current task's write_scope", () => {
  const repo = scopedRepo();
  assert.equal(repo.run(["guard", "src/auth/login.ts"]).code, 0);
  assert.equal(repo.run(["guard", "test/auth/login.test.ts"]).code, 0);
});

test("guard blocks paths outside write_scope with exit 2 and names the scope", () => {
  const repo = scopedRepo();
  const r = repo.run(["guard", "src/billing/invoice.ts"]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /write_scope/);
  assert.match(r.stderr, /src\/auth\/\*\*/); // tells the agent what IS allowed
});

test("guard blocks absolute paths that resolve outside the scope", () => {
  const repo = scopedRepo();
  const r = repo.run(["guard", `${repo.root}/src/billing/invoice.ts`]);
  assert.equal(r.code, 2);
  const ok = repo.run(["guard", `${repo.root}/src/auth/login.ts`]);
  assert.equal(ok.code, 0);
});

test("guard always blocks hand-edits of goalpost state and the generated markdown", () => {
  const repo = scopedRepo({ write_scope: ["**"] }); // even a wide-open scope
  assert.equal(repo.run(["guard", ".goalpost/goalpost.json"]).code, 2);
  assert.equal(repo.run(["guard", ".goalpost/archive.json"]).code, 2);
  assert.equal(repo.run(["guard", "ROADMAP.md"]).code, 2);
  // but specs and config are hand-editable
  assert.equal(repo.run(["guard", ".goalpost/specs/a.md"]).code, 0);
  assert.equal(repo.run(["guard", ".goalpost/config.json"]).code, 0);
});

test("guard is a no-op (allow) when the task declares no write_scope", () => {
  const repo = makeRepo({
    state: state({ current: "a", tasks: [task({ id: "a", status: "in_progress" })] }),
  });
  assert.equal(repo.run(["guard", "anything/anywhere.ts"]).code, 0);
});

test("guard is a no-op when no task is in_progress at the pointer", () => {
  const repo = makeRepo({ state: state({ tasks: [task({ id: "a", write_scope: ["src/**"] })] }) });
  assert.equal(repo.run(["guard", "way/out/of/scope.ts"]).code, 0);
});

test("guard reads the Claude Code hook payload from stdin when no args are given", () => {
  const repo = scopedRepo();
  const blocked = repo.run(["guard"], {
    input: JSON.stringify({ tool_name: "Edit", tool_input: { file_path: `${repo.root}/src/billing/x.ts` } }),
  });
  assert.equal(blocked.code, 2);
  const allowed = repo.run(["guard"], {
    input: JSON.stringify({ tool_name: "Write", tool_input: { file_path: `${repo.root}/src/auth/x.ts` } }),
  });
  assert.equal(allowed.code, 0);
});

test("guard with no args and empty stdin allows (never breaks a hook chain)", () => {
  const repo = scopedRepo();
  assert.equal(repo.run(["guard"], { input: "" }).code, 0);
});
