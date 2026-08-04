# CORTEX

A consciousness layer for CLI AI agents. CORTEX talks to you from the terminal, remembers everything across sessions, and keeps a consistent personality - like Jarvis, minus the arc reactor.

## Status

Phase 1 (MVP) and Phase 2 (consciousness upgrade) complete. Current scope:

- [x] GitHub repo + SSH auth
- [x] Brain adapter (opencode SDK)
- [x] Episodic memory (full conversation recall, FTS5)
- [x] Persona / voice injection
- [x] REPL shell with colored streaming markdown
- [x] Semantic memory: facts distilled from every conversation (LLM extraction + FTS5)
- [x] Life story: first-person journal entries + self-model injected as context
- [x] Consolidation ("dream"): dedupes and refreshes stored facts
- [x] Proactive engine: CORTEX speaks up when you've been idle
- [x] Web dashboard: browse facts / journal / sessions at `127.0.0.1:4040`

Planned:

- [ ] Vector embeddings for true semantic recall
- [ ] Reminders / scheduled actions
- [ ] Voice interface

## Architecture

```
User <-> Shell (REPL) <-> Consciousness Core <-> Brain (opencode)
                              |
                              v
                         Memory (SQLite, local-first)
                              |
                              v
                    Semantic engine (facts + journal)
```

- **Brain layer**: pluggable adapters. Primary is the opencode server via `@opencode-ai/sdk`.
- **Memory core**: hybrid local-first - SQLite for full episodic history; facts distilled into FTS5 for fast retrieval.
- **Semantic engine**: on session close CORTEX reflects and distills durable facts + a journal entry. `/dream` consolidates and dedupes.
- **Personality**: `persona.json` injected as the system prompt on every call.
- **Privacy**: conversations and memories stay local under `~/.consciousness/` and are git-ignored. Only code, config, and persona are committed.

## Run

```bash
bun install
bun run dev        # shell
bun run web        # dashboard (set web.enabled: true in cortex.json to autostart)
```

## Commands

| Command        | Description                        |
| -------------- | ---------------------------------- |
| `/recall q`    | Search past conversations          |
| `/forget q`    | Forget messages matching query     |
| `/facts`       | List distilled facts               |
| `/facts del i` | Permanently delete fact `i`        |
| `/dream`       | Consolidate + dedupe stored facts  |
| `/journal`     | Show CORTEX's life story           |
| `/prefer k v`  | Record a preference                |
| `/clear`       | Reset current session              |
| `/status`      | Memory stats                       |
| `/whoami`      | Show persona                       |
| `/exit`        | Leave                              |

## License

MIT
