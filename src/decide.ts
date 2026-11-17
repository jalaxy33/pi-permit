import { parseArgs, type Args } from "./argv";
import { matchRule } from "./match";
import { tokenize } from "./tokenize";
import type { Action, CompiledRule, GateRules, Verdict } from "./types";

const RANK: Record<Action, number> = { allow: 0, ask: 1, deny: 2 };

function allowed(): Verdict {
  return { action: "allow", reasons: [], grants: [], terminate: false };
}

/** A session grant covers one rule with the same flags, not every command it matches. */
function grantKey(rule: CompiledRule, args: Args): string {
  return `rule:${rule.id}:${[...args.flags].sort().join(",")}`;
}

function decideOne(argv: string[], rules: GateRules): Verdict {
  const args = parseArgs(argv);
  if (!args) return allowed();

  const deny = rules.deny.filter((rule) => matchRule(rule, args));
  if (deny.length > 0) {
    return {
      action: "deny",
      reasons: deny.map((rule) => rule.reason ?? rule.id),
      grants: [],
      terminate: deny.some((rule) => rule.terminate === true),
    };
  }

  if (rules.allow.some((rule) => matchRule(rule, args))) return allowed();

  const ask = rules.ask.filter((rule) => matchRule(rule, args));
  if (ask.length > 0) {
    return {
      action: "ask",
      reasons: ask.map((rule) => rule.reason ?? rule.id),
      grants: ask.map((rule) => grantKey(rule, args)),
      terminate: false,
    };
  }

  return allowed();
}

/** Strictest verdict across every simple command in the string. */
export function decide(command: string, rules: GateRules): Verdict {
  const merged: Verdict = { action: "allow", reasons: [], grants: [], terminate: false };

  for (const simple of tokenize(command)) {
    const verdict = decideOne(simple.argv, rules);
    for (const reason of verdict.reasons) {
      if (!merged.reasons.includes(reason)) merged.reasons.push(reason);
    }
    for (const grant of verdict.grants) {
      if (!merged.grants.includes(grant)) merged.grants.push(grant);
    }
    if (RANK[verdict.action] > RANK[merged.action]) merged.action = verdict.action;
    if (verdict.terminate) merged.terminate = true;
  }

  return merged;
}
