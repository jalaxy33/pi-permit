import type { Args } from "./argv";
import type { CompiledRule, CompileResult, Rule } from "./types";

function wildcardRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
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

    const names = Array.isArray(rule.program) ? rule.program : [rule.program];
    const entry: CompiledRule = { ...rule, programRes: names.filter((name) => name.includes("*")).map(wildcardRegex) };

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

function matchesProgram(rule: CompiledRule, program: string): boolean {
  const names = Array.isArray(rule.program) ? rule.program : [rule.program];
  if (names.some((name) => !name.includes("*") && name.replace(/^\//, "") === program)) return true;
  return (rule.programRes ?? []).some((re) => re.test(program));
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
