import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Memory, VectorStore, MockEmbedder, backupMemory, exportMemory, importMemory } from "../core/index.ts";

describe("export / import", () => {
  let dir: string;

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  test("round-trips all memory", async () => {
    dir = mkdtempSync(join(tmpdir(), "cortex-exp-"));
    const mem = new Memory(dir);
    const vs = new VectorStore(mem.database);
    const embedder = new MockEmbedder(8);

    const s = mem.createSession("first");
    mem.addMessage(s, "user", "hello there");
    mem.addMessage(s, "assistant", "hi");
    mem.setPreference("language", "typescript");
    const f = mem.addFact("user is on arch linux", "fact", s);
    mem.addJournal("we met for the first time", s);
    const [fv] = await embedder.embed(["user is on arch linux"]);
    vs.upsertFact(f, fv);
    const [mv] = await embedder.embed(["hello there"]);
    vs.upsertMessage(1, mv);

    const file = exportMemory(mem, { vectors: vs, dir });
    expect(existsSync(file)).toBe(true);

    const dir2 = mkdtempSync(join(tmpdir(), "cortex-exp2-"));
    const mem2 = new Memory(dir2);
    const vs2 = new VectorStore(mem2.database);
    const stats = importMemory(mem2, file, { vectors: vs2 });

    expect(stats.sessions).toBe(1);
    expect(stats.messages).toBe(2);
    expect(stats.facts).toBe(1);
    expect(stats.journal).toBe(1);
    expect(mem2.allPreferences()[0].value).toBe("typescript");
    expect(mem2.searchFacts("arch")[0].text).toBe("user is on arch linux");
    expect(mem2.latestJournal()[0].summary).toContain("first time");
    expect(vs2.countMessages()).toBe(1);
    expect(vs2.countFacts()).toBe(1);

    mem.close();
    mem2.close();
    rmSync(dir2, { recursive: true, force: true });
  });
});

describe("backupMemory", () => {
  test("writes a database snapshot", () => {
    const dir = mkdtempSync(join(tmpdir(), "cortex-bak-"));
    const mem = new Memory(dir);
    const s = mem.createSession("b");
    mem.addMessage(s, "user", "persisted");
    const file = backupMemory(dir, { db: mem })!;
    expect(existsSync(file)).toBe(true);
    const bytes = readFileSync(file);
    expect(bytes.length).toBeGreaterThan(0);
    mem.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
