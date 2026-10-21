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
  const AUTO_AIM_RANGE = 750;

  // Mines (tank 6)
  const MINE_ARM_TIME = 1.0; // seconds before a new mine can go off
  const MINE_RADIUS = 24; // an enemy this close to a mine sets it off
  const MINE_COOLDOWN = 2.0;
  const MINE_MAX = 4; // mines one tank can have on the field; placing more removes the oldest
  const MINE_DAMAGE = 100;

  // Jumping (tank 7): a short leap over walls
  const JUMP_TIME = 0.5; // seconds in the air
  const JUMP_SPEED = 420; // pixels per second, so a jump covers about 210 pixels
  const JUMP_COOLDOWN = 3.0;

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

  // A map's spawn points: each base point mirrored into all four corners of the arena, plus
  // the two points in the middle of the top and bottom edges. That gives 4 x bases + 2 points,
  // numbered from the top left, row by row. Every point is clear of walls and every point can
  // reach every other one.
  function spawnPoints(...bases) {
    const out = [];
    const seen = new Set();
    for (const [x, y] of [...bases, [W / 2, 45]]) {
      for (const [px, py] of [[x, y], [W - x, y], [x, H - y], [W - x, H - y]]) {
        const key = `${px},${py}`;
        if (!seen.has(key)) {
          seen.add(key);
          out.push({ x: px, y: py });
        }
      }
    }
    return out.sort((a, b) => a.y - b.y || a.x - b.x);
  }

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
      spawns: spawnPoints([70, 70], [320, 60], [60, 240], [470, 230]),
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
      spawns: spawnPoints([70, 70], [320, 60], [60, 240], [150, 300]),
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
      spawns: spawnPoints([70, 70], [320, 60], [60, 240], [400, 300]),
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
      spawns: spawnPoints([70, 70], [320, 60], [60, 240], [330, 315]),
    },
  ];

  // The map being played or previewed. Collisions, bots and drawing all read WALLS.
  let currentMap = MAPS[0];
  const DEFAULT_BOTS = 5;
  let botCount = DEFAULT_BOTS; // bots to add to a match
  let mySpawn = -1; // the spawn point you chose on this map, or -1 for a random one
  let WALLS = currentMap.walls;

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
    hopper:    { L: 34, Wd: 28, tw: 6, turret: "tri",      ts: 10, bl: 24, bw: 4.5, twin: false, brake: false, legs: true },
  };

  // The 6 tank types. Anyone can pick any of them, including the same one as another player.
  //   hp: hit points. A normal shot does 100, so 100 hp dies in one hit.
  //   speed: movement speed, as a multiple of normal
  //   dmg: damage per shot
  //   cooldown: time between shots, as a multiple of normal (2 = half the fire rate)
  //   bulletSpeed: bullet speed, as a multiple of normal
  //   pierce: bullets pass through walls    autoAim: aims at the nearest visible enemy
  //   mines: can lay mines                   range: bullets vanish after this many pixels (0 = no limit)
  //   jump: can leap over walls with Space (but cannot shoot while in the air)
  const TANK_TYPES = [
    { id: 1, name: "Bulwark", color: "#d0644a", design: "heavy", hp: 200, speed: 0.7, dmg: 100, cooldown: 1, bulletSpeed: 1, pierce: false, autoAim: false, mines: false, range: 0,
      desc: "Takes twice as many hits, but moves at 70% speed." },
    { id: 2, name: "Dart", color: "#d9a441", design: "light", hp: 100, speed: 1.5, dmg: 50, cooldown: 1, bulletSpeed: 1, pierce: false, autoAim: false, mines: false, range: 0,
      desc: "Moves at 150% speed, but needs 2 shots to destroy an opponent." },
    { id: 3, name: "Twin Gun", color: "#9b7cc4", design: "twin", hp: 100, speed: 1, dmg: 50, cooldown: 0.5, bulletSpeed: 1, pierce: false, autoAim: false, mines: false, range: 0,
      desc: "Shoots twice as fast, but each shot removes only half of an opponent's health." },
    { id: 4, name: "Phantom", color: "#4f97c9", design: "destroyer", hp: 100, speed: 1, dmg: 100, cooldown: 1, bulletSpeed: 0.7, pierce: true, autoAim: false, mines: false, range: 0,
      desc: "Shoots through walls, but its bullets travel at 70% speed." },
    { id: 5, name: "Hunter", color: "#4fc3b0", design: "sniper", hp: 100, speed: 1, dmg: 100, cooldown: 2, bulletSpeed: 1, pierce: false, autoAim: true, mines: false, range: 0,
      desc: "Aims automatically at the nearest enemy it can see, but fires at half the normal rate." },
    { id: 6, name: "Sapper", color: "#7fb83e", design: "medium", hp: 100, speed: 1, dmg: 100, cooldown: 1, bulletSpeed: 1, pierce: false, autoAim: false, mines: true, range: 100,
      desc: "Lays mines (E or right-click), but its bullets only reach 100 pixels." },
    { id: 7, name: "Hopper", color: "#e05fa8", design: "hopper", hp: 100, speed: 1, dmg: 100, cooldown: 1, bulletSpeed: 1, pierce: false, autoAim: false, mines: false, range: 0, jump: true,
      desc: "Jumps over walls with Space, but can't shoot in the air and needs 3 seconds to recharge." },
  ];

  function cleanTank(v) {
    const n = Math.round(Number(v));
    return n >= 1 && n <= TANK_TYPES.length ? n : 1;
  }
  const typeOf = (id) => TANK_TYPES[cleanTank(id) - 1];

  // The tank types bots may use, as a sorted list of tank numbers. Never empty.
  function cleanBotTanks(v) {
    const ids = Array.isArray(v) ? v : String(v || "").split(",");
    const set = new Set(ids.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= TANK_TYPES.length));
    return set.size ? [...set].sort((a, b) => a - b) : TANK_TYPES.map((t) => t.id);
  }
  let botTanks = cleanBotTanks(null);

  const BOT_NAMES = [
    "Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf", "Hotel", "India",
    "Juliet", "Kilo", "Lima", "Mike", "November", "Oscar", "Papa", "Quebec",
  ];

  // Hands out the messages of a list one by one in random order, like dealing a shuffled deck.
  // A message is not repeated until every message in the list has been used; then the deck is
  // shuffled again and the cycle starts over. The deck is saved in this browser, so reloading
  // the page doesn't restart the cycle.
  function messageDeck(storageKey, list) {
    let deck = []; // indexes of the messages not used yet in this cycle
    let last = -1; // the message dealt most recently
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey));
      const ok = saved && Array.isArray(saved.deck) && new Set(saved.deck).size === saved.deck.length
        && saved.deck.every((i) => Number.isInteger(i) && i >= 0 && i < list.length);
      if (ok) {
        deck = saved.deck;
        last = Number.isInteger(saved.last) ? saved.last : -1;
      }
    } catch {}

    return function next() {
      if (!deck.length) {
        // A new cycle: all messages again, in a new random order. With more than one message,
        // the first of the new cycle is never the one that ended the previous cycle.
        deck = [...list.keys()];
        for (let i = deck.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [deck[i], deck[j]] = [deck[j], deck[i]];
        }
        if (list.length > 1 && deck[deck.length - 1] === last) {
          [deck[0], deck[deck.length - 1]] = [deck[deck.length - 1], deck[0]];
        }
      }
      last = deck.pop();
      try { localStorage.setItem(storageKey, JSON.stringify({ deck, last })); } catch {}
      return list[last];
    };
  }

  // One of these is shown, in capitals, in the banner when your tank is destroyed
  const DESTROYED_MESSAGES = [
    "Sos choto",
    "La tenes adentro",
    "Ah, en esto tambien fracasas",
    "Perdiste pero esta bien para un manco como vos",
    "A COMERLAAA",
    "No te regales bichito de luz",
    "Si te gusta perder vas bien",
    "Tranqui, nadie esperaba nada de vos",
  ];

  const nextDestroyedMessage = messageDeck("last-one-standing-destroyed-deck", DESTROYED_MESSAGES);

  // One of these is shown, in capitals, when you win a round
  const VICTORY_MESSAGES = [
    "Bien, ganaste un jueguito choto",
    "Ganaste un jueguito, desperdiciaste tu vida",
    "GANASTE!! Anda a contarle a alguien que le importe",
    "Felicitaciones pedazo de fracasado, ganaste",
  ];

  const nextVictoryMessage = messageDeck("last-one-standing-victory-deck", VICTORY_MESSAGES);

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const canvas = $("game");
  const ctx0 = canvas.getContext("2d");
  let ctx = ctx0; // the game canvas, or a small preview canvas while a menu card is drawn
  const aliveEl = $("alive");
  const killsEl = $("kills");
  const roomChip = $("room-chip");
  const feedEl = $("feed");
  const bannerEl = $("banner");
  const overlay = $("overlay");
  const panels = { menu: $("menu-panel"), lobby: $("lobby-panel"), end: $("end-panel"), spawn: $("spawn-panel"), bottanks: $("bottanks-panel") };
  const nameInput = $("name");
  const codeInput = $("code");
  const menuStatus = $("menu-status");
  const menuButtons = [$("create"), $("join"), $("solo")];
  const mapSelects = [...document.querySelectorAll(".map-select")];
  const botSelects = [...document.querySelectorAll(".bots-select")];
  const spawnSelect = $("spawn-select");
  const botTankButtons = [...document.querySelectorAll(".bot-tanks-open")];
  const spawnButtons = [...document.querySelectorAll(".spawn-open")];

  function showPanel(name) {
    overlay.hidden = !name;
    // While choosing a spawn point the arena stays visible and clickable behind a small panel
    overlay.classList.toggle("spawning", name === "spawn");
    for (const [key, el] of Object.entries(panels)) el.hidden = key !== name;
  }

  const choosing = () => !overlay.hidden && !panels.spawn.hidden;

  function setMenuStatus(text, isError = false) {
    menuStatus.textContent = text;
    menuStatus.classList.toggle("error", isError);
  }

  // ---------- Input ----------
  const keys = new Set();
  const mouse = { x: W / 2, y: H / 2, down: false, mine: false };

  window.addEventListener("keydown", (e) => {
    if (e.target instanceof HTMLInputElement) return; // typing a name or code
    keys.add(e.code);
    if (e.code === "KeyR" && session.role === "solo") startRound();
    // Space on the end-of-round screen starts a new solo game. A focused button
    // keeps its own Space behaviour, so the round can't start twice.
    // (A short delay stops a Space press from a last jump from skipping the results.)
    if (e.code === "Space" && !e.repeat && session.role === "solo" && !panels.end.hidden && !overlay.hidden
        && performance.now() - state.endShownAt > 600
        && !(e.target instanceof HTMLButtonElement || e.target instanceof HTMLSelectElement)) {
      e.preventDefault();
      startRound();
    }
    // Once your tank is destroyed and only bots are left, Esc skips to the main menu
    if (e.code === "Escape" && session.role === "solo" && state.running) {
      const me = mine();
      if (me && !me.alive) leaveMatch();
    }
    if (e.code === "Escape" && choosing()) closeSpawnPicker();
    if (e.code === "Escape" && !overlay.hidden && !panels.bottanks.hidden) closeBotTanks();
    if (e.code === "KeyM" && window.Sound) {
      Sound.toggleMute();
      updateHud();
    }
    if (state.running && (e.code.startsWith("Arrow") || e.code === "Space")) e.preventDefault();
  });
  window.addEventListener("keyup", (e) => keys.delete(e.code));
  window.addEventListener("blur", () => { keys.clear(); mouse.down = false; mouse.mine = false; });

  function updateMouse(e) {
    const r = canvas.getBoundingClientRect();
    mouse.x = ((e.clientX - r.left) / r.width) * W;
    mouse.y = ((e.clientY - r.top) / r.height) * H;
  }
  canvas.addEventListener("mousemove", updateMouse);
  canvas.addEventListener("mousedown", (e) => {
    if (choosing()) {
      updateMouse(e);
      if (e.button === 0) pickSpawnAt(mouse.x, mouse.y);
      return;
    }
    if (e.button === 0) mouse.down = true;
    if (e.button === 2) mouse.mine = true; // right-click lays a mine
  });
  window.addEventListener("mouseup", (e) => {
    if (e.button === 0) mouse.down = false;
    if (e.button === 2) mouse.mine = false;
  });
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

  function clampArena(e) {
    e.x = clamp(e.x, RADIUS, W - RADIUS);
    e.y = clamp(e.y, RADIUS, H - RADIUS);
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
    mines: [],
    particles: [],
    wrecks: [],
    countdown: 0,
    over: false,
    endTimer: 0,
    winnerId: -1,
    myKills: 0,
    destroyedMessage: "", // the message shown when your tank was destroyed, reused on the end screen
    victoryMessage: "", // the same for winning the round
    endShownAt: 0,
  };

  const isMine = (e) => e.pid !== null && e.pid === session.myPid;
  const mine = () => state.entities.find(isMine);
  const alive = () => state.entities.filter((e) => e.alive);
  const displayName = (e) => (isMine(e) ? "You" : e.name);
  const tag = (e) => `<b style="color:${e.color}">${esc(displayName(e))}</b>`;

  // r: { id, pid, name, type, x, y }
  function makeEntity(r, withAi) {
    const angle = Math.atan2(H / 2 - r.y, W / 2 - r.x);
    const spec = typeOf(r.type);
    return {
      id: r.id,
      pid: r.pid || null,
      name: r.name,
      spec,
      color: spec.color,
      tank: TANKS[spec.design], // the look; spec holds what the tank can do
      hp: spec.hp,
      flash: 0,
      mineCd: 0,
      jump: 0, // seconds left in the air
      jumpDir: 0,
      jumpCd: 0,
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

  // Bots added to a match: the chosen number, limited by the free spawn points. A match always
  // has at least one bot when fewer than two people are playing, or nobody could ever win.
  function effectiveBots(humans) {
    const n = Math.min(botCount, currentMap.spawns.length - humans);
    return humans < 2 ? Math.max(1, n) : n;
  }

  // Pick a spawn point for everyone in a round: each player gets the one they chose
  // (if it is free), and bots and players who didn't choose get random free ones.
  function assignSpawns(humans, total) {
    const count = currentMap.spawns.length;
    const used = new Set();
    const spots = humans.map((h) => {
      const want = Number.isInteger(h.spawn) ? h.spawn : -1;
      if (want >= 0 && want < count && !used.has(want)) {
        used.add(want);
        return want;
      }
      return -1;
    });
    const free = shuffle([...Array(count).keys()].filter((i) => !used.has(i)));
    while (spots.length < total) spots.push(-1);
    return spots.map((s) => (s >= 0 ? s : free.pop()));
  }

  // Host and solo: build a fresh round and tell everyone about it.
  function startRound() {
    const humans = session.role === "solo"
      ? [{ pid: session.myPid, name: myName(), tank: myTank, spawn: mySpawn }]
      : session.players.slice(0, MAX_PLAYERS);
    const bots = effectiveBots(humans.length);
    if (session.role === "solo" && bots !== botCount) setBots(bots, true);
    const spots = assignSpawns(humans, humans.length + bots);
    let bot = 0;
    const roster = Array.from({ length: humans.length + bots }, (_, i) => {
      const h = humans[i];
      return {
        id: i,
        pid: h ? h.pid : null,
        name: h ? h.name : "Bot " + BOT_NAMES[bot++],
        // Players drive their chosen tank; bots get a random one from the list the player allowed
        type: h ? cleanTank(h.tank) : botTanks[Math.floor(Math.random() * botTanks.length)],
        x: currentMap.spawns[spots[i]].x,
        y: currentMap.spawns[spots[i]].y,
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
    state.mines = [];
    state.particles = [];
    state.wrecks = [];
    state.countdown = COUNTDOWN;
    state.over = false;
    state.endTimer = 0;
    state.winnerId = -1;
    state.myKills = 0;
    state.destroyedMessage = "";
    state.victoryMessage = "";
    if (window.Sound) Sound.stopSpeech();
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
    const speed = BULLET_SPEED * e.spec.bulletSpeed;
    // Twin-barrel tanks alternate between left and right barrels
    const side = t.twin ? (e.shotSide *= -1) * 3.5 : 0;
    state.bullets.push({
      x: e.x + Math.cos(e.angle) * (t.bl + 2) - Math.sin(e.angle) * side,
      y: e.y + Math.sin(e.angle) * (t.bl + 2) + Math.cos(e.angle) * side,
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed,
      owner: e.id,
      life: e.spec.range ? e.spec.range / speed : BULLET_LIFE, // short-range bullets vanish after their range
      dmg: e.spec.dmg,
      pierce: e.spec.pierce,
    });
    e.muzzle = 0.06;
    if (isMine(e) && window.Sound) Sound.shot();
  }

  // Take hit points off a tank; it is destroyed when none are left
  function damage(victim, killer, amount) {
    victim.hp -= amount;
    if (victim.hp > 0) {
      victim.flash = 0.15;
      return;
    }
    victim.hp = 0;
    kill(victim, killer);
  }

  function placeMine(e) {
    e.mineCd = MINE_COOLDOWN;
    state.mines.push({ x: e.x, y: e.y, owner: e.id, age: 0 });
    const own = state.mines.filter((m) => m.owner === e.id);
    if (own.length > MINE_MAX) state.mines.splice(state.mines.indexOf(own[0]), 1);
  }

  // Mines arm after a moment, then go off when any tank except their owner comes close
  function updateMines(dt) {
    if (state.over) return;
    for (const m of state.mines.slice()) {
      m.age += dt;
      if (m.age < MINE_ARM_TIME) continue;
      const victim = state.entities.find((e) => e.alive && e.jump <= 0 && e.id !== m.owner && Math.hypot(e.x - m.x, e.y - m.y) < MINE_RADIUS);
      if (!victim) continue;
      state.mines.splice(state.mines.indexOf(m), 1);
      spark(m.x, m.y, "#ffb347", 22);
      damage(victim, state.entities[m.owner], MINE_DAMAGE);
    }
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
      if (window.Sound) Sound.destroyed();
      const said = nextDestroyedMessage();
      state.destroyedMessage = said.toUpperCase();
      if (window.Sound) Sound.speak(said); // read aloud as written, so the voice doesn't spell out capitals
      const how = killer ? `Shot by ${esc(killer.name)}` : "";
      const next = session.role === "solo" ? "R to restart · Esc for the main menu" : "spectating until the round ends";
      bannerEl.innerHTML = `<span style="color:#ff6b6b">${state.destroyedMessage}</span><small>${how ? how + " · " : ""}${next}</small>`;
    }
    updateHud();
  }

  function checkEnd() {
    const left = alive();
    if (left.length > 1 || state.over) return;
    state.over = true;
    state.endTimer = 1.2;
    state.winnerId = left[0] ? left[0].id : -1;
    announceWinner();
    broadcast({ t: "end", w: state.winnerId });
  }

  // If you won, show a random message in the banner straight away; the end screen reuses it
  function announceWinner() {
    const winner = state.entities[state.winnerId];
    if (!winner || !isMine(winner)) return;
    const said = nextVictoryMessage();
    state.victoryMessage = said.toUpperCase();
    if (window.Sound) Sound.speak(said);
    bannerEl.innerHTML = `<span style="color:#7fb83e">${state.victoryMessage}</span><small>You destroyed ${plural(state.myKills, "tank")}</small>`;
  }

  function showEnd() {
    const winner = state.entities[state.winnerId];
    const me = mine();
    const title = $("end-title");
    if (winner && isMine(winner)) {
      title.textContent = state.victoryMessage || "VICTORY!"; // the same message as the banner
      title.style.color = "#7fb83e";
    } else if (me) {
      title.textContent = state.destroyedMessage || "SOS CHOTO"; // the same message as the banner
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
    $("again").textContent = session.role === "solo" ? "Play again · Space" : "Play again";
    $("end-wait").hidden = !isClient;
    $("end-settings").hidden = isClient;
    for (const b of botTankButtons) b.hidden = isClient;
    $("end-leave").textContent = session.role === "solo" ? "Main menu" : "Leave match";
    bannerEl.innerHTML = "";
    state.endShownAt = performance.now();
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
    $("sound-chip").hidden = !(window.Sound && Sound.muted);
  }

  // ---------- Simulation (host and solo) ----------
  const NO_INPUT = { u: 0, d: 0, l: 0, r: 0, f: 0, m: 0, j: 0, a: null };

  function localInput(e) {
    return {
      u: keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0,
      d: keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0,
      l: keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0,
      r: keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0,
      f: mouse.down ? 1 : 0,
      m: keys.has("KeyE") || mouse.mine ? 1 : 0,
      j: keys.has("Space") ? 1 : 0,
      a: Math.atan2(mouse.y - e.y, mouse.x - e.x),
    };
  }

  // Never trust what arrives over the network
  function cleanInput(m) {
    const b = (v) => (v ? 1 : 0);
    const a = Number(m.a);
    return { u: b(m.u), d: b(m.d), l: b(m.l), r: b(m.r), f: b(m.f), m: b(m.m), j: b(m.j), a: Number.isFinite(a) ? a : null };
  }

  function inputFor(e) {
    return e.pid === session.myPid ? localInput(e) : session.inputs.get(e.pid) || NO_INPUT;
  }

  function startJump(e, dir) {
    e.jump = JUMP_TIME;
    e.jumpDir = dir;
    e.jumpCd = JUMP_COOLDOWN;
  }

  // In the air a tank flies straight in the direction it took off. It can still aim,
  // but cannot shoot, and walls (and mines) don't touch it.
  function flyJump(e, dt) {
    e.x += Math.cos(e.jumpDir) * JUMP_SPEED * dt;
    e.y += Math.sin(e.jumpDir) * JUMP_SPEED * dt;
    e.jump -= dt;
    if (e.pid) {
      const input = inputFor(e);
      if (input.a !== null) e.angle = input.a;
    }
  }

  // Angle to shoot at to hit a moving target; `lead` is how much of the target's movement to account for
  function leadAngle(from, target, bulletSpeed, lead) {
    const t = dist(from, target) / bulletSpeed;
    return Math.atan2(target.y + target.vy * t * lead - from.y, target.x + target.vx * t * lead - from.x);
  }

  // The nearest enemy a tank with auto-aim can see
  function autoTarget(e) {
    let best = null, bestD = AUTO_AIM_RANGE;
    for (const o of state.entities) {
      if (!o.alive || o === e) continue;
      const d = dist(e, o);
      if (d < bestD && hasLineOfSight(e, o)) { best = o; bestD = d; }
    }
    return best;
  }

  function applyInput(e, input, dt, canFire) {
    const spec = e.spec;
    const mx = input.r - input.l, my = input.d - input.u;
    const len = Math.hypot(mx, my) || 1;
    const speed = PLAYER_SPEED * spec.speed;
    e.x += (mx / len) * speed * dt;
    e.y += (my / len) * speed * dt;

    let aim = input.a;
    let locked = false;
    if (spec.autoAim) {
      // The turret swings onto the nearest visible enemy by itself
      const target = autoTarget(e);
      if (target) {
        aim = leadAngle(e, target, BULLET_SPEED * spec.bulletSpeed, 0.8);
        locked = true;
      }
    }
    if (aim !== null) {
      if (locked) e.angle += clamp(angleDiff(e.angle, aim), -14 * dt, 14 * dt);
      else e.angle = aim;
    }

    const onTarget = !locked || Math.abs(angleDiff(e.angle, aim)) < 0.12;
    if (canFire && input.f && onTarget && e.cooldown <= 0) {
      shoot(e, locked ? 0 : 0.02);
      e.cooldown = PLAYER_COOLDOWN * spec.cooldown;
    }
    if (spec.mines && canFire && input.m && e.mineCd <= 0) placeMine(e);
    if (spec.jump && canFire && input.j && e.jumpCd <= 0) startJump(e, mx || my ? Math.atan2(my, mx) : e.hullAngle);
  }

  function findTarget(bot) {
    let best = null, bestD = BOT_VIEW_RANGE;
    for (const e of state.entities) {
      if (!e.alive || e === bot) continue;
      const d = dist(bot, e);
      if (d < bestD && (bot.spec.pierce || hasLineOfSight(bot, e))) { best = e; bestD = d; }
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
    const spec = bot.spec;
    const speed = BOT_SPEED * spec.speed;
    const target = findTarget(bot);

    if (target) {
      if (ai.targetId !== target.id) {
        ai.targetId = target.id;
        ai.reaction = rand(0.25, 0.55); // time to "notice" a new target
      }
      const d = dist(bot, target);

      // Aim with partial lead
      const desired = leadAngle(bot, target, BULLET_SPEED * spec.bulletSpeed, 0.6);
      const diff = angleDiff(bot.angle, desired);
      const turn = 7 * dt;
      bot.angle += clamp(diff, -turn, turn);

      // Short-range bullets only fire once the target is in reach
      const inReach = !spec.range || d <= spec.range + 10;
      ai.reaction -= dt;
      if (canFire && inReach && ai.reaction <= 0 && Math.abs(diff) < 0.15 && bot.cooldown <= 0) {
        shoot(bot, ai.accuracy * (spec.autoAim ? 0.4 : 1));
        bot.cooldown = (ai.fireRate + rand(0, 0.25)) * spec.cooldown;
      }
      if (canFire && spec.mines && bot.mineCd <= 0 && d < 280 && Math.random() < dt * 1.5) placeMine(bot);

      // Strafe around the target, keeping a fighting distance
      ai.strafeTimer -= dt;
      if (ai.strafeTimer <= 0) {
        ai.strafeDir *= -1;
        ai.strafeTimer = rand(0.5, 1.4);
      }
      const far = spec.range ? spec.range * 0.8 : 330;
      const near = spec.range ? spec.range * 0.4 : 180;
      const toX = (target.x - bot.x) / d, toY = (target.y - bot.y) / d;
      let mx = -toY * ai.strafeDir, my = toX * ai.strafeDir;
      // A jumping bot sometimes leaps sideways to dodge
      if (canFire && spec.jump && bot.jumpCd <= 0 && Math.random() < dt * 0.25) startJump(bot, Math.atan2(my, mx));
      if (d > far) { mx += toX; my += toY; }
      else if (d < near) { mx -= toX; my -= toY; }
      const len = Math.hypot(mx, my) || 1;
      bot.x += (mx / len) * speed * dt;
      bot.y += (my / len) * speed * dt;
      ai.waypoint = { x: target.x, y: target.y }; // chase last known position if lost
    } else {
      ai.targetId = null;
      if (dist(bot, ai.waypoint) < 25) newWaypoint(bot);
      moveToward(bot, ai.waypoint.x, ai.waypoint.y, speed * 0.85, dt);
      const desired = Math.atan2(ai.waypoint.y - bot.y, ai.waypoint.x - bot.x);
      const turn = 5 * dt;
      bot.angle += clamp(angleDiff(bot.angle, desired), -turn, turn);
      if (canFire && spec.mines && bot.mineCd <= 0 && Math.random() < dt * 0.3) placeMine(bot);
      // A jumping bot leaps over walls that are between it and where it is heading
      if (canFire && spec.jump && bot.jumpCd <= 0 && dist(bot, ai.waypoint) > 150 && !hasLineOfSight(bot, ai.waypoint) && Math.random() < dt * 0.5) {
        startJump(bot, Math.atan2(ai.waypoint.y - bot.y, ai.waypoint.x - bot.x));
      }
    }

    // Stuck detection: if barely moved in a second, pick a new waypoint
    ai.stuckTimer += dt;
    if (ai.stuckTimer > 1) {
      if (dist(bot, ai.stuckFrom) < 20) {
        newWaypoint(bot);
        ai.strafeDir *= -1;
        if (canFire && spec.jump && bot.jumpCd <= 0) startJump(bot, Math.atan2(ai.waypoint.y - bot.y, ai.waypoint.x - bot.x));
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

  // Where along this step (0 to 1) a bullet reaches the first wreck in its way, or Infinity
  function wreckHit(b, x2, y2) {
    let first = Infinity;
    for (const w of state.wrecks) {
      if (Math.hypot(b.x - w.x, b.y - w.y) <= RADIUS + 2) continue; // already on top of it
      if (segPointDist(b.x, b.y, x2, y2, w.x, w.y) > RADIUS + 2) continue;
      const dx = x2 - b.x, dy = y2 - b.y;
      const t = clamp(((w.x - b.x) * dx + (w.y - b.y) * dy) / (dx * dx + dy * dy), 0, 1);
      first = Math.min(first, t);
    }
    return first;
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
      if (!b.pierce) {
        for (const w of WALLS) {
          const t = segHitsRect(x1, y1, x2, y2, w);
          if (t >= 0) hitT = Math.min(hitT, t);
        }
      }
      // A wreck stops every bullet, including ones that pass through walls. A bullet fired from on
      // top of a wreck isn't stopped by it, so a tank standing on a wreck can still shoot.
      const wreckT = wreckHit(b, x2, y2);
      if (wreckT !== Infinity) hitT = Math.min(hitT, wreckT);
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
        damage(hitEntity.e, state.entities[b.owner], b.dmg);
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

  function spark(x, y, color, n = 6) {
    sparkEffect(x, y, color, n);
    broadcast({ t: "ev", k: "spark", x: Math.round(x), y: Math.round(y), c: color, n });
  }

  function sparkEffect(x, y, color, n = 6) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2), s = rand(40, n > 6 ? 300 : 160);
      state.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: n > 6 ? 0.5 : 0.25, max: n > 6 ? 0.5 : 0.25, color });
    }
  }

  function simulate(dt) {
    if (state.countdown > 0) state.countdown -= dt;
    const canFire = state.countdown <= 0 && !state.over;

    const living = alive();
    for (const e of living) {
      e.px = e.x; e.py = e.y;
      e.cooldown -= dt;
      e.mineCd -= dt;
      e.jumpCd -= dt;
      e.flash -= dt;
      e.muzzle -= dt;
      if (e.jump > 0) {
        flyJump(e, dt);
      } else if (e.pid) {
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
      if (e.jump > 0) clampArena(e);
      else resolveWalls(e);
      e.vx = dt > 0 ? (e.x - e.px) / dt : 0;
      e.vy = dt > 0 ? (e.y - e.py) / dt : 0;
      turnHull(e, dt);
    }

    updateBullets(dt);
    updateMines(dt);

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
        e.id, r1(e.x), r1(e.y), r3(e.angle), r3(e.hullAngle), r1(e.tread), e.alive ? 1 : 0, e.muzzle > 0 ? 1 : 0, r1(e.hp),
        r3(Math.max(0, e.jump)), r1(Math.max(0, e.jumpCd)),
      ]),
      b: state.bullets.map((b) => [r1(b.x), r1(b.y), Math.round(b.vx), Math.round(b.vy), b.owner]),
      mi: state.mines.map((m) => [r1(m.x), r1(m.y), m.owner, m.age >= MINE_ARM_TIME ? 1 : 0]),
    };
  }

  function lobbyMessage() {
    return { t: "lobby", map: currentMap.id, bots: botCount, botTanks, players: session.players.map(({ pid, name, tank, spawn }) => ({ pid, name, tank, spawn })) };
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
        // A spawn point someone already has is not given out twice
        let wanted = cleanSpawn(msg.spawn);
        if (wanted >= 0 && session.players.some((p) => p.spawn === wanted)) wanted = -1;
        session.players.push({ pid, name: cleanName(msg.name), tank: cleanTank(msg.tank), spawn: wanted, lastSeen: performance.now() });
        session.net.send(pid, { t: "welcome" });
        broadcastLobby();
        // Joining mid-round: watch until the next round starts
        if (state.running && !state.over && session.lastStart) session.net.send(pid, session.lastStart);
        break;
      }
      case "spawn":
        if (player) {
          const i = cleanSpawn(msg.i);
          // A spawn point someone else already has is refused; the reply puts the list right
          if (i < 0 || !session.players.some((p) => p.pid !== pid && p.spawn === i)) player.spawn = i;
          broadcastLobby();
        }
        break;
      case "pick":
        if (player) {
          player.tank = cleanTank(msg.tank);
          broadcastLobby();
        }
        break;
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
        if (!state.running) {
          setMap(msg.map);
          setBots(msg.bots);
          setBotTanks(msg.botTanks);
        }
        {
          const me = session.players.find((p) => p.pid === session.myPid);
          if (me) mySpawn = cleanSpawn(me.spawn);
        }
        refreshSpawnUi();
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
        if (msg.k === "spark") sparkEffect(msg.x, msg.y, msg.c, msg.n);
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
        announceWinner();
        break;
    }
  }

  function applySnapshot(m) {
    if (m.r !== state.round || !state.running) return;
    state.countdown = m.cd;
    for (const [id, x, y, a, ha, tread, isAlive, muzzle, hp, jump, jumpCd] of m.e) {
      const e = state.entities[id];
      if (!e) continue;
      if (hp < e.hp) e.flash = 0.15; // took a hit that didn't destroy it
      e.hp = hp;
      e.jump = jump;
      e.jumpCd = jumpCd;
      if (e.tx === undefined) { e.x = x; e.y = y; e.hullAngle = ha; }
      e.tx = x; e.ty = y; e.ta = a; e.tha = ha;
      e.tread = tread;
      if (!isAlive) e.alive = false;
      if (muzzle) e.muzzle = 0.06;
    }
    state.bullets = m.b.map(([x, y, vx, vy, owner]) => {
      const o = state.entities[owner];
      return { x, y, vx, vy, owner, life: 1, pierce: !!(o && o.spec.pierce) };
    });
    state.mines = m.mi.map(([x, y, owner, armed]) => ({ x, y, owner, age: armed ? MINE_ARM_TIME : 0 }));
  }

  // Smoothly move everything toward the latest snapshot, and keep bullets flying between snapshots
  function clientUpdate(dt) {
    if (state.countdown > 0) state.countdown -= dt;
    const k = Math.min(1, dt * 18);
    for (const e of state.entities) {
      e.muzzle -= dt;
      e.flash -= dt;
      e.jump -= dt;
      e.jumpCd -= dt;
      if (e.tx === undefined) continue;
      e.x += (e.tx - e.x) * k;
      e.y += (e.ty - e.y) * k;
      e.hullAngle += angleDiff(e.hullAngle, e.tha) * k;
      // Your own turret follows your mouse straight away (an auto-aim turret follows the host's aim)
      if (isMine(e) && e.alive && !e.spec.autoAim) e.angle = Math.atan2(mouse.y - e.y, mouse.x - e.x);
      else e.angle += angleDiff(e.angle, e.ta) * k;
    }

    for (const b of state.bullets) {
      const x2 = b.x + b.vx * dt, y2 = b.y + b.vy * dt;
      if ((!b.pierce && WALLS.some((w) => segHitsRect(b.x, b.y, x2, y2, w) >= 0)) || wreckHit(b, x2, y2) !== Infinity || x2 < 0 || x2 > W || y2 < 0 || y2 > H) b.life = 0;
      b.x = x2; b.y = y2;
    }
    state.bullets = state.bullets.filter((b) => b.life > 0);

    const me = mine();

    // Play your own shots straight away, using the same fire rate as the host,
    // instead of waiting for the host's update to arrive
    if (me && me.alive) {
      me.cooldown -= dt;
      if (mouse.down && state.countdown <= 0 && !state.over && me.cooldown <= 0) {
        me.cooldown = PLAYER_COOLDOWN * me.spec.cooldown;
        if (window.Sound) Sound.shot();
      }
    }

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
    const next = MAPS.find((m) => m.id === id) || MAPS[0];
    if (next !== currentMap) mySpawn = -1; // spawn points belong to one map
    currentMap = next;
    WALLS = currentMap.walls;
    for (const sel of mapSelects) sel.value = currentMap.id;
    buildBotOptions();
    setBots(botCount); // keeps the number within what the new map allows
    refreshSpawnUi();
  }

  function savedMap() {
    try { return localStorage.getItem(MAP_KEY); } catch { return null; }
  }

  // The number of bots to play with. Like the map, a player's own choice is remembered,
  // while a value received from the host is only shown.
  const BOTS_KEY = "last-one-standing-bots";

  // At most one bot fewer than the map has spawn points, which leaves a spawn point for you
  const maxBots = () => currentMap.spawns.length - 1;

  function cleanBots(v) {
    const n = v === null || v === undefined || v === "" ? NaN : Math.round(Number(v));
    return Number.isFinite(n) ? clamp(n, 0, maxBots()) : Math.min(DEFAULT_BOTS, maxBots());
  }

  // The Bots lists offer None up to the most the current map allows
  function buildBotOptions() {
    const html = Array.from({ length: maxBots() + 1 }, (_, n) => `<option value="${n}">${n === 0 ? "None" : n}</option>`).join("");
    for (const sel of botSelects) sel.innerHTML = html;
  }

  function setBots(n, remember = false) {
    botCount = cleanBots(n);
    for (const sel of botSelects) sel.value = String(botCount);
    if (remember) {
      try { localStorage.setItem(BOTS_KEY, String(botCount)); } catch {}
    }
  }

  function savedBots() {
    try { return localStorage.getItem(BOTS_KEY); } catch { return null; }
  }

  for (const sel of botSelects) {
    sel.addEventListener("change", () => {
      if (session.role === "client" || state.running) return;
      setBots(sel.value, true);
      if (session.role === "host") broadcastLobby();
    });
  }

  for (const sel of mapSelects) {
    sel.innerHTML = MAPS.map((m) => `<option value="${m.id}">${m.name}</option>`).join("");
    sel.addEventListener("change", () => {
      if (session.role === "client" || state.running) return;
      setMap(sel.value);
      try { localStorage.setItem(MAP_KEY, currentMap.id); } catch {}
      if (session.role === "host") {
        for (const p of session.players) p.spawn = -1;
        broadcastLobby();
      }
    });
  }

  // ---------- Spawn picker ----------
  let spawnReturn = "menu"; // the panel to go back to when the picker is closed

  function cleanSpawn(v) {
    const n = Number(v);
    return Number.isInteger(n) && n >= 0 && n < currentMap.spawns.length ? n : -1;
  }

  const spawnTakenByOther = (i) => session.players.some((p) => p.pid !== session.myPid && p.spawn === i);

  function chooseSpawn(i) {
    i = cleanSpawn(i);
    if (i >= 0 && spawnTakenByOther(i)) return;
    mySpawn = i;
    refreshSpawnUi();
    if (session.role === "host") {
      if (session.players[0]) session.players[0].spawn = i;
      broadcastLobby();
    } else if (session.role === "client") {
      session.net.send({ t: "spawn", i });
    }
  }

  // Keep the list and the buttons that open the picker in step with the choice
  function refreshSpawnUi() {
    const html = '<option value="-1">Random</option>' + currentMap.spawns.map((_, i) => {
      const taken = spawnTakenByOther(i);
      return `<option value="${i}"${taken ? " disabled" : ""}>Spawn ${i + 1}${taken ? " (taken)" : ""}</option>`;
    }).join("");
    if (spawnSelect.dataset.html !== html) {
      spawnSelect.innerHTML = html;
      spawnSelect.dataset.html = html;
    }
    spawnSelect.value = String(mySpawn);
    const label = mySpawn >= 0 ? `Spawn ${mySpawn + 1}` : "Random";
    for (const b of spawnButtons) b.textContent = label;
  }

  function openSpawnPicker() {
    spawnReturn = !panels.lobby.hidden ? "lobby" : !panels.end.hidden ? "end" : "menu";
    refreshSpawnUi();
    showPanel("spawn");
  }

  function closeSpawnPicker() {
    showPanel(spawnReturn);
  }

  // Click on the map: take the nearest free spawn point, if the click is close enough to one
  function pickSpawnAt(x, y) {
    let best = -1, bestD = 32;
    currentMap.spawns.forEach((p, i) => {
      const d = Math.hypot(x - p.x, y - p.y);
      if (d < bestD && !spawnTakenByOther(i)) { best = i; bestD = d; }
    });
    if (best >= 0) chooseSpawn(best);
  }

  for (const b of spawnButtons) b.addEventListener("click", openSpawnPicker);
  spawnSelect.addEventListener("change", () => chooseSpawn(spawnSelect.value));
  $("spawn-random").addEventListener("click", () => chooseSpawn(-1));
  $("spawn-done").addEventListener("click", closeSpawnPicker);

  // ---------- Bot tanks ----------
  const BOT_TANKS_KEY = "last-one-standing-bot-tanks";
  let botTanksReturn = "menu"; // the panel to go back to when the list is closed

  function savedBotTanks() {
    try { return localStorage.getItem(BOT_TANKS_KEY); } catch { return null; }
  }

  // "All", the name of the only tank allowed, or how many are allowed
  function botTankSummary() {
    return botTanks.length === TANK_TYPES.length ? "All" : botTanks.length === 1 ? typeOf(botTanks[0]).name : `${botTanks.length} tanks`;
  }

  // How bots are shown in the lobby
  function botTankName() {
    if (botTanks.length === 1) return `${botTanks[0]} · ${typeOf(botTanks[0]).name}`;
    return botTanks.length === TANK_TYPES.length ? "Random tank" : `Random of ${botTanks.length}`;
  }

  function refreshBotTanksUi() {
    for (const b of botTankButtons) b.textContent = `Bot tanks: ${botTankSummary()}`;
    for (const card of document.querySelectorAll(".bot-picker .tank-card")) {
      const on = botTanks.includes(Number(card.dataset.tank));
      card.classList.toggle("selected", on);
      card.setAttribute("aria-checked", String(on));
    }
  }

  // Like the map and the number of bots, a player's own choice is remembered,
  // and a list received from the host is only shown.
  function setBotTanks(v, remember = false) {
    botTanks = cleanBotTanks(v);
    refreshBotTanksUi();
    if (remember) {
      try { localStorage.setItem(BOT_TANKS_KEY, botTanks.join(",")); } catch {}
    }
  }

  function changeBotTanks(list) {
    if (session.role === "client") return;
    setBotTanks(list, true);
    if (session.role === "host") broadcastLobby();
  }

  function toggleBotTank(id) {
    const on = botTanks.includes(id);
    if (on && botTanks.length === 1) return; // at least one tank has to stay allowed
    changeBotTanks(on ? botTanks.filter((n) => n !== id) : [...botTanks, id]);
  }

  function openBotTanks() {
    botTanksReturn = !panels.lobby.hidden ? "lobby" : !panels.end.hidden ? "end" : "menu";
    showPanel("bottanks");
  }

  function closeBotTanks() {
    showPanel(botTanksReturn);
  }

  for (const b of botTankButtons) b.addEventListener("click", openBotTanks);
  $("bottanks-all").addEventListener("click", () => changeBotTanks(TANK_TYPES.map((t) => t.id)));
  $("bottanks-done").addEventListener("click", closeBotTanks);

  for (const spec of TANK_TYPES) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "tank-card";
    card.dataset.tank = spec.id;
    card.setAttribute("role", "checkbox");
    const cv = document.createElement("canvas");
    cv.width = 132;
    cv.height = 72;
    const name = document.createElement("span");
    name.className = "tank-name";
    name.textContent = `${spec.id} · ${spec.name}`;
    card.append(cv, name);
    card.addEventListener("click", () => toggleBotTank(spec.id));
    document.querySelector(".bot-picker").appendChild(card);
    drawTankPreview(cv, spec);
  }
  refreshBotTanksUi();

  // ---------- Tank picker ----------
  const TANK_KEY = "last-one-standing-tank";
  let myTank = 1;
  try { myTank = cleanTank(localStorage.getItem(TANK_KEY)); } catch {}

  // Draw a tank into a small canvas, for the picker cards
  function drawTankPreview(cv, spec) {
    const t = TANKS[spec.design];
    const prev = ctx;
    ctx = cv.getContext("2d");
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.save();
    ctx.translate(cv.width / 2 - 8, cv.height / 2);
    ctx.scale(1.95, 1.95);
    drawTracks(t, 0, "#2b2e33", "#15171b");
    drawHull(t, spec.color, shade(spec.color, -0.45));
    drawBarrels(t, shade(spec.color, -0.25), shade(spec.color, -0.6));
    drawTurret(t, shade(spec.color, 0.12), shade(spec.color, -0.55));
    ctx.restore();
    ctx = prev;
  }

  function refreshPickers() {
    for (const card of document.querySelectorAll(".tank-picker:not(.bot-picker) .tank-card")) {
      const on = Number(card.dataset.tank) === myTank;
      card.classList.toggle("selected", on);
      card.setAttribute("aria-checked", String(on));
    }
    for (const d of document.querySelectorAll(".tank-desc")) d.textContent = typeOf(myTank).desc;
  }

  function selectTank(n) {
    myTank = cleanTank(n);
    try { localStorage.setItem(TANK_KEY, String(myTank)); } catch {}
    refreshPickers();
    if (session.role === "host") {
      if (session.players[0]) session.players[0].tank = myTank;
      broadcastLobby();
    } else if (session.role === "client") {
      session.net.send({ t: "pick", tank: myTank });
    }
  }

  for (const picker of document.querySelectorAll(".tank-picker:not(.bot-picker)")) {
    for (const spec of TANK_TYPES) {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "tank-card";
      card.dataset.tank = spec.id;
      card.setAttribute("role", "radio");
      const cv = document.createElement("canvas");
      cv.width = 132;
      cv.height = 72;
      const name = document.createElement("span");
      name.className = "tank-name";
      name.textContent = `${spec.id} · ${spec.name}`;
      card.append(cv, name);
      card.addEventListener("click", () => selectTank(spec.id));
      picker.appendChild(card);
      drawTankPreview(cv, spec);
    }
  }
  refreshPickers();

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
    for (let i = 0; i < session.players.length; i++) {
      const p = session.players[i];
      const li = document.createElement("li");
      const tags = [];
      if (i === 0) tags.push("Host");
      if (p.pid === session.myPid) tags.push("You");
      const spec = typeOf(p.tank);
      li.innerHTML =
        `<span class="swatch" style="background:${spec.color}"></span>` +
        `<span class="pname">${esc(p.name)}</span>` +
        `<span class="tag">${tags.join(" · ")}</span>` +
        `<span class="tag tank-tag">${spec.id} · ${spec.name}</span>`;
      list.appendChild(li);
    }
    // With many bots, a single line is shown for all of them
    const botSlots = effectiveBots(session.players.length);
    if (botSlots > 0) {
      const li = document.createElement("li");
      li.className = "bot";
      li.innerHTML =
        '<span class="swatch" style="background:#5a6272"></span>' +
        `<span class="pname">${botSlots} ${botSlots === 1 ? "bot" : "bots"}</span>` +
        '<span class="tag"></span>' +
        `<span class="tag tank-tag">${botTankName()}</span>`;
      list.appendChild(li);
    }
    const isHost = session.role === "host";
    $("start").hidden = !isHost;
    $("map-lobby").disabled = !isHost;
    $("bots-lobby").disabled = !isHost;
    for (const b of botTankButtons) b.disabled = !isHost;
    $("lobby-hint").textContent = isHost
      ? "Send your friends the room code or invite link. Choose how many bots to add above."
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
    Object.assign(state, { running: false, entities: [], bullets: [], mines: [], particles: [], wrecks: [], over: false, countdown: 0 });
    if (window.Sound) Sound.stopSpeech();
    setMap(savedMap());
    mySpawn = -1;
    refreshSpawnUi();
    setBots(savedBots());
    setBotTanks(savedBotTanks());
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
      session.players = [{ pid: "host", name: myName(), tank: myTank, spawn: mySpawn, lastSeen: Infinity }];
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
      net.send({ t: "hello", name: myName(), tank: myTank, spawn: mySpawn });
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
  setBots(savedBots());
  setBotTanks(savedBotTanks());
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

  // Numbered spawn points, shown while a spawn point is being chosen
  function drawSpawnMarkers() {
    const spots = currentMap.spawns;
    let hover = -1, hoverD = 32;
    spots.forEach((p, i) => {
      const d = Math.hypot(mouse.x - p.x, mouse.y - p.y);
      if (d < hoverD && !spawnTakenByOther(i)) { hover = i; hoverD = d; }
    });
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "bold 13px system-ui, sans-serif";
    spots.forEach((p, i) => {
      const other = session.players.find((q) => q.pid !== session.myPid && q.spawn === i);
      if (i === mySpawn) {
        // Your tank, shown where it will start
        drawTank(makeEntity({ id: -1, pid: session.myPid, name: "", type: myTank, x: p.x, y: p.y }, false));
        ctx.strokeStyle = "#7fb83e";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 28, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = "#fff";
        ctx.fillText(String(i + 1), p.x, p.y + 42);
        return;
      }
      ctx.beginPath();
      ctx.arc(p.x, p.y, 16, 0, Math.PI * 2);
      if (other) {
        ctx.fillStyle = typeOf(other.tank).color;
        ctx.globalAlpha = 0.55;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = "#10141c";
        ctx.fillText((other.name || "?").slice(0, 1).toUpperCase(), p.x, p.y + 1);
        return;
      }
      ctx.fillStyle = i === hover ? "rgba(127,184,62,0.55)" : "rgba(255,255,255,0.1)";
      ctx.fill();
      ctx.strokeStyle = i === hover ? "#fff" : "#8d97aa";
      ctx.lineWidth = i === hover ? 3 : 2;
      ctx.stroke();
      ctx.fillStyle = "#fff";
      ctx.fillText(String(i + 1), p.x, p.y + 1);
    });
    ctx.textBaseline = "alphabetic";
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
    if (t.legs) {
      // Spring-loaded leg pads at the corners
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      for (const [lx, ly] of [[-L / 2 + 6, -hw + 2], [-L / 2 + 6, hw - 2], [L / 2 - 8, -hw + 2], [L / 2 - 8, hw - 2]]) {
        ctx.beginPath();
        ctx.arc(lx, ly, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
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
    } else if (t.turret === "tri") {
      // Pointed, wedge-shaped turret
      ctx.moveTo(s * 1.1, 0);
      ctx.lineTo(-s * 0.8, -s * 0.9);
      ctx.lineTo(-s * 0.8, s * 0.9);
      ctx.closePath();
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
    // 0 on the ground, up to 1 at the top of a jump
    const air = e.jump > 0 ? Math.sin(Math.PI * clamp(1 - e.jump / JUMP_TIME, 0, 1)) : 0;
    if (air > 0) {
      // The shadow stays on the ground while the tank rises above it
      ctx.fillStyle = "rgba(0,0,0,0.4)";
      ctx.beginPath();
      ctx.ellipse(e.x + 2, e.y + 4, t.L * 0.5, t.Wd * 0.45, e.hullAngle, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.save();
    ctx.translate(e.x, e.y - air * 22);
    ctx.scale(1 + air * 0.28, 1 + air * 0.28);

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
    if (e.flash > 0) {
      // Brief white flash when a hit doesn't destroy the tank
      ctx.globalAlpha = Math.min(1, e.flash / 0.15) * 0.7;
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(0, 0, t.L * 0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    // health bar, for tanks that have taken damage or have extra health
    if (e.hp < e.spec.hp || e.spec.hp > 100) {
      const w = 30, x = e.x - w / 2, y = e.y + t.Wd / 2 + 7, f = clamp(e.hp / e.spec.hp, 0, 1);
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillRect(x - 1, y - 1, w + 2, 6);
      ctx.fillStyle = f > 0.5 ? "#7fb83e" : f > 0.25 ? "#d9a441" : "#d0644a";
      ctx.fillRect(x, y, w * f, 4);
    }

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

  // A bobbing arrow over your tank during the countdown, so you can find it before the round starts.
  // Near the top edge, where it would be cut off, it sits below the tank and points up.
  function drawYouArrow(e) {
    const tagY = e.y - e.tank.Wd / 2 - 10;
    const bob = Math.sin(performance.now() / 160) * 6;
    const below = e.y < 100;
    const dir = below ? -1 : 1; // 1 points down at the tank, -1 points up at it
    const tip = below ? e.y + e.tank.Wd / 2 + 16 + bob : tagY - 16 + bob;
    ctx.save();
    ctx.globalAlpha = clamp(state.countdown / 0.4, 0, 1); // fades out as the round starts
    ctx.beginPath();
    ctx.moveTo(e.x, tip);
    ctx.lineTo(e.x - 13, tip - 14 * dir);
    ctx.lineTo(e.x - 5, tip - 14 * dir);
    ctx.lineTo(e.x - 5, tip - 28 * dir);
    ctx.lineTo(e.x + 5, tip - 28 * dir);
    ctx.lineTo(e.x + 5, tip - 14 * dir);
    ctx.lineTo(e.x + 13, tip - 14 * dir);
    ctx.closePath();
    ctx.fillStyle = "#ffe14d";
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#1a1f2a";
    ctx.stroke();
    ctx.restore();
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

  // "#rrggbb" as an rgba() string
  function hexA(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
  }

  // Bullets take the colour of the tank that fired them
  function drawBullets() {
    ctx.lineCap = "round";
    for (const b of state.bullets) {
      const o = state.entities[b.owner];
      const col = o ? o.color : "#ffe08a";
      const tx = b.x - b.vx * 0.03, ty = b.y - b.vy * 0.03;
      const g = ctx.createLinearGradient(tx, ty, b.x, b.y);
      g.addColorStop(0, hexA(col, 0));
      g.addColorStop(1, col);
      ctx.strokeStyle = g;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.fillStyle = shade(col, 0.55);
      ctx.beginPath();
      ctx.arc(b.x, b.y, 2.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawMines() {
    for (const m of state.mines) {
      const o = state.entities[m.owner];
      const col = o ? o.color : "#ffb347";
      const armed = m.age >= MINE_ARM_TIME;
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.beginPath();
      ctx.arc(m.x + 2, m.y + 3, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#2b2e33";
      ctx.beginPath();
      ctx.arc(m.x, m.y, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = col;
      ctx.stroke();
      // The light blinks once the mine is armed
      const on = armed && Math.floor(performance.now() / 350) % 2 === 0;
      ctx.fillStyle = armed ? (on ? "#ff5a4a" : "#7a2a24") : "#5a6272";
      ctx.beginPath();
      ctx.arc(m.x, m.y, 3, 0, Math.PI * 2);
      ctx.fill();
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

  const jumpChip = $("jump-chip");

  // Shows your jump's recharge time, for a tank that can jump
  function updateJumpChip() {
    const me = state.running ? mine() : null;
    let text = "";
    if (me && me.alive && me.spec.jump) {
      text = me.jump > 0 ? "Jumping" : me.jumpCd > 0 ? `Jump ${me.jumpCd.toFixed(1)}s` : "Jump ready · Space";
    }
    if (jumpChip.textContent !== text) {
      jumpChip.textContent = text;
      jumpChip.hidden = !text;
    }
  }

  function render() {
    updateJumpChip();
    drawFloor();
    for (const w of state.wrecks) drawWreck(w);
    drawWalls();
    if (choosing()) drawSpawnMarkers();
    drawMines();
    drawParticles();
    for (const e of state.entities) if (e.alive) drawTank(e);
    drawBullets();
    drawCountdown();
    // Drawn after the countdown's darkening, so the arrow stays bright
    const me = state.running && state.countdown > 0 ? mine() : null;
    if (me && me.alive) drawYouArrow(me);
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
