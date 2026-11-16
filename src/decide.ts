import { parseArgs } from "./argv";
import { matchRule } from "./match";
import { tokenize } from "./tokenize";
import type { Action, GateRules, Verdict } from "./types";

const RANK: Record<Action, number> = { allow: 0, ask: 1, deny: 2 };

function decideOne(argv: string[], rules: GateRules): Verdict {
  const args = parseArgs(argv);
  if (!args) return { action: "allow", reasons: [], terminate: false };

  const deny = rules.deny.filter((rule) => matchRule(rule, args));
  if (deny.length > 0) {
    return {
      action: "deny",
      reasons: deny.map((rule) => rule.reason ?? rule.id),
      terminate: deny.some((rule) => rule.terminate === true),
    };
  }

  if (rules.allow.some((rule) => matchRule(rule, args))) {
    return { action: "allow", reasons: [], terminate: false };
  }

  const ask = rules.ask.filter((rule) => matchRule(rule, args));
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
export function decide(command: string, rules: GateRules): Verdict {
  const merged: Verdict = { action: "allow", reasons: [], terminate: false };

  for (const simple of tokenize(command)) {
    const verdict = decideOne(simple.argv, rules);
    for (const reason of verdict.reasons) {
      if (!merged.reasons.includes(reason)) merged.reasons.push(reason);
    }
    if (RANK[verdict.action] > RANK[merged.action]) merged.action = verdict.action;
    if (verdict.terminate) merged.terminate = true;
  }

  return merged;
}
