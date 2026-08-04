import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export interface CortexConfig {
  data_dir: string;
  brain: {
    engine: "opencode" | string;
    model: string;
    server_timeout_ms: number;
  };
  memory: {
    episodic: boolean;
    semantic: boolean;
    recall_on_start: boolean;
    recall_messages: number;
    max_recall_chars: number;
    max_fact_chars: number;
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
  },
  memory: {
    episodic: true,
    semantic: true,
    recall_on_start: true,
    recall_messages: 40,
    max_recall_chars: 4000,
    max_fact_chars: 1500,
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
  if (typeof base !== "object" || base === null) return (override as T) ?? base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  if (typeof override === "object" && override !== null) {
    for (const [k, v] of Object.entries(override as Record<string, unknown>)) {
      out[k] = deepMerge(out[k], v);
    }
  }
  return out as T;
}
