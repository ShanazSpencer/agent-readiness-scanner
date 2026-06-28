/* =====================================================
   Agent Readiness Scanner — proxy function
   Server-side fetch for the static scanner. Replaces the
   public corsproxy.io that started returning 403 for our
   requests.

   Endpoint:  /.netlify/functions/proxy?url=<encoded URL>
   Forwards: upstream status, body, content-type
   Adds:     Cache-Control 5min, CORS *
   Refuses:  non-http(s), private/loopback/link-local hosts
   Reserves: 502 (couldn't reach upstream) / 504 (timed out)
             for OUR errors — distinct from upstream's status
   ===================================================== */

import dns from "node:dns/promises";

const TIMEOUT_MS = 8000;
const USER_AGENT = "AgentReadinessScanner/1.0 (+https://aeo-rex.com)";

/* SSRF guard, two layers:
   1. Hostname string match (fast — catches "localhost", literal IPs, *.local, etc).
   2. DNS resolution of every other hostname, then check each resolved IP against
      the same private-range blocklist. Defeats DNS rebinding (attacker registers
      a public hostname like evil.example.com that resolves to 10.0.0.1). */
const BLOCKED_HOST_PATTERNS = [
  /^localhost$/i,
  /\.local$/i,
  /\.internal$/i,
  /^127\./,                  // 127.0.0.0/8 loopback
  /^10\./,                   // 10.0.0.0/8 private
  /^192\.168\./,             // 192.168.0.0/16 private
  /^169\.254\./,             // 169.254.0.0/16 link-local — incl. AWS metadata
  /^0\.0\.0\.0$/,
  /^::1$/,                   // IPv6 loopback
  /^fc[0-9a-f]*:/i,          // IPv6 ULA fc::/8
  /^fd[0-9a-f]*:/i,          // IPv6 ULA fd::/8
  /^fe[89ab][0-9a-f]*:/i,    // IPv6 link-local fe80::/10
];

function is172Private(host) {
  // 172.16.0.0/12 — second octet 16..31
  const m = host.match(/^172\.(\d+)\./);
  if (!m) return false;
  const second = parseInt(m[1], 10);
  return second >= 16 && second <= 31;
}

function isBlockedHost(host) {
  return BLOCKED_HOST_PATTERNS.some(re => re.test(host)) || is172Private(host);
}

/* Layer 2 — IP-level checks applied after DNS lookup. */
function isPrivateIPv4(ip) {
  const m = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return false;
  const [a, b] = m.slice(1).map(Number);
  if (a === 127) return true;                     // 127.0.0.0/8 loopback
  if (a === 10) return true;                      // 10.0.0.0/8 private
  if (a === 172 && b >= 16 && b <= 31) return true;  // 172.16.0.0/12 private
  if (a === 192 && b === 168) return true;        // 192.168.0.0/16 private
  if (a === 169 && b === 254) return true;        // 169.254.0.0/16 link-local (incl. AWS metadata)
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 carrier-grade NAT
  if (a === 0) return true;                       // 0.0.0.0/8
  return false;
}
function isPrivateIPv6(ip) {
  const s = ip.toLowerCase();
  if (s === "::1") return true;
  if (/^fc[0-9a-f]*:/.test(s)) return true;       // fc00::/7 ULA
  if (/^fd[0-9a-f]*:/.test(s)) return true;
  if (/^fe[89ab][0-9a-f]*:/.test(s)) return true; // fe80::/10 link-local
  return false;
}
async function resolveAndBlockPrivate(hostname) {
  try {
    const addrs = await dns.lookup(hostname, { all: true });
    for (const a of addrs) {
      const privateHit = a.family === 6 ? isPrivateIPv6(a.address) : isPrivateIPv4(a.address);
      if (privateHit) {
        return { blocked: true, reason: `resolves to private IP ${a.address}` };
      }
    }
    return { blocked: false };
  } catch (e) {
    // DNS failure — block to be safe (legit public hostnames should resolve)
    return { blocked: true, reason: `DNS lookup failed: ${e.message}` };
  }
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function jsonError(status, message) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export default async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("", { status: 204, headers: corsHeaders });
  }

  const target = new URL(req.url).searchParams.get("url");
  if (!target) {
    return jsonError(400, "Missing ?url= query parameter.");
  }

  let parsed;
  try {
    parsed = new URL(target);
  } catch {
    return jsonError(400, "?url= is not a valid URL.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return jsonError(400, `Protocol ${parsed.protocol} not allowed; use http or https.`);
  }

  // Layer 1: fast string-based hostname check
  if (isBlockedHost(parsed.hostname)) {
    console.log(`[ssrf-block-string] ${new Date().toISOString()} ${target}`);
    return jsonError(400, "Private/internal hostnames are not proxied.");
  }

  // Layer 2: DNS resolution + per-IP private-range check (defeats DNS rebinding)
  const dnsCheck = await resolveAndBlockPrivate(parsed.hostname);
  if (dnsCheck.blocked) {
    console.log(`[ssrf-block-dns] ${new Date().toISOString()} ${target} — ${dnsCheck.reason}`);
    return jsonError(400, `Hostname cannot be proxied (${dnsCheck.reason}).`);
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const upstream = await fetch(target, {
      method: "GET",
      headers: { "User-Agent": USER_AGENT, "Accept": "*/*" },
      signal: ctrl.signal,
      redirect: "follow",
    });
    clearTimeout(timer);

    const body = await upstream.text();
    const contentType = upstream.headers.get("content-type") || "text/plain";

    return new Response(body, {
      status: upstream.status,
      headers: {
        ...corsHeaders,
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=300",
      },
    });
  } catch (e) {
    clearTimeout(timer);
    if (e.name === "AbortError") {
      return jsonError(504, `Upstream timed out after ${TIMEOUT_MS / 1000}s.`);
    }
    return jsonError(502, `Could not reach upstream: ${e.message}`);
  }
};
