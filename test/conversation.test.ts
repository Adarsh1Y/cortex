import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  Conversation,
  Memory,
  OpenCodeBrain,
  loadConfig,
  loadPersona,
  resolvePersonaPath,
} from "../core/index.ts";

let dir: string;
let mem: Memory;
let brain: OpenCodeBrain;
let config: ReturnType<typeof loadConfig>;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "cortex-conv-"));
  config = loadConfig();
  config.data_dir = dir;
  mem = new Memory(dir);
  brain = await OpenCodeBrain.connect(config.brain.server_timeout_ms);
});

afterAll(() => {
  brain.close();
  mem.close();
  rmSync(dir, { recursive: true, force: true });
});

const persona = () => loadPersona(resolvePersonaPath(loadConfig()));

describe("conversation lifecycle", () => {
  test(
    "turn streams deltas identical to the final reply and persists both roles",
    async () => {
      const convo = await Conversation.start({ config, memory: mem, brain, persona: persona() });
      let streamed = "";
      const reply = await convo.turn("Remember: my favorite number is 42.", (d) => (streamed += d));
      expect(reply.length).toBeGreaterThan(0);
      expect(streamed).toBe(reply);
      const msgs = mem.getMessages(convo.sessionId);
      expect(msgs.map((m) => m.role)).toEqual(["user", "assistant"]);
      expect(msgs[0].content).toContain("42");
    },
    90_000,
  );

  test(
    "digest distills durable facts and a journal entry",
    async () => {
      const before = mem.stats();
      const convo = await Conversation.start({ config, memory: mem, brain, persona: persona() });
      await convo.turn("Just confirming: the project is codenamed CORTEX.");
      const digest = await convo.digest();
      expect(digest).not.toBeNull();
      const after = mem.stats();
      expect(after.facts).toBeGreaterThanOrEqual(before.facts);
      expect(after.journal).toBeGreaterThan(before.journal);
      const facts = mem.listFacts(true);
      expect(facts.some((f) => /cortex/i.test(f.text))).toBe(true);
    },
    120_000,
  );

  test(
    "a fresh conversation recalls previously stored facts",
    async () => {
      mem.addFact("user's favorite color is neon green", "preference");
      const convo = await Conversation.start({ config, memory: mem, brain, persona: persona() });
      const reply = await convo.turn("What is my favorite color?");
      expect(reply.toLowerCase()).toMatch(/green/);
    },
    90_000,
  );

  test(
    "clear() wipes only the current session",
    async () => {
      const convo = await Conversation.start({ config, memory: mem, brain, persona: persona() });
      await convo.turn("temporary message one");
      const removed = await convo.clear();
      expect(removed).toBe(2);
      expect(mem.getMessages(convo.sessionId)).toHaveLength(0);
      // other sessions are untouched
      expect(mem.stats().messages).toBeGreaterThan(0);
    },
    90_000,
  );
});
