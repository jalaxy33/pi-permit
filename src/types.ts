export type Section = "deny" | "ask" | "allow";

export interface Rule {
  id: string;
  /** Program name(s). A `*` wildcard is allowed (e.g. `mkfs.*`). */
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
  programRes?: RegExp[];
}

export interface CompileResult {
  rules: CompiledRule[];
  warnings: string[];
}

export interface GateRules {
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

export interface CommandsSection {
  deny?: Rule[];
  ask?: Rule[];
  allow?: Rule[];
}

/** A set is either a path to a rule file or inline rules. */
export type RuleSetRef =
  | string
  | (CommandsSection & { description?: string; paths?: PathRule[] });

export interface RuleFile {
  version?: number;
  description?: string;
  defaultRules?: string[];
  sets?: Record<string, RuleSetRef>;
  commands?: CommandsSection;
  paths?: PathRule[];
}

export interface OutsideCwdConfig {
  /** What to do when a tool touches a path outside the working directory. */
  mode?: "allow" | "ask" | "block";
  /** Absolute, `~`, or cwd-relative globs that stay allowed. */
  allowPaths?: string[];
}

export interface ConfigFile extends RuleFile {
  enabled?: { commands?: boolean; paths?: boolean };
  outsideCwd?: OutsideCwdConfig;
}

import type { OutsideRule } from "./outside";

export type PathOp = "read" | "write" | "delete";
export type Protection = "block" | "read-only";

export interface PathRule {
  id: string;
  /** Glob patterns. No slash: matches the basename. `~`/`/`: absolute. Else relative to cwd. */
  patterns: string[];
  /** Patterns that cancel the rule. */
  except?: string[];
  /** Default: block every op. `read-only` only blocks write/delete. */
  protection?: Protection;
  /** Default: all operations. */
  ops?: PathOp[];
  /** Only protect paths that already exist. Default false. */
  onlyIfExists?: boolean;
  message?: string;
}

export interface CompiledPathRule extends PathRule {
  compiled: Array<{ value: string; kind: "base" | "abs" | "rel"; re: RegExp }>;
  compiledExcept: Array<{ value: string; kind: "base" | "abs" | "rel"; re: RegExp }>;
}

export interface ResolvedConfig {
  enabled: { commands: boolean; paths: boolean };
  commands: GateRules;
  paths: CompiledPathRule[];
  outside: OutsideRule;
  /** Set when the shipped rules cannot be read: every gated tool is blocked. */
  fatal?: string;
  warnings: string[];
  sources: string[];
}
