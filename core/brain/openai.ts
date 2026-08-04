import type { Brain, PromptOptions } from "../brain";
import { parseJsonLine, sseData } from "./http";

export interface OpenAIBrainOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
}

interface ChatChunk {
  choices?: { delta?: { content?: string | null } }[];
}

/** Streaming OpenAI-compatible chat backend (works with OpenAI, Azure, vLLM, LiteLLM). */
export class OpenAIBrain implements Brain {
  readonly name = "openai";

  constructor(private opts: OpenAIBrainOptions) {}

  async createSession(_title: string): Promise<string> {
    return `openai-${crypto.randomUUID()}`;
  }

  async prompt(opts: PromptOptions): Promise<string> {
    const url = `${this.opts.baseUrl.replace(/\/$/, "")}/chat/completions`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.opts.apiKey}`,
      },
      body: JSON.stringify({
        model: this.opts.model,
        stream: true,
        messages: [
          ...(opts.system ? [{ role: "system", content: opts.system }] : []),
          { role: "user", content: opts.text },
        ],
      }),
      signal: AbortSignal.timeout(this.opts.timeoutMs ?? 120_000),
    });
    if (!res.ok || !res.body) throw new Error(`openai request failed: ${res.status}`);

    let out = "";
    for await (const line of sseData(res)) {
      const chunk = parseJsonLine<ChatChunk>(line);
      const delta = chunk?.choices?.[0]?.delta?.content;
      if (delta) {
        out += delta;
        opts.onDelta?.(delta);
      }
    }
    return out;
  }

  async analyze(text: string, system: string): Promise<string> {
    return this.prompt({ sessionId: "", text, system });
  }

  close(): void {}
}
