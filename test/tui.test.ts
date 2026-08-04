import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HistoryFile, parseKeys } from "../shell/tui.ts";

const enc = (s: string) => new TextEncoder().encode(s);

describe("parseKeys", () => {
  test("plain characters", () => {
    const keys = parseKeys(enc("hi"));
    expect(keys).toEqual([
      { type: "char", ch: "h" },
      { type: "char", ch: "i" },
    ]);
  });

  test("enter, backspace, tab, ctrl combos", () => {
    const keys = parseKeys(enc("\r\x7f\t\x01\x05\x03\x04\x12"));
    expect(keys.map((k) => k.type)).toEqual([
      "enter", "backspace", "tab", "ctrl-a", "ctrl-e", "ctrl-c", "ctrl-d", "ctrl-r",
    ]);
  });

  test("arrow keys and home/end/delete", () => {
    const keys = parseKeys(enc("\x1b[A\x1b[B\x1b[C\x1b[D\x1b[H\x1b[F\x1b[3~"));
    expect(keys.map((k) => k.type)).toEqual([
      "up", "down", "right", "left", "home", "end", "delete",
    ]);
  });

  test("bare escape", () => {
    expect(parseKeys(enc("\x1b"))[0].type).toBe("escape");
  });
});

describe("HistoryFile", () => {
  test("persists entries to disk and re-orders repeats", () => {
    const dir = mkdtempSync(join(tmpdir(), "cortex-hist-"));
    const file = join(dir, "history");
    const h = new HistoryFile(file, 100);
    h.add("hello");
    h.add("world");
    h.add("hello"); // repeated -> moved to most-recent
    expect(h.all).toEqual(["world", "hello"]);

    const h2 = new HistoryFile(file, 100);
    expect(h2.all).toEqual(["world", "hello"]);
    rmSync(dir, { recursive: true, force: true });
  });

  test("respects max size", () => {
    const dir = mkdtempSync(join(tmpdir(), "cortex-hist2-"));
    const file = join(dir, "history");
    const h = new HistoryFile(file, 3);
    for (const s of ["a", "b", "c", "d", "e"]) h.add(s);
    expect(h.all).toEqual(["c", "d", "e"]);
    rmSync(dir, { recursive: true, force: true });
  });
});
