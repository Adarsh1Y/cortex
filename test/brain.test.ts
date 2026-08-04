import { afterAll, describe, expect, test } from "bun:test";
import {
  AnthropicBrain,
  MockBrain,
  OllamaBrain,
  OpenAIBrain,
  createBrain,
  loadConfig,
  type PromptOptions,
} from "../core/index.ts";

function streamResponse(lines: string[]): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const l of lines) controller.enqueue(enc.encode(l + "\n"));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
}

const originalFetch = globalThis.fetch;
afterAll(() => {
  globalThis.fetch = originalFetch;
});

describe("MockBrain", () => {
  test("prompt streams and returns reply", async () => {
    const b = new MockBrain({ reply: "hello from mock" });
    let streamed = "";
    const reply = await b.prompt({ sessionId: "s", text: "hi", onDelta: (d) => (streamed += d) });
    expect(reply).toBe("hello from mock");
    expect(streamed).toBe("hello from mock");
    expect(b.prompts.length).toBe(1);
    b.close();
  });

  test("analyze returns configured JSON", async () => {
    const b = new MockBrain({ analyzeReply: '{"facts":[]}' });
    expect(await b.analyze("x", "y")).toBe('{"facts":[]}');
    b.close();
  });
});

describe("OpenAIBrain", () => {
  test("streams chat completion deltas", async () => {
    globalThis.fetch = async () =>
      streamResponse([
        'data: {"choices":[{"delta":{"content":"Hel"}}]}',
        'data: {"choices":[{"delta":{"content":"lo"}}]}',
        "data: [DONE]",
      ]);

    const b = new OpenAIBrain({ baseUrl: "https://api.openai.com/v1", apiKey: "k", model: "gpt-4o-mini" });
    let streamed = "";
    const reply = await b.prompt({ sessionId: "s", text: "x", system: "sys", onDelta: (d) => (streamed += d) });
    expect(reply).toBe("Hello");
    expect(streamed).toBe("Hello");
    b.close();
  });
});

describe("AnthropicBrain", () => {
  test("streams content_block_delta events", async () => {
    globalThis.fetch = async () =>
      streamResponse([
        '{"type":"content_block_delta","delta":{"type":"text_delta","text":"I "}}',
        '{"type":"content_block_delta","delta":{"type":"text_delta","text":"think"}}',
        '{"type":"message_stop"}',
      ]);

    const b = new AnthropicBrain({ baseUrl: "https://api.anthropic.com/v1", apiKey: "k", model: "claude-3-5-sonnet" });
    const reply = await b.prompt({ sessionId: "s", text: "x" });
    expect(reply).toBe("I think");
    b.close();
  });
});

describe("OllamaBrain", () => {
  test("streams NDJSON chunks", async () => {
    globalThis.fetch = async () =>
      streamResponse([
        '{"message":{"content":"yes"},"done":false}',
        '{"message":{"content":"!"},"done":true}',
      ]);

    const b = new OllamaBrain({ url: "http://127.0.0.1:11434", model: "llama3" });
    const reply = await b.prompt({ sessionId: "s", text: "x" });
    expect(reply).toBe("yes!");
    b.close();
  });
});

describe("createBrain factory", () => {
  test("mock engine returns MockBrain", async () => {
    const config = loadConfig();
    config.brain.engine = "mock";
    const b = await createBrain({ config });
    expect(b).toBeInstanceOf(MockBrain);
    b.close();
  });

  test("openai engine throws without a key", async () => {
    const config = loadConfig();
    config.brain.engine = "openai";
    config.brain.api_key = "";
    await expect(createBrain({ config, env: {} })).rejects.toThrow(/API key/);
  });

  test("openai engine accepts env key", async () => {
    const config = loadConfig();
    config.brain.engine = "openai";
    config.brain.api_key = "";
    const b = await createBrain({ config, env: { OPENAI_API_KEY: "sk-abc" } });
    expect(b).toBeInstanceOf(OpenAIBrain);
    b.close();
  });
});

describe("typed prompt options", () => {
  test("PromptOptions is structural", () => {
    const opts: PromptOptions = { sessionId: "s", text: "t" };
    expect(opts.sessionId).toBe("s");
  });
});
