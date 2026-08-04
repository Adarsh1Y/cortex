# CORTEX

A consciousness layer for CLI AI agents. CORTEX talks to you from the terminal, remembers everything across sessions, and keeps a consistent personality - like Jarvis, minus the arc reactor.

## Status

MVP complete. Current scope:

- [x] GitHub repo + SSH auth
- [x] Brain adapter (opencode SDK)
- [x] Episodic memory (full conversation recall)
- [x] Persona / voice injection
- [x] REPL shell

## Architecture

```
User <-> Shell (REPL) <-> Consciousness Core <-> Brain (opencode)
                              |
                              v
                         Memory (SQLite, local-first)
```

- **Brain layer**: pluggable adapters. Primary is the opencode server via `@opencode-ai/sdk`.
- **Memory core**: hybrid local-first - SQLite for full episodic history; semantic/vector search planned.
- **Personality**: `persona.json` injected as the system prompt on every call.
- **Privacy**: conversations and memories stay local under `~/.consciousness/` and are git-ignored. Only code, config, and persona are committed.

## Run

```bash
bun install
bun run dev
```

## Commands

| Command      | Description                |
| ------------ | -------------------------- |
| `/recall q`  | Search past conversations  |
| `/forget id` | Forget a memory            |
| `/clear`     | Reset current session      |
| `/status`    | Memory stats               |
| `/whoami`    | Show persona               |
| `/exit`      | Leave                       |

## License

MIT
