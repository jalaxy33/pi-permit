# Configuration reference

All config is JSON.

## Files and precedence

| File | Scope |
|---|---|
| `~/.pi/agent/permit.json` | all projects |
| `<project>/.pi/permit.json` | one project, only after the project is trusted |

Shipped sets apply first, then global, then project. Within one file, a later rule with the same `id` replaces an earlier one. The shipped `policy/` files are read-only: override a rule by `id`, or switch a set off in `defaultRules`.

Config is re-read on session start; `/permit:reload` reloads it without restarting pi.

## `enabled`

```json
{ "enabled": { "commands": true, "paths": true } }
```

Both default to `true`. Turning `paths` off skips protected-path rules but leaves `outsideCwd` active; that gate has its own `mode`.

## `defaultRules`

Which rule sets are active, and in what order.

```json
{ "defaultRules": ["deny", "basic", "-strict", "./rules/mine.json"] }
```

| Entry | Meaning |
|---|---|
| `"name"` or `"+name"` | enable the set called `name` |
| `"-name"` | disable that set, including its path rules |
| `"./file.json"`, `"/abs/file.json"`, `"~/file.json"` | load a rule file; relative paths resolve from the file that lists them |

- Order matters: later entries replace earlier rules with the same `id`, across `deny`, `ask` and `allow`.
- The shipped default is `["deny", "basic", "strict"]`.
- A user file's `defaultRules` is appended to the shipped list, so `["-strict"]` alone is enough to drop a set.

## `sets`

Named sets, so `defaultRules` can refer to them. A set is either a rule file path or inline rules.

```json
{
  "sets": {
    "mine": "./rules/mine.json",
    "inline": { "description": "quick tweaks", "ask": [{ "id": "x", "program": "x" }] }
  }
}
```

A rule file has the same shape as `permit.json` minus `enabled` and `outsideCwd`: `commands` and `paths`, plus an optional `description`.

## Command rules

```json
{
  "commands": {
    "deny": [{ "id": "git-history", "program": "git", "args": ["filter-repo"], "terminate": true }],
    "ask": [{ "id": "git-push", "program": "git", "args": ["push"], "reason": "updates the remote" }],
    "allow": [{ "id": "push-lease", "program": "git", "args": ["push"], "argvRegex": "--force-with-lease" }]
  }
}
```

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | identity for overrides and diagnostics |
| `program` | yes | program basename, or a list; `*` wildcard allowed (`mkfs.*`) |
| `args` | no | matches when any of these is a positional argument |
| `anyFlag` | no | matches when any of these flags is present |
| `allFlags` | no | matches only when all of these flags are present |
| `unlessFlag` | no | never matches when any of these flags is present |
| `argvRegex` | no | regex over the joined argv of one simple command |
| `reason` | no | shown in the prompt and in block messages |
| `terminate` | no | `deny` only: end the turn instead of letting the agent retry |

Matching notes:

- `-rf` is expanded to `-r` and `-f`; `--hard` is also available as `hard`.
- An option that takes a value stays positional, so `args` still sees the subcommand (`git -C dir push`).
- One string can hold several commands (`&&`, `;`, `|`, substitutions); the strictest verdict wins.
- Precedence inside one simple command: `deny` → `allow` → `ask` → allow by default.
- "Allow for this session" remembers the rule and the flags: after allowing `rm -r build`, `rm -r dist` runs without asking, while `rm -rf dist` asks again. A deny rule still blocks a granted command.

## Path rules

```json
{
  "paths": [
    {
      "id": "secrets-env",
      "patterns": [".env", ".env.*"],
      "except": [".env.example"],
      "protection": "block",
      "ops": ["read", "write", "delete"],
      "onlyIfExists": false,
      "message": "ask the user to handle .env files"
    }
  ]
}
```

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | identity for overrides and messages |
| `patterns` | yes | globs; matching rules below |
| `except` | no | patterns that cancel the rule |
| `protection` | no | `block` (default) or `read-only`, which only blocks writes and deletes |
| `ops` | no | operations covered: `read`, `write`, `delete`; default all three |
| `onlyIfExists` | no | protect existing files only; default `false` |
| `message` | no | text returned when the rule blocks |

Path rules always block; they never prompt.

Matching:

| Pattern | Compared against |
|---|---|
| no slash (`.env`, `*.pem`) | the basename, at any depth |
| starts with `~` or `/` | the absolute path |
| anything else (`config/*.yml`) | the path relative to the project root |

- The target is resolved to an absolute path first: `~` expanded, `..` normalized.
- If the path exists, its real path is matched as well, so symlinks do not bypass a rule.
- `*` does not cross `/`; `**` does.

For bash commands the gate reads redirections, path arguments of known programs, path-looking arguments of unknown ones, `sed -i`, and nested `sh -c` (three levels); `cd` inside the string changes the directory for later commands. Globs are expanded before matching, so `cat .env*` is caught for files that exist; `$VAR` operands match by basename only.

## `outsideCwd`

```json
{ "outsideCwd": { "mode": "ask", "allowPaths": ["~/work/shared/**"] } }
```

| Field | Meaning |
|---|---|
| `mode` | what writes and deletes outside the workspace do: `ask` (default), `block`, `allow` |
| `allowPaths` | extra globs allowed outside the workspace; relative patterns compare against the project |

Built-in allow list: `/tmp/**`, `/dev/**`, `~/.pi/agent/**`, `~/.cache/**`, `~/.bun/**`, `~/.npm/**`, `~/.local/share/**`.

Only writes and deletes are checked. Reads outside the workspace are not gated, and `mode: block` does not stop them either; use a path rule for files that must never be read.

"Allow for this session" remembers the directory of the approved path, including everything below it.

## Shipped rule sets

The three sets and what they gate: [README](../README.md#shipped-rule-sets).

## Schema

`$schema` is optional and only helps editors. The loader reports field names it does not read as warnings.

## Warnings

Problems in a config file are reported as notifications at load time and listed by `/permit`:

- invalid JSON in a user file: that file is skipped;
- unknown field name: reported and ignored by the loader;
- unknown set name: skipped;
- bad `argvRegex`: the rule is dropped and named in the warning;
- a `deny` rule overridden by `ask` or `allow`: reported, since the safety floor just moved.
