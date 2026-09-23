// Main orchestration: physics setup, leg lifecycle, elimination, rendering.
// See SPEC.md for the full design.

const TOTAL_BALLS = 2500;
const BALL_RADIUS = 5;
const STALL_MS = 8000;
const SPAWN_PER_FRAME = 25;
const MAX_BALL_SPEED = 22; // safety clamp: attractor/repulsor fields with little
                            // damping can otherwise pump velocity without bound
const PHYSICS_SUBSTEPS = 4;

const canvas = document.getElementById('field');
const ctx = canvas.getContext('2d');
const W = canvas.width;
const H = canvas.height;

const legTitleEl = document.getElementById('leg-title');
const startOverlay = document.getElementById('start-overlay');
const startBtn = document.getElementById('start-btn');
const winnerOverlay = document.getElementById('winner-overlay');
const winnerText = document.getElementById('winner-text');
const pauseBtn = document.getElementById('pause-btn');
const fullscreenBtn = document.getElementById('fullscreen-btn');
const gameFrame = document.getElementById('game-frame');
const binsContainer = document.getElementById('bins');

const palette = PALETTE;
const paletteById = Object.fromEntries(palette.map((c) => [c.id, c]));
const bins = new Bins(binsContainer, palette);

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
  Matter.Bodies.rectangle(-WALL_MARGIN, H / 2, WALL_MARGIN * 2, H * 4, { isStatic: true }),
  Matter.Bodies.rectangle(W + WALL_MARGIN, H / 2, WALL_MARGIN * 2, H * 4, { isStatic: true }),
]);

let activeColours = palette.map((c) => c.id);
let legIndex = 0;
let allocation = 0;
let spawnQueue = [];
let balls = [];
let rays = [];
let currentLevel = null;
let currentLevelRuntime = null;
let collectionZone = { type: 'line', y: H * 0.85 };

let started = false;
let paused = false;
let gameOver = false;
let transitioning = false;
let legStartTime = 0;
let lastCollectionTime = 0;
let lastJitterTime = -Infinity;
let lastFrameTime = 0;

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function releasePoint() {
  const r = currentLevel.release;
  if (r.type === 'point') {
    return {
      x: r.x * W + (Math.random() - 0.5) * (r.jitterX ?? 20),
      y: r.y * H + (Math.random() - 0.5) * (r.jitterY ?? 20),
    };
  }
  const xMin = (r.xMin ?? 0) * W, xMax = (r.xMax ?? 1) * W;
  return { x: xMin + Math.random() * (xMax - xMin), y: r.y * H + Math.random() * H * 0.03 };
}

function startLeg() {
  if (currentLevelRuntime) {
    Matter.World.remove(world, currentLevelRuntime.bodies);
    currentLevelRuntime = null;
  }
  for (const b of balls) Matter.World.remove(world, b);
  balls = [];
  rays = [];

  allocation = Math.floor(TOTAL_BALLS / activeColours.length);
  bins.startLeg(activeColours, allocation);

  currentLevel = LEVELS[legIndex % LEVELS.length];
  engine.world.gravity.x = currentLevel.gravity.x;
  engine.world.gravity.y = currentLevel.gravity.y;
  currentLevelRuntime = currentLevel.build(Matter, world, W, H);

  const c = currentLevel.collection;
  collectionZone = c.type === 'line'
    ? { type: 'line', y: c.y * H }
    : { type: 'circle', x: c.x * W, y: c.y * H, r: c.r * Math.min(W, H) };

  spawnQueue = shuffle(activeColours.flatMap((id) => Array(allocation).fill(id)));

  legTitleEl.textContent = `LEG ${legIndex + 1}`;
  legStartTime = performance.now();
  lastCollectionTime = legStartTime;
  lastJitterTime = -Infinity;
  transitioning = false;
}

function spawnBatch() {
  const n = Math.min(SPAWN_PER_FRAME, spawnQueue.length);
  for (let i = 0; i < n; i++) {
    const colourId = spawnQueue.pop();
    const p = releasePoint();
    const ball = Matter.Bodies.circle(p.x, p.y, BALL_RADIUS, {
      restitution: 0.3,
      friction: 0.02,
      frictionAir: currentLevel.frictionAir ?? 0.001,
      collisionFilter: { group: BALL_GROUP },
    });
    ball.colourId = colourId;
    Matter.World.add(world, ball);
    balls.push(ball);
  }
}

function applyFields(now) {
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
      let fx = sign * nx * f.strength * falloff;
      let fy = sign * ny * f.strength * falloff;
      if (f.tangential) {
        fx += -ny * f.tangential * falloff;
        fy += nx * f.tangential * falloff;
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

function checkCollection(now) {
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
      rays.push({ x: b.position.x, y: b.position.y, targetX: binTargetX(b.colourId), colourId: b.colourId, start: now });
      lastCollectionTime = now;
    }
  }
}

function clampSpeeds() {
  for (const b of balls) {
    const sx = b.velocity.x, sy = b.velocity.y;
    const speed = Math.sqrt(sx * sx + sy * sy);
    if (speed > MAX_BALL_SPEED) {
      const s = MAX_BALL_SPEED / speed;
      Matter.Body.setVelocity(b, { x: sx * s, y: sy * s });
    }
  }
}

function recycleStray(now) {
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

function checkStall(now) {
  // This force was calibrated under the same wrong force-to-velocity
  // assumption later corrected for the attractor/repulsor fields (Matter's
  // applyForce is mass-scaled and the real multiplier is far larger than it
  // looks). At 0.02 this was applying to every ball in play at once and
  // launching a large fraction of them at extreme, off-screen-in-one-frame
  // speed — a handful of stall firings account for thousands of the
  // "balls flung off-canvas" events seen in Level 3 testing. Scaled down
  // ~30x to a genuine gentle nudge.
  if (balls.length === 0) return;
  if (now - lastCollectionTime > STALL_MS && now - lastJitterTime > STALL_MS) {
    for (const b of balls) {
      Matter.Body.applyForce(b, b.position, {
        x: (Math.random() - 0.5) * 0.004,
        y: (Math.random() - 0.5) * 0.004 - 0.0015,
      });
    }
    lastJitterTime = now;
  }
}

function checkLegEnd() {
  if (transitioning || activeColours.length <= 1) return;
  const completeIds = activeColours.filter((id) => bins.isComplete(id));
  if (completeIds.length === activeColours.length - 1) {
    transitioning = true;
    const loserId = activeColours.find((id) => !bins.isComplete(id));
    for (const b of balls) Matter.World.remove(world, b);
    balls = [];
    spawnQueue = [];
    bins.eliminate(loserId);
    activeColours = activeColours.filter((id) => id !== loserId);

    if (activeColours.length === 1) {
      gameOver = true;
      showWinner(activeColours[0]);
    } else {
      legIndex++;
      setTimeout(startLeg, 1500);
    }
  }
}

function showWinner(id) {
  const colour = paletteById[id];
  winnerText.textContent = `${colour.label} wins!`;
  winnerText.style.background = colour.ball;
  winnerText.style.color = '#111';
  winnerOverlay.classList.remove('hidden');
}

function render(now) {
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = currentLevel ? currentLevel.background : '#000';
  ctx.fillRect(0, 0, W, H);

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
  for (const r of rays) {
    const age = (now - r.start) / 400;
    ctx.globalAlpha = 1 - age;
    ctx.strokeStyle = paletteById[r.colourId].ball;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(r.x, r.y);
    ctx.lineTo(r.targetX, H);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  for (const b of balls) {
    ctx.fillStyle = paletteById[b.colourId].ball;
    ctx.beginPath();
    ctx.arc(b.position.x, b.position.y, BALL_RADIUS, 0, Math.PI * 2);
    ctx.fill();
  }
}

function loop(now) {
  const dt = lastFrameTime ? Math.min(50, now - lastFrameTime) : 16.67;
  lastFrameTime = now;

  if (started && !paused && !gameOver) {
    if (spawnQueue.length > 0) spawnBatch();
    // Sub-step the physics AND the level's own wall movement together.
    // Moving the walls once per animation frame, then resolving physics
    // against that single static pose, meant a fast-moving wall (e.g. a
    // rotating flap) effectively teleported a whole frame's worth of
    // motion before any collision was resolved at the new position —
    // Matter would detect a ball deeply overlapping the wall's new pose
    // and fire off a large corrective impulse, launching it at extreme
    // speed. Advancing the wall by a fraction of the frame on each substep
    // keeps its motion — and any resulting collision — proportionally
    // small everywhere, not just where the physics substeps alone helped.
    const subDt = dt / PHYSICS_SUBSTEPS;
    const elapsedBefore = now - legStartTime - dt;
    for (let s = 1; s <= PHYSICS_SUBSTEPS; s++) {
      const subElapsed = elapsedBefore + subDt * s;
      if (currentLevelRuntime) currentLevelRuntime.update(subElapsed);
      applyFields(now);
      Matter.Engine.update(engine, subDt);
      clampSpeeds();
    }
    checkCollection(now);
    recycleStray(now);
    checkStall(now);
    checkLegEnd();
  }

  render(now);
  requestAnimationFrame(loop);
}

startBtn.addEventListener('click', () => {
  started = true;
  startOverlay.classList.add('hidden');
  startLeg();
});

pauseBtn.addEventListener('click', () => {
  paused = !paused;
  pauseBtn.innerHTML = paused ? '&#9654;' : '&#10074;&#10074;';
});

fullscreenBtn.addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else gameFrame.requestFullscreen();
});

requestAnimationFrame(loop);
