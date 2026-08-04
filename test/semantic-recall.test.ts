import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  Conversation,
  Memory,
  MockEmbedder,
  VectorStore,
  loadConfig,
  loadPersona,
  resolvePersonaPath,
  type Brain,
  type PromptOptions,
} from "../core/index.ts";

class FakeBrain implements Brain {
  lastSystem = "";
  digestPayload = JSON.stringify({
    facts: [{ text: "user loves pierogi", category: "preference" }],
    journal: "We bonded over dumplings.",
  });

  async createSession(_title: string): Promise<string> {
    return `fake-${Math.random().toString(36).slice(2)}`;
  }

  async prompt(opts: PromptOptions): Promise<string> {
    this.lastSystem = opts.system ?? "";
    return "acknowledged";
  }

  async analyze(_text: string, _system: string): Promise<string> {
    return this.digestPayload;
  }

  close(): void {}
}

describe("semantic recall", () => {
  let dir: string;
  let mem: Memory;
  let vs: VectorStore;
  let embedder: MockEmbedder;
  let brain: FakeBrain;
  let config: ReturnType<typeof loadConfig>;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "cortex-sema-"));
    config = loadConfig();
    config.data_dir = dir;
    config.memory.semantic_recall = true;
    mem = new Memory(dir);
    vs = new VectorStore(mem.database);
    embedder = new MockEmbedder(32);
    brain = new FakeBrain();
  });

  afterAll(() => {
    mem.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const persona = () => loadPersona(resolvePersonaPath(loadConfig()));

  test("recalls semantically similar past messages into the system prompt", async () => {
    const other = mem.createSession("past");
    const sentence = "I adore coding with Bun and TypeScript";
    const m1 = mem.addMessage(other, "user", sentence);
    const m2 = mem.addMessage(other, "assistant", "Bun is fast, welcome aboard");
    const [v1, v2] = await embedder.embed([sentence, "Bun is fast, welcome aboard"]);
    vs.upsertMessage(m1, v1);
    vs.upsertMessage(m2, v2);

    const convo = await Conversation.start({ config, memory: mem, brain, persona: persona(), embedder, vectors: vs });
    // Exact query -> identical stored vector -> similarity 1 -> must be recalled.
    await convo.turn(sentence);
    expect(brain.lastSystem).toContain("adore coding");

    const [q] = await embedder.embed([sentence]);
    const hits = vs.searchMessages(q, 5);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].id).toBe(m1);
  });

  test("digest embeds distilled facts", async () => {
    const convo = await Conversation.start({ config, memory: mem, brain, persona: persona(), embedder, vectors: vs });
    await convo.turn("pierogi are my favorite food");
    const digest = await convo.digest();
    expect(digest).not.toBeNull();
    expect(vs.countFacts()).toBeGreaterThan(0);
    expect(vs.countMessages()).toBeGreaterThan(0);
  });
});
