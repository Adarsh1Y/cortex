import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { Memory, VectorStore, blobToFloat32, cosine, float32ToBlob } from "../core/index.ts";

describe("cosine", () => {
  test("identical vectors score 1", () => {
    const a = Float32Array.from([1, 0, 0]);
    expect(cosine(a, a)).toBeCloseTo(1);
  });
  test("orthogonal vectors score 0", () => {
    expect(cosine(Float32Array.from([1, 0]), Float32Array.from([0, 1]))).toBeCloseTo(0);
  });
  test("opposite vectors score -1", () => {
    expect(cosine(Float32Array.from([1, 0]), Float32Array.from([-1, 0]))).toBeCloseTo(-1);
  });
  test("blob roundtrip preserves values", () => {
    const v = Float32Array.from([1.5, -2.25, 3.75]);
    const back = blobToFloat32(float32ToBlob(v));
    expect(Array.from(back)).toEqual(Array.from(v));
  });
});

describe("VectorStore", () => {
  let dir: string;
  let db: Database;
  let mem: Memory;
  let vs: VectorStore;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "cortex-vec-"));
    db = new Database(join(dir, "v.db"));
    mem = new Memory(dir);
    vs = new VectorStore(db);
  });

  afterAll(() => {
    mem.close();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("upsert + search by similarity", () => {
    const a = Float32Array.from([1, 0, 0]);
    const b = Float32Array.from([0.8, 0.6, 0]);
    vs.upsertMessage(1, a);
    vs.upsertMessage(2, b);

    const hits = vs.searchMessages(a, 5);
    expect(hits[0].id).toBe(1);
    expect(hits[0].similarity).toBeCloseTo(1);
    expect(hits.map((h) => h.id).sort()).toEqual([1, 2]);
  });

  test("excludeIds are skipped", () => {
    const a = Float32Array.from([1, 0, 0]);
    const hits = vs.searchMessages(a, 5, [1]);
    expect(hits[0].id).toBe(2);
  });

  test("facts index is separate", () => {
    vs.upsertFact(10, Float32Array.from([0, 0, 1]));
    const hits = vs.searchFacts(Float32Array.from([0, 0, 1]), 5);
    expect(hits[0].id).toBe(10);
    // orthogonal to all stored message vectors -> filtered out
    expect(vs.searchMessages(Float32Array.from([0, 0, 1]), 5).length).toBe(0);
  });

  test("delete removes from index", () => {
    vs.deleteMessage(1);
    const hits = vs.searchMessages(Float32Array.from([1, 0, 0]), 5);
    expect(hits.map((h) => h.id)).not.toContain(1);
  });

  test("removeMessages batch delete", () => {
    vs.upsertMessage(3, Float32Array.from([0, 0, 1]));
    vs.upsertMessage(4, Float32Array.from([0, 0, 1]));
    vs.removeMessages([3, 4]);
    const hits = vs.searchMessages(Float32Array.from([0, 0, 1]), 5);
    expect(hits.map((h) => h.id)).not.toContain(3);
    expect(hits.map((h) => h.id)).not.toContain(4);
  });
});

describe("Memory + VectorStore integration", () => {
  test("hooks fire on delete and reset", () => {
    const dir = mkdtempSync(join(tmpdir(), "cortex-vechook-"));
    let vs!: VectorStore;
    const mem = new Memory(dir, {
      hooks: {
        onMessagesDeleted: (ids) => vs.removeMessages(ids),
        onFactDeleted: (id) => vs.deleteFact(id),
      },
    });
    vs = new VectorStore(mem.database);
    mem.addMessage("s", "user", "alpha");
    vs.upsertMessage(1, Float32Array.from([1, 0, 0]));

    mem.deleteMessages([1]);
    expect(vs.countMessages()).toBe(0);

    mem.addMessage("s", "user", "beta");
    vs.upsertMessage(2, Float32Array.from([0, 1, 0]));
    mem.resetSession("s");
    expect(vs.countMessages()).toBe(0);

    mem.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
