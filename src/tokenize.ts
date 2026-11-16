/**
 * Quote-aware command splitter.
 *
 * Turns a raw bash command string into simple commands (argv lists) and
 * throws away text that is not a command: quoted words stay inside argv,
 * heredoc bodies and comments are skipped, and command substitutions are
 * tokenized as their own commands.
 */

export interface Redirect {
  op: ">" | ">>" | "<";
  target: string;
}

export interface SimpleCommand {
  argv: string[];
  redirects: Redirect[];
}

const BLANK = /\s/;

function isSeparator(ch: string): boolean {
  return ch === ";" || ch === "&" || ch === "|" || ch === "\n";
}

/** Reads a quoted string starting at `start`; double quotes honour backslash escapes. */
function readQuoted(input: string, start: number): { text: string; next: number } {
  const quote = input[start];
  let text = "";
  let i = start + 1;
  while (i < input.length && input[i] !== quote) {
    if (quote === '"' && input[i] === "\\") {
      text += input[i + 1] ?? "";
      i += 2;
      continue;
    }
    text += input[i];
    i++;
  }
  return { text, next: i + 1 };
}

export function tokenize(input: string): SimpleCommand[] {
  const commands: SimpleCommand[] = [];
  const subs: string[] = [];
  let argv: string[] = [];
  let redirects: Redirect[] = [];
  let word = "";
  let inWord = false;
  let heredocs: string[] = [];

  const flushWord = () => {
    if (inWord) {
      argv.push(word);
      word = "";
      inWord = false;
    }
  };

  const endCommand = () => {
    flushWord();
    if (argv.length > 0) commands.push({ argv, redirects });
    argv = [];
    redirects = [];
  };

  // Skip to the end of a pending heredoc body; returns the index after it.
  const skipHeredoc = (from: number, delimiter: string): number => {
    let i = from;
    while (i < input.length) {
      const nl = input.indexOf("\n", i);
      const lineEnd = nl === -1 ? input.length : nl;
      if (input.slice(i, lineEnd).replace(/^\t+/, "").trimEnd() === delimiter) {
        return nl === -1 ? input.length : nl + 1;
      }
      if (nl === -1) return input.length;
      i = nl + 1;
    }
    return input.length;
  };

  const readRedirTarget = (from: number): { target: string; next: number } => {
    let i = from;
    while (i < input.length && (input[i] === " " || input[i] === "\t")) i++;
    let target = "";
    while (i < input.length && !BLANK.test(input[i] as string) && !isSeparator(input[i] as string)) {
      const ch = input[i] as string;
      if (ch === "'" || ch === '"') {
        const quoted = readQuoted(input, i);
        target += quoted.text;
        i = quoted.next;
        continue;
      }
      target += ch;
      i++;
    }
    return { target, next: i };
  };

  let i = 0;
  while (i < input.length) {
    const ch = input[i] as string;

    if (ch === "\\") {
      word += input[i + 1] ?? "";
      inWord = true;
      i += 2;
      continue;
    }

    if (ch === "'" || ch === '"') {
      const quoted = readQuoted(input, i);
      word += quoted.text;
      inWord = true;
      i = quoted.next;
      continue;
    }

    if (ch === "`") {
      const close = input.indexOf("`", i + 1);
      const stop = close === -1 ? input.length : close;
      subs.push(input.slice(i + 1, stop));
      i = stop + 1;
      continue;
    }

    if (ch === "$" && input[i + 1] === "(") {
      let depth = 1;
      let j = i + 2;
      while (j < input.length && depth > 0) {
        const c = input[j] as string;
        if (c === "(") depth++;
        else if (c === ")") depth--;
        if (depth === 0) break;
        j++;
      }
      subs.push(input.slice(i + 2, j));
      i = j + 1;
      continue;
    }

    if (ch === "<" && input[i + 1] === "<") {
      let j = i + 2;
      if (input[j] === "-") j++;
      while (input[j] === " " || input[j] === "\t") j++;
      let delimiter = "";
      if (input[j] === "'" || input[j] === '"') {
        const quoted = readQuoted(input, j);
        delimiter = quoted.text;
        j = quoted.next;
      } else {
        while (j < input.length && !BLANK.test(input[j] as string) && !isSeparator(input[j] as string)) {
          delimiter += input[j];
          j++;
        }
      }
      if (delimiter) heredocs.push(delimiter);
      i = j;
      continue;
    }

    if (ch === ">") {
      const append = input[i + 1] === ">";
      flushWord();
      const redir = readRedirTarget(i + (append ? 2 : 1));
      redirects.push({ op: append ? ">>" : ">", target: redir.target });
      i = redir.next;
      continue;
    }

    if (ch === "<") {
      flushWord();
      const redir = readRedirTarget(i + 1);
      redirects.push({ op: "<", target: redir.target });
      i = redir.next;
      continue;
    }

    if (isSeparator(ch)) {
      endCommand();
      i++;
      if (ch === "\n") {
        for (const delimiter of heredocs) i = skipHeredoc(i, delimiter);
        heredocs = [];
      }
      continue;
    }

    if (ch === "#" && !inWord) {
      const nl = input.indexOf("\n", i);
      i = nl === -1 ? input.length : nl;
      continue;
    }

    if (BLANK.test(ch)) {
      flushWord();
      i++;
      continue;
    }

    word += ch;
    inWord = true;
    i++;
  }

  endCommand();

  for (const sub of subs) commands.push(...tokenize(sub));
  return commands;
}
