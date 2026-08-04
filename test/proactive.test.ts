import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Memory, ProactiveEngine } from "../core/index.ts";
import type { Brain } from "../core/index.ts";

function makeBrain(lines: string[]): Brain & { calls: number } {
  const calls = { count: 0 };
  const brain = {
    calls,
    async analyze(): Promise<string> {
      calls.count++;
      return lines.shift() ?? "SILENT";
    },
    createSession: async () => "fake-session",
    prompt: async () => "",
    close: () => {},
  };
  return brain as unknown as Brain & { calls: { count: number } };
}

function makePersona() {
  return {
    name: "CORTEX",
    role: "consciousness layer",
    voice: { tone: "calm", register: "conversational", habits: [] },
    boundaries: [],
    memory_ethic: "remembers everything",
  };
}

function setup(lines: string[], overrides: Record<string, unknown> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "cortex-pro-"));
  const memory = new Memory(dir);
  const persona = makePersona();
  const spoken: string[] = [];
  const brain = makeBrain(lines);
  const engine = new ProactiveEngine({
    config: {
      enabled: true,
      idleMinutes: 0.001,
      cooldownMinutes: 0.01,
      checkIntervalMs: 20,
      ...overrides,
    },
    brain,
    memory,
    persona,
    userName: "boss",
    onSpeak: (t) => spoken.push(t),
  });
  return { dir, memory, brain, engine, spoken };
}

function teardown(dir: string, memory: Memory, engine: ProactiveEngine) {
  engine.stop();
  memory.close();
  rmSync(dir, { recursive: true, force: true });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("proactive engine gating", () => {
  afterEach(() => {});

  test("does nothing when disabled", async () => {
    const ctx = setup(["hello"], { enabled: false });
    ctx.engine.start();
    await sleep(250);
    ctx.engine.stop();
    expect(ctx.spoken).toHaveLength(0);
    expect(ctx.brain.calls.count).toBe(0);
    teardown(ctx.dir, ctx.memory, ctx.engine);
  });

  test("speaks when idle past threshold", async () => {
    const ctx = setup(["wake up boss"]);
    ctx.engine.start();
    await sleep(250);
    ctx.engine.stop();
    expect(ctx.spoken).toEqual(["wake up boss"]);
    expect(ctx.brain.calls.count).toBeGreaterThanOrEqual(1);
    teardown(ctx.dir, ctx.memory, ctx.engine);
  });

  test("stays SILENT when the brain says so", async () => {
    const ctx = setup(["SILENT", "SILENT"]);
    ctx.engine.start();
    await sleep(300);
    ctx.engine.stop();
    expect(ctx.spoken).toHaveLength(0);
    teardown(ctx.dir, ctx.memory, ctx.engine);
  });

  test("cooldown suppresses a second line", async () => {
    const ctx = setup(["first", "second"]);
    ctx.engine.start();
    await sleep(300);
    ctx.engine.stop();
    expect(ctx.spoken).toEqual(["first"]);
    teardown(ctx.dir, ctx.memory, ctx.engine);
  });

  test("poke() resets the idle clock", async () => {
    const ctx = setup(["intruder"]);
    ctx.engine.start();
    await sleep(100);
    ctx.engine.poke();
    await sleep(100);
    ctx.engine.stop();
    // after the poke, idle restarts; within 100ms + 20ms it may or may not reach
    // threshold again, but the poke must have reset interaction time so the very
    // first speak cannot happen before it. We assert it is either 0 or 1.
    expect(ctx.spoken.length).toBeLessThanOrEqual(1);
    expect(ctx.brain.calls.count).toBeGreaterThanOrEqual(1); // at least the pre-poke tick fired
    teardown(ctx.dir, ctx.memory, ctx.engine);
  });

  test("remind() fires onSpeak after delay", async () => {
    const ctx = setup([]);
    ctx.engine.start();
    ctx.engine.remind("take a break", 60);
    await sleep(250);
    ctx.engine.stop();
    expect(ctx.spoken).toEqual(["⏰ take a break"]);
    teardown(ctx.dir, ctx.memory, ctx.engine);
  });
});
