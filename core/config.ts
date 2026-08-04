import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export interface CortexConfig {
  data_dir: string;
  brain: {
    engine: "opencode" | "openai" | "anthropic" | "ollama" | "mock" | string;
    model: string;
    server_timeout_ms: number;
    base_url?: string;
    api_key?: string;
    ollama_url?: string;
  };
  memory: {
    episodic: boolean;
    semantic: boolean;
    recall_on_start: boolean;
    recall_messages: number;
    max_recall_chars: number;
    max_fact_chars: number;
    semantic_recall: boolean;
    embed_on_digest: boolean;
    fact_ttl_ms: number | null;
    compress_after_days: number;
    max_session_messages: number;
  };
  embeddings: {
    enabled: boolean;
    engine: "transformers" | "ollama" | "openai" | "off";
    model: string;
    ollama_url: string;
    openai_base_url: string;
    openai_api_key?: string;
    openai_model: string;
    batch_size: number;
  };
  reminders: {
    enabled: boolean;
    check_interval_ms: number;
    notify: "terminal" | "desktop" | "both";
  };
  permissions: {
    auto_allow: string[];
    auto_deny: string[];
    ask: boolean;
  };
  notify: {
    enabled: boolean;
    command?: string;
  };
  voice: {
    tts_engine: "off" | "auto" | "espeak" | "edge-tts" | "command";
    tts_command?: string;
    stt_engine: "off" | "openai" | "command";
    stt_command?: string;
    openai_api_key?: string;
  };
  security: {
    encryption: boolean;
    keyfile?: string;
    key_env?: string;
  };
  tui: {
    enabled: boolean;
    history_file: string;
    max_history: number;
  };
  proactive: {
    enabled: boolean;
    idle_minutes: number;
    cooldown_minutes: number;
    check_interval_ms: number;
  };
  web: {
    enabled: boolean;
    port: number;
  };
  shell: {
    prompt: string;
    welcome_message: boolean;
    colors: boolean;
  };
  persona_path?: string;
}

const DEFAULTS: CortexConfig = {
  data_dir: "~/.consciousness",
  brain: {
    engine: "opencode",
    model: "inherit",
    server_timeout_ms: 60000,
    base_url: "https://api.openai.com/v1",
    api_key: "",
    ollama_url: "http://127.0.0.1:11434",
  },
  memory: {
    episodic: true,
    semantic: true,
    recall_on_start: true,
    recall_messages: 40,
    max_recall_chars: 4000,
    max_fact_chars: 1500,
    semantic_recall: true,
    embed_on_digest: true,
    fact_ttl_ms: null,
    compress_after_days: 30,
    max_session_messages: 200,
  },
  embeddings: {
    enabled: true,
    engine: "transformers",
    model: "Xenova/all-MiniLM-L6-v2",
    ollama_url: "http://127.0.0.1:11434",
    openai_base_url: "https://api.openai.com/v1",
    openai_api_key: "",
    openai_model: "text-embedding-3-small",
    batch_size: 16,
  },
  reminders: {
    enabled: true,
    check_interval_ms: 15_000,
    notify: "both",
  },
  permissions: {
    auto_allow: [],
    auto_deny: [],
    ask: false,
  },
  notify: {
    enabled: true,
    command: "",
  },
  voice: {
    tts_engine: "off",
    tts_command: "",
    stt_engine: "off",
    stt_command: "",
    openai_api_key: "",
  },
  security: {
    encryption: false,
    keyfile: "~/.consciousness/.cortex-key",
    key_env: "CORTEX_KEY",
  },
  tui: {
    enabled: true,
    history_file: "~/.consciousness/history",
    max_history: 500,
  },
  proactive: {
    enabled: true,
    idle_minutes: 10,
    cooldown_minutes: 30,
    check_interval_ms: 30_000,
  },
  web: {
    enabled: false,
    port: 4040,
  },
  shell: {
    prompt: "you > ",
    welcome_message: true,
    colors: true,
  },
};

export function projectRoot(): string {
  let dir = process.cwd();
  while (dir !== "/") {
    if (existsSync(join(dir, "cortex.json"))) return dir;
    dir = dirname(dir);
  }
  return process.cwd();
}

export function expandHome(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return join(homedir(), p.slice(2));
  return p;
}

export function loadConfig(): CortexConfig {
  const root = projectRoot();
  const path = join(root, "cortex.json");
  if (!existsSync(path)) return DEFAULTS;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return deepMerge(DEFAULTS, parsed) as CortexConfig;
  } catch {
    return DEFAULTS;
  }
}

export function resolvePersonaPath(config: CortexConfig): string {
  if (config.persona_path) return expandHome(config.persona_path);
  return join(projectRoot(), "persona.json");
}

function deepMerge<T>(base: T, override: unknown): T {
  if (Array.isArray(base) || Array.isArray(override)) {
    return (override ?? base) as T;
  }
  if (typeof base !== "object" || base === null) return (override as T) ?? base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  if (typeof override === "object" && override !== null) {
    for (const [k, v] of Object.entries(override as Record<string, unknown>)) {
      out[k] = deepMerge(out[k], v);
    }
  }
  return out as T;
}
