import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Memory, loadConfig } from "../core/index.ts";
import { startWebServer } from "../shell/web.ts";

let dir: string;
let mem: Memory;
let server: ReturnType<typeof startWebServer>;
const PORT = 4599;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "cortex-web-"));
  mem = new Memory(dir);

  const s = mem.createSession("web session");
  mem.addMessage(s, "user", "the password hint is blue banana");
  mem.addMessage(s, "assistant", "noted.");
  mem.addFact("user likes deep space", "fact", s);
  mem.addJournal("Today I visited the dashboard.", s);
  mem.setPreference("editor", "vim");

  const config = loadConfig();
  config.web.port = PORT;
  server = startWebServer(config, mem, dir);
});

afterAll(() => {
  server.close();
  mem.close();
  rmSync(dir, { recursive: true, force: true });
});

const base = `http://127.0.0.1:${PORT}`;

async function getJson(path: string) {
  const r = await fetch(base + path);
  return { status: r.status, body: (await r.json()) as any };
}

async function post(path: string) {
  const r = await fetch(base + path, { method: "POST" });
  return { status: r.status, body: (await r.json()) as any };
}

describe("web dashboard API", () => {
  test("GET / serves the dashboard html", async () => {
    const r = await fetch(base + "/");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("text/html");
    expect(await r.text()).toContain("CORTEX");
  });

  test("GET /api/stats", async () => {
    const { status, body } = await getJson("/api/stats");
    expect(status).toBe(200);
    expect(body.facts).toBeGreaterThanOrEqual(1);
    expect(body.journal).toBeGreaterThanOrEqual(1);
    expect(body.preferences).toBeGreaterThanOrEqual(1);
  });

  test("GET /api/facts + search", async () => {
    const { body } = await getJson("/api/facts");
    expect(body.length).toBeGreaterThanOrEqual(1);
    const { body: searched } = await getJson("/api/facts?q=space");
    expect(searched.some((f: any) => /space/i.test(f.text))).toBe(true);
  });

  test("fact deactivate/activate/delete", async () => {
    const id = mem.addFact("temporary web fact", "fact");
    let r = await post(`/api/facts/${id}/deactivate`);
    expect(r.status).toBe(200);
    expect(mem.listFacts(true).some((f) => f.id === id)).toBe(false);

    r = await post(`/api/facts/${id}/activate`);
    expect(r.status).toBe(200);
    expect(mem.listFacts(true).some((f) => f.id === id)).toBe(true);

    r = await post(`/api/facts/${id}/delete`);
    expect(r.status).toBe(200);
    expect(mem.listFacts(false).some((f) => f.id === id)).toBe(false);
  });

  test("journal + delete", async () => {
    const { body } = await getJson("/api/journal");
    expect(body.length).toBeGreaterThanOrEqual(1);
    const id = body[0].id;
    await post(`/api/journal/${id}/delete`);
    const { body: after } = await getJson("/api/journal");
    expect(after.some((j: any) => j.id === id)).toBe(false);
  });

  test("preferences", async () => {
    const { body } = await getJson("/api/preferences");
    expect(body.some((p: any) => p.key === "editor" && p.value === "vim")).toBe(true);
  });

  test("sessions include message_count", async () => {
    const { body } = await getJson("/api/sessions");
    expect(body.length).toBeGreaterThanOrEqual(1);
    expect(body[0].message_count).toBeGreaterThanOrEqual(0);
  });

  test("messages by session", async () => {
    const sessions = (await getJson("/api/sessions")).body as any[];
    const sid = sessions[0].id;
    const { body } = await getJson(`/api/messages?sessionId=${encodeURIComponent(sid)}`);
    expect(body.some((m: any) => m.content.includes("blue banana"))).toBe(true);
  });

  test("search endpoint", async () => {
    const { body } = await getJson("/api/search?q=banana");
    expect(body.some((m: any) => m.content.includes("banana"))).toBe(true);
  });

  test("reminders: add, list, cancel", async () => {
    const add = await fetch(base + "/api/reminders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "in 5 minutes feed the cat" }),
    });
    expect(add.status).toBe(200);
    const added = (await add.json()) as any;
    expect(added.text).toBe("feed the cat");

    const { body: list } = await getJson("/api/reminders");
    expect(list.some((r: any) => r.id === added.id)).toBe(true);

    const cancel = await post(`/api/reminders/${added.id}/cancel`);
    expect(cancel.status).toBe(200);
    const { body: after } = await getJson("/api/reminders");
    expect(after.some((r: any) => r.id === added.id)).toBe(false);
  });

  test("reminders: unparseable time is a 400", async () => {
    const add = await fetch(base + "/api/reminders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "sometime later maybe" }),
    });
    expect(add.status).toBe(400);
  });

  test("semantic endpoint without embeddings reports unavailable", async () => {
    const { body } = await getJson("/api/semantic?q=space");
    expect(body.error).toBeTruthy();
  });

  test("export endpoint returns a full bundle", async () => {
    const r = await fetch(base + "/api/export");
    expect(r.status).toBe(200);
    const bundle = (await r.json()) as any;
    expect(bundle.version).toBe(1);
    expect(bundle.messages.some((m: any) => m.content.includes("blue banana"))).toBe(true);
    expect(bundle.facts.length).toBeGreaterThanOrEqual(1);
  });

  test("404 for unknown paths", async () => {
    const r = await fetch(base + "/api/nope");
    expect(r.status).toBe(404);
  });
});
