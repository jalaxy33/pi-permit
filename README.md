# pi-permit

A permission gate for pi. Every tool call gets one of three answers: run it, ask the user, or block it.

It looks at three things, in this order:

1. **Protected paths** — file tools and bash commands are resolved to absolute paths and matched against path rules. A match blocks, without asking.
2. **Paths outside the workspace** — anything outside the session `cwd` asks first, unless it is on the allow list.
3. **Commands** — each simple command in a bash string is tokenized into argv and matched against command rules. Text inside heredocs, quotes and comments is never matched.

## Install

Add the package to `~/.pi/agent/settings.json`. Relative paths resolve from that file:

```json
{ "packages": ["./local-packages/pi-permit"] }
```

Then run `/reload`. To check what was loaded, run `/permit`: it lists the rule counts and the files they came from. `/permit:reload` re-reads the config without restarting pi.

## Keys

| Key | Action |
|---|---|
| `y` / `Enter` | allow once |
| `a` | allow this command or path for the rest of the session |
| `n` / `Esc` / `Ctrl+C` | deny; the turn continues |
| `s` | deny and stop the turn |
| `j` / `k` / `↑` / `↓` | scroll the command view |
| `o` | expand or collapse the command view |

Without a UI the gate fails closed: a command that would ask is blocked instead.

## Configuration

| File | Scope |
|---|---|
| `~/.pi/agent/permit.json` | all projects |
| `<project>/.pi/permit.json` | one project, only after the project is trusted |
| `policy/*.json` | shipped rule sets; do not edit |

All of them use the same fields. Priority, lowest to highest: shipped policy, then global, then project. Within a file, later rules replace earlier ones with the same `id`.

```json
{
  "$schema": "/home/you/.pi/agent/local-packages/pi-permit/schema.json",
  "enabled": { "commands": true, "paths": true },
  "defaultRules": ["deny", "basic", "strict", "./rules/mine.json"],
  "sets": { "mine": "./rules/mine.json" },
  "commands": {
    "ask": [{ "id": "git-push", "program": "git", "args": ["push"], "reason": "updates the remote" }]
  },
  "paths": [
    { "id": "my-env", "patterns": [".env"], "except": [".env.example"], "protection": "block" }
  ],
  "outsideCwd": { "mode": "ask", "allowPaths": ["~/work/shared/**"] }
}
```

The package ships a JSON schema; point `$schema` at it (absolute path, as above) to get field completion and early warnings in your editor.

### `defaultRules`

Which rule sets are active, and in what order. Each entry is a set name or a path to a rule file.

- `"name"` or `"+name"` enables a set. `"-name"` disables it.
- A path (`*.json`) loads its rules. Paths resolve relative to the file that lists them, or from `~/` and `/`.
- Later entries win on a shared `id`, including across `deny`, `ask` and `allow`.

The shipped default is `["deny", "basic", "strict"]`, declared in `policy/manifest.json`.

### Command rules

```json
{
  "id": "git-reset-hard",
  "program": "git",
  "args": ["reset"],
  "allFlags": ["--hard"],
  "reason": "discards uncommitted work",
  "terminate": true
}
```

| Field | Meaning |
|---|---|
| `program` | program basename, or a list; `*` wildcard is allowed (`mkfs.*`) |
| `args` | matches when any of these is a positional argument |
| `anyFlag` / `allFlags` / `unlessFlag` | flag conditions; `-rf` is read as `-r` and `-f` |
| `argvRegex` | regex over the joined argv of one command, never over raw shell text |
| `reason` | shown in the prompt and in block messages |
| `terminate` | `deny` only: end the turn instead of letting the agent retry |

Rules live under `deny`, `ask` or `allow`. A `deny` rule wins over `allow`, and `allow` wins over `ask`.

### Path rules

```json
{
  "id": "secrets-env",
  "patterns": [".env", ".env.*"],
  "except": [".env.example"],
  "protection": "block",
  "ops": ["read", "write", "delete"],
  "onlyIfExists": false,
  "message": "ask the user to handle .env files"
}
```

| Field | Meaning |
|---|---|
| `patterns` | no slash: basename anywhere; `~` or `/`: absolute; otherwise relative to the project |
| `except` | patterns that cancel the rule |
| `protection` | `block` (default) or `read-only`, which only blocks writes and deletes |
| `ops` | operations the rule covers; default all three |
| `onlyIfExists` | protect existing files only; default `false` |
| `message` | text returned when blocked |

Path rules always block; they never prompt. Matching uses the resolved absolute path, and a symlink is matched by both its literal and its real path.

Bash paths are collected from redirections, command arguments (`cat`, `rm`, `cp`, `sed -i`, and similar), nested `sh -c "…"`, and after each `cd` in the same command string.

### `outsideCwd`

| Field | Meaning |
|---|---|
| `mode` | `ask` (default), `block`, `allow` |
| `allowPaths` | extra globs allowed outside the workspace |

Built-in allow list: `/tmp/**`, `/dev/**`, `~/.pi/agent/**`, `~/.cache/**`, `~/.bun/**`, `~/.npm/**`, `~/.local/share/**`.

### `enabled`

`{ "commands": true, "paths": true }` by default. Turning `paths` off skips the protected-path rules; the outside-workspace gate is controlled by `outsideCwd` alone.

## Shipped rule sets

| Set | Contents |
|---|---|
| `deny` | git history rewriting, `reflog expire`, `gc --prune=now` |
| `basic` | rare but unrecoverable damage: `rm -r`, `sudo`, `dd of=`, `mkfs*`, `wipefs`, `fdisk`, `shred`, `chmod -R 777`, `chown -R`, privileged containers; plus `.env` and private key files |
| `strict` | git workflow, `rsync --delete`, bulk deletes, `truncate`, databases, terraform/kubectl/helm, docker volumes, publishing |

For a quiet setup, drop the last set: `"defaultRules": ["-strict"]`.

## Limits

This is a guard, not a sandbox.

- Paths a program builds at runtime are invisible: `python -c "open('.env')"` passes.
- `$VAR` operands can only be matched by basename (`.env`), not by directory.
- Glob operands are expanded before matching, so `cat .env*` is caught, but only for files that exist.
- Shell aliases, functions and `eval` are not expanded.

## Development

```bash
bun test              # 133 cases
bun test test/gate.test.ts
```

Test-only symlinks for `pi-tui`, `pi-coding-agent` and `ajv` live in `node_modules/` and are gitignored.
