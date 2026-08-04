import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Memory } from "../core/index.ts";

let dir: string;
let mem: Memory;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "cortex-mem-"));
  mem = new Memory(dir);
});

afterAll(() => {
  mem.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("sessions", () => {
  test("create/list/count", () => {
    const a = mem.createSession("first");
    const b = mem.createSession("second");
    const sessions = mem.listSessions();
    expect(sessions.some((s) => s.id === a && s.title === "first")).toBe(true);
    expect(sessions.some((s) => s.id === b)).toBe(true);
    expect(mem.countMessages(a)).toBe(0);
  });
});

describe("messages", () => {
  test("add/get in order with limit", () => {
    const s = mem.createSession("msgs");
    mem.addMessage(s, "user", "hello");
    mem.addMessage(s, "assistant", "hi there");
    mem.addMessage(s, "user", "third");
    const all = mem.getMessages(s);
    expect(all.map((m) => m.content)).toEqual(["hello", "hi there", "third"]);
    const last2 = mem.getMessages(s, 2);
    expect(last2.map((m) => m.content)).toEqual(["hi there", "third"]);
  });

  test("recentMessages excludes current session", () => {
    const s1 = mem.createSession("r1");
    const s2 = mem.createSession("r2");
    mem.addMessage(s1, "user", "msg-one");
    mem.addMessage(s2, "user", "msg-two");
    const recent = mem.recentMessages(10, s2);
    expect(recent.some((m) => m.content === "msg-two")).toBe(false);
    expect(recent.some((m) => m.content === "msg-one")).toBe(true);
  });

  test("search + delete + reset", () => {
    const s = mem.createSession("del");
    const id1 = mem.addMessage(s, "user", "the secret word is zebra");
    const id2 = mem.addMessage(s, "user", "unrelated chatter");
    const hits = mem.searchMessages("zebra", 10);
    expect(hits.some((m) => m.id === id1)).toBe(true);
    expect(hits.some((m) => m.id === id2)).toBe(false);

    expect(mem.deleteMessages([id2])).toBe(1);
    expect(mem.searchMessages("chatter", 10)).toHaveLength(0);

    expect(mem.resetSession(s)).toBe(1);
    expect(mem.getMessages(s)).toHaveLength(0);
  });
});

describe("preferences", () => {
  test("upsert keeps latest value", () => {
    mem.setPreference("language", "python");
    mem.setPreference("language", "typescript");
    const prefs = mem.allPreferences();
    expect(prefs.find((p) => p.key === "language")?.value).toBe("typescript");
  });
});

describe("facts", () => {
  test("add/update/toggle/delete + fts search", () => {
    const id = mem.addFact("The user loves the movie Interstellar.", "preference", "ses-x");
    const id2 = mem.addFact("The user uses bun instead of npm.", "preference");
    expect(mem.listFacts(true).some((f) => f.id === id)).toBe(true);
    expect(mem.listFacts(true).some((f) => f.id === id2)).toBe(true);

    const hits = mem.searchFacts("interstellar", 5);
    expect(hits.some((f) => f.id === id)).toBe(true);

    mem.updateFact(id, "The user's favorite movie is Interstellar.", "preference");
    expect(mem.listFacts(false).find((f) => f.id === id)?.text).toContain("favorite movie");

    mem.setFactActive(id2, false);
    expect(mem.listFacts(true).some((f) => f.id === id2)).toBe(false);
    expect(mem.searchFacts("bun", 5).some((f) => f.id === id2)).toBe(false);

    mem.deleteFact(id);
    expect(mem.listFacts(false).some((f) => f.id === id)).toBe(false);
    expect(mem.searchFacts("interstellar", 5).some((f) => f.id === id)).toBe(false);
  });

  test("search falls back to LIKE when no tokens", () => {
    const id = mem.addFact("Spaceship name is Endurance.", "fact");
    expect(mem.searchFacts("@@@", 5).some((f) => f.id === id)).toBe(true);
  });
});

describe("journal", () => {
  test("add/latest/delete", () => {
    mem.addJournal("Day one: I met my user.", "ses-y");
    mem.addJournal("Day two: learned their name.", "ses-z");
    const latest = mem.latestJournal(5);
    expect(latest[0].summary).toBe("Day two: learned their name.");
    const id = latest[0].id;
    mem.deleteJournal(id);
    expect(mem.latestJournal(5).some((j) => j.id === id)).toBe(false);
  });
});

describe("stats + persistence", () => {
  test("stats reflect every table", () => {
    const stats = mem.stats();
    expect(stats.sessions).toBeGreaterThanOrEqual(5);
    expect(stats.messages).toBeGreaterThanOrEqual(5);
    expect(stats.facts).toBeGreaterThanOrEqual(2);
    expect(stats.journal).toBeGreaterThanOrEqual(1);
    expect(stats.preferences).toBeGreaterThanOrEqual(1);
  });

  test("data survives reopen", () => {
    mem.close();
    const mem2 = new Memory(dir);
    expect(mem2.stats().sessions).toBeGreaterThanOrEqual(5);
    expect(mem2.searchFacts("interstellar", 5)).toHaveLength(0); // deleted earlier
    expect(mem2.searchFacts("spaceship", 5)).toHaveLength(1);
    mem = mem2;
  });
});
