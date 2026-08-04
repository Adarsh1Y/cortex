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
- [x] Voice assistant mode — continuous listen-and-respond loop (`bun run voice`)
- [x] Daemon mode — headless background process with web dashboard, proactive voice, and reminders (`bun run daemon`)
- [x] Memory ops — JSON export/import, SQLite backup, optional AES-256-GCM encryption at rest
- [x] Memory compression — old sessions auto-summarized into compact digests
- [x] Fact TTL — facts can expire and be automatically deactivated
- [x] Session compression — sessions exceeding message limits are compressed into summaries

## Installation

### Prerequisites

- **Bun** (>= 1.3.14): JavaScript runtime
- **Node.js** (>= 18): For optional additional features

Install Bun:

```bash
# macOS
curl -fsSL https://bun.sh/install | bash

# Linux (Debian/Ubuntu)
curl -fsSL https://bun.sh/install | bash -s -- --yes

# Verify installation
bun --version
```

### Clone CORTEX

```bash
git clone https://github.com/Adarsh1Y/cortex.git
cd cortex
bun install
```

### Quick Start Commands

1. **Initialize CORTEX**:

```bash
cortex init
```

2. **Edit Configuration**:

```bash
cortex setup
```

3. **Start the Shell** (most common usage):

```bash
cortex dev
```

4. **Start the Dashboard**:

```bash
cortex web
```

5. **Start Background Daemon**:

```bash
cortex daemon
```

6. **Start Voice Assistant**:

```bash
cortex voice
```

## Quick Start

CORTEX comes with a simple CLI tool to get you started:

```bash
cortex init      # create initial config
cortex setup     # edit config
cortex dev       # start shell
cortex web       # start dashboard
cortex daemon    # start background daemon
cortex voice     # start voice assistant
```

Create an alias in your shell configuration to use the full path:

```bash
echo 'export PATH="$HOME/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
```

## Usage

### Commands

| Command          | Description |
|------------------|-------------|
| `/help`          | Show all commands |
| `/whoami`        | Show persona |
| `/status`        | Memory + system stats |
| `/model`         | List Ollama models or show current brain model |
| `/say <text>`    | Speak through the voice engine |
| `/voice`         | Report voice engine status |
| `/remind <spec> <text>` | Set a reminder: "in 30 minutes X", "at 14:00 X", "tomorrow at 09:00 X" |
| `/reminders`     | List pending reminders |
| `/remind cancel <id>` | Cancel a reminder |
| `/semantic <query>` | Semantic search across all memory |
| `/recall <query>` | Search past conversations |
| `/forget <query>` | Forget messages matching query |
| `/facts`         | List distilled facts |
| `/fact del <id>` | Permanently delete fact `id` |
| `/dream`         | Consolidate + dedupe stored facts |
| `/journal`       | Show CORTEX's life story |
| `/prefer <key> <val>` | Record a preference |
| `/allow <type>`  | Allow a tool type for this session |
| `/permissions`   | Show the tool permission policy |
| `/reindex`       | Rebuild the embedding index |
| `/export [dir]`  | Export all memory to JSON |
| `/import <file>` | Import a JSON memory bundle |
| `/backup`        | Snapshot the SQLite database |
| `/clear`         | Reset current session |
| `/exit`          | Leave |

### Running Modes

| Mode | What it does |
|------|-------------|
| `dev` | Interactive TUI with streaming markdown, commands, and TTS on replies |
| `web` | Dashboard only at `127.0.0.1:4040` — view memory, search, manage reminders |
| `daemon` | Headless background process — web dashboard, proactive voice (speaks when idle or reminded), and scheduled reminders. Logs to `~/.consciousness/daemon.log`, PID file at `~/.consciousness/daemon.pid`. Press Ctrl+C or `kill $(cat ~/.consciousness/daemon.pid)` to stop. |
| `voice` | Continuous voice loop — listens via microphone (ffmpeg + ALSA), transcribes with STT, responds through the brain, and speaks replies via TTS. Press Ctrl+C to stop. |

## Configuration

Edit `cortex.json` with your preferences:

```json
{
  "data_dir": "~/.consciousness",
  "brain": {
    "engine": "opencode",
    "model": "inherit",
    "server_timeout_ms": 60000,
    "base_url": "https://api.openai.com/v1",
    "api_key": "",
    "ollama_url": "http://127.0.0.1:11434"
  },
  "memory": {
    "episodic": true,
    "semantic": true,
    "recall_on_start": true,
    "recall_messages": 40,
    "max_recall_chars": 4000,
    "max_fact_chars": 1500,
    "semantic_recall": true,
    "embed_on_digest": true,
    "fact_ttl_ms": null,
    "compress_after_days": 30,
    "max_session_messages": 200
  },
  "embeddings": {
    "enabled": true,
    "engine": "transformers",
    "model": "Xenova/all-MiniLM-L6-v2"
  },
  "reminders": {
    "enabled": true,
    "check_interval_ms": 15000,
    "notify": "both"
  },
  "permissions": {
    "auto_allow": ["read", "ls", "grep", "glob", "webfetch", "bash:read"],
    "auto_deny": ["write", "edit"],
    "ask": false
  },
  "voice": {
    "tts_engine": "auto",
    "stt_engine": "off"
  },
  "security": {
    "encryption": false
  },
  "tui": {
    "enabled": true,
    "history_file": "~/.consciousness/history",
    "max_history": 500
  },
  "proactive": {
    "enabled": true,
    "idle_minutes": 10,
    "cooldown_minutes": 30,
    "check_interval_ms": 30000
  },
  "web": {
    "enabled": true,
    "port": 4040
  },
  "shell": {
    "prompt": "you > ",
    "welcome_message": true,
    "colors": true
  }
}
```

### Key Configuration Options

- **brain.engine**: Choose between "opencode", "openai", "anthropic", "ollama", or "mock"
- **brain.model**: Use "inherit" to follow the persona's preferences, or set a specific model
- **embeddings.engine**: "transformers" (offline), "ollama" (local), "openai", or "off"
- **security.encryption**: Enable AES-256-GCM encryption for data at rest

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

- **Brain layer**: Pluggable adapters (opencode, OpenAI, Anthropic, Ollama, Mock)
- **Memory core**: Hybrid system with SQLite for conversations, FTS5 for facts, and vector search for semantic recall
- **Embeddings**: Offline by default via transformers.js, with fallback to Ollama or OpenAI
- **Proactivity**: Speaks when idle or when reminders fire
- **Voice**: Pluggable TTS/STT engines with auto-detection
- **Security**: Optional AES-256-GCM encryption for sensitive data
- **Privacy**: All conversations and memories are local under `~/.consciousness/`

## Development

For development, you can run:

```bash
bun run dev     # Interactive shell
bun run web     # Dashboard
bun run daemon  # Background daemon
bun run voice   # Voice assistant
bun run test    # All tests
bun run typecheck # TypeScript checks
```

## License

MIT