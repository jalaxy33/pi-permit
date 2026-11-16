# pi-permit

Permission gate for pi. It decides, per tool call, whether a command or a file access may run, must be confirmed, or is blocked outright.

Three things it checks:

- **Commands** — every simple command in a bash string is tokenized into argv and matched against rules. Text inside heredocs, quotes or comments never matches.
- **Paths** — file tools (`read`, `write`, `edit`, `grep`, `find`, `ls`) and paths used by bash (arguments and redirections, including `sh -c` and `cd` tracking) are resolved to absolute paths and matched against path rules.
- **Outside the workspace** — anything outside the session `cwd` asks first, unless it is on the allow list.

## Install

Add the package to `~/.pi/agent/settings.json` (relative paths resolve from that file):

```json
{ "packages": ["./local-packages/pi-permit"] }
```

Then `/reload`. `/permit` prints the loaded rule counts and the files they came from.

## Keys

| Key | Action |
|---|---|
| `y` / `Enter` | allow once |
| `a` | allow this command or path for the session |
| `n` / `Esc` / `Ctrl+C` | deny (the turn continues) |
| `s` | deny and stop the turn |
| `j` / `k` / `↑` `↓` | scroll the command view |
| `o` | expand or collapse the command view |

Without a UI the gate fails closed: `ask` rules block.

## Configuration

| File | Scope |
|---|---|
| `~/.pi/agent/permit.json` | all projects |
| `<project>/.pi/permit.json` | one project (only after the project is trusted) |
| `policy/*.json` | shipped defaults; do not edit |

Every file may contain the same fields; later scopes win per rule id:

```json
{
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

Schemas ship with the package; point `$schema` at `…/pi-permit/schema.json` for editor completion.

### `defaultRules`

Which rule sets are active, in order. Each entry is a set name or a rule file path (`*.json`, relative to the file that lists it, or absolute, or `~/…`).

- `"name"` or `"+name"` enables a set.
- `"-name"` disables it, including its path rules.
- Later entries override earlier ones by rule id.

Defaults are declared in `policy/manifest.json`: `["deny", "basic", "strict"]`.

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
| `program` | program basename, or a list; `*` wildcard allowed (`mkfs.*`) |
| `args` | matches when any of these is a positional argument |
| `anyFlag` / `allFlags` / `unlessFlag` | flag conditions; `-rf` is expanded to `-r` and `-f` |
| `argvRegex` | regex over the joined argv of one command (no raw shell text) |
| `reason` | shown in the prompt and in block messages |
| `terminate` | for `deny`: end the turn instead of letting the agent retry |

Rules live under `deny`, `ask` or `allow`. `deny` wins over `allow`, and `allow` wins over `ask`.

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
| `protection` | `block` (default) or `read-only` (writes only) |
| `ops` | which operations the rule covers; default all |
| `onlyIfExists` | protect existing files only; default `false` |
| `message` | block message |

Symlinks are matched by both the literal and the resolved path.

### `outsideCwd`

| Field | Meaning |
|---|---|
| `mode` | `ask` (default), `block`, `allow` |
| `allowPaths` | extra globs allowed outside the workspace |

Built-in allow list: `/tmp/**`, `/dev/**`, `~/.pi/agent/**`, `~/.cache/**`, `~/.bun/**`, `~/.npm/**`, `~/.local/share/**`.

## Shipped sets

| Set | Contents |
|---|---|
| `deny` | git history rewriting, `reflog expire`, `gc --prune=now` |
| `basic` | rare but unrecoverable: `rm -r`, `sudo`, `dd of=`, `mkfs*`, `wipefs`, `fdisk`, `shred`, `chmod -R 777`, `chown -R`, privileged containers; plus `.env` and private key files |
| `strict` | git workflow, `rsync --delete`, bulk deletes, `truncate`, databases, terraform/kubectl/helm, docker volumes, publishing |

Drop `strict` for a quiet setup: `"defaultRules": ["-strict"]`.

## Limits

This is a guard, not a sandbox.

- Paths built by a program at runtime are invisible: `python -c "open('.env')"` passes.
- `$VAR` operands can only be matched by basename (`.env`), not by directory.
- Glob operands are expanded before matching, so `cat .env*` is caught, but only for files that exist.
- Heredoc bodies and comments are ignored on purpose; text that is not a command never matches.

## Development

```bash
bun test          # 120 cases: tokenizer, argv, matching, config sets, paths, prompt, schema
```

Test-only symlinks for `pi-tui`, `pi-coding-agent`, `ajv` live in `node_modules/` and are gitignored.
