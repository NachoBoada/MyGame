(() => {
  "use strict";

  // ---------- Constants ----------
  const W = 1200;
  const H = 800;
  const RADIUS = 14;
  const PLAYER_SPEED = 220;
  const BOT_SPEED = 170;
  const BULLET_SPEED = 750;
  const BULLET_LIFE = 1.4;
  const PLAYER_COOLDOWN = 0.3;
  const BOT_VIEW_RANGE = 750;
  const COUNTDOWN = 3;

  const WALLS = [
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
  ];

  const SPAWNS = [
    { x: 70, y: 70 },
    { x: W - 70, y: 70 },
    { x: 70, y: H - 70 },
    { x: W - 70, y: H - 70 },
    { x: W / 2, y: 45 },
    { x: W / 2, y: H - 45 },
  ];

  const BOT_DEFS = [
    { name: "Alpha", color: "#ff5c5c" },
    { name: "Bravo", color: "#ffb347" },
    { name: "Charlie", color: "#c77dff" },
    { name: "Delta", color: "#4dabf7" },
    { name: "Echo", color: "#f783ac" },
  ];

  // ---------- DOM ----------
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const aliveEl = document.getElementById("alive");
  const killsEl = document.getElementById("kills");
  const feedEl = document.getElementById("feed");
  const bannerEl = document.getElementById("banner");
  const overlay = document.getElementById("overlay");
  const ovTitle = document.getElementById("ov-title");
  const ovText = document.getElementById("ov-text");
  const playBtn = document.getElementById("play");

  // ---------- Input ----------
  const keys = new Set();
  const mouse = { x: W / 2, y: H / 2, down: false };

  window.addEventListener("keydown", (e) => {
    keys.add(e.code);
    if (e.code === "KeyR" && state.running !== null) startGame();
    if (e.code.startsWith("Arrow") || e.code === "Space") e.preventDefault();
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

  playBtn.addEventListener("click", startGame);

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
  const shuffle = (arr) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };

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
  const state = {
    running: null, // null = never started, true = playing, false = ended
    entities: [],
    bullets: [],
    particles: [],
    feed: [],
    countdown: 0,
    playerKills: 0,
    over: false,
    endTimer: 0,
  };

  function makeEntity(id, name, color, spawn, isPlayer) {
    return {
      id, name, color, isPlayer,
      x: spawn.x, y: spawn.y,
      px: spawn.x, py: spawn.y,
      vx: 0, vy: 0,
      angle: Math.atan2(H / 2 - spawn.y, W / 2 - spawn.x),
      alive: true,
      cooldown: 0,
      muzzle: 0,
      ai: isPlayer ? null : {
        waypoint: randomOpenPoint(),
        targetId: null,
        reaction: 0,
        strafeDir: Math.random() < 0.5 ? 1 : -1,
        strafeTimer: rand(0.6, 1.4),
        stuckTimer: 0,
        stuckFrom: { x: spawn.x, y: spawn.y },
        accuracy: rand(0.05, 0.12), // max aim error in radians
        fireRate: rand(0.55, 0.85),
      },
    };
  }

  function startGame() {
    const spawns = shuffle(SPAWNS.slice());
    state.entities = [makeEntity(0, "You", "#3ddc84", spawns[0], true)];
    BOT_DEFS.forEach((b, i) => {
      state.entities.push(makeEntity(i + 1, "Bot " + b.name, b.color, spawns[i + 1], false));
    });
    state.bullets = [];
    state.particles = [];
    state.feed = [];
    feedEl.innerHTML = "";
    state.countdown = COUNTDOWN;
    state.playerKills = 0;
    state.over = false;
    state.running = true;
    overlay.classList.add("hidden");
    bannerEl.innerHTML = "";
    updateHud();
  }

  const player = () => state.entities[0];
  const alive = () => state.entities.filter((e) => e.alive);

  // ---------- Combat ----------
  function shoot(e, spread) {
    const a = e.angle + rand(-spread, spread);
    const muzzleDist = RADIUS + 8;
    state.bullets.push({
      x: e.x + Math.cos(a) * muzzleDist,
      y: e.y + Math.sin(a) * muzzleDist,
      vx: Math.cos(a) * BULLET_SPEED,
      vy: Math.sin(a) * BULLET_SPEED,
      owner: e.id,
      life: BULLET_LIFE,
      color: e.color,
    });
    e.muzzle = 0.06;
  }

  function kill(victim, killer) {
    victim.alive = false;
    for (let i = 0; i < 26; i++) {
      const a = rand(0, Math.PI * 2), s = rand(60, 260);
      state.particles.push({
        x: victim.x, y: victim.y,
        vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: rand(0.4, 0.9), max: 0.9,
        color: victim.color,
      });
    }
    if (killer.isPlayer) state.playerKills++;
    addFeed(`<b style="color:${killer.color}">${killer.name}</b> eliminated <b style="color:${victim.color}">${victim.name}</b>`);

    if (victim.isPlayer) {
      bannerEl.innerHTML = `<span style="color:#ff6b6b">ELIMINATED</span><small>Shot by ${killer.name} · spectating · press R to restart</small>`;
    }
    updateHud();
    checkEnd();
  }

  function checkEnd() {
    const left = alive();
    if (left.length > 1 || state.over) return;
    state.over = true;
    state.endTimer = 1.2;
    const winner = left[0];
    if (winner && winner.isPlayer) {
      ovTitle.textContent = "Victory!";
      ovTitle.style.color = "#3ddc84";
      ovText.innerHTML = `You were the last one standing with <b>${state.playerKills}</b> kill${state.playerKills === 1 ? "" : "s"}.`;
    } else {
      ovTitle.textContent = "Defeat";
      ovTitle.style.color = "#ff6b6b";
      ovText.innerHTML = `${winner ? `<b style="color:${winner.color}">${winner.name}</b> won the round.` : "Nobody survived."} You got <b>${state.playerKills}</b> kill${state.playerKills === 1 ? "" : "s"}.`;
    }
    playBtn.textContent = "Play again";
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
    aliveEl.textContent = `Alive: ${alive().length}`;
    killsEl.textContent = `Kills: ${state.playerKills}`;
  }

  // ---------- Update ----------
  function updatePlayer(p, dt, canFire) {
    let mx = 0, my = 0;
    if (keys.has("KeyW") || keys.has("ArrowUp")) my -= 1;
    if (keys.has("KeyS") || keys.has("ArrowDown")) my += 1;
    if (keys.has("KeyA") || keys.has("ArrowLeft")) mx -= 1;
    if (keys.has("KeyD") || keys.has("ArrowRight")) mx += 1;
    const len = Math.hypot(mx, my) || 1;
    p.x += (mx / len) * PLAYER_SPEED * dt;
    p.y += (my / len) * PLAYER_SPEED * dt;
    p.angle = Math.atan2(mouse.y - p.y, mouse.x - p.x);
    if (canFire && mouse.down && p.cooldown <= 0) {
      shoot(p, 0.02);
      p.cooldown = PLAYER_COOLDOWN;
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

  function updateBullets(dt) {
    for (const b of state.bullets) {
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
        spark(x1 + (x2 - x1) * hitEntity.t, y1 + (y2 - y1) * hitEntity.t, "#fff");
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
    for (let i = 0; i < 6; i++) {
      const a = rand(0, Math.PI * 2), s = rand(40, 160);
      state.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.25, max: 0.25, color });
    }
  }

  function update(dt) {
    if (!state.running) return;

    if (state.countdown > 0) state.countdown -= dt;
    const canFire = state.countdown <= 0 && !state.over;

    const living = alive();
    for (const e of living) {
      e.px = e.x; e.py = e.y;
      e.cooldown -= dt;
      e.muzzle -= dt;
      if (state.countdown > 0) continue; // frozen during countdown
      if (e.isPlayer) updatePlayer(e, dt, canFire);
      else updateBot(e, dt, canFire);
    }
    // During countdown the player can still aim
    if (state.countdown > 0 && player().alive) {
      const p = player();
      p.angle = Math.atan2(mouse.y - p.y, mouse.x - p.x);
    }

    resolveEntityOverlap(living);
    for (const e of living) {
      resolveWalls(e);
      e.vx = dt > 0 ? (e.x - e.px) / dt : 0;
      e.vy = dt > 0 ? (e.y - e.py) / dt : 0;
    }

    updateBullets(dt);

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
        bannerEl.innerHTML = "";
        overlay.classList.remove("hidden");
      }
    }
  }

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
    for (const r of WALLS) {
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.fillRect(r.x + 5, r.y + 6, r.w, r.h);
      ctx.fillStyle = "#4a5468";
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = "#6b7790";
      ctx.lineWidth = 2;
      ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
    }
  }

  function drawEntity(e) {
    ctx.save();
    ctx.translate(e.x, e.y);

    // shadow
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath();
    ctx.ellipse(3, 5, RADIUS, RADIUS * 0.8, 0, 0, Math.PI * 2);
    ctx.fill();

    // gun
    ctx.rotate(e.angle);
    ctx.fillStyle = "#c9d1e0";
    ctx.fillRect(4, -3.5, RADIUS + 10, 7);
    ctx.strokeStyle = "#11141b";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(4, -3.5, RADIUS + 10, 7);
    if (e.muzzle > 0) {
      ctx.fillStyle = "#ffe08a";
      ctx.beginPath();
      ctx.arc(RADIUS + 16, 0, 6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.rotate(-e.angle);

    // body
    ctx.fillStyle = e.color;
    ctx.beginPath();
    ctx.arc(0, 0, RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = e.isPlayer ? 3 : 2;
    ctx.strokeStyle = e.isPlayer ? "#fff" : "rgba(0,0,0,0.5)";
    ctx.stroke();
    ctx.restore();

    // name tag
    ctx.font = "bold 12px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillText(e.isPlayer ? "YOU" : e.name, e.x + 1, e.y - RADIUS - 7);
    ctx.fillStyle = e.isPlayer ? "#fff" : e.color;
    ctx.fillText(e.isPlayer ? "YOU" : e.name, e.x, e.y - RADIUS - 8);
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
    drawWalls();
    drawParticles();
    for (const e of state.entities) if (e.alive) drawEntity(e);
    drawBullets();
    drawCountdown();
  }

  // ---------- Loop ----------
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
