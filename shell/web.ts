import {
  expandHome,
  loadConfig,
  loadPersona,
  Memory,
  resolvePersonaPath,
} from "@cortex/core";
import type { CortexConfig } from "@cortex/core";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>CORTEX — memory dashboard</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; background: #0d1117; color: #c9d1d9; }
  header { padding: 16px 24px; border-bottom: 1px solid #21262d; display: flex; align-items: baseline; gap: 12px; }
  header h1 { font-size: 18px; margin: 0; color: #58a6ff; }
  header .sub { color: #8b949e; font-size: 12px; }
  main { padding: 24px; max-width: 1200px; margin: 0 auto; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin-bottom: 24px; }
  .card { background: #161b22; border: 1px solid #21262d; border-radius: 8px; padding: 16px; }
  .card .num { font-size: 28px; font-weight: 700; color: #58a6ff; }
  .card .lbl { color: #8b949e; font-size: 12px; text-transform: uppercase; letter-spacing: .5px; }
  section { margin-bottom: 24px; }
  h2 { font-size: 15px; color: #e6edf3; border-bottom: 1px solid #21262d; padding-bottom: 8px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #21262d; vertical-align: top; }
  th { color: #8b949e; font-size: 12px; text-transform: uppercase; }
  .tag { display: inline-block; padding: 1px 8px; border-radius: 10px; font-size: 11px; background: #1f6feb33; color: #79c0ff; }
  .tag.pref { background: #2ea04333; color: #7ee787; }
  .tag.err { background: #f8514933; color: #ffa198; }
  .tag.dec { background: #d2992233; color: #e3b341; }
  button { background: #21262d; color: #c9d1d9; border: 1px solid #30363d; border-radius: 6px; padding: 4px 10px; cursor: pointer; font: inherit; }
  button:hover { background: #30363d; }
  input[type=text] { background: #0d1117; color: #e6edf3; border: 1px solid #30363d; border-radius: 6px; padding: 8px 12px; width: 100%; font: inherit; }
  .mono { color: #8b949e; font-size: 12px; }
  .msg-you { color: #79c0ff; }
  .msg-cortex { color: #7ee787; }
  .fact-actions { display: flex; gap: 6px; }
  .inactive { opacity: .45; }
</style>
</head>
<body>
<header>
  <h1>CORTEX</h1><span class="sub">memory dashboard · everything it remembers</span>
</header>
<main>
  <div class="grid" id="stats"></div>

  <section>
    <h2>Distilled facts</h2>
    <input type="text" id="fact-search" placeholder="search facts…" />
    <table id="facts-table"></table>
  </section>

  <section>
    <h2>Life story (journal)</h2>
    <table id="journal-table"></table>
  </section>

  <section>
    <h2>Preferences</h2>
    <table id="prefs-table"></table>
  </section>

  <section>
    <h2>Sessions</h2>
    <input type="text" id="session-filter" placeholder="filter sessions…" />
    <table id="sessions-table"></table>
  </section>

  <section id="messages-section" style="display:none">
    <h2 id="messages-title">Messages</h2>
    <table id="messages-table"></table>
  </section>
</main>
<script>
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const tag = (c) => \`<span class="tag \${c === 'preference' ? 'pref' : c === 'error' ? 'err' : c === 'decision' ? 'dec' : ''}">\${esc(c)}</span>\`;
const when = (t) => new Date(t).toLocaleString();

async function get(url) { const r = await fetch(url); return r.json(); }
async function post(url) { await fetch(url, { method: 'POST' }); refresh(); }

async function loadStats() {
  const s = await get('/api/stats');
  const items = [['sessions', s.sessions], ['messages', s.messages], ['facts', s.facts], ['journal', s.journal], ['preferences', s.preferences]];
  document.getElementById('stats').innerHTML = items.map(([l, n]) =>
    \`<div class="card"><div class="num">\${n}</div><div class="lbl">\${l}</div></div>\`).join('');
}

async function loadFacts() {
  const q = document.getElementById('fact-search').value.trim();
  const facts = q ? await get('/api/facts?q=' + encodeURIComponent(q)) : await get('/api/facts');
  const rows = facts.map(f =>
    \`<tr class="\${f.active ? '' : 'inactive'}">
       <td>\${f.id}</td><td>\${tag(f.category)}</td><td>\${esc(f.text)}</td>
       <td class="mono">\${when(f.updated_at)}</td>
       <td><div class="fact-actions">
         \${f.active
           ? \`<button onclick="post('/api/facts/\${f.id}/deactivate')">forget</button>\`
           : \`<button onclick="post('/api/facts/\${f.id}/activate')">restore</button>\`}
         <button onclick="post('/api/facts/\${f.id}/delete')">delete</button>
       </div></td>
     </tr>\`).join('');
  document.getElementById('facts-table').innerHTML =
    \`<tr><th>id</th><th>cat</th><th>text</th><th>updated</th><th></th></tr>\` + rows;
}

async function loadJournal() {
  const j = await get('/api/journal');
  const rows = j.map(x =>
    \`<tr><td>\${x.id}</td><td class="mono">\${when(x.created_at)}</td><td>\${esc(x.summary)}</td>
     <td><button onclick="post('/api/journal/\${x.id}/delete')">delete</button></td></tr>\`).join('');
  document.getElementById('journal-table').innerHTML =
    \`<tr><th>id</th><th>when</th><th>entry</th><th></th></tr>\` + rows;
}

async function loadPrefs() {
  const p = await get('/api/preferences');
  const rows = p.map(x => \`<tr><td>\${esc(x.key)}</td><td>\${esc(x.value)}</td></tr>\`).join('');
  document.getElementById('prefs-table').innerHTML = \`<tr><th>key</th><th>value</th></tr>\` + rows;
}

async function loadSessions() {
  const filter = document.getElementById('session-filter').value.toLowerCase();
  let s = await get('/api/sessions');
  if (filter) s = s.filter(x => (x.title || '').toLowerCase().includes(filter) || (x.id || '').toLowerCase().includes(filter));
  const rows = s.map(x =>
    \`<tr><td class="mono">\${esc(x.id.slice(0, 12))}</td><td>\${esc(x.title)}</td>
     <td>\${x.message_count}</td><td class="mono">\${when(x.created_at)}</td>
     <td><button onclick="loadMessages('\${x.id}')">view</button></td></tr>\`).join('');
  document.getElementById('sessions-table').innerHTML =
    \`<tr><th>id</th><th>title</th><th>msgs</th><th>created</th><th></th></tr>\` + rows;
}

async function loadMessages(sessionId) {
  const data = await get('/api/messages?sessionId=' + encodeURIComponent(sessionId));
  document.getElementById('messages-section').style.display = 'block';
  document.getElementById('messages-title').textContent = 'Messages — ' + sessionId.slice(0, 12);
  const rows = data.map(m =>
    \`<tr><td class="mono">\${when(m.created_at)}</td>
     <td class="\${m.role === 'user' ? 'msg-you' : 'msg-cortex'}">\${m.role}</td>
     <td>\${esc(m.content)}</td></tr>\`).join('');
  document.getElementById('messages-table').innerHTML =
    \`<tr><th>when</th><th>role</th><th>content</th></tr>\` + rows;
}

function refresh() { loadStats(); loadFacts(); loadJournal(); loadPrefs(); loadSessions(); }
document.getElementById('fact-search').addEventListener('input', loadFacts);
document.getElementById('session-filter').addEventListener('input', loadSessions);
refresh();
</script>
</body>
</html>`;

export function startWebServer(config: CortexConfig, memory: Memory, dataDir: string): { port: number; close(): void } {
  const port = config.web.port;
  const server = Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;

      if (req.method === "OPTIONS") {
        return new Response(null, { headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-headers": "content-type" } });
      }

      if (path === "/") return new Response(PAGE, { headers: { "content-type": "text/html" } });

      if (path === "/api/stats") return json(memory.stats());

      if (path === "/api/facts" && req.method === "GET") {
        const q = url.searchParams.get("q") ?? "";
        return json(q ? memory.searchFacts(q, 30) : memory.listFacts(false, 200));
      }
      const factMatch = path.match(/^\/api\/facts\/(\d+)\/(delete|deactivate|activate)$/);
      if (factMatch && req.method === "POST") {
        const id = Number(factMatch[1]);
        if (factMatch[2] === "delete") memory.deleteFact(id);
        else memory.setFactActive(id, factMatch[2] === "activate");
        return json({ ok: true });
      }

      if (path === "/api/journal" && req.method === "GET") return json(memory.latestJournal(50));
      const journalMatch = path.match(/^\/api\/journal\/(\d+)\/delete$/);
      if (journalMatch && req.method === "POST") {
        memory.deleteJournal(Number(journalMatch[1]));
        return json({ ok: true });
      }

      if (path === "/api/preferences") return json(memory.allPreferences());

      if (path === "/api/sessions") {
        const sessions = memory
          .listSessions()
          .map((s) => ({
            ...s,
            message_count: memory.countMessages(s.id),
          }))
          .sort((a, b) => b.created_at - a.created_at)
          .slice(0, 50);
        return json(sessions);
      }

      if (path === "/api/messages") {
        const sessionId = url.searchParams.get("sessionId");
        if (!sessionId) return json({ error: "missing sessionId" }, 400);
        return json(memory.getMessages(sessionId));
      }

      if (path === "/api/search") {
        const q = url.searchParams.get("q") ?? "";
        return json(memory.searchMessages(q, 20));
      }

      return json({ error: "not found" }, 404);
    },
  });
  console.log(`\n  CORTEX dashboard: http://127.0.0.1:${server.port}\n`);
  return { port: server.port ?? config.web.port, close: () => server.stop(true) };
}

if (import.meta.main) {
  const config = loadConfig();
  const persona = loadPersona(resolvePersonaPath(config));
  void persona;
  const dataDir = expandHome(config.data_dir);
  const memory = new Memory(dataDir);
  const server = startWebServer(config, memory, dataDir);
  const shutdown = () => {
    memory.close();
    server.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
