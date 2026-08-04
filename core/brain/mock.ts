import type { Brain, PromptOptions } from "../brain";

export interface MockBrainOptions {
  reply?: string;
  onPrompt?: (opts: PromptOptions) => void;
  /** Analyze returns this JSON (used to simulate memory extraction). */
  analyzeReply?: string;
}

/** Deterministic in-process brain for tests and offline demos. */
export class MockBrain implements Brain {
  readonly name = "mock";
  readonly prompts: PromptOptions[] = [];

  constructor(private opts: MockBrainOptions = {}) {}

  async createSession(_title: string): Promise<string> {
    return `mock-${crypto.randomUUID()}`;
  }

  async prompt(opts: PromptOptions): Promise<string> {
    this.prompts.push(opts);
    this.opts.onPrompt?.(opts);
    const reply = this.opts.reply ?? "mock reply";
    opts.onDelta?.(reply);
    return reply;
  }

  async analyze(_text: string, _system: string): Promise<string> {
    return this.opts.analyzeReply ?? "{}";
  }

  close(): void {}
}
