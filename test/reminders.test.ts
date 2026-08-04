import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { Memory, ReminderEngine, ReminderStore, parseReminderWhen } from "../core/index.ts";

describe("parseReminderWhen", () => {
  test("in N minutes", () => {
    const before = Date.now();
    const r = parseReminderWhen("in 30 minutes water the plants");
    expect(r).not.toBeNull();
    expect(r!.dueAt).toBeGreaterThan(before + 29 * 60_000);
    expect(r!.dueAt).toBeLessThan(before + 31 * 60_000);
    expect(r!.text).toBe("water the plants");
  });

  test("in N hours with text", () => {
    const r = parseReminderWhen("in 2 hours call mom");
    expect(r!.text).toBe("call mom");
    expect(r!.dueAt).toBeCloseTo(Date.now() + 2 * 3_600_000, -2);
  });

  test("at HH:MM in the future", () => {
    const d = new Date();
    d.setHours(23, 59, 0, 0);
    const iso = `at 23:59 check the logs`;
    const r = parseReminderWhen(iso);
    expect(r!.text).toBe("check the logs");
  });

  test("tomorrow at HH:MM", () => {
    const r = parseReminderWhen("tomorrow at 08:00 morning run");
    expect(r!.text).toBe("morning run");
    const d = new Date(r!.dueAt);
    expect(d.getHours()).toBe(8);
  });

  test("ISO timestamp", () => {
    const r = parseReminderWhen("2030-01-01T12:00 do the thing");
    expect(r!.text).toBe("do the thing");
    expect(new Date(r!.dueAt).getTime()).toBe(new Date("2030-01-01T12:00").getTime());
  });

  test("returns null without a time expression", () => {
    expect(parseReminderWhen("just some text")).toBeNull();
  });
});

describe("ReminderStore", () => {
  let dir: string;
  let db: Database;
  let store: ReminderStore;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "cortex-rem-"));
    db = new Database(join(dir, "rem.db"));
    store = new ReminderStore(db);
  });

  afterAll(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("add + due + fire lifecycle", () => {
    const id = store.add("test", Date.now() - 1000);
    const due = store.due();
    expect(due.some((r) => r.id === id)).toBe(true);
    store.fire(due.find((r) => r.id === id)!);
    expect(store.due().some((r) => r.id === id)).toBe(false);
    expect(store.list(false).find((r) => r.id === id)!.fired).toBe(1);
  });

  test("cancel removes", () => {
    const id = store.add("cancel me", Date.now() - 1000);
    store.cancel(id);
    expect(store.list(false).find((r) => r.id === id)).toBeUndefined();
  });

  test("repeating reminders reschedule instead of firing", () => {
    const id = store.add("every day", Date.now() - 1000, "daily");
    const row = store.due().find((r) => r.id === id)!;
    store.fire(row);
    const refreshed = store.list(false).find((r) => r.id === id)!;
    expect(refreshed.fired).toBe(0);
    expect(refreshed.due_at).toBeGreaterThan(Date.now());
  });
});

describe("ReminderEngine", () => {
  test("fires due reminders on tick", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cortex-remeng-"));
    const mem = new Memory(dir);
    const fired: number[] = [];
    const engine = new ReminderEngine({
      database: mem.database,
      checkIntervalMs: 50,
      onFire: (r) => fired.push(r.id),
    });
    engine.start();
    const id = engine.store_.add("go", Date.now() - 1);
    await new Promise((r) => setTimeout(r, 150));
    engine.stop();
    expect(fired).toContain(id);
    mem.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("does not fire future reminders", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cortex-remeng2-"));
    const mem = new Memory(dir);
    const fired: number[] = [];
    const engine = new ReminderEngine({
      database: mem.database,
      checkIntervalMs: 20,
      onFire: (r) => fired.push(r.id),
    });
    engine.start();
    engine.store_.add("later", Date.now() + 60_000);
    await new Promise((r) => setTimeout(r, 120));
    engine.stop();
    expect(fired.length).toBe(0);
    mem.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
