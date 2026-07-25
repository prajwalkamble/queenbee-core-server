/* ═══════════════════════════════════════════════
   queenbee-core-srv · hub — interactions
   1. Theme toggle (persisted, respects OS pref)
   2. Typed role rotation in hero
   3. Scroll-reveal via IntersectionObserver
   4. Request-trace typing + chain animation
   5. Mobile menu
   ═══════════════════════════════════════════════ */

(function () {
  "use strict";
  console.log("%c hub v3 — css should log v3 too ", "background:#4d7cfe;color:#fff;border-radius:4px");

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ══════════════════════════════════════════════════════════════════
     OFFLINE-FIRST CONNECTIVITY GUARD
     ------------------------------------------------------------------
     Purpose: when this hub is served from ANYWHERE other than the
     server itself (GitHub Pages, a local file on disk, localhost),
     it checks whether queenbee-core-srv is reachable.

       · Server unreachable  -> redirect the viewer to offline.html
       · Server reachable    -> show the hub, and keep re-checking in
                                the background; if the server dies
                                while the page is open, redirect too.

     When the hub is served BY the server (hostname ends in ts.net),
     this whole module is skipped: the server delivering the page is
     itself proof the server is up, and the app-down case there is
     handled by Nginx's error_page -> offline.html instead.
     ══════════════════════════════════════════════════════════════════ */
  (function () {
    /* ---- CONFIG — adjust these if your URLs ever change ---- */
    var SERVER_URL   = "https://queenbee-core-srv.emperor-adelie.ts.net/server/"; // probe target: the hub itself. It answers only when the server is up, so it IS the health check.
    /* ABSOLUTE URL, not a relative path: this hub is served from several
       places (local disk, the server, a clone), and the status page lives
       on GitHub Pages — independent infrastructure that stays up when the
       server does not. A relative path would resolve against whichever
       origin the hub happens to be on and 404. */
    var OFFLINE_PAGE = "https://prajwalkamble.github.io/queenbee-core-server/";
    var PROBE_TIMEOUT = 3000;           // ms before a probe is called unreachable
    var RECHECK_MS    = 5000;           // background re-check interval while the hub is open
    var CONFIRM_DELAY = 1000;           // pause before the confirming second probe
    /* Worst case to detection: 5 + 3 + 1 + 3 = 12s, typically 4-6s. A dead
       Tailscale host usually HANGS rather than refusing, so probes tend to
       burn their full timeout — which is why these numbers matter more here
       than they would against an ordinary web server. */

    /* ---- Guard only in "standalone" contexts ----
       file:  -> opened from local disk
       github.io / localhost / anything not ts.net -> hosted elsewhere.
       Served from ts.net -> skip (see header comment). */
    var host = location.hostname;

    /* Escape hatch for local work: open index.html?dev and the guard stands
       down for that tab. Otherwise editing the hub while the server is off
       throws you to the offline page before you can see anything. */
    if (/[?&]dev\b/.test(location.search)) return;

    /* ---- Where are we, and how do we ask? ----
       Served from ts.net  -> same origin, so the status code is readable and
                              a 502 from a dead app is caught as well as a
                              dead machine.
       Anywhere else       -> cross-origin, so an opaque no-cors probe is all
                              we get: resolved means it answered, rejected
                              means it did not. */
    var sameOrigin = !!(host && host.indexOf(".ts.net") !== -1);
    if (location.href.indexOf(OFFLINE_PAGE) === 0) return;      // already on the status page

    function probe() {
      return new Promise(function (resolve) {
        var ctrl  = new AbortController();
        var timer = setTimeout(function () { ctrl.abort(); resolve(false); }, PROBE_TIMEOUT);
        var url   = (sameOrigin ? location.pathname : SERVER_URL) + "?ping=" + Date.now();
        var opts  = sameOrigin
          ? { cache: "no-store", signal: ctrl.signal }
          : { mode: "no-cors", cache: "no-store", signal: ctrl.signal };
        fetch(url, opts)
          .then(function (res) { clearTimeout(timer); resolve(sameOrigin ? res.ok : true); })
          .catch(function ()   { clearTimeout(timer); resolve(false); });
      });
    }

    /* ---- Say something while we confirm ----
       The delay itself was never the real complaint: the page looked healthy
       and said nothing for several seconds, so the viewer reloaded. Surface
       the first failed probe immediately, and withdraw it if the confirming
       probe succeeds. */
    var notice = null;
    function showNotice() {
      if (notice || !document.body) return;
      notice = document.createElement("div");
      notice.textContent = "Connection lost — checking\u2026";
      notice.setAttribute("role", "status");
      notice.style.cssText = [
        "position:fixed", "left:50%", "top:1rem", "transform:translateX(-50%)",
        "z-index:9999", "padding:.55rem 1.1rem", "border-radius:999px",
        "font:500 13px/1 'JetBrains Mono',ui-monospace,monospace",
        "background:rgba(18,18,22,.94)", "color:#ffb454",
        "border:1px solid rgba(255,180,84,.35)",
        "box-shadow:0 6px 24px rgba(0,0,0,.45)",
        "pointer-events:none"
      ].join(";");
      document.body.appendChild(notice);
    }
    function hideNotice() {
      if (!notice) return;
      notice.parentNode && notice.parentNode.removeChild(notice);
      notice = null;
    }

    /* One failed probe is not proof of an outage — a wifi hiccup looks
       identical. Confirm with a second probe before throwing the viewer
       to another origin. */
    function confirmedDown() {
      return probe().then(function (up) {
        if (up) { hideNotice(); return false; }
        showNotice();                                           // first failure: tell the viewer
        return new Promise(function (r) { setTimeout(r, CONFIRM_DELAY); })
          .then(probe)
          .then(function (upAgain) {
            if (upAgain) hideNotice();                          // false alarm, carry on
            return !upAgain;
          });
      });
    }

    function goOffline() {
      /* location.replace (not .href) so the offline page does not enter
         browser history — pressing Back later won't bounce the viewer
         through a dead-server redirect loop. */
      location.replace(OFFLINE_PAGE);
    }

    var checking = false;
    function check() {
      if (checking) return;                                     // no overlapping probes
      checking = true;
      confirmedDown().then(function (down) {
        checking = false;
        if (down) goOffline();
      });
    }

    /* Initial check runs immediately, in parallel with the boot loader, so a
       redirect happens while the loader is still on screen. */
    check();

    /* Then keep watching. setInterval alone is not enough: browsers throttle
       timers in background tabs to a minute or more, so a tab you are not
       looking at would notice the outage minutes late. Re-checking the moment
       the tab regains focus, and when the OS reports the network is back,
       is what makes it feel immediate. */
    setInterval(check, RECHECK_MS);
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") check();
    });
    window.addEventListener("online",  check);
    window.addEventListener("pageshow", function (e) { if (e.persisted) check(); });
  })();

  /* ---------- Platform detection (for adaptive bottom nav) ---------- */
  (function () {
    const ua = navigator.userAgent;
    const isIOS =
      /iPhone|iPad|iPod/.test(ua) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1); // iPadOS
    const isAndroid = /Android/.test(ua);
    document.body.classList.add(
      isIOS ? "platform-ios" : isAndroid ? "platform-android" : "platform-other"
    );
  })();

  /* ---------- 0. Boot loader ---------- */
  (function () {
    const loader = document.getElementById("loader");
    if (!loader) return;
    const term = document.getElementById("loaderTerm");
    const fill = document.getElementById("loaderFill");
    let finished = false;

    function done() {
      if (finished) return;
      finished = true;
      loader.classList.add("is-done");
      document.body.classList.remove("is-loading");
      setTimeout(() => loader.remove(), 550);
    }

    if (reduceMotion) { done(); return; }

    loader.addEventListener("click", done); // skippable

    // ── Phase 1: the prompt, with the command typed like a human ──
    const promptLine = document.createElement("div");
    const user = document.createElement("span");
    user.className = "term__user";
    user.textContent = "toothless@queenbee-core-srv";
    const path = document.createElement("span");
    path.className = "term__path";
    path.textContent = "~";
    const cmdSpan = document.createElement("span");
    promptLine.append(user, ":", path, "$ ", cmdSpan);
    term.append(promptLine);

    const CMD = "sudo ./start-website.sh";
    let ci = 0;
    (function typeCmd() {
      if (finished) return;
      if (ci <= CMD.length) {
        cmdSpan.textContent = CMD.slice(0, ci);
        ci++;
        fill.style.width = (ci / CMD.length) * 25 + "%";
        setTimeout(typeCmd, 26);
      } else {
        setTimeout(password, 180);
      }
    })();

    // ── Phase 2: sudo asks for the password ──
    function password() {
      if (finished) return;
      const line = document.createElement("div");
      line.textContent = "[sudo] password for toothless: ";
      term.append(line);
      let d = 0;
      (function dot() {
        if (finished) return;
        if (d < 4) {
          line.textContent += "•";
          d++;
          fill.style.width = 25 + (d / 4) * 15 + "%";
          setTimeout(dot, 120);
        } else {
          setTimeout(runScript, 200);
        }
      })();
    }

    // ── Phase 3: script output bursts line by line, like real execution ──
    const lines = [
      [["Starting web stack ...", null]],
      [["  ✓ ", "term__ok"], ["nginx.service ......... ", null], ["active", "term__ok"]],
      [["  ✓ ", "term__ok"], ["docker.service ........ ", null], ["active", "term__ok"]],
      [["  ✓ ", "term__ok"], ["portfolio:3000 ........ ", null], ["healthy", "term__ok"]],
      [["  → ", "term__path"], ["securing connections .. ", null], ["done", "term__ok"]],
      [["Website online — welcome.", "term__ok"]],
    ];
    function runScript() {
      let i = 0;
      (function nextLine() {
        if (finished) return;
        if (i >= lines.length) {
          fill.style.width = "100%";
          setTimeout(done, 350);
          return;
        }
        const div = document.createElement("div");
        lines[i].forEach(([txt, cls]) => {
          if (cls) {
            const s = document.createElement("span");
            s.className = cls;
            s.textContent = txt;
            div.append(s);
          } else {
            div.append(txt);
          }
        });
        term.append(div);
        i++;
        fill.style.width = 40 + (i / lines.length) * 60 + "%";
        setTimeout(nextLine, 100);
      })();
    }

    // hard cap: never block the page longer than 3.5s no matter what
    setTimeout(done, 3500);
  })();

  /* ---------- 1. Theme ---------- */
  const root = document.documentElement;
  const toggle = document.getElementById("themeToggle");

  // Load saved theme, else follow the OS
  const saved = localStorage.getItem("hub-theme");
  if (saved === "light" || saved === "dark") {
    root.dataset.theme = saved;
  } else if (window.matchMedia("(prefers-color-scheme: light)").matches) {
    root.dataset.theme = "light";
  }

  toggle.addEventListener("click", () => {
    const next = root.dataset.theme === "dark" ? "light" : "dark";
    root.dataset.theme = next;
    localStorage.setItem("hub-theme", next);
  });

  /* ---------- 2. Typed roles ---------- */
  const roles = [
    "Full-Stack Developer",
    "Java · Spring Boot",
    "Next.js · React",
    "AI Integration",
    "Self-Hosting Engineer",
  ];
  const typedEl = document.getElementById("typedRole");

  if (typedEl && !reduceMotion) {
    let roleIdx = 0;
    let charIdx = roles[0].length; // start fully typed (matches initial HTML)
    let deleting = true;           // begin by deleting the initial role
    const TYPE_MS = 65, DELETE_MS = 35, HOLD_MS = 2200;

    function tick() {
      const word = roles[roleIdx];

      if (deleting) {
        charIdx--;
        typedEl.textContent = word.slice(0, charIdx);
        if (charIdx === 0) {
          deleting = false;
          roleIdx = (roleIdx + 1) % roles.length;
          setTimeout(tick, 350);
          return;
        }
        setTimeout(tick, DELETE_MS);
      } else {
        const nextWord = roles[roleIdx];
        charIdx++;
        typedEl.textContent = nextWord.slice(0, charIdx);
        if (charIdx === nextWord.length) {
          deleting = true;
          setTimeout(tick, HOLD_MS);
          return;
        }
        setTimeout(tick, TYPE_MS);
      }
    }
    setTimeout(tick, HOLD_MS); // hold the initial role first
  }

  /* ---------- 3. Scroll reveal ---------- */
  const revealEls = document.querySelectorAll("[data-reveal]");

  if (reduceMotion) {
    revealEls.forEach((el) => el.classList.add("is-visible"));
  } else {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15, rootMargin: "0px 0px -40px 0px" }
    );
    revealEls.forEach((el) => io.observe(el));
  }

  /* ---------- 4. Request trace ---------- */
  const trace = document.querySelector(".trace");
  const traceLine = document.getElementById("traceLine");
  const traceText = "$ curl -I https://queenbee-core-srv — tracing your request…";

  function playTrace() {
    if (reduceMotion) {
      traceLine.textContent = traceText;
      trace.classList.add("is-played");
      return;
    }
    let i = 0;
    (function typeChar() {
      if (i <= traceText.length) {
        traceLine.textContent = traceText.slice(0, i);
        i++;
        setTimeout(typeChar, 22);
      } else {
        trace.classList.add("is-played"); // reveals the node chain (CSS staggers)
      }
    })();
  }

  if (trace && traceLine) {
    const traceObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            playTrace();
            traceObserver.disconnect();
          }
        });
      },
      { threshold: 0.4 }
    );
    traceObserver.observe(trace);
  }

  /* ---------- 5. Mobile menu ---------- */
  const burger = document.getElementById("navBurger");
  const mobileMenu = document.getElementById("navMobile");

  burger.addEventListener("click", () => {
    const open = mobileMenu.classList.toggle("is-open");
    burger.setAttribute("aria-expanded", String(open));
  });

  // Close the menu after tapping a link
  mobileMenu.querySelectorAll("a").forEach((a) =>
    a.addEventListener("click", () => {
      mobileMenu.classList.remove("is-open");
      burger.setAttribute("aria-expanded", "false");
    })
  );

  /* ---------- 6. Playground ---------- */

  /* — Game tabs — */
  (function () {
    const tabs = document.querySelectorAll(".games-tab");
    const panels = document.querySelectorAll(".game-panel");
    if (!tabs.length) return;

    function show(gameId) {
      tabs.forEach((t) => {
        const active = t.dataset.game === gameId;
        t.classList.toggle("is-active", active);
        t.setAttribute("aria-selected", String(active));
      });
      panels.forEach((p) => {
        const active = p.dataset.panel === gameId;
        p.classList.toggle("is-active", active);
        // Inline style: guarantees only one panel is visible even if the
        // stylesheet is stale or overridden
        p.style.display = active ? "flex" : "none";
      });
    }

    tabs.forEach((tab) =>
      tab.addEventListener("click", () => show(tab.dataset.game))
    );

    // Enforce correct initial state on load
    const initial = document.querySelector(".games-tab.is-active");
    show(initial ? initial.dataset.game : tabs[0].dataset.game);
  })();

  /* shared terminal element helper */
  function tEl(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  /* — Guess Game (terminal) — */
  (function () {
    const out = document.getElementById("guessOut");
    if (!out) return;
    const MAX = 50;
    let secret, attempts, over;
    let attemptsLine, history, inputRow, input;

    function build() {
      out.innerHTML = "";
      attemptsLine = tEl("p", "term__line", "Attempts: 0");
      out.append(attemptsLine);
      out.append(tEl("p", "term__line", `Guess a number between 1 and ${MAX}`));
      history = tEl("div", "term__out");
      out.append(history);

      inputRow = tEl("p", "term__inrow");
      const dollar = tEl("span", "term__user", "$");
      inputRow.append(dollar, " guess ");
      input = document.createElement("input");
      input.type = "number";
      input.min = "1";
      input.max = String(MAX);
      input.placeholder = `1-${MAX}`;
      input.className = "term__input";
      input.setAttribute("aria-label", "Your guess");
      inputRow.append(input, " ");
      inputRow.append(tEl("span", "term__key", "⏎"));
      out.append(inputRow);

      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") guess();
      });
    }

    function reset() {
      secret = Math.floor(Math.random() * MAX) + 1;
      attempts = 0;
      over = false;
      build();
      input.focus({ preventScroll: true });
    }

    function guess() {
      if (over) return;
      const n = parseInt(input.value, 10);
      if (isNaN(n) || n < 1 || n > MAX) {
        history.append(tEl("p", "term__err", `> enter a number from 1 to ${MAX}`));
        input.select();
        return;
      }
      attempts++;
      attemptsLine.textContent = `Attempts: ${attempts}`;
      if (n === secret) {
        over = true;
        history.append(tEl("p", "term__ok", `> ${n} — correct!`));
        history.append(
          tEl("p", "term__ok", `You got it in ${attempts} attempt${attempts === 1 ? "" : "s"}.`)
        );
        inputRow.remove();
        const again = tEl("button", "term__link", "play again");
        again.addEventListener("click", reset);
        out.append(again);
      } else {
        history.append(tEl("p", "term__dim", `> ${n} — too ${n < secret ? "low" : "high"}`));
        input.value = "";
        input.focus({ preventScroll: true });
      }
    }

    reset();
  })();

  /* — Tic-Tac-Toe — */
  (function () {
    const boardEl = document.getElementById("ttt");
    if (!boardEl) return;
    const cells = Array.from(boardEl.querySelectorAll(".ttt__cell"));
    const msg = document.getElementById("tttMsg");
    const scoreEl = document.getElementById("tttScore");
    const LINES = [
      [0,1,2],[3,4,5],[6,7,8],
      [0,3,6],[1,4,7],[2,5,8],
      [0,4,8],[2,4,6],
    ];
    let board, over, busy;
    const score = { w: 0, l: 0, d: 0 };

    function reset() {
      board = Array(9).fill("");
      over = false;
      busy = false;
      cells.forEach((c) => {
        c.textContent = "";
        c.disabled = false;
        c.classList.remove("is-x", "is-o", "is-win");
      });
      msg.textContent = "Your move — you are X.";
    }
    function winLine(b, p) {
      return LINES.find((l) => l.every((i) => b[i] === p));
    }
    function finish(line, text, key) {
      over = true;
      busy = false;
      if (line) line.forEach((i) => cells[i].classList.add("is-win"));
      score[key]++;
      scoreEl.textContent = `W ${score.w} · L ${score.l} · D ${score.d}`;
      msg.textContent = text;
      cells.forEach((c) => (c.disabled = true));
    }
    function place(i, p) {
      board[i] = p;
      cells[i].textContent = p;
      cells[i].classList.add(p === "X" ? "is-x" : "is-o");
      cells[i].disabled = true;
      const w = winLine(board, p);
      if (w) return finish(w, p === "X" ? "You win. Impressive." : "The server wins.", p === "X" ? "w" : "l");
      if (!board.includes("")) return finish(null, "Draw. Rematch?", "d");
      if (p === "X") {
        busy = true;
        msg.textContent = "Server thinking…";
        setTimeout(serverMove, 380);
      } else {
        busy = false;
        msg.textContent = "Your move.";
      }
    }
    function serverMove() {
      if (over) return;
      const empty = board.map((v, i) => (v ? null : i)).filter((v) => v !== null);
      // 1. win if possible
      for (const i of empty) {
        board[i] = "O";
        if (winLine(board, "O")) { board[i] = ""; return place(i, "O"); }
        board[i] = "";
      }
      // 2. block the player
      for (const i of empty) {
        board[i] = "X";
        if (winLine(board, "X")) { board[i] = ""; return place(i, "O"); }
        board[i] = "";
      }
      // 3. center, 4. corner, 5. anything
      if (board[4] === "") return place(4, "O");
      const corners = [0, 2, 6, 8].filter((i) => board[i] === "");
      if (corners.length) return place(corners[Math.floor(Math.random() * corners.length)], "O");
      place(empty[Math.floor(Math.random() * empty.length)], "O");
    }
    cells.forEach((c, i) =>
      c.addEventListener("click", () => {
        if (over || busy || board[i]) return;
        place(i, "X");
      })
    );
    document.getElementById("tttReset").addEventListener("click", reset);
    reset();
  })();

  /* — Coin Flip (terminal) — */
  (function () {
    const out = document.getElementById("coinOut");
    if (!out) return;
    let wins = 0, losses = 0, busy = false;

    function el(tag, cls, text) {
      const n = document.createElement(tag);
      if (cls) n.className = cls;
      if (text !== undefined) n.textContent = text;
      return n;
    }

    function renderChoice() {
      busy = false;
      out.innerHTML = "";
      const line = el("p", "term__line");
      line.append("Call it: ");
      ["heads", "tails"].forEach((side, i) => {
        const b = el("button", "term__link", side);
        b.addEventListener("click", () => play(side));
        line.append(b);
        if (i === 0) line.append(" / ");
      });
      out.append(line);
    }

    function play(pick) {
      if (busy) return;
      busy = true;

      // The server locks in its result BEFORE the flip is shown
      const result = Math.random() < 0.5 ? "heads" : "tails";
      const won = pick === result;

      out.innerHTML = "";
      out.append(el("p", "term__dim", `> you called: ${pick}`));
      const flipping = el("p", "term__line term__flipping", "flipping coin");
      out.append(flipping);

      const wait = reduceMotion ? 100 : 1200;
      setTimeout(() => {
        flipping.remove();

        const resLine = el("p", "term__line");
        resLine.append("Result: ");
        resLine.append(el("span", won ? "term__ok" : "term__err", result));
        out.append(resLine);

        out.append(el("p", won ? "term__ok" : "term__err", won ? "You win!" : "You lose!"));

        won ? wins++ : losses++;
        out.append(el("p", "term__dim", `W: ${wins} / L: ${losses}`));

        const again = el("button", "term__link", "flip again");
        again.addEventListener("click", renderChoice);
        out.append(again);
      }, wait);
    }

    renderChoice();
  })();

  /* — Rock Paper Scissors (terminal) — */
  (function () {
    const out = document.getElementById("rpsOut");
    if (!out) return;
    const beats = { rock: "scissors", paper: "rock", scissors: "paper" };
    const options = ["rock", "paper", "scissors"];
    const score = { w: 0, l: 0, d: 0 };
    const cap = (s) => s[0].toUpperCase() + s.slice(1);

    function renderChoice() {
      out.innerHTML = "";
      const line = tEl("p", "term__line");
      line.append("Choose: ");
      options.forEach((o, i) => {
        const b = tEl("button", "term__link", o);
        b.addEventListener("click", () => play(o));
        line.append(b);
        if (i < options.length - 1) line.append(" / ");
      });
      out.append(line);
    }

    function play(you) {
      const srv = options[Math.floor(Math.random() * 3)];
      out.innerHTML = "";
      out.append(tEl("p", "term__dim", `> you: ${cap(you)} · server: ${cap(srv)}`));

      let verdict, cls, key;
      if (you === srv) { verdict = "Draw."; cls = "term__line"; key = "d"; }
      else if (beats[you] === srv) { verdict = "You win!"; cls = "term__ok"; key = "w"; }
      else { verdict = "You lose!"; cls = "term__err"; key = "l"; }
      score[key]++;

      out.append(tEl("p", cls, verdict));
      out.append(tEl("p", "term__dim", `W: ${score.w} / L: ${score.l} / D: ${score.d}`));

      const again = tEl("button", "term__link", "play again");
      again.addEventListener("click", renderChoice);
      out.append(again);
    }

    renderChoice();
  })();

  /* ---------- 7. Cursor glow (whole site) ---------- */
  (function () {
    const glow = document.getElementById("cursorGlow");
    if (!glow || reduceMotion) return;
    if (!window.matchMedia("(pointer: fine)").matches) return;
    let raf = null;
    window.addEventListener("mousemove", (e) => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = null;
        glow.style.setProperty("--gx", e.clientX + "px");
        glow.style.setProperty("--gy", e.clientY + "px");
        document.body.classList.add("has-cursor");
      });
    });
    document.documentElement.addEventListener("mouseleave", () =>
      document.body.classList.remove("has-cursor")
    );
  })();

  /* ---------- 7b. Grid brighten (hero) ---------- */
  (function () {
    const hero = document.querySelector(".hero");
    if (!hero || reduceMotion) return;
    if (!window.matchMedia("(pointer: fine)").matches) return;
    let raf = null;
    hero.addEventListener("mousemove", (e) => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = null;
        const r = hero.getBoundingClientRect();
        hero.style.setProperty("--mx", e.clientX - r.left + "px");
        hero.style.setProperty("--my", e.clientY - r.top + "px");
        hero.classList.add("has-pointer");
      });
    });
    hero.addEventListener("mouseleave", () => hero.classList.remove("has-pointer"));
  })();

  /* ---------- 8. Parallax drift (hero) ---------- */
  (function () {
    if (reduceMotion) return;
    const floats = document.querySelector(".hero__floats");
    const grid = document.querySelector(".hero__grid"); // base layer only
    if (!floats && !grid) return;
    let raf = null;
    window.addEventListener(
      "scroll",
      () => {
        if (raf) return;
        raf = requestAnimationFrame(() => {
          raf = null;
          const y = Math.min(window.scrollY, 900);
          if (floats) floats.style.transform = `translateY(${(y * 0.18).toFixed(1)}px)`;
          if (grid) grid.style.transform = `translateY(${(y * 0.08).toFixed(1)}px)`;
        });
      },
      { passive: true }
    );
  })();

  /* ---------- 9. Scroll progress bar ---------- */
  (function () {
    const bar = document.getElementById("progressBar");
    if (!bar) return;
    function update() {
      const doc = document.documentElement;
      const max = doc.scrollHeight - doc.clientHeight;
      bar.style.transform = `scaleX(${max ? window.scrollY / max : 0})`;
    }
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    update();
  })();

  /* ---------- 10. Active section in nav (top + bottom) ---------- */
  (function () {
    const links = Array.from(
      document.querySelectorAll('.nav__links a[href^="#"], .bottomnav a[href^="#"]')
    );
    const sections = [
      ...new Set(
        links.map((a) => document.querySelector(a.getAttribute("href"))).filter(Boolean)
      ),
    ];
    if (!sections.length) return;
    const hero = document.querySelector(".hero");
    const spy = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          if (entry.target === hero) {
            // at the top of the page: no section is active
            links.forEach((l) => l.classList.remove("is-current"));
            return;
          }
          const id = "#" + entry.target.id;
          links.forEach((l) =>
            l.classList.toggle("is-current", l.getAttribute("href") === id)
          );
        });
      },
      { rootMargin: "-35% 0px -55% 0px" }
    );
    sections.forEach((sec) => spy.observe(sec));
    if (hero) spy.observe(hero);
  })();

  /* ---------- 11. 3D tilt on work visuals ---------- */
  (function () {
    if (reduceMotion || !window.matchMedia("(pointer: fine)").matches) return;
    document.querySelectorAll(".work__visual").forEach((panel) => {
      panel.addEventListener("mousemove", (e) => {
        const r = panel.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width - 0.5;
        const py = (e.clientY - r.top) / r.height - 0.5;
        panel.style.transform = `perspective(700px) rotateX(${(-py * 7).toFixed(2)}deg) rotateY(${(px * 7).toFixed(2)}deg)`;
      });
      panel.addEventListener("mouseleave", () => {
        panel.style.transform = "";
      });
    });
  })();

  /* ---------- 12. Monogram scramble ---------- */
  (function () {
    if (reduceMotion) return;
    const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#$%&";
    document.querySelectorAll(".work__mono").forEach((mono) => {
      const original = mono.textContent;
      let timer = null;
      const card = mono.closest(".work");
      (card || mono).addEventListener("mouseenter", () => {
        if (timer) return;
        let frame = 0;
        const total = 12;
        timer = setInterval(() => {
          frame++;
          mono.textContent = original
            .split("")
            .map((ch, idx) =>
              (frame / total) * original.length > idx
                ? ch
                : CHARS[Math.floor(Math.random() * CHARS.length)]
            )
            .join("");
          if (frame >= total) {
            clearInterval(timer);
            timer = null;
            mono.textContent = original;
          }
        }, 45);
      });
    });
  })();

  /* ---------- 13. Stat counter roll-up ---------- */
  (function () {
    const values = document.querySelectorAll(".stat__value");
    if (!values.length) return;
    function roll(el) {
      const raw = el.textContent.trim();
      const m = raw.match(/^([^\d]*)(\d+)(.*)$/);
      if (!m) return; // non-numeric stats (SSR, Live) stay as-is
      const [, pre, numStr, suf] = m;
      const target = parseInt(numStr, 10);
      if (reduceMotion || target === 0) return;
      const dur = 900;
      const t0 = performance.now();
      requestAnimationFrame(function step(t) {
        const p = Math.min((t - t0) / dur, 1);
        const eased = 1 - Math.pow(1 - p, 3);
        el.textContent = pre + Math.round(target * eased) + suf;
        if (p < 1) requestAnimationFrame(step);
        else el.textContent = raw;
      });
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((en) => {
          if (!en.isIntersecting) return;
          io.unobserve(en.target);
          roll(en.target);
        });
      },
      { threshold: 0.6 }
    );
    values.forEach((v) => io.observe(v));
  })();

  /* ---------- 14. Live syslog feed + visitor ping ---------- */
  (function () {
    const out = document.getElementById("syslog");
    if (!out) return;
    const MAX_LINES = 7;
    const stamp = () => new Date().toTimeString().slice(0, 8);
    function add(text, cls) {
      const line = document.createElement("div");
      line.className = "syslog__line" + (cls ? " " + cls : "");
      line.textContent = `[${stamp()}] ${text}`;
      out.append(line);
      while (out.children.length > MAX_LINES) out.firstChild.remove();
    }
    const pool = [
      ["nginx: request served · 200 OK · 12ms", "syslog__ok"],
      ["docker: all containers healthy", ""],
      ["network: encrypted tunnel active", ""],
      ["nginx: request served · 200 OK · 38ms", "syslog__ok"],
      ["security: intrusion attempt blocked", "syslog__warn"],
      ["firewall: unauthorized probe denied", ""],
      ["tls: certificate valid · auto-renew armed", "syslog__ok"],
      ["systemd: all units active · load nominal", ""],
    ];
    let idx = 0, timer = null, started = false, visible = false;
    function tick() {
      if (!visible) return;
      const [text, cls] = pool[idx % pool.length];
      idx++;
      add(text, cls);
    }
    function startFeed() { if (!timer) timer = setInterval(tick, 2000); }
    function stopFeed() { if (timer) { clearInterval(timer); timer = null; } }
    function start() {
      if (started) return;
      started = true;
      if (reduceMotion) {
        add("> you connected from a browser · served by queenbee-core-srv", "syslog__ok");
        tick(); tick();
        startFeed();
        return;
      }
      // visitor ping types out first, then the feed begins
      const ping = document.createElement("div");
      ping.className = "syslog__line syslog__ok";
      out.append(ping);
      const msg = `[${stamp()}] > you connected from a browser · served by queenbee-core-srv`;
      let i = 0;
      (function type() {
        if (i <= msg.length) {
          ping.textContent = msg.slice(0, i);
          i++;
          setTimeout(type, 15);
        } else {
          startFeed();
        }
      })();
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((en) => {
          visible = en.isIntersecting;
          if (visible) { start(); if (started) startFeed(); }
          else stopFeed();
        });
      },
      { threshold: 0.2 }
    );
    io.observe(out);
  })();

  /* ---------- 15. Request-path choreography (rack) ---------- */
  (function () {
    const units = document.querySelectorAll(".rack__unit");
    if (!units.length || reduceMotion) return;
    // narrative order of a real request: tailscale ingress → nginx → docker
    const order = [2, 0, 1];
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((en) => {
          if (!en.isIntersecting) return;
          io.disconnect();
          order.forEach((u, k) =>
            setTimeout(() => {
              units[u].classList.add("is-hot");
              setTimeout(() => units[u].classList.remove("is-hot"), 650);
            }, 400 + k * 450)
          );
        });
      },
      { threshold: 0.35 }
    );
    io.observe(units[0].parentElement);
  })();

  /* ---------- 16. Word-by-word heading reveal ---------- */
  (function () {
    if (reduceMotion) return;
    const heads = document.querySelectorAll("main h2");
    heads.forEach((h) => {
      const words = h.textContent.split(" ");
      h.textContent = "";
      words.forEach((w, i) => {
        const s = document.createElement("span");
        s.className = "w";
        s.style.setProperty("--wd", i * 70 + "ms");
        s.textContent = w;
        h.append(s);
        if (i < words.length - 1) h.append(" ");
      });
    });
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((en) => {
          if (!en.isIntersecting) return;
          en.target.classList.add("words-in");
          io.unobserve(en.target);
        });
      },
      { threshold: 0.4 }
    );
    heads.forEach((h) => io.observe(h));
  })();

  /* ---------- 17. Eyebrow number tickers ---------- */
  (function () {
    if (reduceMotion) return;
    document.querySelectorAll(".eyebrow").forEach((eye) => {
      const m = eye.textContent.match(/^(\d{2})([\s\S]*)$/);
      if (!m) return; // hero eyebrow has no number
      const finalNum = m[1];
      const rest = m[2];
      const io = new IntersectionObserver(
        (entries) => {
          entries.forEach((en) => {
            if (!en.isIntersecting) return;
            io.disconnect();
            let frame = 0;
            const total = 10;
            const iv = setInterval(() => {
              frame++;
              eye.textContent =
                (frame >= total
                  ? finalNum
                  : String(Math.floor(Math.random() * 90) + 10)) + rest;
              if (frame >= total) clearInterval(iv);
            }, 50);
          });
        },
        { threshold: 0.5 }
      );
      io.observe(eye);
    });
  })();

  /* ---------- Back to top ---------- */
  document.querySelectorAll('a[href="#top"]').forEach((a) =>
    a.addEventListener("click", (e) => {
      e.preventDefault();
      window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
      document
        .querySelectorAll(".nav__links a, .bottomnav a")
        .forEach((l) => l.classList.remove("is-current"));
    })
  );

  /* ---------- Footer year ---------- */
  document.getElementById("year").textContent = new Date().getFullYear();
})();
