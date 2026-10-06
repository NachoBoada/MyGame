(() => {
  "use strict";

  // ---------- Constants ----------
  const W = 1200;
  const H = 800;
  const RADIUS = 17;
  const PLAYER_SPEED = 220;
  const BOT_SPEED = 170;
  const BULLET_SPEED = 750;
  const BULLET_LIFE = 1.4;
  const PLAYER_COOLDOWN = 0.3;
  const BOT_VIEW_RANGE = 750;
  const COUNTDOWN = 3;

  // Networking
  const MAX_PLAYERS = 6;
  const SNAPSHOT_INTERVAL = 0.05; // host → players, 20 per second
  const INPUT_INTERVAL = 1 / 30; // player → host, 30 per second
  const HEARTBEAT_MS = 1000;
  const TIMEOUT_MS = 10000;

  // Mirror rectangles into all four quarters of the arena, so a map is symmetric
  // left-right and top-bottom. Rectangles that sit on a center line aren't duplicated.
  function mirrored(...rects) {
    const out = [];
    const seen = new Set();
    for (const r of rects) {
      for (const [x, y] of [[r.x, r.y], [W - r.x - r.w, r.y], [r.x, H - r.y - r.h], [W - r.x - r.w, H - r.y - r.h]]) {
        const key = `${x},${y},${r.w},${r.h}`;
        if (!seen.has(key)) {
          seen.add(key);
          out.push({ x, y, w: r.w, h: r.h });
        }
      }
    }
    return out;
  }

  // Every map keeps the spawn points below clear, and every spawn can reach every other.
  const MAPS = [
    {
      id: "outpost",
      name: "Outpost",
      walls: [
        { x: 200, y: 150, w: 160, h: 30 },
        { x: 840, y: 150, w: 160, h: 30 },
        { x: 200, y: 620, w: 160, h: 30 },
        { x: 840, y: 620, w: 160, h: 30 },
        { x: 560, y: 330, w: 80, h: 140 },
        { x: 380, y: 300, w: 30, h: 200 },
        { x: 790, y: 300, w: 30, h: 200 },
        { x: 540, y: 100, w: 120, h: 30 },
        { x: 540, y: 670, w: 120, h: 30 },
        { x: 80, y: 370, w: 100, h: 60 },
        { x: 1020, y: 370, w: 100, h: 60 },
      ],
    },
    {
      // L-shaped bunkers around an open center with a single block
      id: "crossroads",
      name: "Crossroads",
      walls: mirrored(
        { x: 250, y: 200, w: 200, h: 30 },
        { x: 250, y: 230, w: 30, h: 110 },
        { x: 585, y: 120, w: 30, h: 110 },
        { x: 560, y: 380, w: 80, h: 40 },
        { x: 90, y: 385, w: 110, h: 30 },
      ),
    },
    {
      // A grid of small pillars: lots of cover, short sight lines
      id: "pillars",
      name: "Pillars",
      walls: mirrored(
        { x: 275, y: 225, w: 50, h: 50 },
        { x: 275, y: 375, w: 50, h: 50 },
        { x: 475, y: 225, w: 50, h: 50 },
        { x: 475, y: 375, w: 50, h: 50 },
        { x: 130, y: 160, w: 50, h: 50 },
      ),
    },
    {
      // Two long trench lines with gaps at the ends and in the middle
      id: "trenches",
      name: "Trenches",
      walls: mirrored(
        { x: 120, y: 230, w: 380, h: 30 },
        { x: 560, y: 330, w: 80, h: 140 },
        { x: 150, y: 370, w: 120, h: 60 },
      ),
    },
  ];

  // The map being played or previewed. Collisions, bots and drawing all read WALLS.
  let currentMap = MAPS[0];
  let WALLS = currentMap.walls;

  const SPAWNS = [
    { x: 70, y: 70 },
    { x: W - 70, y: 70 },
    { x: 70, y: H - 70 },
    { x: W - 70, y: H - 70 },
    { x: W / 2, y: 45 },
    { x: W / 2, y: H - 45 },
  ];

  // Tank designs, drawn facing +x. Sizes are in pixels.
  //   L/Wd: hull length/width, tw: track width
  //   turret: "round" | "box" | "hex" | "casemate", ts: turret size
  //   bl/bw: barrel length/width, twin: two barrels, brake: muzzle brake
  const TANKS = {
    medium:    { L: 36, Wd: 28, tw: 7, turret: "round",    ts: 9,  bl: 22, bw: 5,   twin: false, brake: true },
    heavy:     { L: 40, Wd: 32, tw: 8, turret: "box",      ts: 10, bl: 26, bw: 6,   twin: false, brake: true },
    light:     { L: 30, Wd: 24, tw: 6, turret: "round",    ts: 7,  bl: 18, bw: 4,   twin: false, brake: false },
    twin:      { L: 36, Wd: 30, tw: 7, turret: "hex",      ts: 10, bl: 20, bw: 4,   twin: true,  brake: false },
    destroyer: { L: 38, Wd: 28, tw: 7, turret: "casemate", ts: 10, bl: 28, bw: 5,   twin: false, brake: true },
    sniper:    { L: 34, Wd: 26, tw: 6, turret: "round",    ts: 8,  bl: 32, bw: 3.5, twin: false, brake: true },
  };

  // One slot per tank. Players take slots in the order they joined; bots fill the rest.
  const SLOTS = [
    { color: "#7fb83e", tank: "medium" },
    { color: "#d0644a", tank: "heavy" },
    { color: "#d9a441", tank: "light" },
    { color: "#9b7cc4", tank: "twin" },
    { color: "#4f97c9", tank: "destroyer" },
    { color: "#a7b0ba", tank: "sniper" },
  ];
  const BOT_NAMES = ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot"];

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const canvas = $("game");
  const ctx = canvas.getContext("2d");
  const aliveEl = $("alive");
  const killsEl = $("kills");
  const roomChip = $("room-chip");
  const feedEl = $("feed");
  const bannerEl = $("banner");
  const overlay = $("overlay");
  const panels = { menu: $("menu-panel"), lobby: $("lobby-panel"), end: $("end-panel") };
  const nameInput = $("name");
  const codeInput = $("code");
  const menuStatus = $("menu-status");
  const menuButtons = [$("create"), $("join"), $("solo")];
  const mapSelects = [...document.querySelectorAll(".map-select")];

  function showPanel(name) {
    overlay.hidden = !name;
    for (const [key, el] of Object.entries(panels)) el.hidden = key !== name;
  }

  function setMenuStatus(text, isError = false) {
    menuStatus.textContent = text;
    menuStatus.classList.toggle("error", isError);
  }

  // ---------- Input ----------
  const keys = new Set();
  const mouse = { x: W / 2, y: H / 2, down: false };

  window.addEventListener("keydown", (e) => {
    if (e.target instanceof HTMLInputElement) return; // typing a name or code
    keys.add(e.code);
    if (e.code === "KeyR" && session.role === "solo") startRound();
    if (state.running && (e.code.startsWith("Arrow") || e.code === "Space")) e.preventDefault();
  });
  window.addEventListener("keyup", (e) => keys.delete(e.code));
  window.addEventListener("blur", () => { keys.clear(); mouse.down = false; });

  canvas.addEventListener("mousemove", (e) => {
    const r = canvas.getBoundingClientRect();
    mouse.x = ((e.clientX - r.left) / r.width) * W;
    mouse.y = ((e.clientY - r.top) / r.height) * H;
  });
  canvas.addEventListener("mousedown", (e) => { if (e.button === 0) mouse.down = true; });
  window.addEventListener("mouseup", (e) => { if (e.button === 0) mouse.down = false; });
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  // ---------- Helpers ----------
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const angleDiff = (a, b) => {
    let d = b - a;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
  };
  // Lighten (amt > 0) or darken (amt < 0) a #rrggbb color
  const shade = (hex, amt) => {
    const n = parseInt(hex.slice(1), 16);
    const f = (c) => clamp(Math.round(c + (amt > 0 ? 255 - c : c) * amt), 0, 255);
    return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
  };
  const shuffle = (arr) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };
  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const cleanName = (n) => String(n || "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 14) || "Player";
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

  // Liang–Barsky segment vs axis-aligned rect; returns entry t in [0,1] or -1
  function segHitsRect(x1, y1, x2, y2, r) {
    const dx = x2 - x1, dy = y2 - y1;
    const p = [-dx, dx, -dy, dy];
    const q = [x1 - r.x, r.x + r.w - x1, y1 - r.y, r.y + r.h - y1];
    let t0 = 0, t1 = 1;
    for (let i = 0; i < 4; i++) {
      if (p[i] === 0) {
        if (q[i] < 0) return -1;
      } else {
        const t = q[i] / p[i];
        if (p[i] < 0) { if (t > t1) return -1; if (t > t0) t0 = t; }
        else { if (t < t0) return -1; if (t < t1) t1 = t; }
      }
    }
    return t0;
  }

  function hasLineOfSight(a, b) {
    for (const w of WALLS) if (segHitsRect(a.x, a.y, b.x, b.y, w) >= 0) return false;
    return true;
  }

  // Distance from point to segment
  function segPointDist(x1, y1, x2, y2, px, py) {
    const dx = x2 - x1, dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    let t = len2 ? ((px - x1) * dx + (py - y1) * dy) / len2 : 0;
    t = clamp(t, 0, 1);
    return Math.hypot(x1 + t * dx - px, y1 + t * dy - py);
  }

  function resolveWalls(e) {
    e.x = clamp(e.x, RADIUS, W - RADIUS);
    e.y = clamp(e.y, RADIUS, H - RADIUS);
    for (const r of WALLS) {
      const cx = clamp(e.x, r.x, r.x + r.w);
      const cy = clamp(e.y, r.y, r.y + r.h);
      const dx = e.x - cx, dy = e.y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 >= RADIUS * RADIUS) continue;
      if (d2 > 0) {
        const d = Math.sqrt(d2);
        e.x += (dx / d) * (RADIUS - d);
        e.y += (dy / d) * (RADIUS - d);
      } else {
        // Center inside the rect: push out along the shortest axis
        const left = e.x - r.x, right = r.x + r.w - e.x;
        const top = e.y - r.y, bottom = r.y + r.h - e.y;
        const m = Math.min(left, right, top, bottom);
        if (m === left) e.x = r.x - RADIUS;
        else if (m === right) e.x = r.x + r.w + RADIUS;
        else if (m === top) e.y = r.y - RADIUS;
        else e.y = r.y + r.h + RADIUS;
      }
    }
  }

  function resolveEntityOverlap(list) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        const min = RADIUS * 2;
        if (d > 0 && d < min) {
          const push = (min - d) / 2;
          a.x -= (dx / d) * push; a.y -= (dy / d) * push;
          b.x += (dx / d) * push; b.y += (dy / d) * push;
        }
      }
    }
  }

  function randomOpenPoint() {
    for (let tries = 0; tries < 100; tries++) {
      const p = { x: rand(40, W - 40), y: rand(40, H - 40) };
      const pad = RADIUS + 10;
      const blocked = WALLS.some(
        (r) => p.x > r.x - pad && p.x < r.x + r.w + pad && p.y > r.y - pad && p.y < r.y + r.h + pad
      );
      if (!blocked) return p;
    }
    return { x: W / 2, y: 60 };
  }

  // ---------- State ----------
  // session: who we are and how we're connected.
  //   role "solo": everything runs locally, no network.
  //   role "host": this browser runs the match and sends it to everyone else.
  //   role "client": this browser sends its controls to the host and draws what the host sends back.
  const session = {
    role: null,
    net: null,
    code: "",
    myPid: "host",
    players: [], // [{ pid, name, lastSeen }] in join order; the host is always first
    inputs: new Map(), // host only: pid → latest controls from that player
    lastStart: null, // host only: the current round's start message, for late joiners
    lastHostMsg: 0, // client only
    sendTimer: 0,
  };

  const state = {
    running: false,
    round: 0,
    entities: [],
    bullets: [],
    particles: [],
    wrecks: [],
    countdown: 0,
    over: false,
    endTimer: 0,
    winnerId: -1,
    myKills: 0,
  };

  const isMine = (e) => e.pid !== null && e.pid === session.myPid;
  const mine = () => state.entities.find(isMine);
  const alive = () => state.entities.filter((e) => e.alive);
  const displayName = (e) => (isMine(e) ? "You" : e.name);
  const tag = (e) => `<b style="color:${e.color}">${esc(displayName(e))}</b>`;

  // r: { id, pid, name, color, tankKey, x, y }
  function makeEntity(r, withAi) {
    const angle = Math.atan2(H / 2 - r.y, W / 2 - r.x);
    return {
      id: r.id,
      pid: r.pid || null,
      name: r.name,
      color: /^#[0-9a-f]{6}$/i.test(r.color) ? r.color : "#a7b0ba",
      tank: TANKS[r.tankKey] || TANKS.medium,
      x: r.x, y: r.y,
      px: r.x, py: r.y,
      vx: 0, vy: 0,
      angle,
      hullAngle: angle,
      tread: 0,
      shotSide: 1,
      alive: true,
      cooldown: 0,
      muzzle: 0,
      ai: withAi ? {
        waypoint: randomOpenPoint(),
        targetId: null,
        reaction: 0,
        strafeDir: Math.random() < 0.5 ? 1 : -1,
        strafeTimer: rand(0.6, 1.4),
        stuckTimer: 0,
        stuckFrom: { x: r.x, y: r.y },
        accuracy: rand(0.05, 0.12), // max aim error in radians
        fireRate: rand(0.55, 0.85),
      } : null,
    };
  }

  // Host and solo: build a fresh round and tell everyone about it.
  function startRound() {
    const humans = session.role === "solo"
      ? [{ pid: session.myPid, name: myName() }]
      : session.players.slice(0, MAX_PLAYERS);
    const spawns = shuffle(SPAWNS.slice());
    let bot = 0;
    const roster = SLOTS.map((slot, i) => {
      const h = humans[i];
      return {
        id: i,
        pid: h ? h.pid : null,
        name: h ? h.name : "Bot " + BOT_NAMES[bot++],
        color: slot.color,
        tankKey: slot.tank,
        x: spawns[i].x,
        y: spawns[i].y,
      };
    });
    state.round++;
    beginRound(roster, true);
    if (session.role === "host") {
      session.inputs.clear();
      session.lastStart = { t: "start", round: state.round, map: currentMap.id, roster };
      session.net.broadcast(session.lastStart);
    }
  }

  function beginRound(roster, withAi) {
    state.entities = roster.map((r) => makeEntity(r, withAi && !r.pid));
    state.bullets = [];
    state.particles = [];
    state.wrecks = [];
    state.countdown = COUNTDOWN;
    state.over = false;
    state.endTimer = 0;
    state.winnerId = -1;
    state.myKills = 0;
    state.running = true;
    session.sendTimer = 0;
    feedEl.innerHTML = "";
    bannerEl.innerHTML = mine() ? "" : `Match in progress<small>You'll join at the start of the next round</small>`;
    showPanel(null);
    updateHud();
  }

  // ---------- Combat (host and solo decide hits; clients only show the effects) ----------
  function shoot(e, spread) {
    const a = e.angle + rand(-spread, spread);
    const t = e.tank;
    // Twin-barrel tanks alternate between left and right barrels
    const side = t.twin ? (e.shotSide *= -1) * 3.5 : 0;
    state.bullets.push({
      x: e.x + Math.cos(e.angle) * (t.bl + 2) - Math.sin(e.angle) * side,
      y: e.y + Math.sin(e.angle) * (t.bl + 2) + Math.cos(e.angle) * side,
      vx: Math.cos(a) * BULLET_SPEED,
      vy: Math.sin(a) * BULLET_SPEED,
      owner: e.id,
      life: BULLET_LIFE,
    });
    e.muzzle = 0.06;
  }

  function kill(victim, killer) {
    victim.alive = false;
    killEffects(victim, killer);
    broadcast({
      t: "ev", k: "kill", v: victim.id, by: killer.id,
      x: victim.x, y: victim.y, a: victim.angle, ha: victim.hullAngle,
    });
    checkEnd();
  }

  // killer is null when the tank's player left the match
  function killEffects(victim, killer) {
    state.wrecks.push({ x: victim.x, y: victim.y, hullAngle: victim.hullAngle, angle: victim.angle, tank: victim.tank });
    for (let i = 0; i < 26; i++) {
      const a = rand(0, Math.PI * 2), s = rand(60, 260);
      state.particles.push({
        x: victim.x, y: victim.y,
        vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: rand(0.4, 0.9), max: 0.9,
        color: victim.color,
      });
    }
    if (killer && isMine(killer)) state.myKills++;
    addFeed(killer ? `${tag(killer)} destroyed ${tag(victim)}` : `${tag(victim)} left the match`);

    if (isMine(victim)) {
      const how = killer ? `Shot by ${esc(killer.name)}` : "";
      const next = session.role === "solo" ? "press R to restart" : "spectating until the round ends";
      bannerEl.innerHTML = `<span style="color:#ff6b6b">DESTROYED</span><small>${how ? how + " · " : ""}${next}</small>`;
    }
    updateHud();
  }

  function checkEnd() {
    const left = alive();
    if (left.length > 1 || state.over) return;
    state.over = true;
    state.endTimer = 1.2;
    state.winnerId = left[0] ? left[0].id : -1;
    broadcast({ t: "end", w: state.winnerId });
  }

  function showEnd() {
    const winner = state.entities[state.winnerId];
    const me = mine();
    const title = $("end-title");
    if (winner && isMine(winner)) {
      title.textContent = "Victory!";
      title.style.color = "#7fb83e";
    } else if (me) {
      title.textContent = "Defeat";
      title.style.color = "#ff6b6b";
    } else {
      title.textContent = "Round over";
      title.style.color = "";
    }
    let text = winner ? (isMine(winner) ? "You were the last one standing." : `${tag(winner)} won the round.`) : "Nobody survived.";
    if (me) text += ` You destroyed <b>${plural(state.myKills, "tank")}</b>.`;
    $("end-text").innerHTML = text;

    const isClient = session.role === "client";
    $("again").hidden = isClient;
    $("end-wait").hidden = !isClient;
    $("end-map").hidden = isClient;
    $("end-leave").textContent = session.role === "solo" ? "Main menu" : "Leave match";
    bannerEl.innerHTML = "";
    showPanel("end");
  }

  function addFeed(html) {
    const div = document.createElement("div");
    div.innerHTML = html;
    feedEl.prepend(div);
    while (feedEl.children.length > 6) feedEl.lastChild.remove();
    setTimeout(() => { div.style.opacity = "0"; }, 4000);
    setTimeout(() => div.remove(), 4600);
  }

  function updateHud() {
    $("hud").hidden = state.entities.length === 0;
    aliveEl.textContent = `Alive: ${alive().length}`;
    killsEl.textContent = `Kills: ${state.myKills}`;
    const online = session.role === "host" || session.role === "client";
    roomChip.hidden = !online;
    roomChip.textContent = online ? `Room ${session.code}` : "";
  }

  // ---------- Simulation (host and solo) ----------
  const NO_INPUT = { u: 0, d: 0, l: 0, r: 0, f: 0, a: null };

  function localInput(e) {
    return {
      u: keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0,
      d: keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0,
      l: keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0,
      r: keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0,
      f: mouse.down ? 1 : 0,
      a: Math.atan2(mouse.y - e.y, mouse.x - e.x),
    };
  }

  // Never trust what arrives over the network
  function cleanInput(m) {
    const b = (v) => (v ? 1 : 0);
    const a = Number(m.a);
    return { u: b(m.u), d: b(m.d), l: b(m.l), r: b(m.r), f: b(m.f), a: Number.isFinite(a) ? a : null };
  }

  function inputFor(e) {
    return e.pid === session.myPid ? localInput(e) : session.inputs.get(e.pid) || NO_INPUT;
  }

  function applyInput(e, input, dt, canFire) {
    const mx = input.r - input.l, my = input.d - input.u;
    const len = Math.hypot(mx, my) || 1;
    e.x += (mx / len) * PLAYER_SPEED * dt;
    e.y += (my / len) * PLAYER_SPEED * dt;
    if (input.a !== null) e.angle = input.a;
    if (canFire && input.f && e.cooldown <= 0) {
      shoot(e, 0.02);
      e.cooldown = PLAYER_COOLDOWN;
    }
  }

  function findTarget(bot) {
    let best = null, bestD = BOT_VIEW_RANGE;
    for (const e of state.entities) {
      if (!e.alive || e === bot) continue;
      const d = dist(bot, e);
      if (d < bestD && hasLineOfSight(bot, e)) { best = e; bestD = d; }
    }
    return best;
  }

  function moveToward(bot, tx, ty, speed, dt) {
    const dx = tx - bot.x, dy = ty - bot.y;
    const d = Math.hypot(dx, dy);
    if (d < 1) return;
    bot.x += (dx / d) * speed * dt;
    bot.y += (dy / d) * speed * dt;
  }

  function updateBot(bot, dt, canFire) {
    const ai = bot.ai;
    const target = findTarget(bot);

    if (target) {
      if (ai.targetId !== target.id) {
        ai.targetId = target.id;
        ai.reaction = rand(0.25, 0.55); // time to "notice" a new target
      }
      const d = dist(bot, target);

      // Aim with partial lead
      const t = d / BULLET_SPEED;
      const aimX = target.x + target.vx * t * 0.6;
      const aimY = target.y + target.vy * t * 0.6;
      const desired = Math.atan2(aimY - bot.y, aimX - bot.x);
      const diff = angleDiff(bot.angle, desired);
      const turn = 7 * dt;
      bot.angle += clamp(diff, -turn, turn);

      ai.reaction -= dt;
      if (canFire && ai.reaction <= 0 && Math.abs(diff) < 0.15 && bot.cooldown <= 0) {
        shoot(bot, ai.accuracy);
        bot.cooldown = ai.fireRate + rand(0, 0.25);
      }

      // Strafe around the target, keeping a fighting distance
      ai.strafeTimer -= dt;
      if (ai.strafeTimer <= 0) {
        ai.strafeDir *= -1;
        ai.strafeTimer = rand(0.5, 1.4);
      }
      const toX = (target.x - bot.x) / d, toY = (target.y - bot.y) / d;
      let mx = -toY * ai.strafeDir, my = toX * ai.strafeDir;
      if (d > 330) { mx += toX; my += toY; }
      else if (d < 180) { mx -= toX; my -= toY; }
      const len = Math.hypot(mx, my) || 1;
      bot.x += (mx / len) * BOT_SPEED * dt;
      bot.y += (my / len) * BOT_SPEED * dt;
      ai.waypoint = { x: target.x, y: target.y }; // chase last known position if lost
    } else {
      ai.targetId = null;
      if (dist(bot, ai.waypoint) < 25) newWaypoint(bot);
      moveToward(bot, ai.waypoint.x, ai.waypoint.y, BOT_SPEED * 0.85, dt);
      const desired = Math.atan2(ai.waypoint.y - bot.y, ai.waypoint.x - bot.x);
      const turn = 5 * dt;
      bot.angle += clamp(angleDiff(bot.angle, desired), -turn, turn);
    }

    // Stuck detection: if barely moved in a second, pick a new waypoint
    ai.stuckTimer += dt;
    if (ai.stuckTimer > 1) {
      if (dist(bot, ai.stuckFrom) < 20) {
        newWaypoint(bot);
        ai.strafeDir *= -1;
      }
      ai.stuckTimer = 0;
      ai.stuckFrom = { x: bot.x, y: bot.y };
    }
  }

  function newWaypoint(bot) {
    const others = state.entities.filter((e) => e.alive && e !== bot);
    if (others.length && Math.random() < 0.5) {
      // Hunt: head roughly toward someone
      const o = others[Math.floor(Math.random() * others.length)];
      bot.ai.waypoint = {
        x: clamp(o.x + rand(-150, 150), 40, W - 40),
        y: clamp(o.y + rand(-150, 150), 40, H - 40),
      };
    } else {
      bot.ai.waypoint = randomOpenPoint();
    }
  }

  // Turn the hull toward the direction of travel and roll the tracks.
  // Tanks can drive in reverse, so the hull aligns with whichever end is closer.
  function turnHull(e, dt) {
    const speed = Math.hypot(e.vx, e.vy);
    if (speed < 5) return;
    const move = Math.atan2(e.vy, e.vx);
    let diff = angleDiff(e.hullAngle, move);
    let dir = 1;
    if (Math.abs(diff) > Math.PI / 2) {
      diff = angleDiff(e.hullAngle, move + Math.PI);
      dir = -1;
    }
    const turn = 8 * dt;
    e.hullAngle += clamp(diff, -turn, turn);
    e.tread += speed * dt * dir;
  }

  function updateBullets(dt) {
    for (const b of state.bullets) {
      // Once the round is decided, remaining bullets can't kill the winner
      if (state.over) { b.life = 0; continue; }
      const x1 = b.x, y1 = b.y;
      const x2 = x1 + b.vx * dt, y2 = y1 + b.vy * dt;
      b.life -= dt;

      // Find the nearest thing this segment hits (wall or entity)
      let hitT = Infinity, hitEntity = null;
      for (const w of WALLS) {
        const t = segHitsRect(x1, y1, x2, y2, w);
        if (t >= 0) hitT = Math.min(hitT, t);
      }
      const outside = x2 < 0 || x2 > W || y2 < 0 || y2 > H;

      for (const e of state.entities) {
        if (!e.alive || e.id === b.owner) continue;
        if (segPointDist(x1, y1, x2, y2, e.x, e.y) <= RADIUS + 2) {
          // Parameter of closest approach, used to see whether a wall comes first
          const dx = x2 - x1, dy = y2 - y1;
          const t = clamp(((e.x - x1) * dx + (e.y - y1) * dy) / (dx * dx + dy * dy), 0, 1);
          if (t < hitT && t < (hitEntity ? hitEntity.t : Infinity)) hitEntity = { e, t };
        }
      }

      if (hitEntity) {
        b.life = 0;
        kill(hitEntity.e, state.entities[b.owner]);
        spark(x1 + (x2 - x1) * hitEntity.t, y1 + (y2 - y1) * hitEntity.t, "#ffffff");
      } else if (hitT !== Infinity) {
        b.life = 0;
        spark(x1 + (x2 - x1) * hitT, y1 + (y2 - y1) * hitT, "#ffe08a");
      } else if (outside) {
        b.life = 0;
      } else {
        b.x = x2; b.y = y2;
      }
    }
    state.bullets = state.bullets.filter((b) => b.life > 0);
  }

  function spark(x, y, color) {
    sparkEffect(x, y, color);
    broadcast({ t: "ev", k: "spark", x: Math.round(x), y: Math.round(y), c: color });
  }

  function sparkEffect(x, y, color) {
    for (let i = 0; i < 6; i++) {
      const a = rand(0, Math.PI * 2), s = rand(40, 160);
      state.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.25, max: 0.25, color });
    }
  }

  function simulate(dt) {
    if (state.countdown > 0) state.countdown -= dt;
    const canFire = state.countdown <= 0 && !state.over;

    const living = alive();
    for (const e of living) {
      e.px = e.x; e.py = e.y;
      e.cooldown -= dt;
      e.muzzle -= dt;
      if (e.pid) {
        const input = inputFor(e);
        // During the countdown players can aim but not move
        if (state.countdown > 0) { if (input.a !== null) e.angle = input.a; }
        else applyInput(e, input, dt, canFire);
      } else if (state.countdown <= 0) {
        updateBot(e, dt, canFire);
      }
    }

    resolveEntityOverlap(living);
    for (const e of living) {
      resolveWalls(e);
      e.vx = dt > 0 ? (e.x - e.px) / dt : 0;
      e.vy = dt > 0 ? (e.y - e.py) / dt : 0;
      turnHull(e, dt);
    }

    updateBullets(dt);

    if (session.role === "host") {
      session.sendTimer += dt;
      if (session.sendTimer >= SNAPSHOT_INTERVAL) {
        session.sendTimer = 0;
        session.net.broadcast(snapshot());
      }
    }
  }

  // ---------- Networking: host side ----------
  function broadcast(msg) {
    if (session.role === "host") session.net.broadcast(msg);
  }

  function snapshot() {
    const r1 = (v) => Math.round(v * 10) / 10;
    const r3 = (v) => Math.round(v * 1000) / 1000;
    return {
      t: "s",
      r: state.round,
      cd: r3(Math.max(0, state.countdown)),
      e: state.entities.map((e) => [
        e.id, r1(e.x), r1(e.y), r3(e.angle), r3(e.hullAngle), r1(e.tread), e.alive ? 1 : 0, e.muzzle > 0 ? 1 : 0,
      ]),
      b: state.bullets.map((b) => [r1(b.x), r1(b.y), Math.round(b.vx), Math.round(b.vy)]),
    };
  }

  function lobbyMessage() {
    return { t: "lobby", map: currentMap.id, players: session.players.map(({ pid, name }) => ({ pid, name })) };
  }

  function broadcastLobby() {
    session.net.broadcast(lobbyMessage());
    renderLobby();
  }

  function onClientMessage(pid, msg) {
    if (!msg || typeof msg !== "object") return;
    const player = session.players.find((p) => p.pid === pid);
    if (player) player.lastSeen = performance.now();

    switch (msg.t) {
      case "hello": {
        if (player) return;
        if (session.players.length >= MAX_PLAYERS) {
          session.net.send(pid, { t: "reject", reason: `This match is full (${MAX_PLAYERS} players).` });
          session.net.kick(pid);
          return;
        }
        session.players.push({ pid, name: cleanName(msg.name), lastSeen: performance.now() });
        session.net.send(pid, { t: "welcome" });
        broadcastLobby();
        // Joining mid-round: watch until the next round starts
        if (state.running && !state.over && session.lastStart) session.net.send(pid, session.lastStart);
        break;
      }
      case "in":
        if (player) session.inputs.set(pid, cleanInput(msg));
        break;
      case "bye":
        session.net.kick(pid);
        onClientLeave(pid);
        break;
    }
  }

  function onClientLeave(pid) {
    const i = session.players.findIndex((p) => p.pid === pid);
    if (i < 0) return;
    session.players.splice(i, 1);
    session.inputs.delete(pid);
    const e = state.entities.find((x) => x.pid === pid && x.alive);
    if (e && state.running && !state.over) {
      e.alive = false;
      killEffects(e, null);
      broadcast({ t: "ev", k: "left", v: e.id, x: e.x, y: e.y, a: e.angle, ha: e.hullAngle });
      checkEnd();
    }
    broadcastLobby();
  }

  // ---------- Networking: client side ----------
  function onHostMessage(msg) {
    if (!msg || typeof msg !== "object") return;
    session.lastHostMsg = performance.now();

    switch (msg.t) {
      case "welcome":
        setMenuStatus("");
        enterLobby();
        break;
      case "reject":
        leaveMatch(String(msg.reason || "The host couldn't let you in."));
        break;
      case "lobby":
        session.players = Array.isArray(msg.players) ? msg.players : [];
        if (!state.running) setMap(msg.map);
        renderLobby();
        break;
      case "start":
        state.round = msg.round;
        setMap(msg.map);
        beginRound(msg.roster, false);
        break;
      case "s":
        applySnapshot(msg);
        break;
      case "ev": {
        const v = state.entities[msg.v];
        if (msg.k === "spark") sparkEffect(msg.x, msg.y, msg.c);
        else if (v && v.alive) {
          Object.assign(v, { x: msg.x, y: msg.y, angle: msg.a, hullAngle: msg.ha, alive: false });
          killEffects(v, msg.k === "kill" ? state.entities[msg.by] : null);
        }
        break;
      }
      case "end":
        state.over = true;
        state.endTimer = 1.2;
        state.winnerId = msg.w;
        break;
    }
  }

  function applySnapshot(m) {
    if (m.r !== state.round || !state.running) return;
    state.countdown = m.cd;
    for (const [id, x, y, a, ha, tread, isAlive, muzzle] of m.e) {
      const e = state.entities[id];
      if (!e) continue;
      if (e.tx === undefined) { e.x = x; e.y = y; e.hullAngle = ha; }
      e.tx = x; e.ty = y; e.ta = a; e.tha = ha;
      e.tread = tread;
      if (!isAlive) e.alive = false;
      if (muzzle) e.muzzle = 0.06;
    }
    state.bullets = m.b.map(([x, y, vx, vy]) => ({ x, y, vx, vy, life: 1 }));
  }

  // Smoothly move everything toward the latest snapshot, and keep bullets flying between snapshots
  function clientUpdate(dt) {
    if (state.countdown > 0) state.countdown -= dt;
    const k = Math.min(1, dt * 18);
    for (const e of state.entities) {
      e.muzzle -= dt;
      if (e.tx === undefined) continue;
      e.x += (e.tx - e.x) * k;
      e.y += (e.ty - e.y) * k;
      e.hullAngle += angleDiff(e.hullAngle, e.tha) * k;
      // Your own turret follows your mouse straight away
      if (isMine(e) && e.alive) e.angle = Math.atan2(mouse.y - e.y, mouse.x - e.x);
      else e.angle += angleDiff(e.angle, e.ta) * k;
    }

    for (const b of state.bullets) {
      const x2 = b.x + b.vx * dt, y2 = b.y + b.vy * dt;
      if (WALLS.some((w) => segHitsRect(b.x, b.y, x2, y2, w) >= 0) || x2 < 0 || x2 > W || y2 < 0 || y2 > H) b.life = 0;
      b.x = x2; b.y = y2;
    }
    state.bullets = state.bullets.filter((b) => b.life > 0);

    const me = mine();
    session.sendTimer += dt;
    if (me && me.alive && session.sendTimer >= INPUT_INTERVAL) {
      session.sendTimer = 0;
      session.net.send({ t: "in", ...localInput(me) });
    }
  }

  // ---------- Heartbeat: notice players or hosts that vanished without saying goodbye ----------
  setInterval(() => {
    const now = performance.now();
    if (session.role === "host") {
      if (!state.running) session.net.broadcast({ t: "ping" });
      for (const p of session.players.slice()) {
        if (p.pid !== session.myPid && now - p.lastSeen > TIMEOUT_MS) {
          session.net.kick(p.pid);
          onClientLeave(p.pid);
        }
      }
    } else if (session.role === "client") {
      const me = mine();
      if (!(state.running && me && me.alive)) session.net.send({ t: "ping" });
      if (now - session.lastHostMsg > TIMEOUT_MS) leaveMatch("Lost the connection to the host.");
    }
  }, HEARTBEAT_MS);

  window.addEventListener("beforeunload", () => {
    if (session.role === "client") session.net.send({ t: "bye" });
    if (session.net) session.net.close();
  });

  // ---------- Menu and lobby ----------
  const NAME_KEY = "last-one-standing-name";
  const MAP_KEY = "last-one-standing-map";

  // Switch the map being played or previewed, and keep every map selector in sync
  function setMap(id) {
    currentMap = MAPS.find((m) => m.id === id) || MAPS[0];
    WALLS = currentMap.walls;
    for (const sel of mapSelects) sel.value = currentMap.id;
  }

  function savedMap() {
    try { return localStorage.getItem(MAP_KEY); } catch { return null; }
  }

  for (const sel of mapSelects) {
    sel.innerHTML = MAPS.map((m) => `<option value="${m.id}">${m.name}</option>`).join("");
    sel.addEventListener("change", () => {
      if (session.role === "client" || state.running) return;
      setMap(sel.value);
      try { localStorage.setItem(MAP_KEY, currentMap.id); } catch {}
      if (session.role === "host") broadcastLobby();
    });
  }

  function myName() {
    return cleanName(nameInput.value);
  }

  function saveName() {
    try { localStorage.setItem(NAME_KEY, myName()); } catch {}
  }

  function setBusy(busy) {
    for (const b of menuButtons) b.disabled = busy;
  }

  function inviteLink() {
    return `${location.href.split(/[?#]/)[0]}?room=${session.code}`;
  }

  function enterLobby() {
    $("room-code").textContent = session.code;
    $("invite-link").value = inviteLink();
    $("copy-link").textContent = "Copy invite link";
    renderLobby();
    updateHud();
    showPanel("lobby");
  }

  function renderLobby() {
    const list = $("player-list");
    list.innerHTML = "";
    SLOTS.forEach((slot, i) => {
      const p = session.players[i];
      const li = document.createElement("li");
      if (!p) li.className = "bot";
      const tags = [];
      if (p && i === 0) tags.push("Host");
      if (p && p.pid === session.myPid) tags.push("You");
      li.innerHTML =
        `<span class="swatch" style="background:${slot.color}"></span>` +
        `<span class="pname">${p ? esc(p.name) : "Bot"}</span>` +
        `<span class="tag">${tags.join(" · ")}</span>`;
      list.appendChild(li);
    });
    const isHost = session.role === "host";
    $("start").hidden = !isHost;
    $("map-lobby").disabled = !isHost;
    $("lobby-hint").textContent = isHost
      ? "Send your friends the room code or invite link. Bots fill any empty slots."
      : "Waiting for the host to start the match…";
  }

  function leaveMatch(message = "") {
    if (session.role === "client") session.net.send({ t: "bye" });
    if (session.net) session.net.close();
    Object.assign(session, {
      role: null, net: null, code: "", myPid: "host",
      players: [], lastStart: null, lastHostMsg: 0, sendTimer: 0,
    });
    session.inputs.clear();
    Object.assign(state, { running: false, entities: [], bullets: [], particles: [], wrecks: [], over: false, countdown: 0 });
    setMap(savedMap());
    feedEl.innerHTML = "";
    bannerEl.innerHTML = "";
    updateHud();
    setBusy(false);
    setMenuStatus(message, !!message);
    showPanel("menu");
  }

  $("create").addEventListener("click", async () => {
    if (!window.Net || !Net.available()) {
      setMenuStatus("Online play couldn't load. Check your internet connection and reload the page.", true);
      return;
    }
    saveName();
    setBusy(true);
    setMenuStatus("Creating match…");
    try {
      const net = await Net.host({ onMessage: onClientMessage, onLeave: onClientLeave });
      Object.assign(session, { role: "host", net, code: net.code, myPid: "host" });
      session.players = [{ pid: "host", name: myName(), lastSeen: Infinity }];
      setMenuStatus("");
      enterLobby();
    } catch (err) {
      setMenuStatus(err.message, true);
    } finally {
      setBusy(false);
    }
  });

  async function joinMatch() {
    if (!window.Net || !Net.available()) {
      setMenuStatus("Online play couldn't load. Check your internet connection and reload the page.", true);
      return;
    }
    const code = Net.normalizeCode(codeInput.value);
    if (code.length !== Net.CODE_LENGTH) {
      setMenuStatus(`Enter the ${Net.CODE_LENGTH}-character room code from the host.`, true);
      return;
    }
    saveName();
    setBusy(true);
    setMenuStatus("Connecting…");
    try {
      const net = await Net.join(code, {
        onMessage: onHostMessage,
        onClose: () => { if (session.role === "client") leaveMatch("The host closed the match."); },
      });
      Object.assign(session, { role: "client", net, code, myPid: net.pid, lastHostMsg: performance.now() });
      net.send({ t: "hello", name: myName() });
      setMenuStatus("Joining…");
    } catch (err) {
      setMenuStatus(err.message, true);
      setBusy(false);
    }
  }

  $("join").addEventListener("click", joinMatch);
  codeInput.addEventListener("keydown", (e) => { if (e.key === "Enter") joinMatch(); });

  $("solo").addEventListener("click", () => {
    saveName();
    session.role = "solo";
    session.myPid = "host";
    startRound();
  });

  $("start").addEventListener("click", startRound);
  $("again").addEventListener("click", startRound);
  $("leave").addEventListener("click", () => leaveMatch());
  $("end-leave").addEventListener("click", () => leaveMatch());

  $("copy-link").addEventListener("click", async () => {
    const field = $("invite-link");
    try {
      await navigator.clipboard.writeText(field.value);
      $("copy-link").textContent = "Copied!";
    } catch {
      field.select();
      $("copy-link").textContent = "Press Ctrl+C to copy";
    }
  });

  // Restore the saved name, and pre-fill the room code from an invite link
  try { nameInput.value = localStorage.getItem(NAME_KEY) || ""; } catch {}
  setMap(savedMap());
  const invitedTo = window.Net && Net.normalizeCode(new URLSearchParams(location.search).get("room"));
  if (invitedTo) {
    codeInput.value = invitedTo;
    setMenuStatus(`You've been invited to room ${invitedTo}. Enter your name and press Join.`);
  }
  showPanel("menu");
  updateHud();

  // ---------- Render ----------
  function drawFloor() {
    ctx.fillStyle = "#1a1f2a";
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "rgba(255,255,255,0.04)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= W; x += 40) { ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, H); }
    for (let y = 0; y <= H; y += 40) { ctx.moveTo(0, y + 0.5); ctx.lineTo(W, y + 0.5); }
    ctx.stroke();
  }

  function drawWalls() {
    // All shadows first, so a shadow never darkens a neighbouring wall
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    for (const r of WALLS) ctx.fillRect(r.x + 5, r.y + 6, r.w, r.h);
    for (const r of WALLS) {
      ctx.fillStyle = "#4a5468";
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = "#6b7790";
      ctx.lineWidth = 2;
      ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
    }
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawTracks(t, tread, trackColor, treadColor) {
    const { L, Wd, tw } = t;
    for (const y of [-Wd / 2, Wd / 2 - tw]) {
      ctx.fillStyle = trackColor;
      roundRect(-L / 2, y, L, tw, 2);
      ctx.fill();
      // Tread plates scroll with distance travelled
      ctx.strokeStyle = treadColor;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      const off = ((tread % 4) + 4) % 4;
      for (let x = -L / 2 + off; x < L / 2; x += 4) {
        ctx.moveTo(x, y + 1);
        ctx.lineTo(x, y + tw - 1);
      }
      ctx.stroke();
    }
  }

  function drawHull(t, body, edge) {
    const { L, Wd, tw } = t;
    const hw = Wd / 2 - tw + 2;
    ctx.fillStyle = body;
    ctx.strokeStyle = edge;
    ctx.lineWidth = 1.5;
    roundRect(-L / 2 + 2, -hw, L - 4, hw * 2, 3);
    ctx.fill();
    ctx.stroke();
    // Sloped front plate and rear engine grille
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    ctx.fillRect(L / 2 - 8, -hw + 1, 5, hw * 2 - 2);
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = -hw + 3; i < hw - 2; i += 3) {
      ctx.moveTo(-L / 2 + 4, i);
      ctx.lineTo(-L / 2 + 9, i);
    }
    ctx.stroke();
  }

  function drawBarrels(t, color, edge) {
    ctx.fillStyle = color;
    ctx.strokeStyle = edge;
    ctx.lineWidth = 1;
    for (const oy of t.twin ? [-3.5, 3.5] : [0]) {
      ctx.fillRect(2, oy - t.bw / 2, t.bl, t.bw);
      ctx.strokeRect(2, oy - t.bw / 2, t.bl, t.bw);
      if (t.brake) {
        ctx.fillRect(t.bl - 2, oy - t.bw / 2 - 1.5, 5, t.bw + 3);
        ctx.strokeRect(t.bl - 2, oy - t.bw / 2 - 1.5, 5, t.bw + 3);
      }
    }
  }

  function drawTurret(t, body, edge) {
    const s = t.ts;
    ctx.fillStyle = body;
    ctx.strokeStyle = edge;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    if (t.turret === "round") {
      ctx.arc(0, 0, s, 0, Math.PI * 2);
    } else if (t.turret === "box") {
      roundRect(-s, -s * 0.9, s * 2, s * 1.8, 3);
    } else if (t.turret === "hex") {
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        ctx[i ? "lineTo" : "moveTo"](Math.cos(a) * s, Math.sin(a) * s);
      }
      ctx.closePath();
    } else {
      // Casemate: low, wedge-shaped superstructure
      ctx.moveTo(-s, -s);
      ctx.lineTo(s * 0.6, -s * 0.7);
      ctx.lineTo(s, 0);
      ctx.lineTo(s * 0.6, s * 0.7);
      ctx.lineTo(-s, s);
      ctx.closePath();
    }
    ctx.fill();
    ctx.stroke();
    // Commander's hatch
    ctx.fillStyle = edge;
    ctx.beginPath();
    ctx.arc(-s * 0.35, -s * 0.3, s * 0.3, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawTank(e) {
    const t = e.tank;
    const me = isMine(e);
    ctx.save();
    ctx.translate(e.x, e.y);

    // Hull, tracks and shadow follow the direction of travel
    ctx.save();
    ctx.rotate(e.hullAngle);
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    roundRect(-t.L / 2 + 3, -t.Wd / 2 + 4, t.L, t.Wd, 4);
    ctx.fill();
    drawTracks(t, e.tread, "#2b2e33", "#15171b");
    drawHull(t, e.color, shade(e.color, -0.45));
    if (me) {
      // White star on the rear deck marks your own tank
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const r = i % 2 ? 2 : 5;
        const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
        ctx[i ? "lineTo" : "moveTo"](-t.L / 2 + 13 + Math.cos(a) * r, Math.sin(a) * r);
      }
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    // Turret and barrel follow the aim
    ctx.rotate(e.angle);
    drawBarrels(t, shade(e.color, -0.25), shade(e.color, -0.6));
    if (e.muzzle > 0) {
      ctx.fillStyle = "#ffe08a";
      for (const oy of t.twin ? [-3.5, 3.5] : [0]) {
        ctx.beginPath();
        ctx.arc(t.bl + 5, oy, 6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    drawTurret(t, shade(e.color, 0.12), shade(e.color, -0.55));
    ctx.restore();

    // name tag
    const tagY = e.y - t.Wd / 2 - 10;
    const label = me ? "YOU" : e.name;
    ctx.font = "bold 12px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillText(label, e.x + 1, tagY + 1);
    ctx.fillStyle = me ? "#fff" : e.color;
    ctx.fillText(label, e.x, tagY);
  }

  // Burnt-out hull left where a tank was destroyed
  function drawWreck(w) {
    const t = w.tank;
    ctx.save();
    ctx.translate(w.x, w.y);
    const g = ctx.createRadialGradient(0, 0, 4, 0, 0, t.L * 0.8);
    g.addColorStop(0, "rgba(0,0,0,0.5)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, t.L * 0.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.rotate(w.hullAngle);
    drawTracks(t, 0, "#202226", "#121316");
    drawHull(t, "#34363b", "#1c1d20");
    ctx.rotate(w.angle - w.hullAngle);
    drawBarrels(t, "#2c2e32", "#18191c");
    drawTurret(t, "#3a3c41", "#1c1d20");
    ctx.restore();
  }

  function drawBullets() {
    ctx.lineCap = "round";
    for (const b of state.bullets) {
      const tx = b.x - b.vx * 0.025, ty = b.y - b.vy * 0.025;
      const g = ctx.createLinearGradient(tx, ty, b.x, b.y);
      g.addColorStop(0, "rgba(255,230,140,0)");
      g.addColorStop(1, "#fff6c8");
      ctx.strokeStyle = g;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  }

  function drawParticles() {
    for (const p of state.particles) {
      ctx.globalAlpha = clamp(p.life / p.max, 0, 1);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
    }
    ctx.globalAlpha = 1;
  }

  function drawCountdown() {
    if (!state.running || state.countdown <= 0) return;
    const n = Math.ceil(state.countdown);
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.fillRect(0, 0, W, H);
    ctx.font = "bold 120px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#fff";
    ctx.fillText(String(n), W / 2, H / 2);
    ctx.textBaseline = "alphabetic";
  }

  function render() {
    drawFloor();
    for (const w of state.wrecks) drawWreck(w);
    drawWalls();
    drawParticles();
    for (const e of state.entities) if (e.alive) drawTank(e);
    drawBullets();
    drawCountdown();
  }

  // ---------- Loop ----------
  function update(dt) {
    if (!state.running) return;
    if (session.role === "client") clientUpdate(dt);
    else simulate(dt);

    for (const p of state.particles) {
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= 0.92; p.vy *= 0.92;
      p.life -= dt;
    }
    state.particles = state.particles.filter((p) => p.life > 0);

    if (state.over) {
      state.endTimer -= dt;
      if (state.endTimer <= 0) {
        state.running = false;
        showEnd();
      }
    }
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    update(dt);
    render();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
