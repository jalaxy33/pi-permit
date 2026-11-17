# pi-permit

A permission gate for pi. Every tool call gets one of three answers: run it, ask the user, or block it.

It looks at three things, in this order:

1. **Protected paths** — file tools and bash paths are matched against path rules. A match blocks, without asking.
2. **Writes outside the workspace** — a write or delete outside the session `cwd` asks first, unless the path is on the allow list.
3. **Commands** — each command in a bash string is matched against command rules. Text inside heredocs, quotes and comments is never matched.

## Install

```bash
pi install npm:@jalaxy33/pi-permit
```

From the repository:

```bash
pi install git:github.com/jalaxy33/pi-permit
```

Then run `/reload`.

## Keys

| Key | Action |
|---|---|
| `y` / `Enter` | allow once |
| `a` | allow this rule with these flags, or this directory, for the rest of the session |
| `n` / `Esc` / `Ctrl+C` | deny; the turn continues |
| `s` | deny and stop the turn |
| `j` / `k` / `↑` / `↓` · `o` | scroll · expand the command view |

Without a UI the gate fails closed: a command that would ask is blocked instead.

## Commands

| Command | Action |
|---|---|
| `/permit` | show the loaded rules, their sources, session grants and warnings |
| `/permit:reload` | re-read the config without restarting pi |

## Configuration

Two files are yours to edit:

| File | Scope |
|---|---|
| `~/.pi/agent/permit.json` | all projects |
| `<project>/.pi/permit.json` | one project, only after the project is trusted |

Shipped rules apply first, then global, then project; a later rule with the same `id` replaces an earlier one.

```json
{
  "commands": {
    "allow": [
      { "id": "git-add", "program": "git", "args": ["add"] },
      { "id": "git-commit", "program": "git", "args": ["commit"] }
    ]
  },
  "paths": [
    { "id": "my-env", "patterns": [".env"], "except": [".env.example"], "protection": "block" }
  ],
  "outsideCwd": { "allowPaths": ["~/work/shared/**"] }
}
```

Both `allow` rules reuse shipped ids, so they replace the `strict` set's asks for `git add` and `git commit`. A path rule blocks a file; `allowPaths` stops the out-of-workspace prompt for a folder. `defaultRules` switches a whole shipped set on or off.

Field-by-field reference and matching rules: [docs/configuration.md](docs/configuration.md).

## Shipped rule sets

| Set | File | Contents |
|---|---|---|
| `deny` | [`policy/deny.json`](policy/deny.json) | git history rewriting, `reflog expire`, `gc --prune=now` |
| `basic` | [`policy/basic.json`](policy/basic.json) | rare but unrecoverable damage: `rm -r`, `sudo`, `dd of=`, `mkfs*`, `wipefs`, `fdisk`, `shred`, `chmod -R 777`, `chown -R`, privileged containers; plus `.env` and private key files |
| `strict` | [`policy/strict.json`](policy/strict.json) | git workflow, `rsync --delete`, bulk deletes, `truncate`, databases, terraform/kubectl/helm, docker volumes, publishing |

For a quiet setup, turn off the `strict` set:

```json
{ "defaultRules": ["-strict"] }
```

## Limits

A guard, not a sandbox. It sees the command text and the paths in it, so anything a program resolves on its own is out of reach.

- `python -c "open('.env')"` passes.
- Shell aliases, functions and `eval` are not expanded.
- Reads outside the workspace are not gated: a path rule is the only check on what the agent may read.

## Development

```bash
bun test
```

`pi-tui`, `pi-coding-agent` and `ajv` come from symlinks in `node_modules/`. The first two are peer dependencies that pi provides at runtime.

## Similar extensions

- [`@aliou/pi-guardrails`](https://pi.dev/packages/%40aliou/pi-guardrails): which inspires this plugin.
