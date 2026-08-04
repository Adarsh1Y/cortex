import { describe, expect, test } from "bun:test";
import { loadConfig, MockEmbedder } from "../core/index.ts";
import { createEmbedder } from "../core/index.ts";

describe("MockEmbedder", () => {
  test("produces normalized fixed-dim vectors", async () => {
    const e = new MockEmbedder(16);
    const [v] = await e.embed(["hello"]);
    expect(v.length).toBe(16);
    let norm = 0;
    for (const x of v) norm += x * x;
    expect(Math.sqrt(norm)).toBeCloseTo(1, 5);
  });

  test("same input yields same vector", async () => {
    const e = new MockEmbedder(8);
    const [a] = await e.embed(["stable"]);
    const [b] = await e.embed(["stable"]);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  test("ready() is true", async () => {
    expect(await new MockEmbedder().ready()).toBe(true);
  });
});

describe("createEmbedder factory", () => {
  test("returns null when disabled", () => {
    const config = loadConfig();
    config.embeddings.enabled = false;
    expect(createEmbedder({ config })).toBeNull();
  });

  test("returns null for off engine", () => {
    const config = loadConfig();
    config.embeddings.engine = "off";
    expect(createEmbedder({ config })).toBeNull();
  });

  test("creates transformers embedder by default", () => {
    const config = loadConfig();
    const e = createEmbedder({ config });
    expect(e).not.toBeNull();
    expect(e!.name).toContain("MiniLM");
    e!.close();
  });

  test("openai embedder picks key from env fallback", () => {
    const config = loadConfig();
    config.embeddings.engine = "openai";
    const e = createEmbedder({ config, env: { OPENAI_API_KEY: "sk-test" } });
    expect(e).not.toBeNull();
    expect(e!.name).toContain("openai");
  });
});
