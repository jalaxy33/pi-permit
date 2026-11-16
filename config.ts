/**
 * Config loading and defaults.
 *
 * Global:  ~/.pi/agent/permit.json
 * Project: <cwd>/.pi/permit.json (only when the project is trusted)
 *
 * The extension never writes config files.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { type CommandsConfig, compileRules, type CompileResult, type Rule } from "./decide";

export interface ConfigFile {
  version?: number;
  enabled?: { commands?: boolean; paths?: boolean };
  commands?: { deny?: Rule[]; ask?: Rule[]; allow?: Rule[] };
  paths?: { rules?: unknown[] };
}

export interface ResolvedConfig {
  enabled: { commands: boolean; paths: boolean };
  commands: CommandsConfig;
  warnings: string[];
  sources: string[];
}

const DENY: Rule[] = [
  {
    id: "git-history",
    program: "git",
    args: ["filter-branch", "filter-repo", "update-ref"],
    reason: "rewrites history or deletes refs",
    terminate: true,
  },
  {
    id: "git-reflog",
    program: "git",
    args: ["reflog"],
    argvRegex: "(^|\\s)(expire|delete)(\\s|$)",
    reason: "removes the recovery log",
    terminate: true,
  },
  {
    id: "git-gc-prune",
    program: "git",
    args: ["gc"],
    argvRegex: "--prune=(now|0|all|never)",
    reason: "drops unreachable objects for good",
    terminate: true,
  },
];

const ASK: Rule[] = [
  { id: "git-add", program: "git", args: ["add"], reason: "stages changes" },
  { id: "git-commit", program: "git", args: ["commit"], reason: "creates a commit" },
  { id: "git-push", program: "git", args: ["push"], reason: "updates the remote" },
  { id: "git-merge", program: "git", args: ["merge"], reason: "merges branches" },
  {
    id: "git-reset-hard",
    program: "git",
    args: ["reset"],
    allFlags: ["--hard"],
    reason: "discards uncommitted work",
  },
  {
    id: "git-discard",
    program: "git",
    args: ["checkout", "restore"],
    argvRegex: "(^|\\s)(--|\\.|-f|--force)(\\s|$)",
    unlessFlag: ["--staged", "-p", "--patch"],
    reason: "discards local changes",
  },
  {
    id: "git-clean",
    program: "git",
    args: ["clean"],
    anyFlag: ["-f", "--force", "-d", "-x"],
    reason: "deletes untracked files",
  },
  { id: "git-branch-delete", program: "git", args: ["branch"], anyFlag: ["-D"], reason: "deletes a branch" },
  { id: "git-tag-delete", program: "git", args: ["tag"], anyFlag: ["-d"], reason: "deletes a tag" },
  {
    id: "git-stash-drop",
    program: "git",
    args: ["stash"],
    argvRegex: "(^|\\s)(drop|clear)(\\s|$)",
    reason: "deletes a stash",
  },
  {
    id: "git-worktree-remove",
    program: "git",
    args: ["worktree"],
    argvRegex: "(^|\\s)remove(\\s|$)",
    reason: "removes a worktree",
  },
  { id: "rm-recursive", program: "rm", anyFlag: ["-r", "-R", "--recursive"], reason: "recursive delete" },
  { id: "rsync-delete", program: "rsync", anyFlag: ["--delete", "--delete-after"], reason: "deletes destination files" },
  {
    id: "find-delete",
    program: "find",
    anyFlag: ["-delete"],
    reason: "bulk delete via find",
  },
  {
    id: "find-exec-rm",
    program: "find",
    argvRegex: "-exec\\s+rm\\b",
    reason: "bulk delete via find -exec rm",
  },
  { id: "xargs-rm", program: "xargs", argvRegex: "(^|\\s)rm(\\s|$)", reason: "bulk delete via xargs" },
  { id: "truncate-zero", program: "truncate", argvRegex: "-s\\s*0|--size=0", reason: "truncates a file" },
  { id: "sudo", program: ["sudo", "doas", "pkexec"], reason: "privilege escalation" },
  { id: "dropdb", program: ["dropdb"], reason: "drops a database" },
  {
    id: "redis-flush",
    program: "redis-cli",
    argvRegex: "[Ff][Ll][Uu][Ss][Hh](all|ALL|db|DB)",
    reason: "flushes the database",
  },
  {
    id: "sql-drop",
    program: ["psql", "mysql", "mariadb", "sqlite3"],
    anyFlag: ["-c", "--command", "-e", "--eval"],
    argvRegex:
      "([Dd][Rr][Oo][Pp]|[Tt][Rr][Uu][Nn][Cc][Aa][Tt][Ee])\\s+([Dd][Aa][Tt][Aa][Bb][Aa][Ss][Ee]|[Tt][Aa][Bb][Ll][Ee]|[Ss][Cc][Hh][Ee][Mm][Aa]|[Kk][Ee][Yy][Ss][Pp][Aa][Cc][Ee])",
    reason: "drops or truncates tables",
  },
  { id: "terraform-apply", program: "terraform", args: ["apply", "destroy"], reason: "changes infrastructure" },
  { id: "kubectl-destructive", program: "kubectl", args: ["delete", "drain"], reason: "deletes cluster resources" },
  { id: "helm-uninstall", program: "helm", args: ["uninstall", "delete"], reason: "uninstalls a release" },
  {
    id: "docker-prune",
    program: "docker",
    argvRegex: "(system\\s+prune|volume\\s+(rm|prune)|compose\\s+down\\b.*-v)",
    reason: "removes volumes or prunes",
  },
  {
    id: "publish",
    program: ["npm", "pnpm", "yarn", "cargo", "gem"],
    args: ["publish", "unpublish", "push"],
    reason: "publishes a package",
  },
  { id: "gh-delete", program: "gh", args: ["delete"], reason: "deletes a remote resource" },
];

const ALLOW: Rule[] = [
  {
    id: "git-push-lease",
    program: "git",
    args: ["push"],
    argvRegex: "--force-with-lease",
    reason: "force-with-lease is recoverable",
  },
];

function defaults(): { deny: Rule[]; ask: Rule[]; allow: Rule[] } {
  return {
    deny: structuredClone(DENY),
    ask: structuredClone(ASK),
    allow: structuredClone(ALLOW),
  };
}

function readScope(path: string, warnings: string[]): ConfigFile | undefined {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
  try {
    return JSON.parse(raw) as ConfigFile;
  } catch (error) {
    warnings.push(`${path}: invalid JSON (${(error as Error).message})`);
    return undefined;
  }
}

export function globalConfigPath(): string {
  return join(homedir(), ".pi", "agent", "permit.json");
}

export function projectConfigPath(cwd: string): string {
  return join(cwd, ".pi", "permit.json");
}

export function loadConfig(cwd: string, trusted: boolean): ResolvedConfig {
  const warnings: string[] = [];
  const sources: string[] = [];
  const global = readScope(globalConfigPath(), warnings);
  const project = trusted ? readScope(projectConfigPath(cwd), warnings) : undefined;
  if (global) sources.push(globalConfigPath());
  if (project) sources.push(projectConfigPath(cwd));

  const base = defaults();
  const merged = {
    deny: [...base.deny, ...(global?.commands?.deny ?? []), ...(project?.commands?.deny ?? [])],
    ask: [...base.ask, ...(global?.commands?.ask ?? []), ...(project?.commands?.ask ?? [])],
    allow: [...base.allow, ...(global?.commands?.allow ?? []), ...(project?.commands?.allow ?? [])],
  };

  const compiled: CompileResult[] = [
    compileRules(merged.deny),
    compileRules(merged.ask),
    compileRules(merged.allow),
  ];
  for (const result of compiled) warnings.push(...result.warnings);

  return {
    enabled: {
      commands: project?.enabled?.commands ?? global?.enabled?.commands ?? true,
      paths: project?.enabled?.paths ?? global?.enabled?.paths ?? false,
    },
    commands: {
      deny: compiled[0]?.rules ?? [],
      ask: compiled[1]?.rules ?? [],
      allow: compiled[2]?.rules ?? [],
    },
    warnings,
    sources,
  };
}
