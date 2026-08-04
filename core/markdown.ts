export const colors = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  gray: "\x1b[90m",
  magenta: "\x1b[35m",
  blue: "\x1b[34m",
  heading: "\x1b[33;1m",
  boldCyan: "\x1b[36;1m",
  code: "\x1b[32m",
  codeDim: "\x1b[32;2m",
} as const;

type Mode = "normal" | "bold" | "code" | "codeblock";

/**
 * Streaming markdown renderer. Re-renders the full buffer on every push and
 * returns only the newly-produced ANSI suffix, so mid-stream delimiters are
 * handled correctly and output stays deterministic. Every opening code is a
 * single escape sequence paired with exactly one reset, and every delimiter
 * closes (or is held) as soon as its final token arrives.
 */
export class MarkdownStream {
  private buffer = "";
  private emitted = 0;

  push(chunk: string): string {
    this.buffer += chunk;
    return this.delta(this.render(this.buffer, true));
  }

  flush(): string {
    return this.delta(this.render(this.buffer, false));
  }

  private delta(full: string): string {
    const out = full.slice(this.emitted);
    this.emitted = full.length;
    return out;
  }

  private render(s: string, holdTail: boolean): string {
    let out = "";
    let mode: Mode = "normal";
    let lineStart = true;
    let heading = false;
    let list = false;
    let skipNl = false;
    let i = 0;
    const n = s.length;

    const at = (j: number, token: string) => s.startsWith(token, j);

    /** Hold a trailing delimiter that might still be mid-token. */
    const holdTrailing = (j: number, ch: string): boolean => {
      if (!holdTail) return false;
      let k = j;
      while (k < n && s[k] === ch) k++;
      if (k !== n) return false; // the run is followed by other chars
      const count = n - j;
      if (mode === "code" || mode === "codeblock") return ch === "`" && count <= 3;
      if (mode === "bold") return ch === "*" && count <= 2;
      if (mode === "normal") {
        if (ch === "`") return count <= 3; // could be `, `` or the start of ```
        if (ch === "*") return count <= 2; // could become **
        return false;
      }
      return false;
    };

    const hold = (j: number, ch: string): boolean => {
      if (!holdTail || j !== n - 1) return false;
      if (mode === "normal") return ch === "#"; // heading marker
      return false;
    };

    const closeEmphasis = (): void => {
      if (heading || list) {
        out += colors.reset;
        heading = false;
        list = false;
      }
      if (mode !== "normal") {
        out += colors.reset;
        mode = "normal";
      }
    };

    while (i < n) {
      const ch = s[i];

      if (mode === "codeblock") {
        if (at(i, "```")) {
          closeEmphasis();
          skipNl = true;
          i += 3;
          continue;
        }
        if (holdTrailing(i, ch)) break;
        if (ch === "\n") {
          if (skipNl) {
            skipNl = false;
            i++;
            continue;
          }
          out += "\n";
          i++;
          continue;
        }
        out += ch;
        i++;
        continue;
      }

      if (mode === "code") {
        if (ch === "`") {
          closeEmphasis();
          i += 1;
          continue;
        }
        if (holdTrailing(i, ch)) break;
        out += ch;
        i++;
        continue;
      }

      if (mode === "bold") {
        if (at(i, "**")) {
          closeEmphasis();
          i += 2;
          continue;
        }
        if (holdTrailing(i, ch)) break;
        out += ch;
        i++;
        continue;
      }

      // normal mode
      if (ch === "\n") {
        if (skipNl) {
          skipNl = false;
          i++;
          continue;
        }
        out += "\n";
        closeEmphasis();
        lineStart = true;
        i++;
        continue;
      }
      if (at(i, "```")) {
        out += colors.codeDim;
        mode = "codeblock";
        skipNl = true;
        i += 3;
        continue;
      }
      if (holdTrailing(i, ch)) break; // defer partial ` / * delimiters
      if (ch === "`") {
        out += colors.code;
        mode = "code";
        i += 1;
        continue;
      }
      if (at(i, "**")) {
        out += colors.boldCyan;
        mode = "bold";
        i += 2;
        continue;
      }
      if (lineStart && ch === "#") {
        if (hold(i, ch)) break;
        out += colors.heading;
        heading = true;
        out += ch;
        lineStart = false;
        i++;
        continue;
      }
      if (lineStart && (at(i, "- ") || at(i, "* ") || at(i, "> "))) {
        out += colors.dim;
        list = true;
        out += s[i];
        out += s[i + 1];
        lineStart = false;
        i += 2;
        continue;
      }
      if (lineStart && /^\d/.test(ch) && s[i + 1] === ".") {
        out += colors.dim;
        list = true;
        out += s[i];
        out += s[i + 1];
        lineStart = false;
        i += 2;
        continue;
      }
      if (hold(i, ch)) break;
      out += ch;
      lineStart = false;
      i++;
    }

    if (!holdTail) {
      closeEmphasis();
    }
    return out;
  }
}

export function paint(text: string, color: keyof typeof colors): string {
  return `${colors[color]}${text}${colors.reset}`;
}
