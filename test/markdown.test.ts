import { describe, expect, test } from "bun:test";
import { MarkdownStream, paint } from "../core/index.ts";

const ANSI = /\x1b\[\d+m/;

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

function countCodes(s: string): number {
  return (s.match(/\x1b\[[0-9;]*m/g) ?? []).length;
}

function renderAll(text: string, hold = false): string {
  const ms = new MarkdownStream();
  const out = ms.push(text) + ms.flush();
  return out;
}

describe("static rendering", () => {
  test("plain text passes through without escapes", () => {
    expect(renderAll("just plain words")).toBe("just plain words");
  });

  test("**bold** is wrapped in color", () => {
    const out = renderAll("a **bold** word");
    expect(out).toContain("\x1b[36;1m");
    expect(stripAnsi(out)).toBe("a bold word");
  });

  test("inline `code` and ```codeblocks```", () => {
    const out = renderAll("use `rm -rf` carefully\n```\nlet x = 1\n```\nend");
    expect(stripAnsi(out)).toBe("use rm -rf carefully\nlet x = 1\nend");
  });

  test("heading, list, blockquote, numbered list", () => {
    const src = "# Title\n- item a\n> quote\n1. first\n- item b";
    const out = renderAll(src);
    expect(stripAnsi(out)).toBe(src);
    expect(out).toContain("\x1b[33;1m"); // heading yellow+bold
  });

  test("every opening code is closed by reset", () => {
    const src = "# H\n**bold** and `code` and\n```\nblock\n```\n> q\n- list\n";
    const out = renderAll(src);
    const opens = out.replace(/\x1b\[0m/g, "").match(/\x1b\[[0-9;]*m/g)?.length ?? 0;
    const resets = (out.match(/\x1b\[0m/g) ?? []).length;
    expect(resets).toBe(opens);
  });
});

describe("streaming correctness", () => {
  const samples = [
    "hello",
    "**bo",
    "ld** te",
    "xt `co",
    "de` now",
    "# head",
    "ing\n- it",
    "em\n```\nfence",
    "d\n```\nend",
    "multi\nline\nplain",
    "**unclosed",
  ];

  test("streaming output equals single-shot render", () => {
    const full = samples.join("");
    const ms = new MarkdownStream();
    let streamed = "";
    for (const chunk of samples) {
      streamed += ms.push(chunk);
    }
    streamed += ms.flush();
    expect(streamed).toBe(renderAll(full));
    // all delimiters swallowed, all content survives (fence-adjacent newlines skipped)
    const text = stripAnsi(streamed);
    expect(text).not.toContain("**");
    expect(text).not.toContain("`");
    expect(text).toContain("fenced");
    expect(text).toContain("# heading");
    expect(text).toContain("- item");
  });

  test("mid-stream chunks never emit dangling codes without a reset", () => {
    const ms = new MarkdownStream();
    let seen = "";
    for (const chunk of samples) {
      seen += ms.push(chunk);
    }
    // every colored open we saw must have a matching reset later; final flush resets all
    const finalOut = seen + ms.flush();
    const opens = finalOut.replace(/\x1b\[0m/g, "").match(/\x1b\[[0-9;]*m/g)?.length ?? 0;
    const resets = (finalOut.match(/\x1b\[0m/g) ?? []).length;
    expect(resets).toBe(opens);
    // no trailing incomplete control sequence (stream would glitch)
    expect(seen.endsWith("\x1b")).toBe(false);
  });

  test("char-by-char streaming is stable", () => {
    const src = "**bold** and `x` and ```code```";
    const ms = new MarkdownStream();
    let out = "";
    for (const ch of src) out += ms.push(ch);
    out += ms.flush();
    expect(stripAnsi(out)).toBe(src.replace(/\*\*/g, "").replace(/`/g, ""));
    expect(out).toBe(renderAll(src));
  });
});

describe("paint", () => {
  test("wraps and resets", () => {
    expect(paint("x", "green")).toBe("\x1b[32mx\x1b[0m");
    expect(ANSI.test(paint("y", "cyan"))).toBe(true);
  });
});
