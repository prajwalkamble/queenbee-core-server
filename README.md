<div align="center">

# queenbee-core-server

**A self-hosted Linux server, the hub page it serves, and the failover that keeps its public URL useful when the machine behind it isn't.**

### [→ Open the server](https://prajwalkamble.github.io/queenbee-core-server/)

[About the build](https://prajwalkamble.github.io/queenbee-core-server/about-server.html)

<sub>Canonical address: <code>queenbee-core-srv.emperor-adelie.ts.net/server/</code> — the link above forwards there when the server is up, and shows the offline page when it isn't.</sub>

</div>

---

## Overview

A portfolio server running on a repurposed laptop, published to the internet over Tailscale Funnel. The laptop is not always on, which turned out to be the interesting constraint: a link on a résumé has to lead somewhere reasonable at 2am on a Sunday when the machine is closed.

This repository holds all three parts — the hub the server serves, the offline page GitHub Pages serves, and the logic that moves visitors between them without anyone pressing reload.

## Behaviour

| Visitor is on | Server up | Server down |
| --- | --- | --- |
| the hub (`…ts.net/server/`) | stays, re-checks every 5s | notice, then → offline page |
| the offline page (Pages) | → hub within ~5s | stays, polls every 5s |
| a local copy (`file://`) | stays | → offline page |

Someone with the hub open when the server dies is moved to the offline page within about twelve seconds. Someone sitting on the offline page when the server returns is carried into the hub within about ten.

### Known limitation

If the server is **already down** when a visitor opens the hub URL for the first time, they get a browser error page rather than the offline page. No client-side code can prevent this: nothing is served, so nothing runs, so nothing can redirect. Closing that gap needs a machine that is always awake to answer on the server's behalf, which is what `front-node/` is for.

---

## How it was built

### The machine

An ageing laptop, wiped and rebuilt as a headless Linux server running ParrotOS. Choosing a laptop over a Raspberry Pi or a rented VPS was partly about reuse and partly about scope: a real machine with a real disk and a battery that survives a power cut, running a real distribution, teaches more than a managed instance where the hard parts are already solved.

Its limitation is the one the rest of this project exists to work around — it is a laptop, so it sleeps, travels, and gets closed.

### Getting it onto the internet

The obvious route is port forwarding: open 80 and 443 on the home router, point dynamic DNS at the WAN address, terminate TLS with Let's Encrypt. It was rejected on three counts. It publishes a residential IP address; it depends on a router configuration that a landlord's ISP can change without notice; and a residential connection's dynamic address makes certificate renewal fragile.

Tailscale solves all three differently. The machine joins a private WireGuard mesh and is addressable by a stable MagicDNS name regardless of which network it is sitting on — home wifi, tethered phone, a café. `tailscale serve` publishes a local port inside that mesh, and Funnel extends the same to the public internet with a certificate provisioned automatically. No inbound firewall rule exists, no home IP is disclosed, and moving the laptop between networks changes nothing about how it is reached.

The trade is that the URL now depends on a machine that is often asleep, which is where the rest of the design comes from.

### Serving

nginx sits in front, serving the hub as static files under a `/server/` path so the hostname has room for other services later. Static was a deliberate choice over an application server: nothing here needs a runtime, and a static root is one less process that can die independently of the machine.

### Building the hub

Vanilla HTML, CSS, and JavaScript. No framework, no bundler, no `node_modules`.

That started as taste and became a constraint with a reason: the offline page has to work when the infrastructure that would have built it is the thing that is down. A page that survives its own build pipeline being unavailable cannot depend on one. The practical consequence is that every file in this repository can be opened directly from disk in a browser, and what you see is what ships.

The interface was built around a terminal metaphor — a boot sequence on load, a hardware rack visualisation, monospace status output — because the subject is a server and the aesthetic should say so without a paragraph of explanation.

### Discovering the actual problem

The first version was a hub and nothing else. It worked, and it looked finished, right up until someone opened the link while the laptop was closed and got `ERR_CONNECTION_CLOSED` — a browser error page with a URL that had been shared publicly.

The instinct was to catch that error and redirect. That is not possible, and understanding why shaped everything after it: when a connection fails at the transport layer, no bytes arrive, so no HTML parses, so no script runs. There is nothing to hook. A fallback cannot live on the thing that is down.

So the fallback moved to GitHub Pages — infrastructure that is always up and costs nothing — and the relationship was inverted. The offline page is not an error screen shown after a failure; it is a live participant that polls for the server and hands visitors back the moment it returns.

### Making the handover feel deliberate

An early version detected outages in roughly twenty-two seconds and displayed nothing while it did. Testing it felt broken: the page looked healthy, said nothing, and viewers reloaded manually — which is exactly the behaviour the whole feature was supposed to remove.

Two changes fixed it. The timing budget was cut to a twelve-second worst case, tuned around the observation that a dead Tailscale host leaves connections hanging rather than refusing them, so checks tend to burn their full timeout rather than failing fast. And the silence was filled: a *Connection lost — checking…* notice now appears on the first failed check, withdrawn if the confirming check succeeds.

The double check itself was kept. A single failed request cannot distinguish an outage from a two-second wifi drop, and throwing a reader to another origin on a blip is worse than making them wait.

### Working on it

Running the hub locally meant fighting its own failover: open the file, the check fails, and you are redirected to the offline page before you can look at anything. Rather than special-casing localhost — which would have silently disabled the guard on the machine where it most needs testing — an explicit `?dev` query parameter stands it down for that tab only.

```bash
cd server && python3 -m http.server 8000
# then open http://localhost:8000/?dev
```

---

## How the failover works

Every check targets the hub URL itself. It answers only while the server is up, which makes it the health check — nothing separate to deploy or keep in sync.

Cross-origin the response is opaque (`mode: "no-cors"`), so a check learns only whether the request completed. That is enough: completion means the server answered. Same-origin the status code is readable, so a `502` from a dead application is caught alongside a dead machine.

```
5s  next scheduled check
3s  first check times out
1s  confirmation delay
3s  second check times out
──
12s worst case, 4-6s typical
```

Interval timers alone are insufficient — browsers throttle them to a minute or worse in background tabs — so the guard also re-checks on `visibilitychange`, on the `online` event, and on `pageshow` from the back/forward cache.

## Layout

```
queenbee-core-server/
├── docs/                        GitHub Pages source
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
├── front-node/                  optional, not deployed
│   ├── nginx/queenbee-front.conf
│   └── install.sh
│
├── deploy.example.sh
├── start-server.example.sh
└── diagnose.example.sh
```

Each directory targets a different host. Everything under `docs/` is world-readable by definition; nothing under `front-node/` is served publicly.

## Configuration

| File | Holds | Committed |
| --- | --- | --- |
| `docs/config.js` | Pages URL, hub URL, contact endpoint | **yes** — Pages must serve it |
| `deploy.sh` | host, paths, credentials | no |
| `start-server.sh` | local service startup | no |
| `diagnose.sh` | hostnames, nginx root | no |

`docs/config.js` is committed deliberately. Anything under `docs/` that isn't committed never reaches GitHub, so the live page would 404 on it — and anything committed there is public regardless. It therefore holds only values safe to publish. Real secrets belong in the gitignored scripts, which nothing serves.

## Diagnostics

`diagnose.example.sh` is a health check for the published URL, driven by a config block so the committed copy carries no hostnames of its own.

It exists because two very different faults look identical in a browser. A 404 from Tailscale, when the hub path is no longer mapped, and a 404 from nginx, when the document root is wrong, produce the same screen and have unrelated fixes. The script separates them by asking the same question locally and publicly and comparing the answers: a local `200` alongside a public `404` points at the Tailscale mapping, while a local `404` points at nginx. A Tailscale-level 404 never reaches nginx at all, so its error log stays empty — an absence that is itself diagnostic.

Six ordered checks in total, covering the Tailscale daemon and its published paths, nginx locally, the public URL, the Pages fallback, recent 404s from the error log, and what is actually on disk. They are ordered so the first failure usually explains the ones after it.

## Stack

**Server** — ParrotOS on a repurposed laptop · nginx · Docker · Tailscale (MagicDNS, Serve, Funnel)
**Front end** — vanilla HTML, CSS, and JavaScript
**Hosting** — Tailscale Funnel for the hub, GitHub Pages for the fallback

### Interface

Near-black canvas with an electric-blue `#4d7cfe` accent. Space Grotesk for display, Inter for body, JetBrains Mono for terminal output. A boot-sequence animation, a hardware rack visualisation, a game playground, and a navigation bar that becomes a bottom bar below 760px.

Responsive from 360px to 2560px, with a dedicated tablet band at 761–1024px, `@media (hover: none)` guards so tapped cards do not latch into hover states, `100dvh` so mobile Safari's collapsing toolbar does not push content below the fold, and safe-area insets for notched devices.

## Releases

Tags follow semantic versioning; `v2.x` covers the offline-first failover. See [Releases](https://github.com/prajwalkamble/queenbee-core-server/releases).

---

<div align="center">
<sub>Built and operated by <a href="https://github.com/prajwalkamble">Prajwal Kamble</a></sub>
</div>
