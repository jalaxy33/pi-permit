/** Turns the argv of one simple command into the pieces rules match on. */

export interface Args {
  program: string;
  positional: string[];
  flags: Set<string>;
  joined: string;
}

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

function programOf(argv: string[]): { program: string; index: number } | undefined {
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i] as string;
    if (ASSIGNMENT.test(token)) continue;
    return { program: token.split("/").pop() as string, index: i };
  }
  return undefined;
}

export function parseArgs(argv: string[]): Args | undefined {
  const head = programOf(argv);
  if (!head) return undefined;

  const positional: string[] = [];
  const flags = new Set<string>();
  let afterDoubleDash = false;

  for (let i = head.index + 1; i < argv.length; i++) {
    const token = argv[i] as string;
    if (afterDoubleDash) {
      positional.push(token);
      continue;
    }
    if (token === "--") {
      afterDoubleDash = true;
      continue;
    }
    if (token.startsWith("--")) {
      flags.add(token);
      flags.add(token.slice(2));
      continue;
    }
    if (/^-[A-Za-z0-9]+$/.test(token)) {
      flags.add(token);
      for (const letter of token.slice(1)) flags.add(`-${letter}`);
      continue;
    }
    if (token.startsWith("-")) {
      flags.add(token);
      continue;
    }
    positional.push(token);
  }

  return { program: head.program, positional, flags, joined: argv.join(" ") };
}
