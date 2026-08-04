import type { CortexConfig } from "../config";
import type { Brain } from "../brain";
import type { BrainOptions, OpenCodeBrain } from "../brain";
import { OpenAIBrain } from "./openai";
import { AnthropicBrain } from "./anthropic";
import { OllamaBrain } from "./ollama";
import { MockBrain } from "./mock";

export { OpenAIBrain } from "./openai";
export { AnthropicBrain } from "./anthropic";
export { OllamaBrain } from "./ollama";
export { MockBrain } from "./mock";
export type { OpenAIBrainOptions } from "./openai";
export type { AnthropicBrainOptions } from "./anthropic";
export type { OllamaBrainOptions } from "./ollama";
export type { MockBrainOptions } from "./mock";

export interface CreateBrainOptions {
  config: CortexConfig;
  opencode?: BrainOptions;
  env?: Record<string, string | undefined>;
}

export type AnyBrain = Brain | OpenCodeBrain;

/**
 * Instantiate a brain from config. "opencode" spins up the local opencode
 * server (the default); the others are plain HTTP streaming clients.
 */
export async function createBrain(opts: CreateBrainOptions): Promise<AnyBrain> {
  const engine = opts.config.brain.engine;
  const env = opts.env ?? process.env;
  switch (engine) {
    case "openai": {
      const apiKey = opts.config.brain.api_key || env.OPENAI_API_KEY || "";
      if (!apiKey) throw new Error("brain.engine=openai requires an API key (brain.api_key or OPENAI_API_KEY)");
      return new OpenAIBrain({
        baseUrl: opts.config.brain.base_url ?? "https://api.openai.com/v1",
        apiKey,
        model: opts.config.brain.model,
        timeoutMs: opts.config.brain.server_timeout_ms,
      });
    }
    case "anthropic": {
      const apiKey = opts.config.brain.api_key || env.ANTHROPIC_API_KEY || "";
      if (!apiKey) throw new Error("brain.engine=anthropic requires an API key (brain.api_key or ANTHROPIC_API_KEY)");
      return new AnthropicBrain({
        baseUrl: opts.config.brain.base_url ?? "https://api.anthropic.com/v1",
        apiKey,
        model: opts.config.brain.model,
        timeoutMs: opts.config.brain.server_timeout_ms,
      });
    }
    case "ollama":
      return new OllamaBrain({
        url: opts.config.brain.ollama_url ?? "http://127.0.0.1:11434",
        model: opts.config.brain.model,
        timeoutMs: opts.config.brain.server_timeout_ms,
      });
    case "mock":
      return new MockBrain();
    case "opencode":
    default: {
      const { OpenCodeBrain } = await import("../brain");
      return OpenCodeBrain.connect(opts.opencode ?? { timeoutMs: opts.config.brain.server_timeout_ms });
    }
  }
}
