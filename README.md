# pi-permit

A permission gate for pi. Every tool call gets one of three answers: run it, ask the user, or block it.

It looks at three things, in this order:

1. **Protected paths** — file tools and bash commands are resolved to absolute paths and matched against path rules. A match blocks, without asking.
2. **Paths outside the workspace** — anything outside the session `cwd` asks first, unless it is on the allow list.
3. **Commands** — each simple command in a bash string is tokenized into argv and matched against command rules. Text inside heredocs, quotes and comments is never matched.

## Install

```bash
pi install npm:@jalaxy33/pi-permit
```

Or from the repository: `pi install git:github.com/jalaxy33/pi-permit` (pin a ref with `@<tag-or-commit>`). For a local checkout: `pi install ./pi-permit`.

Then run `/reload`. To check what was loaded, run `/permit`: it lists the rule counts and the files they came from. `/permit:reload` re-reads the config without restarting pi.

## Keys

| Key | Action |
|---|---|
| `y` / `Enter` | allow once |
| `a` | allow this command or path for the rest of the session |
| `n` / `Esc` / `Ctrl+C` | deny; the turn continues |
| `s` | deny and stop the turn |
| `j` / `k` / `↑` / `↓` · `o` | scroll · expand the command view |

Without a UI the gate fails closed: a command that would ask is blocked instead.

## Configuration

Two files are yours to edit:

| File | Scope |
|---|---|
| `~/.pi/agent/permit.json` | all projects |
| `<project>/.pi/permit.json` | one project, only after the project is trusted |

Rules from the shipped sets apply first, then global, then project. Within a file, a later rule with the same `id` replaces an earlier one.

```json
{
  "$schema": "https://raw.githubusercontent.com/jalaxy33/pi-permit/main/schema.json",
  "defaultRules": ["deny", "basic", "-strict"],
  "commands": {
    "ask": [{ "id": "git-push", "program": "git", "args": ["push"], "reason": "updates the remote" }]
  },
  "paths": [
    { "id": "my-env", "patterns": [".env"], "except": [".env.example"], "protection": "block" }
  ],
  "outsideCwd": { "mode": "ask", "allowPaths": ["~/work/shared/**"] }
}
```

`defaultRules` picks which sets are active: `"name"` or `"+name"` enables one, `"-name"` disables one, and a `*.json` path loads a rule file. Later entries win on a shared `id`. The shipped default is `["deny", "basic", "strict"]`.

Field-by-field reference, matching rules and shipped set contents: [docs/configuration.md](docs/configuration.md).

## Shipped rule sets

| Set | File | Contents |
|---|---|---|
| `deny` | [`policy/deny.json`](policy/deny.json) | git history rewriting, `reflog expire`, `gc --prune=now` |
| `basic` | [`policy/basic.json`](policy/basic.json) | rare but unrecoverable damage: `rm -r`, `sudo`, `dd of=`, `mkfs*`, `wipefs`, `fdisk`, `shred`, `chmod -R 777`, `chown -R`, privileged containers; plus `.env` and private key files |
| `strict` | [`policy/strict.json`](policy/strict.json) | git workflow, `rsync --delete`, bulk deletes, `truncate`, databases, terraform/kubectl/helm, docker volumes, publishing |

For a quiet setup, drop the last set: `"defaultRules": ["-strict"]`.

## Limits

A guard, not a sandbox. It reads the command text and the paths in it; anything a program resolves on its own is out of reach.

- `python -c "open('.env')"` passes.
- `$VAR` operands match by basename only (`.env`), not by directory.
- Glob operands are expanded before matching, so `cat .env*` is caught only for files that exist.
- Shell aliases, functions and `eval` are not expanded.

## Development

```bash
bun test              # 133 cases
bun test test/gate.test.ts
```

`pi-tui`, `pi-coding-agent` and `ajv` resolve from symlinks in `node_modules/`, which is gitignored. The package itself declares `pi-tui` and `pi-coding-agent` as peer dependencies; pi provides them at runtime.

## Similar extensions

pi has no built-in permission system. Related packages, in the spirit of pi's [packages registry](https://pi.dev/packages):

- [`@aliou/pi-guardrails`](https://pi.dev/packages/%40aliou/pi-guardrails) — same three checks plus a settings UI, onboarding, example rule library, migrations, and decision delegation.
- [`@gotgenes/pi-permission-system`](https://pi.dev/packages/%40gotgenes/pi-permission-system) — broad permission enforcement across tool calls.
- [`@vtstech/pi-security`](https://pi.dev/packages/%40vtstech/pi-security) — command, path, network and audit controls.
- [`@casualjim/pi-heimdall`](https://pi.dev/packages/%40casualjim/pi-heimdall) — secret exposure guards, command policies and `.env` protection.
- [pi-sandbox](https://pi.dev/packages/pi-sandbox) — OS-level sandboxing for bash, with allow and deny lists.

Run one gate at a time: pi stops at the first `tool_call` handler that blocks, so overlapping gates shadow each other.

## License

MIT
