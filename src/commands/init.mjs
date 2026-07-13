import { existsSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { fail, Store } from "../store.mjs";
import { parseArgs } from "../args.mjs";
import { wireClaudeSettings, wireAgentsMd } from "../integrate.mjs";

const BUNDLED_TEMPLATE = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "assets", "spec-template.md");

const DEFAULT_CONFIG = {
  markdown: "ROADMAP.md",
  staleDays: 14,
  requireSpec: false,
  autoAdvance: false,
  compact: { keepRecent: 5, pin: [] },
  verification: { allowPrefixes: [] },
  agent: { command: null },
};

const SAMPLE_TASK = {
  id: "hello-goalpost",
  name: "Run the goalpost loop once",
  status: "todo",
  depends_on: [],
  success_criteria: ["you claimed this task, did something small, and closed it through the verification gate"],
  verification: [`node -e "process.exit(0)"`],
  result: null,
  started_at: null,
  updated_at: null,
  waiting_on: null,
};

export function run(argv) {
  const { flags } = parseArgs(argv, ["claude", "agents-md", "yes"]);
  const root = process.cwd();
  const dir = join(root, ".goalpost");
  if (existsSync(dir)) fail(".goalpost already exists here — goalpost is already initialized");

  mkdirSync(join(dir, "specs"), { recursive: true });
  mkdirSync(join(dir, "templates"), { recursive: true });
  writeFileSync(join(dir, "config.json"), JSON.stringify(DEFAULT_CONFIG, null, 2) + "\n");
  writeFileSync(
    join(dir, "goalpost.json"),
    JSON.stringify({ version: 1, current: null, milestones: [], tasks: [SAMPLE_TASK] }, null, 2) + "\n",
  );
  writeFileSync(join(dir, "archive.json"), JSON.stringify({ version: 1, tasks: [] }, null, 2) + "\n");
  writeFileSync(join(dir, "journal.jsonl"), "");
  writeFileSync(join(dir, "specs", ".gitkeep"), "");
  writeFileSync(join(dir, "templates", "spec.md"), readFileSync(BUNDLED_TEMPLATE, "utf8"));

  const store = new Store(dir);
  store.journal("init", null);
  store.writeMarkdown();

  console.log("initialized .goalpost/ with a sample task — try:");
  console.log("  goalpost claim            # pick up the next workable task");
  console.log('  goalpost done hello-goalpost --result "ran the loop"');
  console.log("  goalpost add <id> --name .. --criteria .. --verify ..");

  if (flags.claude) {
    const path = wireClaudeSettings(root);
    console.log(`wired Claude Code hooks into ${path}`);
  }
  if (flags["agents-md"]) {
    const path = wireAgentsMd(root);
    console.log(`wrote goalpost block into ${path}`);
  }
  return 0;
}
