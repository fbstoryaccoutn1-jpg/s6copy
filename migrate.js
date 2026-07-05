/**
 * Migration Worker - KV to D1
 * Run once: visit /migrate to start migration
 * Secret key required to prevent unauthorized access
 */

const MIGRATE_SECRET = "migrate-lnkfy-2026";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname !== "/migrate") {
      return new Response("Not found", { status: 404 });
    }

    const secret = url.searchParams.get("secret");
    if (secret !== MIGRATE_SECRET) {
      return new Response("Unauthorized", { status: 401 });
    }

    const results = {
      users: { success: 0, failed: 0, skipped: 0 },
      links: { success: 0, failed: 0, skipped: 0 },
      clicks: { success: 0, failed: 0, skipped: 0 },
      errors: []
    };

    // ---- Migrate USERS ----
    try {
      const userList = await env.USERS.list();
      for (const key of userList.keys) {
        try {
          const raw = await env.USERS.get(key.name);
          if (!raw) continue;
          const u = JSON.parse(raw);

          const existing = await env.DB.prepare(
            "SELECT email FROM users WHERE email = ?"
          ).bind(u.email).first();

          if (existing) {
            results.users.skipped++;
            continue;
          }

          await env.DB.prepare(
            "INSERT INTO users (email, password_hash, salt, created) VALUES (?, ?, ?, ?)"
          ).bind(u.email, u.passwordHash, u.salt, u.created || Date.now()).run();

          results.users.success++;
        } catch (e) {
          results.users.failed++;
          results.errors.push(`User ${key.name}: ${e.message}`);
        }
      }
    } catch (e) {
      results.errors.push(`Users list error: ${e.message}`);
    }

    // ---- Migrate LINKS ----
    try {
      const linkList = await env.LINKS.list();
      for (const key of linkList.keys) {
        // skip click keys
        if (key.name.startsWith("click:")) continue;

        try {
          const raw = await env.LINKS.get(key.name);
          if (!raw) continue;
          const l = JSON.parse(raw);

          const existing = await env.DB.prepare(
            "SELECT code FROM links WHERE code = ?"
          ).bind(key.name).first();

          if (existing) {
            results.links.skipped++;
            continue;
          }

          await env.DB.prepare(
            "INSERT INTO links (code, url, owner, created, clicks) VALUES (?, ?, ?, ?, ?)"
          ).bind(key.name, l.url, l.owner || "", l.created || Date.now(), l.clicks || 0).run();

          results.links.success++;
        } catch (e) {
          results.links.failed++;
          results.errors.push(`Link ${key.name}: ${e.message}`);
        }
      }
    } catch (e) {
      results.errors.push(`Links list error: ${e.message}`);
    }

    // ---- Migrate CLICKS ----
    try {
      const clickList = await env.CLICKS.list();
      for (const key of clickList.keys) {
        try {
          const raw = await env.CLICKS.get(key.name);
          if (!raw) continue;
          const c = JSON.parse(raw);

          // Extract code from key: "click:CODE:timestamp:random"
          const parts = key.name.split(":");
          const code = parts[1] || "unknown";

          const existing = await env.DB.prepare(
            "SELECT id FROM clicks WHERE id = ?"
          ).bind(key.name).first();

          if (existing) {
            results.clicks.skipped++;
            continue;
          }

          await env.DB.prepare(
            "INSERT INTO clicks (id, code, country, device, platform, browser, source, ts) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
          ).bind(
            key.name,
            code,
            c.country || "Unknown",
            c.device || "Unknown",
            c.platform || "Unknown",
            c.browser || "Unknown",
            c.source || "direct",
            c.ts || Date.now()
          ).run();

          results.clicks.success++;
        } catch (e) {
          results.clicks.failed++;
          results.errors.push(`Click ${key.name}: ${e.message}`);
        }
      }
    } catch (e) {
      results.errors.push(`Clicks list error: ${e.message}`);
    }

    const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Migration Results</title>
<style>
body{font-family:monospace;background:#0b0e14;color:#e8eaed;padding:2rem;max-width:800px;margin:0 auto}
h1{color:#4f7cff}
.box{background:#141a24;border:1px solid #232b38;border-radius:10px;padding:1rem;margin:1rem 0}
.success{color:#4ade80}
.failed{color:#f87171}
.skipped{color:#facc15}
table{width:100%;border-collapse:collapse}
th,td{padding:.5rem;text-align:left;border-bottom:1px solid #232b38}
th{color:#8b94a3}
</style></head>
<body>
<h1>✅ Migration Complete!</h1>
<div class="box">
<table>
<tr><th>Type</th><th class="success">Success</th><th class="failed">Failed</th><th class="skipped">Skipped</th></tr>
<tr><td>Users</td><td class="success">${results.users.success}</td><td class="failed">${results.users.failed}</td><td class="skipped">${results.users.skipped}</td></tr>
<tr><td>Links</td><td class="success">${results.links.success}</td><td class="failed">${results.links.failed}</td><td class="skipped">${results.links.skipped}</td></tr>
<tr><td>Clicks</td><td class="success">${results.clicks.success}</td><td class="failed">${results.clicks.failed}</td><td class="skipped">${results.clicks.skipped}</td></tr>
</table>
</div>
${results.errors.length ? `
<div class="box">
<h3 class="failed">Errors (${results.errors.length}):</h3>
${results.errors.map(e => `<div class="failed">• ${e}</div>`).join("")}
</div>` : `<div class="box"><p class="success">No errors! Migration successful.</p></div>`}
<p style="color:#8b94a3;margin-top:2rem">Migration done. Now deploy main worker.js and delete this migrate.js file.</p>
</body></html>`;

    return new Response(html, { headers: { "Content-Type": "text/html" } });
  }
};
