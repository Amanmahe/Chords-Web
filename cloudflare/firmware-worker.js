/**
 * Chords firmware proxy — Cloudflare Worker
 *
 * Serves the latest Chords-Arduino-Firmware release to the browser with CORS
 * headers (GitHub release downloads don't send them, so the web app can't
 * fetch them directly).
 *
 * Routes:
 *   GET /latest                    -> latest release info + asset list (JSON)
 *   GET /firmware/latest/<file>    -> binary from the latest release
 *   GET /firmware/<tag>/<file>     -> binary from a specific release (e.g. v1.0.3)
 *
 * Optional environment variables (Worker -> Settings -> Variables):
 *   GITHUB_TOKEN     GitHub token, raises the API rate limit from 60 to 5000 req/h
 *   ALLOWED_ORIGINS  Comma-separated list of allowed origins, e.g.
 *                    "https://chords.upsidedownlabs.tech,http://localhost:3000".
 *                    Leave unset to allow any origin.
 */

const OWNER = "Amanmahe";
const REPO = "Chords-Arduino-Firmware";
const LATEST_CACHE_SECONDS = 300; // re-check GitHub for a new release every 5 min
const BINARY_CACHE_SECONDS = 86400; // a tagged release's files never change

export default {
    async fetch(request, env, ctx) {
        const cors = corsHeaders(request, env);

        if (request.method === "OPTIONS") {
            return new Response(null, { status: 204, headers: cors });
        }
        if (request.method !== "GET") {
            return json({ error: "Method not allowed" }, 405, cors);
        }

        const url = new URL(request.url);
        const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);

        try {
            if (parts.length === 1 && parts[0] === "latest") {
                try {
                    const release = await getRelease("latest", env, ctx);
                    return json(describeRelease(release, url.origin), 200, cors, LATEST_CACHE_SECONDS);
                } catch (err) {
                    // API blocked and nothing cached: the tag alone (from the
                    // github.com redirect) is still enough to download files.
                    const tag = await getLatestTag(env, ctx);
                    return json(
                        {
                            tag,
                            name: tag,
                            html_url: `https://github.com/${OWNER}/${REPO}/releases/tag/${tag}`,
                            assets: null,
                            warning: err.message || String(err),
                        },
                        200,
                        cors,
                        60
                    );
                }
            }

            if (parts.length === 3 && parts[0] === "firmware") {
                const [, tag, file] = parts;
                if (!/^[\w.\-]+$/.test(tag) || !/^[\w.\-]+$/.test(file)) {
                    return json({ error: "Invalid tag or file name" }, 400, cors);
                }
                // Downloads skip the GitHub API (it rate-limits shared Worker IPs).
                const resolvedTag = tag === "latest" ? await getLatestTag(env, ctx) : tag;
                return await getBinary(resolvedTag, file, cors, ctx);
            }

            return json(
                { routes: ["/latest", "/firmware/latest/<file>", "/firmware/<tag>/<file>"] },
                404,
                cors
            );
        } catch (err) {
            return json({ error: err.message || String(err) }, 502, cors);
        }
    },
};

// Release metadata from the GitHub API, cached at the edge. If GitHub refuses
// (403 rate limit), fall back to the last good copy kept for a week.
async function getRelease(tag, env, ctx) {
    const apiUrl =
        tag === "latest"
            ? `https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`
            : `https://api.github.com/repos/${OWNER}/${REPO}/releases/tags/${tag}`;

    const cache = caches.default;
    const cacheKey = new Request(apiUrl);
    const staleKey = new Request(`${apiUrl}?stale`);
    const cached = await cache.match(cacheKey);
    if (cached) return cached.json();

    const headers = {
        Accept: "application/vnd.github+json",
        "User-Agent": "chords-firmware-worker",
    };
    if (env.GITHUB_TOKEN) headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`;

    const res = await fetch(apiUrl, { headers });
    if (!res.ok) {
        const stale = await cache.match(staleKey);
        if (stale) return stale.json();
        throw new Error(`GitHub API returned ${res.status} for release "${tag}"`);
    }
    const release = await res.json();
    const body = JSON.stringify(release);

    const ttl = tag === "latest" ? LATEST_CACHE_SECONDS : BINARY_CACHE_SECONDS;
    const put = (key, maxAge) =>
        cache.put(key, new Response(body, {
            headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${maxAge}` },
        }));
    ctx.waitUntil(Promise.all([put(cacheKey, ttl), put(staleKey, 7 * 86400)]));
    return release;
}

// Latest tag without the API: github.com/<repo>/releases/latest redirects to
// .../releases/tag/<tag>.
async function getLatestTag(env, ctx) {
    const cache = caches.default;
    const cacheKey = new Request(`https://firmware-cache/${OWNER}/${REPO}/latest-tag`);
    const cached = await cache.match(cacheKey);
    if (cached) return cached.text();

    let tag = null;
    const res = await fetch(`https://github.com/${OWNER}/${REPO}/releases/latest`, {
        method: "HEAD",
        redirect: "manual",
        headers: { "User-Agent": "chords-firmware-worker" },
    });
    const match = (res.headers.get("Location") || "").match(/\/releases\/tag\/([^/?#]+)/);
    if (match) tag = decodeURIComponent(match[1]);
    else tag = (await getRelease("latest", env, ctx)).tag_name; // fallback

    ctx.waitUntil(
        cache.put(cacheKey, new Response(tag, { headers: { "Cache-Control": `public, max-age=${LATEST_CACHE_SECONDS}` } }))
    );
    return tag;
}

// Download a release asset straight from github.com (not rate-limited like the
// API); GitHub redirects to its CDN and fetch follows it.
async function getBinary(tag, file, cors, ctx) {
    const cache = caches.default;
    const cacheKey = new Request(`https://firmware-cache/${OWNER}/${REPO}/${tag}/${file}`);
    let res = await cache.match(cacheKey);

    if (!res) {
        const downloadUrl = `https://github.com/${OWNER}/${REPO}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(file)}`;
        const upstream = await fetch(downloadUrl, { headers: { "User-Agent": "chords-firmware-worker" }, redirect: "follow" });
        if (upstream.status === 404) {
            return json({ error: `${file} not found in release ${tag}` }, 404, cors);
        }
        if (!upstream.ok) throw new Error(`Download failed (${upstream.status}) for ${file}`);

        res = new Response(upstream.body, {
            headers: {
                "Content-Type": "application/octet-stream",
                "Cache-Control": `public, max-age=${BINARY_CACHE_SECONDS}, immutable`,
            },
        });
        ctx.waitUntil(cache.put(cacheKey, res.clone()));
    }

    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
    out.headers.set("Content-Disposition", `attachment; filename="${file}"`);
    out.headers.set("X-Firmware-Version", tag);
    return out;
}

function describeRelease(release, origin) {
    return {
        tag: release.tag_name,
        name: release.name,
        published_at: release.published_at,
        html_url: release.html_url,
        assets: release.assets.map((a) => ({
            name: a.name,
            size: a.size,
            url: `${origin}/firmware/${encodeURIComponent(release.tag_name)}/${encodeURIComponent(a.name)}`,
        })),
    };
}

function corsHeaders(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowed = (env.ALLOWED_ORIGINS || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    const allowOrigin = allowed.length === 0 ? "*" : allowed.includes(origin) ? origin : allowed[0];

    return {
        "Access-Control-Allow-Origin": allowOrigin,
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Expose-Headers": "Content-Disposition, X-Firmware-Version, Content-Length",
        Vary: "Origin",
    };
}

function json(body, status, cors, maxAge = 0) {
    return new Response(JSON.stringify(body, null, 2), {
        status,
        headers: {
            ...cors,
            "Content-Type": "application/json",
            "Cache-Control": maxAge ? `public, max-age=${maxAge}` : "no-store",
        },
    });
}
