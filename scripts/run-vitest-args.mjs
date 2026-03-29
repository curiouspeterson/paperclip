export function normalizeVitestScriptArgs(args) {
  if (!Array.isArray(args) || args.length === 0) {
    return [];
  }

  if (args[0] === "--") {
    return args.slice(1);
  }

  if (args[1] === "--") {
    return [args[0], ...args.slice(2)];
  }

  return [...args];
}
