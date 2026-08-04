import type { Brain, PromptOptions } from "../brain";
import { parseJsonLine, sseData } from "./http";

export interface AnthropicBrainOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
}

interface AnthropicEvent {
  type?: string;
  delta?: { type?: string; text?: string };
}

/** Streaming Anthropic Messages API backend. */
export class AnthropicBrain implements Brain {
  readonly name = "anthropic";

  constructor(private opts: AnthropicBrainOptions) {}

  async createSession(_title: string): Promise<string> {
    return `anthropic-${crypto.randomUUID()}`;
  }

  async prompt(opts: PromptOptions): Promise<string> {
    const url = `${this.opts.baseUrl.replace(/\/$/, "")}/messages`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.opts.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.opts.model,
        max_tokens: 4096,
        system: opts.system,
        messages: [{ role: "user", content: opts.text }],
        stream: true,
      }),
      signal: AbortSignal.timeout(this.opts.timeoutMs ?? 120_000),
    });
    if (!res.ok || !res.body) throw new Error(`anthropic request failed: ${res.status}`);

    let out = "";
    for await (const line of sseData(res)) {
      const evt = parseJsonLine<AnthropicEvent>(line);
      if (evt?.type === "content_block_delta" && evt.delta?.type === "text_delta" && evt.delta.text) {
        out += evt.delta.text;
        opts.onDelta?.(evt.delta.text);
      }
    }
    return out;
  }

  async analyze(text: string, system: string): Promise<string> {
    return this.prompt({ sessionId: "", text, system });
  }

  close(): void {}
}
