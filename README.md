# CORTEX

A consciousness layer for CLI AI agents. CORTEX talks to you from the terminal, remembers everything across sessions, keeps a consistent personality — and now has real semantic memory, reminders, tools, voice, and more.

## Status

Phases 1–3 complete:

**Phase 1 (MVP)**
- [x] GitHub repo + SSH auth
- [x] Brain adapter (opencode SDK)
- [x] Episodic memory (full conversation recall, FTS5)
- [x] Persona / voice injection
- [x] REPL shell with colored streaming markdown

**Phase 2 (consciousness upgrade)**
- [x] Semantic memory: facts distilled from every conversation (LLM extraction + FTS5)
- [x] Life story: first-person journal entries + self-model injected as context
- [x] Consolidation ("dream"): dedupes and refreshes stored facts
- [x] Proactive engine: CORTEX speaks up when you've been idle
- [x] Web dashboard at `127.0.0.1:4040`

**Phase 3 (fullest extent)**
- [x] Vector embeddings for true semantic recall — offline via transformers.js (`all-MiniLM-L6-v2`), plus Ollama / OpenAI-compatible backends
- [x] Reminders / scheduled actions — natural-language `/remind`, persisted in SQLite, survive restarts
- [x] Tool access — CORTEX can run read-only tools (bash, file read, grep, webfetch) with a configurable permission policy
- [x] Multi-brain — pluggable engines: opencode, OpenAI, Anthropic, Ollama, mock
- [x] Rich TUI — raw-mode line editor, history, arrows/editing keys, Ctrl-R reverse search, tab completion
- [x] Desktop notifications (notify-send / osascript / PowerShell)
- [x] Voice — pluggable TTS/STT engines with auto-detection
- [x] Memory ops — JSON export/import, SQLite backup, optional AES-256-GCM encryption at rest

## Architecture

```
User <-> Shell (TUI) <-> Consciousness Core <-> Brain (pluggable)
                              |                      |  opencode / openai /
                              v                      v  anthropic / ollama
                         Memory (SQLite, local-first)
                              |
                              v
        Semantic engine (facts + journal) + Vector index (embeddings)
```

- **Brain layer**: pluggable adapters. Default is the opencode server via `@opencode-ai/sdk`; set `brain.engine` to `openai`, `anthropic`, `ollama`, or `mock`.
- **Memory core**: hybrid local-first — SQLite for full episodic history; facts distilled into FTS5; a vector index adds similarity search over messages and facts.
- **Embeddings**: offline by default (`transformers`), no API key. The model downloads once on first use and is cached.
- **Reminders**: `ReminderEngine` polls SQLite and fires due reminders through the terminal, desktop notifications, and TTS.
- **Tools**: `PermissionPolicy` auto-allows read-only tools from `cortex.json` and denies the rest. Add per-session exceptions with `/allow <type>`.
- **Encryption**: set `security.encryption: true` to transparently AES-256-GCM-encrypt message/fact/journal contents at rest (key in `CORTEX_KEY` env or a 0600 keyfile).
- **Privacy**: conversations and memories stay local under `~/.consciousness/` and are git-ignored. Only code, config, and persona are committed.

## Run

```bash
bun install
bun run dev        # shell
bun run web        # dashboard (set web.enabled: true in cortex.json to autostart)
```

## Commands

| Command          | Description |
| ---------------- | ----------- |
| `/recall q`      | Search past conversations (semantic when embeddings are on) |
| `/semantic q`    | Semantic memory search with similarity scores |
| `/forget q`      | Forget messages matching query |
| `/facts`         | List distilled facts |
| `/facts del i`   | Permanently delete fact `i` |
| `/dream`         | Consolidate + dedupe stored facts |
| `/journal`       | Show CORTEX's life story |
| `/prefer k v`    | Record a preference |
| `/remind spec`   | Set a reminder: `in 30 minutes X`, `at 14:00 X`, `tomorrow at 09:00 X` |
| `/reminders`     | List pending reminders |
| `/remind cancel i` | Cancel reminder `i` |
| `/say text`      | Speak through the voice engine |
| `/voice`         | Report voice engine status |
| `/allow type`    | Allow a tool type for this session |
| `/permissions`   | Show the tool permission policy |
| `/reindex`       | Rebuild the embedding index |
| `/export [dir]`  | Export all memory to JSON |
| `/import file`   | Import a JSON memory bundle |
| `/backup`        | Snapshot the SQLite database |
| `/clear`         | Reset current session |
| `/whoami`        | Show persona |
| `/status`        | Memory + system stats |
| `/help`          | Show help |
| `/exit`          | Leave |

## Config

Everything is in `cortex.json`. Notable sections:

```jsonc
{
  "brain":   { "engine": "opencode", "model": "inherit" },
  "embeddings": {
    "enabled": true,
    "engine": "transformers",          // transformers | ollama | openai | off
    "model": "Xenova/all-MiniLM-L6-v2"
  },
  "reminders":   { "enabled": true, "notify": "both" },
  "permissions": {
    "auto_allow": ["read", "ls", "grep", "glob", "webfetch", "bash:read"],
    "auto_deny":  ["write", "edit"],
    "ask": false
  },
  "voice": { "tts_engine": "off", "stt_engine": "off" },
  "security": { "encryption": false }
}
```

## License

MIT
