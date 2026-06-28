# Post-launch backlog

## Done (cleanup pass)

- ✅ **Remove unused Tailwind CDN** — removed `<script src="https://cdn.tailwindcss.com">` from `index.html`. Markup uses 0 Tailwind utility classes (only custom CSS classes that happen to share substrings). ~80 KB freed per visit.
- ✅ **WordPress sitemap fallback** — `checkSitemap()` in `scanner.js` now tries `/sitemap.xml` first, then `/sitemap_index.xml` (Yoast / RankMath), then the `Sitemap:` directive from `robots.txt` as a last fallback.
- ✅ **README: Cloudflare Worker → Netlify Functions** — replaced the stale "Moving to production (Cloudflare Worker)" section with the current Netlify Function setup. Marked the Roadmap "Own Cloudflare Worker" item as done.
- ✅ **JSON-LD parsing: replace regex with DOMParser + JSON.parse** — `checkHomepage()` now parses each JSON-LD block with `JSON.parse`, walks the object tree, and matches `@type` values (including arrays like `["Organization","Corporation"]`) and actual `price` / `priceSpecification` / `priceAmount` / `priceCurrency` keys. Eliminates the ~15-25% false-positive rate on the pricing check. New helpers: `walkJsonLd`, `collectTypes`, `hasPriceKey`. Also widened the orgschema match to include `professionalservice` and the productsch match to include `softwareapplication`. SPA-without-SSR limitation still requires a headless browser — out of scope for this pass.
- ✅ **Mobile check-row tightening** — added `@media (max-width: 480px)` rule in `styles.css` that switches `.check-row` to a 2-column grid and stacks the right verdict column below.
- ✅ **aria-live on scan log** — added `aria-live="polite" aria-atomic="false"` to `<div id="scanLog">` so screen readers announce check progress.
- ✅ **Harden SSRF protection with DNS resolution** — `netlify/functions/proxy.js` now runs two SSRF layers: (1) the existing fast string-based hostname check, and (2) a new DNS lookup via `node:dns/promises` that resolves the hostname and validates every returned IP against private-range blocklists (IPv4: 127/8, 10/8, 172.16/12, 192.168/16, 169.254/16, 100.64/10 CGNAT, 0/8; IPv6: ::1, fc00::/7, fe80::/10). DNS-lookup failures also block, on the assumption that legit public hostnames resolve. Defeats DNS rebinding attacks.

## Still open

- **Install `netlify-cli` for local dev with functions** — user task. Once you want to iterate on scanner behaviour without pushing each change, install the CLI (`npm install -g netlify-cli`) and use `netlify dev` (runs static site + functions at `localhost:8888`).
- **Wire up `agentrex.aeo-rex.com` subdomain** — user task. Currently live at `peppy-alpaca-efe75b.netlify.app`. Steps: add CNAME record at the DNS provider pointing `agentrex` to the Netlify site, add the custom domain in Netlify site settings, wait for the auto-issued Let's Encrypt cert. Once live, update the README "Live demo" line; the canonical/og:url tags in `index.html` already point at `agentrex.aeo-rex.com`.
