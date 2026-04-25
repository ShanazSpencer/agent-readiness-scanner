/* =====================================================
   Agent Readiness Scanner — Logic
   Runs 14 checks via a public CORS proxy, scores them
   0–100 across 4 categories, renders results.

   NOTE for production deployment:
   ──────────────────────────────
   The public CORS proxy is fine for a v1 / demo, but
   it's rate-limited and beyond your control. For
   production move fetches server-side via a Cloudflare
   Worker, Vercel Edge Function, or your own endpoint.
   ===================================================== */

const PROXY = "https://corsproxy.io/?url=";

/* ---------- Check definitions ---------- */
const CHECKS = [
  // Discoverability — 25 pts
  { id: "robots",     cat: "discoverability", weight: 6,  label: "robots.txt present",                  hint: "Agents respect robots — missing = invisible by default." },
  { id: "bots",       cat: "discoverability", weight: 8,  label: "AI bot policy declared",              hint: "Explicit GPTBot / ClaudeBot / PerplexityBot rules." },
  { id: "llmstxt",    cat: "discoverability", weight: 6,  label: "llms.txt file",                        hint: "Emerging standard for instructing LLMs how to use your content." },
  { id: "sitemap",    cat: "discoverability", weight: 5,  label: "sitemap.xml",                         hint: "Lets agents index everything you offer." },

  // Structured data — 25 pts
  { id: "jsonld",     cat: "structured",      weight: 10, label: "JSON-LD schema.org markup",           hint: "Machine-readable identity for your business." },
  { id: "ogmeta",     cat: "structured",      weight: 5,  label: "Open Graph metadata",                 hint: "Basic preview signals agents still fall back to." },
  { id: "orgschema",  cat: "structured",      weight: 5,  label: "Organization / LocalBusiness schema", hint: "Tells agents what kind of entity you are." },
  { id: "productsch", cat: "structured",      weight: 5,  label: "Product / Offer schema",              hint: "Required for agents to compare and cite your offerings." },

  // Agent access — 25 pts
  { id: "mcp",        cat: "access",          weight: 12, label: "MCP server endpoint",                 hint: "Model Context Protocol — how agents query you directly. Almost nobody has this yet." },
  { id: "openapi",    cat: "access",          weight: 7,  label: "Public API / OpenAPI spec",           hint: "Agents prefer APIs over scraping HTML." },
  { id: "wellknown",  cat: "access",          weight: 6,  label: ".well-known surfaces",                hint: "Standard discovery endpoints: api-catalog, agent, ai-plugin." },

  // Transaction readiness — 25 pts
  { id: "pricing",    cat: "transaction",     weight: 9,  label: "Machine-readable pricing",            hint: "Schema with priceSpecification or product feed." },
  { id: "feed",       cat: "transaction",     weight: 8,  label: "Product / services feed",             hint: "products.json, RSS, or similar structured catalogue." },
  { id: "oauth",      cat: "transaction",     weight: 8,  label: "Agent auth (OAuth / ACP hints)",     hint: "OAuth discovery + Agentic Commerce Protocol signals." },
];

const CATEGORIES = {
  discoverability: { label: "Discoverability", blurb: "Can agents find you?" },
  structured:      { label: "Structured data", blurb: "Can they read you?" },
  access:          { label: "Agent access",    blurb: "Can they query you?" },
  transaction:     { label: "Transaction",     blurb: "Can they buy?" },
};

/* ---------- Utility: fetch via proxy with timeout ---------- */
async function safeFetch(url, timeoutMs = 7000) {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(PROXY + encodeURIComponent(url), { signal: ctrl.signal });
    clearTimeout(timer);
    if (!r.ok) return { ok: false, status: r.status, text: "" };
    const text = await r.text();
    return { ok: true, status: r.status, text };
  } catch (e) {
    clearTimeout(timer);
    return { ok: false, status: 0, text: "", err: e.message };
  }
}

/* ---------- Individual checks ---------- */
async function checkRobots(base) {
  const r = await safeFetch(base + "/robots.txt");
  const out = {
    robots: { state: "fail", detail: "No robots.txt found." },
    bots:   { state: "fail", detail: "No AI bot policy detected." },
  };
  if (r.ok && r.text && r.text.length < 50000) {
    out.robots = { state: "pass", detail: "robots.txt served correctly." };
    const t = r.text.toLowerCase();
    const botAgents = [
      "gptbot", "claudebot", "perplexitybot", "google-extended",
      "anthropic-ai", "oai-searchbot", "chatgpt-user", "cohere-ai", "ccbot"
    ];
    const hits = botAgents.filter(b => t.includes(b));
    if (hits.length >= 3)      out.bots = { state: "pass", detail: `Declares policy for ${hits.length} AI bots (${hits.slice(0, 4).join(", ")}${hits.length > 4 ? ", …" : ""}).` };
    else if (hits.length >= 1) out.bots = { state: "warn", detail: `Only ${hits.length} AI bot(s) referenced (${hits.join(", ")}). Add the full major-bot list.` };
    else                       out.bots = { state: "fail", detail: "No explicit rules for GPTBot, ClaudeBot, PerplexityBot etc." };
  }
  return out;
}

async function checkLLMSTxt(base) {
  const r = await safeFetch(base + "/llms.txt");
  if (r.ok && r.text && r.text.trim().length > 20 && !/<html/i.test(r.text)) {
    return { state: "pass", detail: `llms.txt found (${r.text.length} bytes).` };
  }
  return { state: "fail", detail: "No /llms.txt served. Add one — it's the cheapest agent-readiness win." };
}

async function checkSitemap(base) {
  const r = await safeFetch(base + "/sitemap.xml");
  if (r.ok && /<urlset|<sitemapindex/i.test(r.text)) {
    const urls = (r.text.match(/<loc>/g) || []).length;
    return { state: "pass", detail: `sitemap.xml found (${urls} entries).` };
  }
  return { state: "fail", detail: "No sitemap.xml — agents can't enumerate your pages." };
}

async function checkHomepage(base) {
  const r = await safeFetch(base + "/");
  const out = {
    jsonld:     { state: "fail", detail: "No JSON-LD <script> tags found on homepage." },
    ogmeta:     { state: "fail", detail: "No Open Graph tags detected." },
    orgschema:  { state: "fail", detail: "No Organization / LocalBusiness schema present." },
    productsch: { state: "fail", detail: "No Product / Offer schema detected." },
    pricing:    { state: "fail", detail: "No machine-readable price markup on homepage." },
  };
  if (!r.ok || !r.text) return { out, raw: "" };
  const html = r.text;

  // JSON-LD
  const ldMatches = html.match(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi) || [];
  if (ldMatches.length > 0) {
    out.jsonld = { state: "pass", detail: `${ldMatches.length} JSON-LD block(s) detected.` };
    const blob = ldMatches.join(" ").toLowerCase();
    if (/"@type"\s*:\s*"(organization|localbusiness|corporation|store)"/i.test(blob)) {
      out.orgschema = { state: "pass", detail: "Organization-type entity declared." };
    } else {
      out.orgschema = { state: "warn", detail: "Schema present but no Organization / LocalBusiness @type." };
    }
    if (/"@type"\s*:\s*"(product|offer|service)"/i.test(blob)) {
      out.productsch = { state: "pass", detail: "Product / Offer / Service schema found." };
    }
    if (/"price"|"pricespecification"|"priceamount"|"pricecurrency"/i.test(blob)) {
      out.pricing = { state: "pass", detail: "Price markup found inside structured data." };
    }
  }

  // Open Graph
  const ogCount = (html.match(/property=["']og:/gi) || []).length;
  if (ogCount >= 4)       out.ogmeta = { state: "pass", detail: `${ogCount} Open Graph tags detected.` };
  else if (ogCount >= 1)  out.ogmeta = { state: "warn", detail: `Only ${ogCount} OG tag(s) — add og:title, og:description, og:image, og:type at minimum.` };

  return { out, raw: html };
}

async function checkMCP(base) {
  const candidates = ["/.well-known/mcp", "/.well-known/model-context-protocol", "/mcp", "/api/mcp"];
  for (const p of candidates) {
    const r = await safeFetch(base + p);
    if (r.ok && r.text && r.text.length > 0 && !/<html/i.test(r.text.slice(0, 200))) {
      return { state: "pass", detail: `MCP-style endpoint responded at ${p}.` };
    }
  }
  return { state: "fail", detail: "No MCP endpoint detected. Fewer than 1% of UK sites have this — early-mover territory." };
}

async function checkOpenAPI(base) {
  const candidates = ["/openapi.json", "/swagger.json", "/api/openapi.json", "/.well-known/openapi"];
  for (const p of candidates) {
    const r = await safeFetch(base + p);
    if (r.ok && /"openapi"|"swagger"/i.test(r.text)) {
      return { state: "pass", detail: `OpenAPI spec found at ${p}.` };
    }
  }
  return { state: "fail", detail: "No public OpenAPI / Swagger spec detected." };
}

async function checkWellKnown(base) {
  const candidates = ["/.well-known/ai-plugin.json", "/.well-known/api-catalog", "/.well-known/agent"];
  const hits = [];
  for (const p of candidates) {
    const r = await safeFetch(base + p);
    if (r.ok && r.text && r.text.length > 5 && !/<html/i.test(r.text.slice(0, 200))) {
      hits.push(p);
    }
  }
  if (hits.length >= 2) return { state: "pass", detail: `${hits.length} .well-known surfaces responding (${hits.join(", ")}).` };
  if (hits.length === 1) return { state: "warn", detail: `Only 1 .well-known endpoint detected (${hits[0]}). Add the others.` };
  return { state: "fail", detail: "No .well-known discovery surfaces exposed." };
}

async function checkProductFeed(base) {
  const candidates = ["/products.json", "/feed", "/feed.xml", "/rss", "/products.xml"];
  for (const p of candidates) {
    const r = await safeFetch(base + p);
    if (r.ok && r.text && r.text.length > 100) {
      if (/<\?xml|<rss|"products"\s*:|<feed/i.test(r.text)) {
        return { state: "pass", detail: `Structured feed detected at ${p}.` };
      }
    }
  }
  return { state: "fail", detail: "No product / services feed detected." };
}

async function checkOAuth(base) {
  const r1 = await safeFetch(base + "/.well-known/oauth-authorization-server");
  const r2 = await safeFetch(base + "/.well-known/openid-configuration");
  if ((r1.ok && /"issuer"/i.test(r1.text)) || (r2.ok && /"issuer"/i.test(r2.text))) {
    return { state: "pass", detail: "OAuth / OpenID discovery endpoint present — agents can authenticate." };
  }
  return { state: "fail", detail: "No OAuth discovery endpoint. ACP / agent auth not yet wired." };
}

/* ---------- Orchestrator ---------- */
async function runScan(url) {
  const base = url.replace(/\/$/, "");

  const log = (msg) => {
    const el = document.getElementById("scanLog");
    const line = document.createElement("div");
    line.innerHTML = `<span style="color: var(--muted);">${new Date().toISOString().slice(11, 19)}</span> &nbsp; ${msg}`;
    el.appendChild(line);
    el.scrollTop = el.scrollHeight;
  };
  const tick = (n) => document.getElementById("scanProgress").textContent = `${n} / ${CHECKS.length}`;

  const results = {};
  let done = 0;

  log(`→ Resolving <span style="color: var(--cyan-deep); font-weight:600;">${base}</span>`);

  log("→ Fetching /robots.txt …");
  const rob = await checkRobots(base);
  results.robots = rob.robots; results.bots = rob.bots;
  done += 2; tick(done); log(`✓ robots.txt: ${rob.robots.state.toUpperCase()} · bot policy: ${rob.bots.state.toUpperCase()}`);

  log("→ Fetching /llms.txt …");
  results.llmstxt = await checkLLMSTxt(base);
  done++; tick(done); log(`✓ llms.txt: ${results.llmstxt.state.toUpperCase()}`);

  log("→ Fetching /sitemap.xml …");
  results.sitemap = await checkSitemap(base);
  done++; tick(done); log(`✓ sitemap: ${results.sitemap.state.toUpperCase()}`);

  log("→ Parsing homepage HTML …");
  const hp = await checkHomepage(base);
  Object.assign(results, hp.out);
  done += 5; tick(done);
  log(`✓ JSON-LD: ${hp.out.jsonld.state.toUpperCase()} · OG: ${hp.out.ogmeta.state.toUpperCase()} · Org: ${hp.out.orgschema.state.toUpperCase()} · Product: ${hp.out.productsch.state.toUpperCase()} · Pricing: ${hp.out.pricing.state.toUpperCase()}`);

  log("→ Probing MCP endpoints …");
  results.mcp = await checkMCP(base);
  done++; tick(done); log(`✓ MCP: ${results.mcp.state.toUpperCase()}`);

  log("→ Probing /openapi.json · /swagger.json …");
  results.openapi = await checkOpenAPI(base);
  done++; tick(done); log(`✓ OpenAPI: ${results.openapi.state.toUpperCase()}`);

  log("→ Probing .well-known/ surfaces …");
  results.wellknown = await checkWellKnown(base);
  done++; tick(done); log(`✓ .well-known: ${results.wellknown.state.toUpperCase()}`);

  log("→ Probing product / services feed …");
  results.feed = await checkProductFeed(base);
  done++; tick(done); log(`✓ feed: ${results.feed.state.toUpperCase()}`);

  log("→ Probing OAuth / OpenID discovery …");
  results.oauth = await checkOAuth(base);
  done++; tick(done); log(`✓ oauth: ${results.oauth.state.toUpperCase()}`);

  log(`<span style="color: var(--emerald); font-weight:600;">✓ Scan complete.</span>`);

  return results;
}

/* ---------- Scoring + render ---------- */
function scoreAndRender(results) {
  const catTotals = { discoverability: 0, structured: 0, access: 0, transaction: 0 };
  const catMax    = { discoverability: 0, structured: 0, access: 0, transaction: 0 };

  CHECKS.forEach(c => {
    catMax[c.cat] += c.weight;
    const r = results[c.id];
    if (!r) return;
    if (r.state === "pass")      catTotals[c.cat] += c.weight;
    else if (r.state === "warn") catTotals[c.cat] += c.weight * 0.5;
  });

  const totalGot = Object.values(catTotals).reduce((a, b) => a + b, 0);
  const totalMax = Object.values(catMax).reduce((a, b) => a + b, 0);
  const overall  = Math.round((totalGot / totalMax) * 100);

  // Overall score
  animateNumber("overallScore", overall);
  const verdict = verdictFor(overall);
  const badge = document.getElementById("verdictBadge");
  badge.textContent = verdict.badge;
  badge.style.background = verdict.bg;
  badge.style.color = verdict.fg;
  document.getElementById("verdictText").textContent = verdict.headline;
  document.getElementById("verdictSub").textContent  = verdict.sub;

  // Category cards
  const grid = document.getElementById("categoryGrid");
  grid.innerHTML = "";
  Object.entries(CATEGORIES).forEach(([key, meta], idx) => {
    const pct  = Math.round(catTotals[key] / catMax[key] * 100);
    const circ = 2 * Math.PI * 34;
    const off  = circ * (1 - pct / 100);

    const card = document.createElement("div");
    card.className = "cat-card reveal";
    card.style.animationDelay = `${0.15 + idx * 0.08}s`;
    card.innerHTML = `
      <div class="cat-card-head">
        <div>
          <div class="cat-card-num">0${idx + 1}</div>
          <div class="cat-card-title">${meta.label}</div>
          <div class="cat-card-blurb">${meta.blurb}</div>
        </div>
        <svg width="80" height="80" viewBox="0 0 80 80" aria-hidden="true">
          <circle cx="40" cy="40" r="34" class="ring-bg" fill="none" stroke-width="6"/>
          <circle cx="40" cy="40" r="34" class="ring-fg" fill="none" stroke-width="6" stroke-linecap="round"
                  stroke-dasharray="${circ}" stroke-dashoffset="${circ}"
                  transform="rotate(-90 40 40)" />
          <text x="40" y="46" text-anchor="middle" font-family="JetBrains Mono, monospace"
                font-size="16" font-weight="700" fill="var(--cyan-deep)">${pct}</text>
        </svg>
      </div>
      <div class="cat-card-meta">
        <span>${catTotals[key].toFixed(0)} / ${catMax[key]} pts</span>
        <span style="color: ${pct >= 60 ? 'var(--emerald)' : pct >= 30 ? 'var(--amber)' : 'var(--ruby)'}; font-weight:600;">
          ${pct >= 60 ? 'Strong' : pct >= 30 ? 'Partial' : 'Weak'}
        </span>
      </div>
    `;
    grid.appendChild(card);
    // Animate ring after the card is in the DOM
    requestAnimationFrame(() => {
      card.querySelector(".ring-fg").style.strokeDashoffset = off;
    });
  });

  // Detailed checks list
  const list = document.getElementById("checksList");
  list.innerHTML = "";
  Object.entries(CATEGORIES).forEach(([catKey, meta]) => {
    const header = document.createElement("div");
    header.className = "check-cat-header";
    header.textContent = meta.label;
    list.appendChild(header);

    CHECKS.filter(c => c.cat === catKey).forEach(c => {
      const r = results[c.id] || { state: "unknown", detail: "Check did not run." };
      const row = document.createElement("div");
      row.className = "check-row";
      const pts = r.state === "pass" ? c.weight
                : r.state === "warn" ? (c.weight * 0.5).toFixed(1)
                : 0;
      row.innerHTML = `
        <span class="check-dot dot-${r.state}"></span>
        <div>
          <div class="check-label">${c.label}</div>
          <div class="check-hint">${c.hint}</div>
          <div class="check-detail">${r.detail}</div>
        </div>
        <div>
          <div class="check-state" style="color: ${stateColor(r.state)};">${stateLabel(r.state)}</div>
          <div class="check-points">${pts} / ${c.weight} pts</div>
        </div>
      `;
      list.appendChild(row);
    });
  });
}

function stateLabel(s) { return { pass: "Pass", warn: "Partial", fail: "Fail", unknown: "Unknown" }[s] || s; }
function stateColor(s) { return { pass: "var(--emerald)", warn: "var(--amber)", fail: "var(--ruby)", unknown: "var(--muted)" }[s] || "var(--muted)"; }

function verdictFor(score) {
  if (score >= 80) return {
    badge: "Agent-native",
    bg: "#d1fae5", fg: "#065f46",
    headline: "You're in the top 1% — genuinely agent-native.",
    sub: "Most businesses won't reach this level for 18–24 months. Lock in your lead with monitoring and keep shipping."
  };
  if (score >= 60) return {
    badge: "Agent-ready",
    bg: "#cffafe", fg: "#083344",
    headline: "Ahead of ~95% of UK sites — solid foundation.",
    sub: "You've covered the basics. The gap to agent-native is mostly infrastructure work: MCP, machine-readable feeds, agent auth."
  };
  if (score >= 30) return {
    badge: "Partial",
    bg: "#fef3c7", fg: "#92400e",
    headline: "Some signals are there — most aren't.",
    sub: "You've probably done decent SEO. Agent readiness is a different stack, and the gaps are the expensive bits. Fixable in 30–60 days with focus."
  };
  return {
    badge: "Invisible",
    bg: "#fecaca", fg: "#991b1b",
    headline: "Right now, to an agent, you essentially don't exist.",
    sub: "That's not a failing — it's where ~70% of UK SMEs are. The upside is quick wins are genuinely quick. Start with the red rows below."
  };
}

function animateNumber(id, target) {
  const el  = document.getElementById(id);
  const dur = 1400;
  const start = performance.now();
  function step(now) {
    const p = Math.min(1, (now - start) / dur);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = Math.round(eased * target);
    if (p < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

/* ---------- Form handling ---------- */
document.getElementById("scanForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  let raw = document.getElementById("urlInput").value.trim();
  if (!raw) return;
  raw = raw.replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (!raw.includes(".")) {
    alert("That doesn't look like a valid domain.");
    return;
  }
  const url = "https://" + raw;

  const btn = document.getElementById("scanBtn");
  btn.disabled = true;
  btn.textContent = "Scanning…";

  document.getElementById("scanSection").classList.remove("hidden");
  document.getElementById("resultsSection").classList.add("hidden");
  document.getElementById("scanLog").innerHTML = "";
  document.getElementById("scanTarget").textContent = raw;
  document.getElementById("scanProgress").textContent = `0 / ${CHECKS.length}`;
  document.getElementById("scanSection").scrollIntoView({ behavior: "smooth", block: "start" });

  try {
    const results = await runScan(url);
    scoreAndRender(results);
    document.getElementById("resultsSection").classList.remove("hidden");
    setTimeout(() => {
      document.getElementById("resultsSection").scrollIntoView({ behavior: "smooth", block: "start" });
    }, 400);
  } catch (err) {
    alert("Scan failed: " + err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = "Run free scan &nbsp;→";
  }
});
