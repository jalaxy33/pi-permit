/**
 * Declarative rule matching over parsed argv.
 *
 * Rules never see the raw command string; they match the program name and
 * flag/argument sets, so text inside heredocs or quotes cannot trigger them.
 */

import { type SimpleCommand, tokenize } from "./tokenize";

export interface Rule {
  id: string;
  /** Program name(s), compared against the basename of argv[0]. */
  program: string | string[];
  /** Subcommand or operand: matches when any of these appears as a positional. */
  args?: string[];
  /** Matches when any of these flags is present. */
  anyFlag?: string[];
  /** Matches only when all of these flags are present. */
  allFlags?: string[];
  /** Never matches when any of these flags is present. */
  unlessFlag?: string[];
  /** Last resort: regex over the joined argv of one simple command. */
  argvRegex?: string;
  reason?: string;
  terminate?: boolean;
}

export interface CompiledRule extends Rule {
  re?: RegExp;
}

export interface CommandsConfig {
  deny: CompiledRule[];
  ask: CompiledRule[];
  allow: CompiledRule[];
}

export type Action = "allow" | "ask" | "deny";

export interface Verdict {
  action: Action;
  reasons: string[];
  terminate: boolean;
}

export interface CompileResult {
  rules: CompiledRule[];
  warnings: string[];
}

export function compileRules(rules: Rule[]): CompileResult {
  const warnings: string[] = [];
  const compiled: CompiledRule[] = [];
  for (const rule of rules) {
    const programOk =
      typeof rule?.program === "string" ||
      (Array.isArray(rule?.program) && rule.program.every((name) => typeof name === "string"));
    if (!rule || !programOk) {
      warnings.push(`ignore rule without program: ${JSON.stringify(rule)}`);
      continue;
    }
    if (!rule.id) {
      warnings.push(`ignore rule without id: ${rule.program}`);
      continue;
    }
    const entry: CompiledRule = { ...rule };
    if (rule.argvRegex) {
      try {
        entry.re = new RegExp(rule.argvRegex);
      } catch (error) {
        warnings.push(`rule ${rule.id}: bad argvRegex (${(error as Error).message})`);
        continue;
      }
    }
    compiled.push(entry);
  }
  return { rules: compiled, warnings };
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

interface Args {
  program: string;
  positional: string[];
  flags: Set<string>;
  joined: string;
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

function matchesProgram(rule: CompiledRule, program: string): boolean {
  const wanted = Array.isArray(rule.program) ? rule.program : [rule.program];
  return wanted.some((name) => name.replace(/^\//, "") === program);
}

export function matchRule(rule: CompiledRule, args: Args): boolean {
  if (!matchesProgram(rule, args.program)) return false;
  if (rule.args && !rule.args.some((wanted) => args.positional.includes(wanted))) return false;
  if (rule.anyFlag && !rule.anyFlag.some((flag) => args.flags.has(flag))) return false;
  if (rule.allFlags && !rule.allFlags.every((flag) => args.flags.has(flag))) return false;
  if (rule.unlessFlag && rule.unlessFlag.some((flag) => args.flags.has(flag))) return false;
  if (rule.re && !rule.re.test(args.joined)) return false;
  return true;
}

function decideOne(argv: string[], config: CommandsConfig): Verdict {
  const args = parseArgs(argv);
  if (!args) return { action: "allow", reasons: [], terminate: false };

  const deny = config.deny.filter((rule) => matchRule(rule, args));
  if (deny.length > 0) {
    return {
      action: "deny",
      reasons: deny.map((rule) => rule.reason ?? rule.id),
      terminate: deny.some((rule) => rule.terminate === true),
    };
  }

  if (config.allow.some((rule) => matchRule(rule, args))) {
    return { action: "allow", reasons: [], terminate: false };
  }

  const ask = config.ask.filter((rule) => matchRule(rule, args));
  if (ask.length > 0) {
    return {
      action: "ask",
      reasons: ask.map((rule) => rule.reason ?? rule.id),
      terminate: false,
    };
  }

  return { action: "allow", reasons: [], terminate: false };
}

/** Strictest verdict across every simple command in the string. */
export function decide(command: string, config: CommandsConfig): Verdict {
  const commands: SimpleCommand[] = tokenize(command);
  const merged: Verdict = { action: "allow", reasons: [], terminate: false };

  const ranks: Record<Action, number> = { allow: 0, ask: 1, deny: 2 };
  for (const simple of commands) {
    const verdict = decideOne(simple.argv, config);
    for (const reason of verdict.reasons) {
      if (!merged.reasons.includes(reason)) merged.reasons.push(reason);
    }
    if (ranks[verdict.action] > ranks[merged.action]) merged.action = verdict.action;
    if (verdict.terminate) merged.terminate = true;
  }

  return merged;
}
