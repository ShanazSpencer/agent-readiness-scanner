# AGENTREX — Agent Readiness Scanner

> Free agent readiness diagnostic. Built by [AEO-REX](https://aeo-rex.com), the UK's first AEO consultancy.

_AGENTREX is a sub-product of AEO-REX. Will live at [agentrex.aeo-rex.com](https://agentrex.aeo-rex.com) once DNS is wired up._

Getting cited by ChatGPT is yesterday's game. The next wave is agents _acting_ on behalf of humans — booking, buying, comparing — without a human ever visiting your site. Agentrex tells you, honestly, whether your business is on the map or invisible to them.

**14 real checks · 4 categories · 60 seconds · No signup.**

## What it checks

| Category | Weight | What's measured |
| --- | --- | --- |
| **Discoverability** | 25 pts | `robots.txt` presence, AI bot policy (GPTBot / ClaudeBot / PerplexityBot), `llms.txt`, `sitemap.xml` |
| **Structured data** | 25 pts | JSON-LD `schema.org` markup, Organization / LocalBusiness schema, Product / Offer schema, Open Graph |
| **Agent access** | 25 pts | MCP server endpoint (`/.well-known/mcp`), OpenAPI / Swagger specs, `.well-known/` discovery surfaces |
| **Transaction readiness** | 25 pts | Machine-readable pricing, product / services feeds, OAuth / OpenID discovery, ACP hints |

Each check returns **pass**, **partial**, or **fail** with a concrete explanation. Scoring is weighted — MCP endpoints are worth more than Open Graph tags because almost nobody has them yet. The final 0–100 score maps to one of four verdicts: _Invisible_, _Partial_, _Agent-ready_, _Agent-native_.

## Live demo

→ Live at [peppy-alpaca-efe75b.netlify.app](https://peppy-alpaca-efe75b.netlify.app) — moving to [agents.aeo-rex.com](https://agents.aeo-rex.com) once DNS is wired up.

## Running locally

No build step. No dependencies beyond a browser. Either:

```bash
# Option 1 — any static server
python3 -m http.server 8000
# then open http://localhost:8000

# Option 2 — VS Code Live Server extension
# right-click index.html → "Open with Live Server"
```

## File structure

```
agent-readiness-scanner/
├── index.html          # Page markup
├── assets/
│   ├── styles.css      # Full stylesheet (AEO-REX cyan palette)
│   └── scanner.js      # Scan logic + scoring + rendering
├── README.md
└── LICENSE
```

## How the fetching works

The browser can't fetch arbitrary cross-origin URLs, so v1 uses the public `corsproxy.io` service. That's fine for a diagnostic tool, but for production traffic you should run your own proxy — see below.

### Moving to production (Cloudflare Worker)

```javascript
// cors-proxy.js — paste into a Cloudflare Worker
export default {
  async fetch(request) {
    const url = new URL(request.url).searchParams.get("url");
    if (!url) return new Response("Missing ?url=", { status: 400 });
    try {
      const upstream = await fetch(url, {
        headers: { "User-Agent": "AgentReadinessScanner/1.0 (+https://aeo-rex.com)" },
        cf: { cacheTtl: 300 }
      });
      return new Response(await upstream.text(), {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": upstream.headers.get("Content-Type") || "text/plain"
        }
      });
    } catch (e) {
      return new Response("Fetch failed", { status: 502 });
    }
  }
};
```

Then replace `const PROXY = "https://corsproxy.io/?url="` in `assets/scanner.js` with your Worker URL.

## Scoring methodology

The scoring is deliberately calibrated to 2026 reality:

- **< 30** · _Invisible_ — where ~70% of UK SME sites currently sit.
- **30–59** · _Partial_ — some SEO foundations exist, agent signals are missing.
- **60–79** · _Agent-ready_ — ahead of ~95% of UK sites.
- **80+** · _Agent-native_ — top ~1%. Genuinely differentiated.

The heavy weights sit on MCP (12 pts), JSON-LD (10 pts), machine-readable pricing (9 pts) and the bot policy declaration (8 pts). These reflect where the actual commercial advantage is in the next 12–18 months, not where legacy SEO lives.

## Limitations (being honest)

- Browser-side scanning is fragile. Sites behind Cloudflare Bot Management or aggressive anti-bot protection return empty, and Agentrex marks those checks as `fail` even when we genuinely can't tell.
- JavaScript-rendered sites (SPAs) won't show their structured data because we read raw HTML, not the rendered DOM. v2 will fix this with a headless-browser fetcher.
- The public CORS proxy is rate-limited.
- This is a _diagnostic_, not a definitive audit. For the line-by-line fix list with implementation templates, book the [AEO-REX Agent Readiness Audit](https://aeo-rex.com).

## Roadmap

- [ ] Own Cloudflare Worker to replace the public proxy
- [ ] JS-rendered page support (Playwright on the edge)
- [ ] PDF export of results
- [ ] Historical tracking (compare month-on-month)
- [ ] Competitor side-by-side mode
- [ ] LinkedIn post auto-generation from scan results
- [ ] Integration with the main AEO-REX dashboard

## Why this exists

AI agents will quietly become the default purchase-decision layer in 2027. The businesses that are machine-readable _before_ that shift will own the category defaults for years. Everyone else will be invisible. We built Agentrex because the alternative was letting another generation of SMEs get lapped by anyone who bothered to ship `llms.txt` and a product feed.

## License

MIT — see [LICENSE](LICENSE).

## About AEO-REX

The UK's first Answer Engine Optimisation consultancy. Featured at Oxford Saïd Business School, on Islam Channel, and in DesignRush's Top AEO Agencies. Founded by Shanaz Begum in Birmingham.

→ **[aeo-rex.com](https://aeo-rex.com)**  ·  hello@aeo-rex.com
