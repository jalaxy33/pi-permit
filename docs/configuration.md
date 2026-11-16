# Configuration reference

Everything pi-permit reads lives in JSON. Nothing here is written back by the plugin.

## Files and precedence

| File | Scope |
|---|---|
| `~/.pi/agent/permit.json` | all projects |
| `<project>/.pi/permit.json` | one project, only after the project is trusted |

Those are the only files you edit. The rule sets shipped inside the package (`policy/` next to `index.ts`) are the starting point; treat them as read-only and override them by `id` or switch them off with `-name` in `defaultRules`.

Priority, lowest to highest: shipped sets, global, project. Within one file, a later rule with the same `id` replaces an earlier one; across files the higher scope wins.

Config is read at extension load and on `session_start`. Use `/permit:reload` after editing.

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
- Disabling a set and enabling it again moves it to the end.
- The shipped default is `["deny", "basic", "strict"]`, declared in `policy/manifest.json`.
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
- `--` ends flag parsing; later tokens are positional.
- Leading `VAR=value` assignments are skipped when finding the program.
- Options that take a value (`git -C dir`, `git -c k=v`) stay positional, so `args` still sees the subcommand.
- One command string can contain several simple commands (`&&`, `;`, `|`, substitutions); each is matched, and the strictest verdict wins.
- Precedence inside one simple command: `deny` → `allow` → `ask` → allow by default.

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

Where bash paths come from:

- redirections (`> file`, `>> file`, `< file`);
- arguments of known programs: reads (`cat`, `head`, `grep`, `less`, `awk`, …), writes (`tee`, `truncate`, `chmod`, …), deletes (`rm`, `unlink`, `shred`), source/destination pairs (`cp`, `mv`, `rsync`), `sed -i`;
- unknown programs: path-looking arguments are treated as reads;
- nested `sh -c "…"` (up to three levels);
- each `cd` updates the directory used for later commands in the same string.

Glob arguments are expanded before matching, so `cat .env*` is caught. `$VAR` operands cannot be resolved; the literal basename is matched instead.

## `outsideCwd`

```json
{ "outsideCwd": { "mode": "ask", "allowPaths": ["~/work/shared/**"] } }
```

| Field | Meaning |
|---|---|
| `mode` | `ask` (default), `block`, `allow` |
| `allowPaths` | extra globs allowed outside the workspace; relative patterns compare against the project |

Built-in allow list: `/tmp/**`, `/dev/**`, `~/.pi/agent/**`, `~/.cache/**`, `~/.bun/**`, `~/.npm/**`, `~/.local/share/**`.

The check runs for file tools and for bash paths, after protected-path rules and before command rules. "Allow for this session" remembers the path, not the command.

## Shipped rule sets

| Set | File | Contents |
|---|---|---|
| `deny` | `policy/deny.json` | git history rewriting, `reflog expire`, `gc --prune=now` |
| `basic` | `policy/basic.json` | `rm -r`, `sudo`, `dd of=`, `mkfs*`, `wipefs`, `blkdiscard`, `fdisk`/`parted`, `shred`, `chmod -R 777`, `chown -R`, privileged containers; plus `.env` and private key paths |
| `strict` | `policy/strict.json` | git add/commit/push/merge, `reset --hard`, discard, `clean`, branch/tag/stash/worktree deletion, `rsync --delete`, `find -delete`, `xargs rm`, `truncate`, databases, terraform/kubectl/helm, docker volumes, publishing; allows `git push --force-with-lease` |

## Schema

`schema.json` in the package root validates all of the above, with `additionalProperties: false`, so a misspelled field is reported instead of silently ignored. Point `$schema` at the installed copy or at the repository copy.

## Warnings

Problems in a config file are reported as notifications at load time and listed by `/permit`:

- invalid JSON in a user file: that file is skipped;
- unknown set name: skipped;
- bad `argvRegex`: the rule is dropped and named in the warning;
- a `deny` rule overridden by `ask` or `allow`: reported, since the safety floor just moved;
- the shipped `policy/manifest.json` unreadable: the gate blocks every gated tool call with that path in the message.
