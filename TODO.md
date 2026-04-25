# Post-launch backlog

Six items deferred from the v1 launch. Re-prioritise before picking up.

- **Remove unused Tailwind CDN** — `<script src="https://cdn.tailwindcss.com">` loads ~80 KB of JIT compiler on every visit but no Tailwind classes are used in the markup. Free performance win.
- **WordPress sitemap fallback** — current `/sitemap.xml` check misses Yoast / RankMath sites that serve `/sitemap_index.xml`. Significant false-negative on a large chunk of UK SME WordPress sites. Should also read the `Sitemap:` directive from robots.txt as a fallback.
- **README: Cloudflare Worker → Netlify Functions** — the "Moving to production" section documents a Cloudflare Worker, but we deploy on Netlify. Update the example when we replace corsproxy.io with a Netlify Function.
- **JSON-LD parsing: replace regex with DOMParser + JSON.parse** — current regex matches `"price"` anywhere in any string value (~15–25% false positives on pricing) and misses array `@type` values like `["Organization","Corporation"]`. Walk the parsed object tree instead. Doesn't fix the SPA-no-SSR limitation — that needs a headless browser.
- **Mobile check-row tightening** — `grid-template-columns: auto 1fr auto` squeezes the middle text column on iPhone SE (375px). Either stack the right column on `< 480px` or set a fixed min-width.
- **aria-live on scan log** — `<div id="scanLog">` updates dynamically but screen readers don't announce check progress. Add `aria-live="polite"` to the element.
- **Install `netlify-cli` for local dev with functions** — once you want to iterate on scanner behaviour without pushing each change, install the CLI (`npm install -g netlify-cli`) and use `netlify dev` (runs static site + functions at `localhost:8888`). For now, the ~30s deploy cycle is fine.
- **Harden SSRF protection with DNS resolution** — `netlify/functions/proxy.js` blocks private IPs by string-matching the hostname only. A determined attacker could register a public hostname that resolves to a private IP (DNS rebinding etc.). If `[ssrf-block]` lines start appearing in Netlify Function logs, switch to resolving the hostname first and validating the resolved IP against the same block list.
