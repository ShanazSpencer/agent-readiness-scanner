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

const TIMEOUT_MS = 8000;
const USER_AGENT = "AgentReadinessScanner/1.0 (+https://aeo-rex.com)";

/* SSRF guard: hostnames + IPv4/IPv6 ranges we refuse to fetch.
   String-based — good enough for a free public scanner.
   Hardening with DNS resolution is in TODO.md; abuse will
   appear in [ssrf-block] console logs first. */
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

  if (isBlockedHost(parsed.hostname)) {
    console.log(`[ssrf-block] ${new Date().toISOString()} ${target}`);
    return jsonError(400, "Private/internal hostnames are not proxied.");
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
