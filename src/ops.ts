/** Maps a parsed bash command to the paths it touches and the operation on each. */

import { existsSync } from "node:fs";
import * as fs from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { parseArgs } from "./argv";
import { expandTilde } from "./paths";
import { type SimpleCommand, tokenize } from "./tokenize";
import type { PathOp } from "./types";

const READ = new Set([
  "cat",
  "bat",
  "head",
  "tail",
  "less",
  "more",
  "grep",
  "egrep",
  "rg",
  "ag",
  "awk",
  "strings",
  "xxd",
  "od",
  "hexdump",
  "file",
  "wc",
  "diff",
  "cmp",
  "md5sum",
  "sha1sum",
  "sha256sum",
  "sha512sum",
  "openssl",
  "gpg",
  "jq",
  "yq",
  "column",
  "sort",
  "uniq",
  "cut",
  "envsubst",
]);

const WRITE = new Set([
  "tee",
  "truncate",
  "touch",
  "install",
  "ln",
  "chmod",
  "chown",
  "chgrp",
  "setfacl",
  "patch",
]);

const DELETE = new Set(["rm", "unlink", "shred", "rmdir"]);

/** First operand is the source (read), the rest are written. */
const COPY = new Set(["cp", "mv", "rsync", "scp", "dd"]);

const EXTENSION = /\.[A-Za-z0-9_]+$/;
const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh", "fish"]);
const MAX_GLOB_MATCHES = 50;
const MAX_NESTING = 3;

/** Conservative heuristic: anything that looks like a filesystem path. */
export function looksLikePath(value: string, cwd: string): boolean {
  if (!value || value.startsWith("-")) return false;
  if (value.includes("$") || value.includes("*") || value.includes("?")) return false;
  if (value.includes("/") || value.startsWith(".") || value.startsWith("~")) return true;
  if (EXTENSION.test(value)) return true;
  const abs = isAbsolute(value) ? value : resolve(cwd, expandTilde(value));
  return existsSync(abs);
}

function hasGlobChars(value: string): boolean {
  return value.includes("*") || value.includes("?") || value.includes("[");
}

/** Expands a shell glob so `cat .env*` cannot slip past the rules. */
function expandGlob(value: string, cwd: string): string[] {
  const fn = (fs as { globSync?: (pattern: string, options?: { cwd?: string }) => string[] }).globSync;
  if (typeof fn !== "function") return [];
  try {
    return fn(expandTilde(value), { cwd }).slice(0, MAX_GLOB_MATCHES);
  } catch {
    return [];
  }
}

/** `$VAR` operands cannot be resolved: keep the literal basename for matching. */
function unresolvedBasename(value: string): string | undefined {
  const suffix = value.slice(value.lastIndexOf("/") + 1);
  if (!suffix || suffix.startsWith("$")) return undefined;
  return EXTENSION.test(suffix) ? suffix : undefined;
}

function flagValueOf(token: string): string | undefined {
  const eq = token.indexOf("=");
  return token.startsWith("-") && eq > 0 ? token.slice(eq + 1) : undefined;
}

/** cwd for the next command in the chain (`cd dir`, `pushd dir`). */
export function cwdAfter(simple: SimpleCommand, cwd: string): string {
  const args = parseArgs(simple.argv);
  if (!args || (args.program !== "cd" && args.program !== "pushd")) return cwd;
  const target = args.positional[0];
  if (!target || target === "-") return cwd;
  const expanded = expandTilde(target);
  return isAbsolute(expanded) ? expanded : resolve(cwd, expanded);
}

export interface PathTarget {
  path: string;
  op: PathOp;
  /** Set when only the literal basename is known (e.g. `${HOME}/.env`). */
  basenameOnly?: boolean;
}

export function extractTargets(simple: SimpleCommand, cwd: string): PathTarget[] {
  const args = parseArgs(simple.argv);
  if (!args) return [];

  const targets: PathTarget[] = [];
  const add = (value: string | undefined, op: PathOp) => {
    if (!value) return;

    if (hasGlobChars(value)) {
      for (const match of expandGlob(value, cwd)) targets.push({ path: match, op });
      return;
    }

    if (value.includes("$")) {
      const basename = unresolvedBasename(value);
      if (basename) targets.push({ path: basename, op, basenameOnly: true });
      return;
    }

    if (!looksLikePath(value, cwd)) return;
    targets.push({ path: value, op });
  };

  // Redirections: `> file` writes, `>> file` writes, `< file` reads.
  for (const redirect of simple.redirects) {
    add(redirect.target, redirect.op === "<" ? "read" : "write");
  }

  if (args.program === "cd" || args.program === "pushd") return targets;

  if (DELETE.has(args.program)) {
    for (const operand of args.positional) add(operand, "delete");
    return targets;
  }

  if (COPY.has(args.program)) {
    if (args.program === "dd") {
      for (const operand of args.positional) add(operand, "write");
      return targets;
    }
    const operands = args.positional;
    operands.forEach((operand, index) => {
      add(operand, index === operands.length - 1 ? "write" : "read");
    });
    return targets;
  }

  if (args.program === "sed") {
    const inPlace = args.flags.has("-i") || args.flags.has("--in-place");
    for (const operand of args.positional.slice(1)) add(operand, inPlace ? "write" : "read");
    return targets;
  }

  if (WRITE.has(args.program)) {
    for (const operand of args.positional) add(operand, "write");
    return targets;
  }

  if (READ.has(args.program)) {
    for (const operand of args.positional) add(operand, "read");
    return targets;
  }

  // Unknown program: treat path-looking operands and `--flag=value` paths as reads.
  for (const operand of args.positional) add(operand, "read");
  for (const token of simple.argv) add(flagValueOf(token), "read");

  return targets;
}

/** Script text of `sh -c "..."`, so nested commands are checked too. */
function nestedScript(simple: SimpleCommand): string | undefined {
  const args = parseArgs(simple.argv);
  if (!args || !SHELLS.has(args.program)) return undefined;
  if (!args.flags.has("-c")) return undefined;
  return args.positional[0];
}

/** All path targets of a command string, including `cd` tracking and `sh -c`. */
export function collectTargets(command: string, cwd: string, depth = 0): PathTarget[] {
  const targets: PathTarget[] = [];
  let current = cwd;

  for (const simple of tokenize(command)) {
    targets.push(...extractTargets(simple, current));
    const script = nestedScript(simple);
    if (script && depth < MAX_NESTING) targets.push(...collectTargets(script, current, depth + 1));
    current = cwdAfter(simple, current);
  }

  return targets;
}
