import type { Brain, PromptOptions } from "../brain";
import { parseJsonLine, sseData } from "./http";

export interface OllamaBrainOptions {
  url: string;
  model: string;
  timeoutMs?: number;
}

interface OllamaChunk {
  message?: { content?: string };
  done?: boolean;
}

/** Local Ollama backend. No API key, runs entirely on your machine. */
export class OllamaBrain implements Brain {
  readonly name = "ollama";

  constructor(private opts: OllamaBrainOptions) {}

  async createSession(_title: string): Promise<string> {
    return `ollama-${crypto.randomUUID()}`;
  }

  async prompt(opts: PromptOptions): Promise<string> {
    const url = `${this.opts.url.replace(/\/$/, "")}/api/chat`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
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
    if (!res.ok || !res.body) throw new Error(`ollama request failed: ${res.status}`);

    let out = "";
    for await (const line of sseData(res)) {
      const chunk = parseJsonLine<OllamaChunk>(line);
      const delta = chunk?.message?.content;
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
