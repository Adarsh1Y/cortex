import { describe, expect, test } from "bun:test";
import { PermissionPolicy } from "../core/index.ts";

const policy = new PermissionPolicy({
  auto_allow: ["read", "ls", "grep", "glob", "webfetch", "bash:read"],
  auto_deny: ["write", "edit"],
  ask: false,
});

const req = (type: string, pattern?: string) => ({
  id: "p1",
  type,
  pattern,
  title: type,
  sessionID: "s1",
});

describe("PermissionPolicy", () => {
  test("allows listed read-only tools", () => {
    expect(policy.decide(req("read", "/home/user/file"))).toBe("allow");
    expect(policy.decide(req("ls"))).toBe("allow");
    expect(policy.decide(req("grep"))).toBe("allow");
    expect(policy.decide(req("glob"))).toBe("allow");
    expect(policy.decide(req("webfetch"))).toBe("allow");
  });

  test("allows read-only bash commands only", () => {
    expect(policy.decide(req("bash", "cat /etc/hostname"))).toBe("allow");
    expect(policy.decide(req("bash", "git status"))).toBe("allow");
    expect(policy.decide(req("bash", "ls -la ~"))).toBe("allow");
    expect(policy.decide(req("bash", "grep -r foo ."))).toBe("allow");
    expect(policy.decide(req("bash", "rm -rf /"))).toBe("deny");
    expect(policy.decide(req("bash", "git push origin main"))).toBe("deny");
  });

  test("denies unlisted tools by default", () => {
    expect(policy.decide(req("task"))).toBe("deny");
    expect(policy.decide(req("agent"))).toBe("deny");
    expect(policy.decide(req("mcp__files__write"))).toBe("deny");
  });

  test("auto_deny wins over auto_allow", () => {
    expect(policy.decide(req("write", "/tmp/x"))).toBe("deny");
    expect(policy.decide(req("edit"))).toBe("deny");
  });

  test("wildcard rules match type prefixes", () => {
    const wild = new PermissionPolicy({ auto_allow: ["mcp__calendar__*"], auto_deny: [], ask: false });
    expect(wild.decide(req("mcp__calendar__list"))).toBe("allow");
    expect(wild.decide(req("mcp__files__read"))).toBe("deny");
  });

  test("ask mode returns ask for unlisted", () => {
    const asking = new PermissionPolicy({ auto_allow: ["read"], auto_deny: [], ask: true });
    expect(asking.decide(req("read"))).toBe("allow");
    expect(asking.decide(req("bash", "rm file"))).toBe("ask");
  });
});
