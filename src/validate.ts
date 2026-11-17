import { SECTIONS } from "./types";

/**
 * Field names the loader reads. The lists mirror schema.json;
 * test/schema.test.ts compares both sides.
 */
export const FIELDS = {
  root: ["$schema", "description", "enabled", "defaultRules", "sets", "commands", "paths", "outsideCwd"],
  enabled: ["commands", "paths"],
  outside: ["mode", "allowPaths"],
  commands: SECTIONS,
  rule: ["id", "program", "args", "anyFlag", "allFlags", "unlessFlag", "argvRegex", "reason", "terminate"],
  pathRule: ["id", "patterns", "except", "protection", "ops", "onlyIfExists", "message"],
  set: ["description", "deny", "ask", "allow", "paths"],
} as const;

type Json = Record<string, unknown>;

export function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function reportUnknown(
  value: unknown,
  allowed: readonly string[],
  path: string,
  label: string,
  warnings: string[],
): void {
  if (!isObject(value)) return;
  for (const key of Object.keys(value)) {
    if (allowed.includes(key)) continue;
    warnings.push(`${path}: unknown field "${label ? `${label}.` : ""}${key}"`);
  }
}

function checkList(
  value: unknown,
  allowed: readonly string[],
  path: string,
  label: string,
  warnings: string[],
): void {
  if (!Array.isArray(value)) return;
  value.forEach((item, index) => reportUnknown(item, allowed, path, `${label}[${index}]`, warnings));
}

/** Warns once per field name the loader would silently drop. */
export function checkFields(file: unknown, path: string, warnings: string[]): void {
  if (!isObject(file)) return;

  reportUnknown(file, FIELDS.root, path, "", warnings);
  reportUnknown(file.enabled, FIELDS.enabled, path, "enabled", warnings);
  reportUnknown(file.outsideCwd, FIELDS.outside, path, "outsideCwd", warnings);

  if (isObject(file.commands)) {
    reportUnknown(file.commands, FIELDS.commands, path, "commands", warnings);
    for (const section of SECTIONS) {
      checkList(file.commands[section], FIELDS.rule, path, `commands.${section}`, warnings);
    }
  }

  checkList(file.paths, FIELDS.pathRule, path, "paths", warnings);

  if (!isObject(file.sets)) return;
  for (const [name, set] of Object.entries(file.sets)) {
    if (typeof set === "string") continue;
    reportUnknown(set, FIELDS.set, path, `sets.${name}`, warnings);
    if (!isObject(set)) continue;
    for (const section of SECTIONS) {
      checkList(set[section], FIELDS.rule, path, `sets.${name}.${section}`, warnings);
    }
    checkList(set.paths, FIELDS.pathRule, path, `sets.${name}.paths`, warnings);
  }
}
