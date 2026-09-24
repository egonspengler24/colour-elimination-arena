// Level definitions. Each level is data-plus-behaviour: static config (gravity,
// collection zone, release pattern) plus a build() that creates the level's
// wall bodies and any attractor/repulsor fields, returning update/draw hooks.
// Kept in this shape deliberately (see SPEC.md §5.1) so a future level editor
// could generate the same structure.
//
// Shared engine contract (see js/game.js):
//   level.gravity          { x, y }
//   level.release           { type:'spread', xMin?, xMax?, y } | { type:'point', x, y }
//   level.collection        { type:'line', y } | { type:'circle', x, y, r }   (fractions of W/H)
//   level.build(Matter, world, W, H) -> {
//     update(t)            move walls/animate — called every tick
//     draw(ctx)             draw walls
//     bodies               [] all wall bodies (removed between legs)
//     fields               [] optional attractor/repulsor fields; each is
//                            { x, y, kind:'attract'|'repel', strength, radius, tangential? }
//                            update(t) is expected to mutate field.x/y in place for moving fields
//   }

// ---- shared helpers -------------------------------------------------------

function makeRect(Matter, world, x, y, w, h, opts = {}) {
  // frictionStatic 0: Matter uses the LARGER static friction of the two bodies in
  // contact, and its default 0.5 makes a ball grip and rest on any slope up to
  // ~26 degrees. That was the real cause of balls sitting motionless on pegs and
  // gentle ramps (long run times). With 0 they always keep sliding off.
  const body = Matter.Bodies.rectangle(x, y, w, h, { isStatic: true, frictionStatic: 0, ...opts });
  body.w = w; body.h = h;
  Matter.World.add(world, body);
  return body;
}

function drawRect(ctx, body, fill) {
  ctx.save();
  ctx.translate(body.position.x, body.position.y);
  ctx.rotate(body.angle);
  ctx.fillStyle = fill;
  ctx.fillRect(-body.w / 2, -body.h / 2, body.w, body.h);
  ctx.restore();
}

// Pegs are laid out symmetrically edge to edge: even rows have a peg ON each
// wall (xStart and xEnd), odd rows sit half a cell in from both. That means
// no vertical channel exists down either edge — an earlier layout started even
// and odd rows at different offsets from the left wall only, which left a
// clear fast lane down the left side (measured: the leftmost slice of the
// field held ~1-2% of balls mid-flight against ~6% if even).
function makePegField(Matter, world, { xStart, xEnd, yStart, rows, rowGap, radius, cols }) {
  const pegs = [];
  const cellW = (xEnd - xStart) / cols;
  for (let r = 0; r < rows; r++) {
    const y = yStart + r * rowGap;
    const offset = (r % 2) * (cellW / 2);
    for (let c = 0; c <= cols; c++) {
      const x = xStart + offset + c * cellW;
      if (x > xEnd + 0.5) continue;
      const peg = Matter.Bodies.circle(x, y, radius, { isStatic: true, frictionStatic: 0 });
      Matter.World.add(world, peg);
      peg.baseX = x; peg.baseY = y; peg.row = r; peg.col = c;
      pegs.push(peg);
    }
  }
  return pegs;
}

function drawPegs(ctx, pegs, fill) {
  ctx.fillStyle = fill;
  for (const b of pegs) {
    ctx.beginPath();
    ctx.arc(b.position.x, b.position.y, b.circleRadius, 0, Math.PI * 2);
    ctx.fill();
  }
}

// Very gentle continuous side-to-side drift, per-peg phase offset so
// neighbours don't all move in lockstep (that stops balls settling into a
// stable resting spot on a peg, which was causing long run times).
function wobblePegsX(Matter, pegs, t, amplitude, period, phaseStep = 0.35) {
  for (let i = 0; i < pegs.length; i++) {
    const p = pegs[i];
    // Pegs sitting on the side walls stay put: a wobbling peg half-buried in a
    // wall pins balls against it (measured: ~70 balls stuck there for 100s+).
    if (p.baseX < 1 || p.baseX > 1600 - 1) continue;
    const dx = Math.sin(t / period + i * phaseStep) * amplitude;
    Matter.Body.setPosition(p, { x: p.baseX + dx, y: p.baseY });
  }
}

// Rotates a rigid group of parts together around a shared pivot. Each part
// keeps a fixed offset/angle relative to the pivot at angle=0 ("rest pose");
// rotating the whole group by `angle` recomputes each part's position/angle
// from that rest pose. Used for anything that should tip/rotate as one piece
// (a V-funnel, a cup) rather than each wall moving independently.
function rotateRigidGroup(Matter, parts, pivot, angle) {
  const cos = Math.cos(angle), sin = Math.sin(angle);
  for (const p of parts) {
    const { x: ox, y: oy } = p.restOffset;
    const nx = ox * cos - oy * sin;
    const ny = ox * sin + oy * cos;
    Matter.Body.setPosition(p.body, { x: pivot.x + nx, y: pivot.y + ny });
    Matter.Body.setAngle(p.body, p.restAngle + angle);
  }
}

const WALL_BLUE = '#2f6fb0';

// ---- Level 1: Rising Pillars ----------------------------------------------
// Moving walls: paired segments per column oscillate together, leaving a
// travelling gap. Segments carry a tiny (~1deg) alternating tilt so balls
// landing on a flat top get nudged sideways instead of bouncing straight up
// and down forever (this was a real problem in the first playtest).
// Feedback: works well, no changes.

function buildRisingPillars(Matter, world, W, H) {
  const playTop = H * 0.09;
  const collectionY = H * 0.85;
  const span = collectionY - playTop;

  const numColumns = 12;
  const gap = 10;
  const colWidth = (W - gap * (numColumns + 1)) / numColumns;

  const blockHeight = span * 0.58;
  const travel = span - blockHeight;
  const upperSegHeight = blockHeight * 0.375;
  const gapHeight = blockHeight * 0.25;
  const lowerSegHeight = blockHeight * 0.375;
  const period = 4200;
  const tilt = (1 * Math.PI) / 180;

  const columns = [];
  for (let i = 0; i < numColumns; i++) {
    const cx = gap + i * (colWidth + gap) + colWidth / 2;
    const dir = i % 2 === 0 ? 1 : -1;
    const upper = makeRect(Matter, world, cx, playTop, colWidth, upperSegHeight);
    const lower = makeRect(Matter, world, cx, playTop, colWidth, lowerSegHeight);
    Matter.Body.setAngle(upper, dir * tilt);
    Matter.Body.setAngle(lower, dir * tilt);
    columns.push({ cx, upper, lower, phase: i * 0.55 });
  }

  function update(t) {
    for (const col of columns) {
      const wave = (Math.sin((t / period) * Math.PI * 2 + col.phase) + 1) / 2;
      const blockTopY = playTop + wave * travel;
      Matter.Body.setPosition(col.upper, { x: col.cx, y: blockTopY + upperSegHeight / 2 });
      Matter.Body.setPosition(col.lower, {
        x: col.cx,
        y: blockTopY + upperSegHeight + gapHeight + lowerSegHeight / 2,
      });
    }
  }

  function draw(ctx) {
    for (const col of columns) {
      drawRect(ctx, col.upper, WALL_BLUE);
      drawRect(ctx, col.lower, WALL_BLUE);
    }
  }

  return { update, draw, bodies: columns.flatMap((c) => [c.upper, c.lower]) };
}

// ---- Level 2: Bubble Field -------------------------------------------------
// Feedback: balls were resting on top of pegs (long run times) — pegs now
// drift gently side to side so nothing stays put.

function buildBubbleField(Matter, world, W, H) {
  const pegs = makePegField(Matter, world, {
    xStart: 0, xEnd: W, yStart: H * 0.1,
    rows: 8, rowGap: H * 0.09, radius: 33, cols: 12,
  });
  function update(t) { wobblePegsX(Matter, pegs, t, 12, 1900); }
  function draw(ctx) { drawPegs(ctx, pegs, WALL_BLUE); }
  return { update, draw, bodies: pegs };
}

// ---- Level 3: See-Saws -------------------------------------------------------
// History: a long free-pivoting shelf swung through the floor, and a long
// hinged flap version needed per-row angle clamping to stay on canvas and
// still read as strange. Feedback: use MORE but SHORTER see-saws, symmetric,
// alternating, at a higher speed.
//
// Five rows of short planks (8 across, 62% of a cell wide), each pivoting
// about its own centre; odd rows have an extra plank so the outer ones sit on
// the walls and no vertical channel stays open. A full tilt only moves a tip
// ~35px, so nothing can swing off-canvas or through the floor. Neighbouring
// planks tilt in opposite directions.
//
// The motion matters more than the geometry here. Measured: with a smooth sine
// tilt (and with longer planks) balls just rode the planks back and forth —
// the tilt reversed about as fast as a ball could slide off — and the leg took
// 80-130s or never finished. A real see-saw tilts, HOLDS, then flips, so the
// tilt is a squared-off wave (tanh of a sine): steep (35 degrees) with quick
// flips every ~1.3s and a hold long enough for balls to slide off. Result:
// 34-45s across repeated runs, no stall jitters, even landing spread.

function buildSeeSaws(Matter, world, W, H) {
  const rowYs = [0.16, 0.31, 0.46, 0.61, 0.76].map((f) => f * H);
  const cols = 8;
  const cell = W / cols;
  const plankLen = cell * 0.62;
  const tiltMax = (35 * Math.PI) / 180;
  const period = 2600;
  const sharpness = 4;
  const planks = [];
  rowYs.forEach((y, r) => {
    const odd = r % 2 === 1;
    const count = odd ? cols + 1 : cols;
    for (let i = 0; i < count; i++) {
      const x = odd ? i * cell : (i + 0.5) * cell;
      const body = makeRect(Matter, world, x, y, plankLen, 12);
      planks.push({ body, sign: (i + r) % 2 === 0 ? 1 : -1 });
    }
  });
  function update(t) {
    const s = Math.sin((t / period) * Math.PI * 2);
    const a = tiltMax * (Math.tanh(sharpness * s) / Math.tanh(sharpness));
    for (const p of planks) Matter.Body.setAngle(p.body, p.sign * a);
  }
  function draw(ctx) { for (const p of planks) drawRect(ctx, p.body, WALL_BLUE); }
  return { update, draw, bodies: planks.map((p) => p.body) };
}

// ---- Level 4: Vortex Well ---------------------------------------------------
// Feedback: occasional gravity made it look wrong, and the drawn ring wasn't
// explained by anything. Reworked: zero gravity (motion is purely the
// field), the field now pulses between attract and repel (keeps things
// churning rather than settling into one static spiral), the collector sits
// at true centre, and the ring is now a functional readout of the current
// attract/repel state (blue = pulling in, orange = pushing out) instead of
// an unexplained decoration.

function buildVortex(Matter, world, W, H) {
  const cx = W * 0.5, cy = H * 0.5;
  // Tuned by measurement (see test/harness.js). Balls start spread over the
  // whole field and spiral in under a weak pull with a stronger swirl, so
  // arrival at the collector is spread over ~40s (peak ~150 balls/s) instead
  // of one big stream. The swirl fades out near the centre (innerFade) so
  // balls reaching the collector aren't flung back out. The repel phase
  // pushes everything back outward for a few seconds each cycle.
  const P = {
    strength: 0.000015, tangential: 0.00004, innerFade: 220, radius: Math.hypot(W, H),
    cycle: 14000, attractFor: 11000, repelScale: 0.6,
  };
  const field = { x: cx, y: cy, kind: 'attract', strength: P.strength, radius: P.radius, tangential: P.tangential, innerFade: P.innerFade };
  function update(t) {
    const attract = t % P.cycle < P.attractFor;
    field.kind = attract ? 'attract' : 'repel';
    field.strength = attract ? P.strength : P.strength * P.repelScale;
  }
  function draw(ctx) {
    ctx.strokeStyle = field.kind === 'attract' ? 'rgba(90,150,220,0.55)' : 'rgba(230,140,60,0.55)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, Math.min(W, H) * 0.16, 0, Math.PI * 2);
    ctx.stroke();
  }
  return { update, draw, bodies: [], fields: [field] };
}

// ---- Level 5: Gravity Wells --------------------------------------------------
// Feedback: finished too fast — reduced to near-zero gravity so the
// attractor fields do almost all of the work (a small residual keeps balls
// that spawn between wells from settling into a permanent stable orbit).

function buildGravityWells(Matter, world, W, H) {
  const positions = [0.14, 0.3, 0.46, 0.62, 0.78, 0.92];
  const fields = positions.map((fx, i) => ({
    x: W * fx, y: H * (0.28 + (i % 3) * 0.16), kind: 'attract',
    strength: 0.00005, radius: 150, tangential: 0.00001,
  }));
  function update() {}
  function draw(ctx) {
    ctx.fillStyle = 'rgba(255, 214, 51, 0.9)';
    for (const f of fields) {
      ctx.beginPath();
      ctx.arc(f.x, f.y, 26, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  return { update, draw, bodies: [], fields };
}

// ---- Level 6: Diamond Funnel -------------------------------------------------
// Feedback: balls just pooled at the bottom and relied on the stall jitter to
// get going again — complete redesign wanted.
//
// Why it pooled: the old V's arms ended a few pixels short of the vertex, but
// each arm is a 16px-thick rectangle, so the real opening was only about 5px
// against a 10px ball — nothing could pass. Redesigned so that can't happen:
//  - a funnel with a genuinely wide opening (320px) whose walls are steeper
//    than the angle balls will rest on (~34 degrees),
//  - a lattice of small diamonds (45-degree squares) above it, which have no
//    flat top to rest on and scatter the stream symmetrically,
//  - a slowly turning four-arm wheel in the opening acting as a turnstile,
//    so nothing can sit still there and the flow is metered rather than
//    blocked. Gaps either side of the wheel stay open.
//
// Measured limit: this leg finishes in ~10s however narrow the opening is made
// (8-10s across every variant tried). Balls don't collide with each other, so a
// gap of any size lets all of them through in parallel — a funnel can shape
// where balls go but can't slow them down. Only something that periodically
// CLOSES can (as Leg 1's pillars do).

function buildDiamondFunnel(Matter, world, W, H) {
  const bodies = [];
  const thick = 14;

  function wall(x1, y1, x2, y2) {
    const len = Math.hypot(x2 - x1, y2 - y1);
    const b = makeRect(Matter, world, (x1 + x2) / 2, (y1 + y2) / 2, len, thick, { angle: Math.atan2(y2 - y1, x2 - x1) });
    bodies.push(b);
    return b;
  }
  wall(W * 0.1, H * 0.2, W * 0.4, H * 0.56);
  wall(W * 0.9, H * 0.2, W * 0.6, H * 0.56);

  const diamondRows = [
    { y: 0.28, xs: [-0.24, -0.08, 0.08, 0.24] },
    { y: 0.38, xs: [-0.16, 0, 0.16] },
    { y: 0.47, xs: [-0.08, 0.08] },
  ];
  for (const row of diamondRows) {
    for (const dx of row.xs) {
      bodies.push(makeRect(Matter, world, W * (0.5 + dx), H * row.y, 38, 38, { angle: Math.PI / 4 }));
    }
  }

  const wheelR = 125;
  const wheelX = W * 0.5, wheelY = H * 0.64;
  const barA = makeRect(Matter, world, wheelX, wheelY, wheelR * 2, 12);
  const barB = makeRect(Matter, world, wheelX, wheelY, wheelR * 2, 12);
  bodies.push(barA, barB);

  function update(t) {
    const a = (t / 4200) * Math.PI * 2;
    Matter.Body.setAngle(barA, a);
    Matter.Body.setAngle(barB, a + Math.PI / 2);
  }
  function draw(ctx) { for (const b of bodies) drawRect(ctx, b, WALL_BLUE); }
  return { update, draw, bodies };
}

// ---- Level 7: Twin-Row Gate --------------------------------------------------
// Feedback: read as a repeat of the other peg-field levels and wasn't doing
// enough. Reworked to lean into "gate": just two rows of a few large pegs,
// each row sliding as a block in opposite directions (a shifting scissor
// gate) rather than a dense static mesh — visually distinct from Levels 2
// and 10, and the large obvious motion should stop balls getting stuck too.

function buildTwinRowGate(Matter, world, W, H) {
  const pegs = makePegField(Matter, world, {
    xStart: 0, xEnd: W, yStart: H * 0.16,
    rows: 5, rowGap: H * 0.14, radius: 50, cols: 8,
  });
  function update(t) {
    for (const p of pegs) {
      const dir = p.row % 2 === 0 ? 1 : -1;
      const dx = Math.sin(t / 2400) * 55 * dir;
      Matter.Body.setPosition(p, { x: p.baseX + dx, y: p.baseY });
    }
  }
  function draw(ctx) { drawPegs(ctx, pegs, WALL_BLUE); }
  return { update, draw, bodies: pegs };
}

// ---- Level 8: Sieve Shelves --------------------------------------------------
// Feedback: works well; make the shelf motion more obvious.

function buildSieveShelves(Matter, world, W, H) {
  const rows = [];
  const rowYs = [H * 0.28, H * 0.5, H * 0.72];
  const segCount = 5;
  for (let r = 0; r < rowYs.length; r++) {
    const y = rowYs[r];
    const segW = W / segCount - 30;
    const segs = [];
    for (let c = 0; c < segCount; c++) {
      const baseX = (c + 0.5) * (W / segCount);
      const seg = makeRect(Matter, world, baseX, y, segW, 14);
      segs.push({ body: seg, baseX });
    }
    rows.push({ segs, phase: r * 1.3, amp: W / segCount / 2 + 10 });
  }
  function update(t) {
    for (const row of rows) {
      const dx = Math.sin(t / 1900 + row.phase) * row.amp;
      for (const s of row.segs) Matter.Body.setPosition(s.body, { x: s.baseX + dx, y: s.body.position.y });
    }
  }
  function draw(ctx) { for (const row of rows) for (const s of row.segs) drawRect(ctx, s.body, WALL_BLUE); }
  return { update, draw, bodies: rows.flatMap((r) => r.segs.map((s) => s.body)) };
}

// ---- Level 9: Horseshoe Cups --------------------------------------------------
// Feedback: cups held balls forever and the geometry looked wrong (walls
// weren't cleanly perpendicular to the base as one rigid piece). Reworked:
// each cup is a proper 90-degree U (base + two perpendicular walls) built as
// one rigid group around a pivot, and the whole cup now slowly rotates well
// past horizontal on a long cycle — spilling whatever it's holding — before
// swinging back to catch again.

function buildHorseshoeCups(Matter, world, W, H) {
  const cupW = 90, wallH = 46, baseH = 12;
  const cups = [];
  function makeCup(cx, cy, phase, dir) {
    const base = makeRect(Matter, world, cx, cy, cupW, baseH);
    const l = makeRect(Matter, world, cx, cy, 12, wallH);
    const r = makeRect(Matter, world, cx, cy, 12, wallH);
    const parts = [
      { body: base, restOffset: { x: 0, y: wallH / 2 }, restAngle: 0 },
      { body: l, restOffset: { x: -cupW / 2, y: 0 }, restAngle: 0 },
      { body: r, restOffset: { x: cupW / 2, y: 0 }, restAngle: 0 },
    ];
    cups.push({ pivot: { x: cx, y: cy }, parts, phase, dir: dir });
  }
  const rowYs = [H * 0.22, H * 0.42, H * 0.62, H * 0.82];
  rowYs.forEach((y, ri) => {
    const cols = 9;
    for (let c = 0; c < cols; c++) {
      const stagger = (ri % 2) * (W / cols / 2);
      const x = stagger + (c + 0.5) * (W / cols);
      if (x < 40 || x > W - 40) continue;
      makeCup(x, y, (ri * cols + c) * 0.7, c % 2 === 0 ? 1 : -1);
    }
  });
  // Feedback: make the cups constantly rotate to speed the level up. A steady
  // full rotation (alternating direction by column) means every cup spends
  // part of each turn upside down and empties itself, instead of the old
  // back-and-forth swing which could hold balls through half the cycle.
  function update(t) {
    for (const cup of cups) {
      const angle = cup.dir * ((t / 3600) * Math.PI * 2) + cup.phase;
      rotateRigidGroup(Matter, cup.parts, cup.pivot, angle);
    }
  }
  function draw(ctx) { for (const cup of cups) for (const p of cup.parts) drawRect(ctx, p.body, WALL_BLUE); }
  return { update, draw, bodies: cups.flatMap((c) => c.parts.map((p) => p.body)) };
}

// ---- Level 10: Hex Pachinko --------------------------------------------------
// Feedback: fine, but a slight drift would stop smaller balls getting stuck.

function buildHexPachinko(Matter, world, W, H) {
  const pegs = makePegField(Matter, world, {
    xStart: 0, xEnd: W, yStart: H * 0.1,
    rows: 11, rowGap: H * 0.068, radius: 15, cols: 18,
  });
  function update(t) { wobblePegsX(Matter, pegs, t, 7, 1500); }
  function draw(ctx) { drawPegs(ctx, pegs, WALL_BLUE); }
  return { update, draw, bodies: pegs };
}

// ---- Level 11: Repulsor Chaos -------------------------------------------------
// Several moving repulsors scatter balls; one fixed attractor acts as the
// collector amid the chaos. Good natural exercise of the stall/jitter safety
// net (SPEC.md §7) since opposing fields can create near-equilibria.

function buildRepulsorChaos(Matter, world, W, H) {
  // Feedback: the left-to-right rush toward the collector was too fast and
  // read as strange. Collector and repulsor strength both cut down, and the
  // repulsors now drift on a much slower cycle so the scene reads as gentle
  // churn rather than a frantic dash.
  const collectorX = W * 0.68, collectorY = H * 0.42;
  const collector = { x: collectorX, y: collectorY, kind: 'attract', strength: 0.000012, radius: Math.hypot(W, H) };
  const repulsors = [
    { baseX: W * 0.25, baseY: H * 0.3, r: 90, speed: 5200, phase: 0 },
    { baseX: W * 0.45, baseY: H * 0.55, r: 70, speed: 6200, phase: 1.4 },
    { baseX: W * 0.62, baseY: H * 0.22, r: 80, speed: 4400, phase: 2.6 },
    { baseX: W * 0.35, baseY: H * 0.65, r: 100, speed: 6800, phase: 4.0 },
  ].map((r) => ({ x: r.baseX, y: r.baseY, kind: 'repel', strength: 0.00009, radius: 150, ...r }));

  function update(t) {
    for (const f of repulsors) {
      f.x = f.baseX + Math.cos(t / f.speed + f.phase) * f.r;
      f.y = f.baseY + Math.sin(t / f.speed * 1.3 + f.phase) * f.r * 0.6;
    }
  }
  function draw(ctx) {
    ctx.fillStyle = 'rgba(60,120,220,0.85)';
    for (const f of repulsors) { ctx.beginPath(); ctx.arc(f.x, f.y, 30, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = 'rgba(130,255,90,0.95)';
    ctx.beginPath(); ctx.arc(collector.x, collector.y, 22, 0, Math.PI * 2); ctx.fill();
  }
  return { update, draw, bodies: [], fields: [collector, ...repulsors] };
}

// ---- registry ---------------------------------------------------------------
// Collection lines sit close to the bottom edge (0.93H) so the green zone
// reads as immediately on top of the bins below, per feedback.

const LEVELS = [
  { id: 'rising-pillars', name: 'Rising Pillars', background: '#050505',
    gravity: { x: 0, y: 1 }, release: { type: 'spread', y: 0.05 },
    collection: { type: 'line', y: 0.93 }, build: buildRisingPillars },

  { id: 'bubble-field', name: 'Bubble Field', background: '#04060a', nudgeStuck: true,
    gravity: { x: 0, y: 0.16 }, release: { type: 'spread', y: 0.05 },
    collection: { type: 'line', y: 0.93 }, build: buildBubbleField },

  { id: 'see-saws', name: 'See-Saws', background: '#050505', nudgeStuck: true,
    gravity: { x: 0, y: 1 }, release: { type: 'spread', y: 0.04 },
    collection: { type: 'line', y: 0.93 }, build: buildSeeSaws },

  { id: 'vortex-well', name: 'Vortex Well', background: '#03040a',
    gravity: { x: 0, y: 0 }, frictionAir: 0.08, release: { type: 'area', xMin: 0.02, xMax: 0.98, yMin: 0.04, yMax: 0.92 },
    collection: { type: 'circle', x: 0.5, y: 0.5, r: 0.07 }, build: buildVortex },

  { id: 'gravity-wells', name: 'Gravity Wells', background: '#0a0806',
    gravity: { x: 0, y: 0.015 }, release: { type: 'spread', y: 0.04 },
    collection: { type: 'line', y: 0.93 }, build: buildGravityWells },

  { id: 'diamond-funnel', name: 'Diamond Funnel', background: '#050505', nudgeStuck: true,
    gravity: { x: 0, y: 0.25 }, release: { type: 'spread', xMin: 0.35, xMax: 0.65, y: 0.04 },
    collection: { type: 'line', y: 0.93 }, build: buildDiamondFunnel },

  { id: 'twin-row-gate', name: 'Twin-Row Gate', background: '#04060a', nudgeStuck: true,
    gravity: { x: 0, y: 0.13 }, release: { type: 'spread', y: 0.05 },
    collection: { type: 'line', y: 0.93 }, build: buildTwinRowGate },

  { id: 'sieve-shelves', name: 'Sieve Shelves', background: '#050505',
    gravity: { x: 0, y: 1 }, release: { type: 'spread', y: 0.04 },
    collection: { type: 'line', y: 0.93 }, build: buildSieveShelves },

  { id: 'horseshoe-cups', name: 'Horseshoe Cups', background: '#04060a',
    gravity: { x: 0, y: 0.4 }, release: { type: 'spread', y: 0.04 },
    collection: { type: 'line', y: 0.93 }, build: buildHorseshoeCups },

  { id: 'hex-pachinko', name: 'Hex Pachinko', background: '#050505', nudgeStuck: true,
    gravity: { x: 0, y: 0.14 }, release: { type: 'spread', y: 0.04 },
    collection: { type: 'line', y: 0.93 }, build: buildHexPachinko },

  { id: 'repulsor-chaos', name: 'Repulsor Chaos', background: '#03040a',
    gravity: { x: 0, y: 0.04 }, release: { type: 'spread', xMin: 0, xMax: 0.3, y: 0.06 },
    collection: { type: 'circle', x: 0.68, y: 0.42, r: 0.06 }, build: buildRepulsorChaos },
];
