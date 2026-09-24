// Main orchestration: physics setup, leg lifecycle, elimination, rendering,
// timers and the leaderboard. See SPEC.md for the full design.
//
// Time: everything is driven by a fixed-step simulation clock (STEP_MS per
// physics step). Game speed just runs more steps per frame, pausing stops the
// clock, and the timers shown on screen are simulation time, so they are
// consistent at any speed and the whole game can be run headless in a test loop.

const BALL_RADIUS = 5;
const STALL_MS = 8000;
const SPAWN_PER_STEP = 25;
const MAX_BALL_SPEED = 22; // safety clamp: attractor/repulsor fields with little
                            // damping can otherwise pump velocity without bound
const NUDGE_AFTER_MS = 1200;  // a ball this long below NUDGE_SPEED gets a small sideways hop
const NUDGE_SPEED = 0.12;
const STEP_MS = 1000 / 60;    // fixed physics step
const MAX_STEPS_PER_FRAME = 16;
const FRAME_BUDGET_MS = 12;   // stop simulating for this frame after this long, so fast-forward never freezes the page
const LEG_GAP_MS = 1500;      // pause between legs
const MAX_RAYS = 250;

const canvas = document.getElementById('field');
const ctx = canvas.getContext('2d');
const W = canvas.width;
const H = canvas.height;

const legNameEl = document.getElementById('leg-name');
const legTimeEl = document.getElementById('leg-time');
const clockEl = document.getElementById('clock');
const winnerOverlay = document.getElementById('winner-overlay');
const winnerCard = document.getElementById('winner-card');
const winnerText = document.getElementById('winner-text');
const winnerSub = document.getElementById('winner-sub');
const pauseBtn = document.getElementById('pause-btn');
const pauseBadge = document.getElementById('pause-badge');
const speedSeg = document.getElementById('speedSeg');
const fullscreenBtn = document.getElementById('fullscreen-btn');
const gameMain = document.getElementById('game-main');
const binsContainer = document.getElementById('bins');
const lbList = document.getElementById('lb-list');
const legLogEl = document.getElementById('leg-log');

const engine = Matter.Engine.create({ enableSleeping: false });
const world = engine.world;
const BALL_GROUP = -1;

// Permanent invisible side walls. Without these, any ball that picks up
// lateral drift (e.g. bounced off an angled wall) just keeps drifting until
// it exits the canvas — and the only thing waiting for it was the
// out-of-bounds safety net, teleporting it back to the release point. That
// was firing thousands of times a leg on some levels, which read as balls
// "regenerating at the top" rather than a rare fallback. Real walls mean
// balls simply bounce back in, and recycling stays a true last resort.
const WALL_MARGIN = 250;
Matter.World.add(world, [
  Matter.Bodies.rectangle(-WALL_MARGIN, H / 2, WALL_MARGIN * 2, H * 4, { isStatic: true, frictionStatic: 0 }),
  Matter.Bodies.rectangle(W + WALL_MARGIN, H / 2, WALL_MARGIN * 2, H * 4, { isStatic: true, frictionStatic: 0 }),
]);

// ---- game state --------------------------------------------------------------

let gameCfg = null;          // the settings this game was started with
let playing = [];            // palette entries in play (labels = chosen names)
let paletteById = {};
let bins = null;
let activeColours = [];
let legOrder = [];
let legIndex = 0;
let allocation = 0;
let spawnQueue = [];
let balls = [];
let rays = [];
let currentLevel = null;
let currentLevelRuntime = null;
let collectionZone = { type: 'line', y: H * 0.85 };

let running = false;         // a game is on screen
let paused = false;
let gameOver = false;
let transitioning = false;
let transitionLeft = 0;
let speed = 1;
let gameTime = 0;            // sim ms since the game started
let legTime = 0;             // sim ms since the current leg started
let lastCollectionTime = 0;  // in legTime
let lastJitterTime = -Infinity;
let results = [];            // one entry per eliminated colour: { id, leg, legMs }
let winnerId = null;

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function fmtTime(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const mmss = `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
  return h ? `${h}:${mmss}` : mmss;
}

// ---- release -----------------------------------------------------------------

function releasePoint() {
  const r = currentLevel.release;
  if (r.type === 'point') {
    return {
      x: r.x * W + (Math.random() - 0.5) * (r.jitterX ?? 20),
      y: r.y * H + (Math.random() - 0.5) * (r.jitterY ?? 20),
    };
  }
  const xMin = (r.xMin ?? 0) * W, xMax = (r.xMax ?? 1) * W;
  if (r.type === 'area') {
    const yMin = (r.yMin ?? 0) * H, yMax = (r.yMax ?? 1) * H;
    return { x: xMin + Math.random() * (xMax - xMin), y: yMin + Math.random() * (yMax - yMin) };
  }
  return { x: xMin + Math.random() * (xMax - xMin), y: r.y * H + Math.random() * H * 0.03 };
}

// ---- game lifecycle ----------------------------------------------------------

function clearLeg() {
  if (currentLevelRuntime) {
    Matter.World.remove(world, currentLevelRuntime.bodies);
    currentLevelRuntime = null;
  }
  for (const b of balls) Matter.World.remove(world, b);
  balls = [];
  rays = [];
  spawnQueue = [];
}

// cfg: { colours: [ids], names: {id: name}, totalBalls, order: 'fixed'|'shuffled', speed }
function startGame(cfg) {
  gameCfg = cfg;
  clearLeg();

  playing = PALETTE
    .filter((c) => cfg.colours.includes(c.id))
    .map((c) => ({ ...c, label: (cfg.names && cfg.names[c.id] || '').trim() || c.label }));
  paletteById = Object.fromEntries(playing.map((c) => [c.id, c]));
  bins = new Bins(binsContainer, playing);
  activeColours = playing.map((c) => c.id);

  legOrder = LEVELS.map((_, i) => i);
  if (cfg.order === 'shuffled') shuffle(legOrder);
  legIndex = 0;

  gameTime = 0;
  legTime = 0;
  results = [];
  winnerId = null;
  gameOver = false;
  transitioning = false;
  setPaused(false);
  winnerOverlay.classList.add('hidden');
  setSpeed(cfg.speed || 1);

  running = true;
  startLeg();
}

function startLeg() {
  clearLeg();

  allocation = Math.floor(gameCfg.totalBalls / activeColours.length);
  bins.startLeg(activeColours, allocation);

  currentLevel = LEVELS[legOrder[legIndex % legOrder.length]];
  engine.world.gravity.x = currentLevel.gravity.x;
  engine.world.gravity.y = currentLevel.gravity.y;
  currentLevelRuntime = currentLevel.build(Matter, world, W, H);

  const c = currentLevel.collection;
  collectionZone = c.type === 'line'
    ? { type: 'line', y: c.y * H }
    : { type: 'circle', x: c.x * W, y: c.y * H, r: c.r * Math.min(W, H) };

  spawnQueue = shuffle(activeColours.flatMap((id) => Array(allocation).fill(id)));

  legNameEl.textContent = `LEG ${legIndex + 1}`;
  legTime = 0;
  lastCollectionTime = 0;
  lastJitterTime = -Infinity;
  transitioning = false;
  updateLeaderboard();
}

function spawnBatch() {
  const n = Math.min(SPAWN_PER_STEP, spawnQueue.length);
  for (let i = 0; i < n; i++) {
    const colourId = spawnQueue.pop();
    const p = releasePoint();
    const ball = Matter.Bodies.circle(p.x, p.y, BALL_RADIUS, {
      restitution: 0.3,
      friction: 0.02,
      frictionStatic: 0,
      frictionAir: currentLevel.frictionAir ?? 0.001,
      collisionFilter: { group: BALL_GROUP },
    });
    ball.colourId = colourId;
    Matter.World.add(world, ball);
    balls.push(ball);
  }
}

// ---- per-step physics helpers ------------------------------------------------

function applyFields() {
  const fields = currentLevelRuntime && currentLevelRuntime.fields;
  if (!fields || !fields.length) return;
  for (const b of balls) {
    for (const f of fields) {
      const dx = f.x - b.position.x, dy = f.y - b.position.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      if (f.radius && dist > f.radius) continue;
      const nx = dx / dist, ny = dy / dist;
      const sign = f.kind === 'repel' ? -1 : 1;
      // Bounded falloff (not inverse-distance): stays meaningfully strong even
      // far from the field centre, since Matter's applyForce is mass-scaled
      // and a 1/dist curve made the pull vanish at any real on-screen distance.
      const t = f.radius ? Math.max(0, 1 - dist / f.radius) : 1;
      const falloff = 0.3 + 0.7 * t;
      const pull = f.strength || 0;
      let fx = sign * nx * pull * falloff;
      let fy = sign * ny * pull * falloff;
      if (f.tangential) {
        // innerFade: the swirl dies away close to the centre, so balls that
        // reach a collector there aren't flung back out by centripetal effects.
        const tf = f.tangential * falloff * (f.innerFade ? Math.min(1, dist / f.innerFade) : 1);
        fx += -ny * tf;
        fy += nx * tf;
      }
      Matter.Body.applyForce(b, b.position, { x: fx, y: fy });
    }
  }
}

function binTargetX(colourId) {
  const el = bins.els[colourId];
  const binRect = el.getBoundingClientRect();
  const canvasRect = canvas.getBoundingClientRect();
  if (canvasRect.width === 0) return W / 2;
  const scale = W / canvasRect.width;
  return (binRect.left + binRect.width / 2 - canvasRect.left) * scale;
}

function checkCollection() {
  const renderNow = performance.now();
  for (let i = balls.length - 1; i >= 0; i--) {
    const b = balls[i];
    let hit = false;
    if (collectionZone.type === 'line') {
      hit = b.position.y >= collectionZone.y;
    } else {
      const dx = b.position.x - collectionZone.x, dy = b.position.y - collectionZone.y;
      hit = dx * dx + dy * dy <= collectionZone.r * collectionZone.r;
    }
    if (hit) {
      Matter.World.remove(world, b);
      balls.splice(i, 1);
      bins.collect(b.colourId);
      if (rays.length < MAX_RAYS) {
        rays.push({ x: b.position.x, y: b.position.y, colourId: b.colourId, start: renderNow, targetX: null });
      }
      lastCollectionTime = legTime;
    }
  }
}

function clampSpeeds() {
  for (const b of balls) {
    const sx = b.velocity.x, sy = b.velocity.y;
    const speed2 = sx * sx + sy * sy;
    if (speed2 > MAX_BALL_SPEED * MAX_BALL_SPEED) {
      const s = MAX_BALL_SPEED / Math.sqrt(speed2);
      Matter.Body.setVelocity(b, { x: sx * s, y: sy * s });
    }
  }
}

// Per-ball unstick, opt-in per level (level.nudgeStuck). The global stall
// jitter only fires when NOTHING is being collected, so a handful of balls
// wedged on pegs could sit for 100s+ while a trickle of others kept resetting
// its timer. This nudges just the balls that are actually stuck. Not used on
// levels where balls are meant to wait (e.g. Leg 1's pillars).
function nudgeStuckBalls(dt) {
  if (!currentLevel || !currentLevel.nudgeStuck) return;
  for (const b of balls) {
    const v2 = b.velocity.x * b.velocity.x + b.velocity.y * b.velocity.y;
    if (v2 < NUDGE_SPEED * NUDGE_SPEED) {
      b.stillMs = (b.stillMs || 0) + dt;
      if (b.stillMs > NUDGE_AFTER_MS) {
        Matter.Body.applyForce(b, b.position, { x: (Math.random() - 0.5) * 0.0012, y: -0.0003 });
        b.stillMs = 0;
      }
    } else {
      b.stillMs = 0;
    }
  }
}

function recycleStray() {
  // Well beyond the boundary walls (WALL_MARGIN) — this should now only
  // ever fire for a ball that tunnels through those walls entirely or one
  // genuinely flung off the top/bottom, not as routine traffic.
  const margin = WALL_MARGIN + 100;
  for (const b of balls) {
    if (b.position.x < -margin || b.position.x > W + margin || b.position.y < -margin || b.position.y > H + margin) {
      const p = releasePoint();
      Matter.Body.setPosition(b, p);
      Matter.Body.setVelocity(b, { x: 0, y: 0 });
    }
  }
}

function checkStall() {
  // Applies a gentle random shake to every ball when nothing has been
  // collected for STALL_MS. Force is deliberately small: Matter's applyForce
  // is mass-scaled and the real force-to-velocity multiplier is far larger
  // than it looks (0.02 launched balls off-canvas in a single frame).
  if (balls.length === 0) return;
  if (legTime - lastCollectionTime > STALL_MS && legTime - lastJitterTime > STALL_MS) {
    for (const b of balls) {
      Matter.Body.applyForce(b, b.position, {
        x: (Math.random() - 0.5) * 0.004,
        y: (Math.random() - 0.5) * 0.004 - 0.0015,
      });
    }
    lastJitterTime = legTime;
  }
}

function checkLegEnd() {
  if (transitioning || activeColours.length <= 1) return;
  const incomplete = activeColours.filter((id) => !bins.isComplete(id));
  // Normally exactly one colour is still short when the leg ends. But the
  // last colours can also finish in the same step (dense waves of balls, as
  // in the vortex), leaving nobody incomplete — previously that meant no
  // loser was ever found and the game hung forever. In that case the colour
  // that finished last is the one eliminated.
  if (incomplete.length <= 1) {
    transitioning = true;
    transitionLeft = LEG_GAP_MS;
    const loserId = incomplete.length === 1
      ? incomplete[0]
      : activeColours.reduce((a, b) => (bins.completedSeq[b] > bins.completedSeq[a] ? b : a));
    for (const b of balls) Matter.World.remove(world, b);
    balls = [];
    spawnQueue = [];
    bins.eliminate(loserId);
    activeColours = activeColours.filter((id) => id !== loserId);
    results.push({ id: loserId, leg: legIndex + 1, legMs: legTime });

    if (activeColours.length === 1) {
      gameOver = true;
      winnerId = activeColours[0];
      showWinner(winnerId);
    } else {
      legIndex++;
    }
    updateLeaderboard();
  }
}

// One fixed physics step of the whole game.
function stepGame() {
  gameTime += STEP_MS;
  if (transitioning) {
    transitionLeft -= STEP_MS;
    if (transitionLeft <= 0 && !gameOver) startLeg();
    return;
  }
  legTime += STEP_MS;
  if (spawnQueue.length > 0) spawnBatch();
  if (currentLevelRuntime) currentLevelRuntime.update(legTime);
  applyFields();
  Matter.Engine.update(engine, STEP_MS);
  clampSpeeds();
  nudgeStuckBalls(STEP_MS);
  checkCollection();
  recycleStray();
  checkStall();
  checkLegEnd();
}

// ---- winner ------------------------------------------------------------------

function showWinner(id) {
  const colour = paletteById[id];
  winnerCard.style.background = colour.ball;
  winnerCard.style.color = '#111';
  winnerText.textContent = colour.label;
  const legs = results.length;
  winnerSub.textContent = `Last colour standing after ${legs} leg${legs === 1 ? '' : 's'} · ${fmtTime(gameTime)}`;
  winnerOverlay.classList.remove('hidden');
}

// ---- leaderboard -------------------------------------------------------------

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function updateLeaderboard() {
  if (!bins) return;

  // Survivors first, ranked on the current leg (a colour that has filled its
  // bin outranks one still filling, earliest finisher first); then the
  // eliminated colours, latest exit highest.
  const alive = activeColours.slice().sort((a, b) => {
    const seqA = bins.completedSeq[a], seqB = bins.completedSeq[b];
    if (seqA !== undefined || seqB !== undefined) {
      if (seqA === undefined) return 1;
      if (seqB === undefined) return -1;
      if (seqA !== seqB) return seqA - seqB;
    }
    return bins.count(b) - bins.count(a);
  });
  const order = alive.map((id) => ({ id, out: false }));
  for (let i = results.length - 1; i >= 0; i--) order.push({ id: results[i].id, out: true, leg: results[i].leg });

  const rows = order.map((o, rank) => {
    const c = paletteById[o.id];
    const li = el('li', 'lb-row' + (o.out ? ' out' : ''));
    li.append(el('span', 'lb-rank', rank + 1));
    const sw = el('span', 'lb-sw');
    sw.style.background = c.ball;
    li.append(sw);
    const nm = el('span', 'lb-name', c.label);
    nm.title = c.label;
    li.append(nm);
    if (o.out) {
      li.append(el('span', 'lb-n', `out · Leg ${o.leg}`));
    } else if (gameOver && o.id === winnerId) {
      li.append(el('span', 'lb-n lb-win', '\u{1F3C6} winner'));
    } else {
      const n = bins.count(o.id);
      const done = allocation > 0 && n >= allocation;
      li.append(el('span', 'lb-n', done ? '✓ full' : `${n} / ${allocation}`));
      li.style.setProperty('--pct', `${allocation ? Math.min(100, (n / allocation) * 100) : 0}%`);
      li.style.setProperty('--lb-colour', c.ball);
    }
    return li;
  });
  lbList.replaceChildren(...rows);

  const log = results.map((r) => {
    const li = el('li', 'log-row');
    li.append(el('span', 'log-leg', `Leg ${r.leg}`));
    li.append(el('span', 'log-time', fmtTime(r.legMs)));
    const out = el('span', 'log-out');
    const sw = el('span', 'lb-sw');
    sw.style.background = paletteById[r.id].ball;
    out.append(sw, document.createTextNode(paletteById[r.id].label));
    li.append(out);
    return li;
  });
  if (!gameOver && running) {
    const li = el('li', 'log-row current');
    li.append(el('span', 'log-leg', `Leg ${legIndex + 1}`));
    li.append(el('span', 'log-time', fmtTime(legTime)));
    li.append(el('span', 'log-out', 'in progress'));
    log.push(li);
  }
  legLogEl.replaceChildren(...log);
}

// ---- render ------------------------------------------------------------------

function render(now) {
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = currentLevel ? currentLevel.background : '#000';
  ctx.fillRect(0, 0, W, H);
  if (!running) return;

  if (currentLevelRuntime) currentLevelRuntime.draw(ctx);

  ctx.strokeStyle = '#aef542';
  ctx.lineWidth = 4;
  if (collectionZone.type === 'line') {
    ctx.beginPath();
    ctx.moveTo(0, collectionZone.y);
    ctx.lineTo(W, collectionZone.y);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.arc(collectionZone.x, collectionZone.y, collectionZone.r, 0, Math.PI * 2);
    ctx.stroke();
  }

  rays = rays.filter((r) => now - r.start < 400);
  ctx.lineWidth = 2;
  for (const r of rays) {
    if (r.targetX === null) r.targetX = binTargetX(r.colourId);
    ctx.globalAlpha = 1 - (now - r.start) / 400;
    ctx.strokeStyle = paletteById[r.colourId].ball;
    ctx.beginPath();
    ctx.moveTo(r.x, r.y);
    ctx.lineTo(r.targetX, H);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // One path and one fill per colour instead of one per ball.
  const byColour = {};
  for (const b of balls) (byColour[b.colourId] || (byColour[b.colourId] = [])).push(b);
  for (const id in byColour) {
    ctx.fillStyle = paletteById[id].ball;
    ctx.beginPath();
    for (const b of byColour[id]) {
      ctx.moveTo(b.position.x + BALL_RADIUS, b.position.y);
      ctx.arc(b.position.x, b.position.y, BALL_RADIUS, 0, Math.PI * 2);
    }
    ctx.fill();
  }
}

// ---- main loop ---------------------------------------------------------------

let lastFrameTime = 0;
let acc = 0;
let lastLeaderboard = 0;
let shownClock = '';
let shownLeg = '';

function loop(now) {
  let dt = lastFrameTime ? Math.min(50, now - lastFrameTime) : STEP_MS;
  lastFrameTime = now;
  // A 60Hz display delivers frames a hair off 16.667ms; snap those so the
  // accumulator doesn't occasionally give a frame zero steps and the next two.
  if (Math.abs(dt - STEP_MS) < 2) dt = STEP_MS;

  if (running && !paused && !gameOver) {
    acc += dt * speed;
    const t0 = performance.now();
    let n = 0;
    while (acc >= STEP_MS && n < MAX_STEPS_PER_FRAME) {
      stepGame();
      acc -= STEP_MS;
      n++;
      if (performance.now() - t0 > FRAME_BUDGET_MS) { acc = Math.min(acc, STEP_MS); break; }
    }
  }

  if (running) {
    if (bins) bins.flush();
    const clock = fmtTime(gameTime), leg = fmtTime(legTime);
    if (clock !== shownClock) { shownClock = clock; clockEl.textContent = clock; }
    if (leg !== shownLeg) { shownLeg = leg; legTimeEl.textContent = leg; }
    if (now - lastLeaderboard > 250) {
      lastLeaderboard = now;
      updateLeaderboard();
    }
  }

  render(now);
  requestAnimationFrame(loop);
}

// ---- controls ----------------------------------------------------------------

function setPaused(p) {
  paused = p;
  pauseBtn.innerHTML = paused ? '&#9654;' : '&#10074;&#10074;';
  pauseBtn.title = paused ? 'Resume' : 'Pause';
  pauseBadge.hidden = !paused;
}

function setSpeed(s) {
  speed = s;
  for (const b of speedSeg.querySelectorAll('button')) {
    b.classList.toggle('on', Number(b.dataset.speed) === s);
  }
}

pauseBtn.addEventListener('click', () => setPaused(!paused));
speedSeg.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-speed]');
  if (b) setSpeed(Number(b.dataset.speed));
});

fullscreenBtn.addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else gameMain.requestFullscreen();
});

requestAnimationFrame(loop);
