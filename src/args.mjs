import { fail } from "./store.mjs";

/**
 * Minimal arg parser. `booleans` names flags that take no value; every other
 * --flag consumes the next token. Repeated value flags accumulate into arrays.
 */
export function parseArgs(argv, booleans = []) {
  const bools = new Set(booleans);
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const name = a.slice(2);
      if (bools.has(name)) {
        flags[name] = true;
      } else {
        const value = argv[++i];
        if (value === undefined) fail(`missing value for --${name}`);
        flags[name] = name in flags ? [].concat(flags[name], value) : value;
      }
    } else {
      positional.push(a);
    }
  }
  return { flags, positional };
}

export function asArray(v) {
  return v === undefined ? [] : Array.isArray(v) ? v : [v];
}
