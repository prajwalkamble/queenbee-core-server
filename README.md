<div align="center">

# queenbee-core-server

**A self-hosted Linux server, the hub page it serves, and the failover that keeps a public URL useful when the machine behind it isn't.**

[Hub](https://queenbee-core-srv.emperor-adelie.ts.net/server/) · [Offline page](https://prajwalkamble.github.io/queenbee-core-server/) · [About the build](https://prajwalkamble.github.io/queenbee-core-server/about-server.html)

</div>

---

## What this is

A portfolio server running on a repurposed laptop, published to the internet over Tailscale Funnel. The laptop is not always on, which is the interesting engineering problem: a link on a résumé has to lead somewhere reasonable at 2am on a Sunday when the machine is closed.

This repository holds all three moving parts — the hub the server serves, the offline page GitHub Pages serves, and the failover logic that moves visitors between them.

## Behaviour

| Visitor is on | Server up | Server down |
| --- | --- | --- |
| the hub (`…ts.net/server/`) | stays, re-checks every 5s | notice, then → offline page |
| the offline page (Pages) | → hub within ~5s | stays, polls every 5s |
| a local copy (`file://`) | stays | → offline page |

A viewer with the hub open when the server dies is moved to the offline page within about twelve seconds without touching anything. A viewer sitting on the offline page when the server comes back is carried into the hub within about ten.

### Known limitation

If the server is **already down** when someone opens `…ts.net/server/` for the first time, they get a browser error page, not the offline page. Nothing client-side can prevent that: no bytes are served, so no JavaScript runs, so nothing can redirect. Fixing it properly requires something that is always awake to answer on the server's behalf — see [`front-node/`](#front-node-optional).

## How the failover works

Every probe targets the hub URL itself. It answers only while the server is up, which makes it the health check — no separate endpoint, no CORS headers, nothing extra to deploy.

Cross-origin, the response is opaque (`mode: "no-cors"`), so the probe learns only whether the request completed. That is sufficient: completion means the server answered. Same-origin, the status code is readable, so a `502` from a dead application is caught as well as a dead machine.

**A single failure is never acted on.** One failed request cannot distinguish an outage from a two-second network drop, and moving a reader to another origin on a blip is worse than waiting. A failure triggers a confirming probe one second later; only if that fails too does the redirect happen.

```
5s  next scheduled check
3s  first probe timeout
1s  confirmation delay
3s  second probe timeout
──
12s worst case, 4-6s typical
```

The timeouts are tuned for this environment specifically: a dead Tailscale host usually leaves connections hanging rather than refusing them, so probes tend to burn their full timeout instead of failing fast.

Interval timers alone are not enough — browsers throttle them to a minute or more in background tabs — so the guard also re-checks on `visibilitychange`, on the `online` event, and on `pageshow` from the back/forward cache.

While a probe is being confirmed, a *Connection lost — checking…* notice appears. It is styled inline rather than through the stylesheet, on the reasoning that a stylesheet which hasn't loaded by the time the server dies never will.

## Layout

```
queenbee-core-server/
├── docs/                        GitHub Pages source (Settings ▸ Pages ▸ main /docs)
│   ├── index.html                  offline page — polls, then carries viewers back to the hub
│   ├── about-server.html           build write-up, with a live status indicator
│   ├── config.js                   public config: URLs, form endpoint
│   └── config.example.js
│
├── server/                      served by the laptop's nginx at /server/
│   ├── index.html                  the hub
│   ├── styles.css
│   └── script.js                   nav, reveals, games, and the connectivity guard
│
├── front-node/                  optional; see below
│   ├── nginx/queenbee-front.conf
│   └── install.sh
│
├── deploy.example.sh            → copy, fill in, gitignored
├── start-server.example.sh      → copy, fill in, gitignored
└── diagnose.example.sh          → copy, fill in, gitignored
```

Each directory targets a different host. Nothing in `front-node/` is served publicly; everything in `docs/` is world-readable by definition, which is why no secret belongs there.

## Configuration

| File | Holds | Committed |
| --- | --- | --- |
| `docs/config.js` | Pages URL, hub URL, contact endpoint | **yes** — Pages must serve it |
| `deploy.sh` | host, paths, credentials | no |
| `start-server.sh` | local service startup | no |
| `diagnose.sh` | hostnames, nginx root | no |

`docs/config.js` is committed deliberately. Anything under `docs/` that isn't committed never reaches GitHub, so the live page would 404 on it — and anything that is committed is public. It therefore holds only values that are safe to publish. Real secrets live in the gitignored scripts, which nothing serves.

## Local development

```bash
cd server && python3 -m http.server 8000
```

Then open `http://localhost:8000/?dev`.

The `?dev` query stands the connectivity guard down for that tab. Without it, editing the hub while the server is off throws you to the offline page before you can look at anything.

## Deployment

### GitHub Pages

Push, then **Settings ▸ Pages ▸ Source: Deploy from a branch ▸ `main` ▸ `/docs`**.

```bash
curl -sI https://prajwalkamble.github.io/queenbee-core-server/ | head -1   # expect 200
```

### The server

```bash
rsync -a --delete server/ /var/www/queenbee/server/
sudo systemctl reload nginx
tailscale serve status        # confirm /server/ is mapped
```

Tailscale must be publishing the hub path. `tailscale funnel reset` clears that mapping — after running it, the path 404s until it is re-established, and the 404 comes from Tailscale rather than nginx, so nginx's logs stay silent.

### front-node (optional)

The one thing the client-side failover cannot do is rescue a visitor who arrives cold while the server is off. `front-node/` solves it: a small always-on machine takes over the MagicDNS name, proxies to the server when it's up, and redirects to the offline page when it isn't. The public URL then answers on the first visit as well as the hundredth.

It is not deployed. The config and installer are complete and cost nothing to keep.

If you deploy it, **the probe target must change**. A proxy in front answers the hub URL whether or not the machine behind it is awake, so probing that URL would report "up" permanently and bounce the offline page against the proxy in a loop. Switch the probe in `server/script.js`, `docs/index.html`, and `docs/about-server.html` to `/healthz`, the liveness endpoint the front-node config provides. Inline comments mark each spot.

## Diagnostics

```bash
cp diagnose.example.sh diagnose.sh   # fill in the CONFIG block
bash diagnose.sh                      # run on the machine serving the hub
```

Six ordered checks. The one that matters most separates two failures that look identical in a browser:

| Symptom | Cause |
| --- | --- |
| local `200`, public `404` | Tailscale path mapping |
| local `404` | nginx root or `location` block |
| public no response | Funnel off, or machine unreachable |
| offline page not `200` | repo name, or Pages source setting |

A Tailscale-level 404 never reaches nginx, so its error log stays empty — that absence is itself the diagnosis.

## Stack

**Server** — ParrotOS on a repurposed laptop · nginx · Docker · Tailscale (MagicDNS, Serve, Funnel)
**Front end** — vanilla HTML, CSS, and JavaScript; no framework, no bundler, no `node_modules`
**Hosting** — Tailscale Funnel for the hub, GitHub Pages for the fallback

Three files a browser can open directly from disk. The absence of a build step is a deliberate constraint: the offline page has to work when the infrastructure that would have built it is the thing that's down.

### Interface

Near-black canvas with an electric-blue `#4d7cfe` accent. Space Grotesk for display, Inter for body, JetBrains Mono for terminal output. A boot-sequence animation, a hardware rack visualisation, a game playground, and a navigation bar that becomes a bottom bar below 760px.

Responsive from 360px to 2560px, with a dedicated tablet band at 761–1024px, `@media (hover: none)` guards so tapped cards don't latch into hover states, `100dvh` so mobile Safari's collapsing toolbar doesn't push content below the fold, and safe-area insets for notched devices.

## Releases

Tags follow semantic versioning. `v2.x` covers the offline-first failover; see [Releases](https://github.com/prajwalkamble/queenbee-core-server/releases) for what changed in each.

---

<div align="center">
<sub>Built and operated by <a href="https://github.com/prajwalkamble">Prajwal Kamble</a></sub>
</div>
