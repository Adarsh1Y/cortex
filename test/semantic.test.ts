import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  Memory,
  OpenCodeBrain,
  consolidateFacts,
  expandHome,
  extractDigest,
  factsToContext,
  journalToContext,
  loadConfig,
  parseJsonObject,
} from "../core/index.ts";

let dir: string;
let mem: Memory;
let brain: OpenCodeBrain;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "cortex-sem-"));
  mem = new Memory(dir);
  brain = await OpenCodeBrain.connect(loadConfig().brain.server_timeout_ms);
});

afterAll(() => {
  brain.close();
  mem.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("parseJsonObject", () => {
  test("extracts JSON from clean input", () => {
    expect(parseJsonObject('{"facts":[]}')).toEqual({ facts: [] });
  });

  test("extracts JSON wrapped in prose/backticks", () => {
    const raw = 'Here you go:\n```json\n{"facts":[{"text":"a","category":"fact"}],"journal":"j"}\n```';
    const parsed = parseJsonObject(raw);
    expect(parsed?.facts[0].text).toBe("a");
    expect(parsed?.journal).toBe("j");
  });

  test("returns null on junk", () => {
    expect(parseJsonObject("no json here")).toBeNull();
    expect(parseJsonObject("")).toBeNull();
    expect(parseJsonObject("{broken")).toBeNull();
  });
});

describe("context formatters", () => {
  test("factsToContext", () => {
    const facts = [
      { id: 1, category: "preference", text: "Likes green." },
      { id: 2, category: "fact", text: "Uses bun." },
    ] as any;
    const out = factsToContext(facts);
    expect(out).toContain("[preference] Likes green.");
    expect(out).toContain("[fact] Uses bun.");

    const long = [{ id: 1, category: "fact", text: "x".repeat(300) }] as any;
    const truncated = factsToContext(long, 50);
    expect(truncated.length).toBeLessThanOrEqual(55);
    expect(truncated.endsWith("...")).toBe(true);
  });

  test("journalToContext newest first, dated", () => {
    const entries = [
      { id: 1, summary: "old", created_at: 1000 },
      { id: 2, summary: "new", created_at: 2000 },
    ] as any;
    const out = journalToContext(entries);
    expect(out.indexOf("new")).toBeLessThan(out.indexOf("old"));
    expect(out).toMatch(/\[\d{4}-\d{2}-\d{2}\]/);
  });
});

describe("extractDigest (real brain)", () => {
  test(
    "distills facts and a journal entry",
    async () => {
      const transcript =
        "USER: My favorite color is neon green and I prefer bun over npm.\n" +
        "CORTEX: Got it.\n" +
        "USER: Also call me boss.\n";
      const digest = await extractDigest(brain, transcript);
      expect(digest.facts.length).toBeGreaterThanOrEqual(1);
      expect(typeof digest.journal).toBe("string");
      const all = digest.facts.map((f) => f.text.toLowerCase()).join(" ");
      expect(all).toMatch(/green|bun|boss/);
      for (const f of digest.facts) {
        expect(f.text.length).toBeGreaterThan(3);
        expect(["preference", "fact", "decision", "error", "people"]).toContain(f.category);
      }
    },
    90_000,
  );

  test("returns empty digest on garbage transcript", async () => {
    const digest = await extractDigest(brain, "ok");
    expect(Array.isArray(digest.facts)).toBe(true);
    expect(typeof digest.journal).toBe("string");
  }, 90_000);
});

describe("consolidateFacts (real brain)", () => {
  test(
    "keeps one canonical fact, retires duplicates",
    async () => {
      const a = mem.addFact("user favorite color is neon green", "preference");
      const b = mem.addFact("user's favorite color is neon green", "preference");
      const before = mem.stats().facts;
      const res = await consolidateFacts(brain, mem);
      expect(before).toBeGreaterThanOrEqual(2);
      expect(res.kept).toBeGreaterThan(0);
      const active = mem.listFacts(true);
      const green = active.filter((f) => /green/i.test(f.text));
      expect(green.length).toBeGreaterThanOrEqual(1);
      // at least one of the original duplicate ids is retired
      const activeIds = new Set(active.map((f) => f.id));
      const retired = [a, b].filter((id) => !activeIds.has(id));
      expect(retired.length).toBeGreaterThanOrEqual(1);
    },
    90_000,
  );
});
