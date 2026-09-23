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
  const body = Matter.Bodies.rectangle(x, y, w, h, { isStatic: true, ...opts });
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

function makePegField(Matter, world, { xStart, xEnd, yStart, rows, rowGap, radius, cols }) {
  const pegs = [];
  const cellW = (xEnd - xStart) / cols;
  for (let r = 0; r < rows; r++) {
    const y = yStart + r * rowGap;
    const stagger = (r % 2) * (cellW / 2);
    for (let c = 0; c < cols; c++) {
      const x = xStart + stagger + (c + 0.5) * cellW;
      if (x < xStart - 1 || x > xEnd + 1) continue;
      const peg = Matter.Bodies.circle(x, y, radius, { isStatic: true });
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
    xStart: W * 0.02, xEnd: W * 0.98, yStart: H * 0.1,
    rows: 8, rowGap: H * 0.09, radius: 33, cols: 12,
  });
  function update(t) { wobblePegsX(Matter, pegs, t, 12, 1900); }
  function draw(ctx) { drawPegs(ctx, pegs, WALL_BLUE); }
  return { update, draw, bodies: pegs };
}

// ---- Level 3: Serpentine Chambers ------------------------------------------
// Feedback (round 2): the free-pivoting version rotated each shelf around
// its own centre, so the far end could swing far enough to pass *below* the
// collection line — a wall below the floor, which doesn't make sense — and
// balls pushed out past the canvas edge by that swing got picked up by the
// out-of-bounds safety net and teleported back to the release point, which
// read as "balls regenerating at the top" rather than falling through a
// real path. A ball resting close to a free pivot's centre also barely
// moves as it rotates, which looked like balls freezing.
//
// Reworked as hinged flaps: each shelf is anchored at a FIXED point on the
// canvas edge (like a door hinge) and only its far tip swings, always
// rising above the hinge's own height — so the tip can never dip below its
// own row, the collection line, or off-canvas. The far side of the row is
// always open at that height (a permanent bypass), and the flap's reach
// pulses to vary how much of the near side it covers.

function buildSerpentine(Matter, world, W, H) {
  // thetaMax is capped per row so the tip's rise (sin(theta)*L) can never
  // exceed that row's own distance from the canvas top, minus a safety
  // margin — a fixed thetaMax for every row (the previous version) let the
  // top rows' tips swing clean off the top of the canvas, since they have
  // less headroom than the lower rows. Any ball caught near the tip when
  // that happened got carried up and out with it.
  const rows = [];
  const n = 4;
  const L = W * 0.32;
  const topY = H * 0.16, botY = H * 0.78;
  const SAFETY = 50;
  // Both bounds are clamped against the same per-row safe angle — clamping
  // only thetaMax (an earlier version) left thetaMin free to violate safety
  // once it was raised above a row's own safe cap, which happened for the
  // topmost row here and put its tip above the canvas at every angle.
  const desiredThetaMin = (20 * Math.PI) / 180;
  const desiredThetaMax = (58 * Math.PI) / 180;
  const hingeInset = 30; // keep the hinge off the exact edge so a near-flat
                          // flap can't form a dead pocket against the side wall
  for (let i = 0; i < n; i++) {
    const hy = topY + (i / (n - 1)) * (botY - topY);
    const hingeLeft = i % 2 === 0;
    const hx = hingeLeft ? hingeInset : W - hingeInset;
    const maxSafeSin = Math.min(1, Math.max(0.05, (hy - SAFETY) / L));
    const safeCap = Math.asin(maxSafeSin);
    const thetaMin = Math.min(desiredThetaMin, safeCap);
    const thetaMax = Math.min(desiredThetaMax, safeCap);
    rows.push({
      hx,
      hy,
      dirX: hingeLeft ? 1 : -1,
      L,
      thetaMin,
      thetaMax: Math.max(thetaMin, thetaMax),
      period: 4600 + i * 500,
      phase: i * 1.3,
      body: makeRect(Matter, world, hx + (hingeLeft ? 1 : -1) * L / 2, hy, L, 14),
    });
  }
  function poseFor(row, theta) {
    const tipX = row.hx + row.dirX * Math.cos(theta) * row.L;
    const tipY = row.hy - Math.sin(theta) * row.L;
    return {
      cx: (row.hx + tipX) / 2,
      cy: (row.hy + tipY) / 2,
      angle: Math.atan2(tipY - row.hy, tipX - row.hx),
    };
  }
  function update(t) {
    for (const row of rows) {
      const k = (Math.sin(t / row.period + row.phase) + 1) / 2;
      const theta = row.thetaMin + k * (row.thetaMax - row.thetaMin);
      const pose = poseFor(row, theta);
      Matter.Body.setPosition(row.body, { x: pose.cx, y: pose.cy });
      Matter.Body.setAngle(row.body, pose.angle);
    }
  }
  function draw(ctx) { for (const row of rows) drawRect(ctx, row.body, WALL_BLUE); }
  return { update, draw, bodies: rows.map((r) => r.body) };
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
  const field = { x: cx, y: cy, kind: 'attract', strength: 0.00012, radius: Math.hypot(W, H), tangential: 0.00018 };
  const cycle = 6200, attractFor = 4400;
  function update(t) {
    field.kind = t % cycle < attractFor ? 'attract' : 'repel';
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
// Feedback: overlapping decorative bars looked wrong, and the closed V vertex
// trapped every ball (needing the stall jitter to clear it every time).
// Reworked: just a clean V (decorative bars removed), a small permanent gap
// at the vertex so balls always have somewhere to drain, and the whole V now
// rocks slowly side to side around the vertex to actively spill balls
// through rather than relying on the gap alone.

function buildDiamondFunnel(Matter, world, W, H) {
  const apex = { x: W * 0.5, y: H * 0.58 };
  const armLen = W * 0.42;
  const gapHalf = 20;
  const baseAngle = (32 * Math.PI) / 180;
  const radius = armLen / 2 + gapHalf;

  function armPose(sign, wobble) {
    const theta = sign * baseAngle + wobble;
    const dir = { x: Math.sin(theta), y: -Math.cos(theta) };
    return { x: dir.x * radius, y: dir.y * radius, angle: Math.atan2(dir.y, dir.x) };
  }

  const leftBody = makeRect(Matter, world, apex.x, apex.y, armLen, 16);
  const rightBody = makeRect(Matter, world, apex.x, apex.y, armLen, 16);
  const parts = [
    { body: leftBody, restOffset: { x: 0, y: 0 }, restAngle: 0, sign: -1 },
    { body: rightBody, restOffset: { x: 0, y: 0 }, restAngle: 0, sign: 1 },
  ];

  function update(t) {
    const wobble = Math.sin(t / 2800) * 0.16;
    for (const p of parts) {
      const pose = armPose(p.sign, wobble);
      Matter.Body.setPosition(p.body, { x: apex.x + pose.x, y: apex.y + pose.y });
      Matter.Body.setAngle(p.body, pose.angle);
    }
  }

  function draw(ctx) { drawRect(ctx, leftBody, WALL_BLUE); drawRect(ctx, rightBody, WALL_BLUE); }
  return { update, draw, bodies: [leftBody, rightBody] };
}

// ---- Level 7: Twin-Row Gate --------------------------------------------------
// Feedback: read as a repeat of the other peg-field levels and wasn't doing
// enough. Reworked to lean into "gate": just two rows of a few large pegs,
// each row sliding as a block in opposite directions (a shifting scissor
// gate) rather than a dense static mesh — visually distinct from Levels 2
// and 10, and the large obvious motion should stop balls getting stuck too.

function buildTwinRowGate(Matter, world, W, H) {
  const pegs = makePegField(Matter, world, {
    xStart: W * 0.02, xEnd: W * 0.98, yStart: H * 0.16,
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
  function makeCup(cx, cy, phase) {
    const base = makeRect(Matter, world, cx, cy, cupW, baseH);
    const l = makeRect(Matter, world, cx, cy, 12, wallH);
    const r = makeRect(Matter, world, cx, cy, 12, wallH);
    const parts = [
      { body: base, restOffset: { x: 0, y: wallH / 2 }, restAngle: 0 },
      { body: l, restOffset: { x: -cupW / 2, y: 0 }, restAngle: 0 },
      { body: r, restOffset: { x: cupW / 2, y: 0 }, restAngle: 0 },
    ];
    cups.push({ pivot: { x: cx, y: cy }, parts, phase });
  }
  const rowYs = [H * 0.22, H * 0.42, H * 0.62, H * 0.82];
  rowYs.forEach((y, ri) => {
    const cols = 9;
    for (let c = 0; c < cols; c++) {
      const stagger = (ri % 2) * (W / cols / 2);
      const x = stagger + (c + 0.5) * (W / cols);
      if (x < 40 || x > W - 40) continue;
      makeCup(x, y, (ri * cols + c) * 0.7);
    }
  });
  function update(t) {
    for (const cup of cups) {
      const angle = ((105 * Math.PI) / 180) * Math.sin(t / 5200 + cup.phase);
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
    xStart: W * 0.02, xEnd: W * 0.98, yStart: H * 0.1,
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

  { id: 'bubble-field', name: 'Bubble Field', background: '#04060a',
    gravity: { x: 0, y: 0.16 }, release: { type: 'spread', y: 0.05 },
    collection: { type: 'line', y: 0.93 }, build: buildBubbleField },

  { id: 'serpentine-chambers', name: 'Serpentine Chambers', background: '#050505',
    gravity: { x: 0, y: 1 }, release: { type: 'spread', y: 0.04 },
    collection: { type: 'line', y: 0.93 }, build: buildSerpentine },

  { id: 'vortex-well', name: 'Vortex Well', background: '#03040a',
    gravity: { x: 0, y: 0 }, release: { type: 'point', x: 0.06, y: 0.5 },
    collection: { type: 'circle', x: 0.5, y: 0.5, r: 0.045 }, build: buildVortex },

  { id: 'gravity-wells', name: 'Gravity Wells', background: '#0a0806',
    gravity: { x: 0, y: 0.015 }, release: { type: 'spread', y: 0.04 },
    collection: { type: 'line', y: 0.93 }, build: buildGravityWells },

  { id: 'diamond-funnel', name: 'Diamond Funnel', background: '#050505',
    gravity: { x: 0, y: 1 }, release: { type: 'spread', xMin: 0.35, xMax: 0.65, y: 0.04 },
    collection: { type: 'line', y: 0.93 }, build: buildDiamondFunnel },

  { id: 'twin-row-gate', name: 'Twin-Row Gate', background: '#04060a',
    gravity: { x: 0, y: 0.13 }, release: { type: 'spread', y: 0.05 },
    collection: { type: 'line', y: 0.93 }, build: buildTwinRowGate },

  { id: 'sieve-shelves', name: 'Sieve Shelves', background: '#050505',
    gravity: { x: 0, y: 1 }, release: { type: 'spread', y: 0.04 },
    collection: { type: 'line', y: 0.93 }, build: buildSieveShelves },

  { id: 'horseshoe-cups', name: 'Horseshoe Cups', background: '#04060a',
    gravity: { x: 0, y: 0.6 }, release: { type: 'spread', y: 0.04 },
    collection: { type: 'line', y: 0.93 }, build: buildHorseshoeCups },

  { id: 'hex-pachinko', name: 'Hex Pachinko', background: '#050505',
    gravity: { x: 0, y: 0.14 }, release: { type: 'spread', y: 0.04 },
    collection: { type: 'line', y: 0.93 }, build: buildHexPachinko },

  { id: 'repulsor-chaos', name: 'Repulsor Chaos', background: '#03040a',
    gravity: { x: 0, y: 0.04 }, release: { type: 'spread', xMin: 0, xMax: 0.3, y: 0.06 },
    collection: { type: 'circle', x: 0.68, y: 0.42, r: 0.06 }, build: buildRepulsorChaos },
];
