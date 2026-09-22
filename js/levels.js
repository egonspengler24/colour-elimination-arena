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
  const bodies = [];
  const cellW = (xEnd - xStart) / cols;
  for (let r = 0; r < rows; r++) {
    const y = yStart + r * rowGap;
    const stagger = (r % 2) * (cellW / 2);
    for (let c = 0; c < cols; c++) {
      const x = xStart + stagger + (c + 0.5) * cellW;
      if (x < xStart - 1 || x > xEnd + 1) continue;
      const peg = Matter.Bodies.circle(x, y, radius, { isStatic: true });
      Matter.World.add(world, peg);
      bodies.push(peg);
    }
  }
  return bodies;
}

function drawPegs(ctx, bodies, fill) {
  ctx.fillStyle = fill;
  for (const b of bodies) {
    ctx.beginPath();
    ctx.arc(b.position.x, b.position.y, b.circleRadius, 0, Math.PI * 2);
    ctx.fill();
  }
}

const WALL_BLUE = '#2f6fb0';

// ---- Level 1: Rising Pillars ----------------------------------------------
// Moving walls: paired segments per column oscillate together, leaving a
// travelling gap. Segments carry a tiny (~1deg) alternating tilt so balls
// landing on a flat top get nudged sideways instead of bouncing straight up
// and down forever (this was a real problem in the first playtest).

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
// Static dense peg mesh, pachinko-style. No motion needed.

function buildBubbleField(Matter, world, W, H) {
  const pegs = makePegField(Matter, world, {
    xStart: W * 0.02, xEnd: W * 0.98, yStart: H * 0.1,
    rows: 8, rowGap: H * 0.09, radius: 33, cols: 12,
  });
  function update() {}
  function draw(ctx) { drawPegs(ctx, pegs, WALL_BLUE); }
  return { update, draw, bodies: pegs };
}

// ---- Level 3: Serpentine Chambers ------------------------------------------
// Zigzag of tilted shelves, each leaving a gap at alternating ends, forcing a
// snaking path down to a single localized exit (not full-width).

function buildSerpentine(Matter, world, W, H) {
  // Each shelf covers exactly one half of the width (closed side) and leaves
  // the other half fully open (the gap), alternating per row. Half-width
  // shelves at a modest tilt keep enough vertical clearance between rows
  // that adjacent shelves never cross each other (an earlier version used
  // wide overlapping diagonals and balls got wedged at the intersections).
  const shelves = [];
  const n = 4;
  const tiltDeg = 10;
  const topY = H * 0.14, botY = H * 0.8;
  for (let i = 0; i < n; i++) {
    const y = topY + (i / (n - 1)) * (botY - topY);
    const openRight = i % 2 === 0;
    const w = W * 0.56;
    const cx = openRight ? W * 0.22 : W * 0.78;
    const angle = ((openRight ? 1 : -1) * tiltDeg * Math.PI) / 180;
    const shelf = makeRect(Matter, world, cx, y, w, 14, { angle });
    shelves.push(shelf);
  }
  function update() {}
  function draw(ctx) { for (const s of shelves) drawRect(ctx, s, WALL_BLUE); }
  return { update, draw, bodies: shelves };
}

// ---- Level 4: Vortex Well ---------------------------------------------------
// One attractor with a tangential component pulls balls into a spiral toward
// its centre, which is also the collection point. Near-zero baseline gravity.

function buildVortex(Matter, world, W, H) {
  const cx = W * 0.58, cy = H * 0.5;
  const field = { x: cx, y: cy, kind: 'attract', strength: 0.00012, radius: Math.hypot(W, H), tangential: 0.00018 };
  function update() {}
  function draw(ctx) {
    ctx.strokeStyle = 'rgba(90,150,220,0.5)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, Math.min(W, H) * 0.45, 0, Math.PI * 2);
    ctx.stroke();
  }
  return { update, draw, bodies: [], fields: [field] };
}

// ---- Level 5: Gravity Wells --------------------------------------------------
// Multiple attractor orbs create slingshot arcs on the way down.

function buildGravityWells(Matter, world, W, H) {
  const positions = [0.14, 0.3, 0.46, 0.62, 0.78, 0.92];
  const fields = positions.map((fx, i) => ({
    x: W * fx, y: H * (0.28 + (i % 3) * 0.16), kind: 'attract',
    strength: 0.00009, radius: 150, tangential: 0.00003,
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
// A wide V of angled walls funnels balls toward bottom-centre, with a
// scattering of small diagonal bars above for extra deflection texture.

function buildDiamondFunnel(Matter, world, W, H) {
  const bodies = [];
  const left = makeRect(Matter, world, W * 0.27, H * 0.5, W * 0.62, 16, { angle: (28 * Math.PI) / 180 });
  const right = makeRect(Matter, world, W * 0.73, H * 0.5, W * 0.62, 16, { angle: (-28 * Math.PI) / 180 });
  bodies.push(left, right);

  const bars = [];
  for (let i = 0; i < 10; i++) {
    const x = W * (0.1 + Math.random() * 0.8);
    const y = H * (0.14 + Math.random() * 0.18);
    const angle = ((Math.random() < 0.5 ? 1 : -1) * 40 * Math.PI) / 180;
    bars.push(makeRect(Matter, world, x, y, W * 0.11, 10, { angle }));
  }
  bodies.push(...bars);

  function update() {}
  function draw(ctx) { for (const b of bodies) drawRect(ctx, b, WALL_BLUE); }
  return { update, draw, bodies };
}

// ---- Level 7: Twin-Row Gate --------------------------------------------------
// Two rows of large circular gaps.

function buildTwinRowGate(Matter, world, W, H) {
  const pegs = makePegField(Matter, world, {
    xStart: W * 0.02, xEnd: W * 0.98, yStart: H * 0.16,
    rows: 4, rowGap: H * 0.15, radius: 52, cols: 8,
  });
  function update() {}
  function draw(ctx) { drawPegs(ctx, pegs, WALL_BLUE); }
  return { update, draw, bodies: pegs };
}

// ---- Level 8: Sieve Shelves --------------------------------------------------
// Three rows of gapped horizontal shelves; gaps drift slowly side to side.

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
    rows.push({ segs, phase: r * 1.3, amp: W / segCount / 2 - 4 });
  }
  function update(t) {
    for (const row of rows) {
      const dx = Math.sin(t / 2600 + row.phase) * row.amp;
      for (const s of row.segs) Matter.Body.setPosition(s.body, { x: s.baseX + dx, y: s.body.position.y });
    }
  }
  function draw(ctx) { for (const row of rows) for (const s of row.segs) drawRect(ctx, s.body, WALL_BLUE); }
  return { update, draw, bodies: rows.flatMap((r) => r.segs.map((s) => s.body)) };
}

// ---- Level 9: Horseshoe Cups --------------------------------------------------
// Two staggered rows of shallow U-shaped catch bumpers with a slight tilt on
// the base so balls always eventually roll out rather than settling forever.

function buildHorseshoeCups(Matter, world, W, H) {
  const bodies = [];
  const cupW = 90, wallH = 46, baseH = 12;
  function makeCup(cx, cy, dir) {
    const base = makeRect(Matter, world, cx, cy + wallH / 2, cupW, baseH, { angle: (dir * 3 * Math.PI) / 180 });
    const l = makeRect(Matter, world, cx - cupW / 2, cy, 12, wallH);
    const r = makeRect(Matter, world, cx + cupW / 2, cy, 12, wallH);
    bodies.push(base, l, r);
  }
  const rowYs = [H * 0.22, H * 0.42, H * 0.62, H * 0.82];
  rowYs.forEach((y, ri) => {
    const cols = 9;
    for (let c = 0; c < cols; c++) {
      const stagger = (ri % 2) * (W / cols / 2);
      const x = stagger + (c + 0.5) * (W / cols);
      if (x < 40 || x > W - 40) continue;
      makeCup(x, y, c % 2 === 0 ? 1 : -1);
    }
  });
  function update() {}
  function draw(ctx) { for (const b of bodies) drawRect(ctx, b, WALL_BLUE); }
  return { update, draw, bodies };
}

// ---- Level 10: Hex Pachinko --------------------------------------------------
// Denser, smaller-pitch peg field than Level 2.

function buildHexPachinko(Matter, world, W, H) {
  const pegs = makePegField(Matter, world, {
    xStart: W * 0.02, xEnd: W * 0.98, yStart: H * 0.1,
    rows: 11, rowGap: H * 0.068, radius: 15, cols: 18,
  });
  function update() {}
  function draw(ctx) { drawPegs(ctx, pegs, WALL_BLUE); }
  return { update, draw, bodies: pegs };
}

// ---- Level 11: Repulsor Chaos -------------------------------------------------
// Several moving repulsors scatter balls; one fixed attractor acts as the
// collector amid the chaos. Good natural exercise of the stall/jitter safety
// net (SPEC.md §7) since opposing fields can create near-equilibria.

function buildRepulsorChaos(Matter, world, W, H) {
  const collectorX = W * 0.68, collectorY = H * 0.42;
  const collector = { x: collectorX, y: collectorY, kind: 'attract', strength: 0.0001, radius: Math.hypot(W, H) };
  const repulsors = [
    { baseX: W * 0.25, baseY: H * 0.3, r: 90, speed: 2600, phase: 0 },
    { baseX: W * 0.45, baseY: H * 0.55, r: 70, speed: 3100, phase: 1.4 },
    { baseX: W * 0.62, baseY: H * 0.22, r: 80, speed: 2200, phase: 2.6 },
    { baseX: W * 0.35, baseY: H * 0.65, r: 100, speed: 3400, phase: 4.0 },
  ].map((r) => ({ x: r.baseX, y: r.baseY, kind: 'repel', strength: 0.0002, radius: 150, ...r }));

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

const LEVELS = [
  { id: 'rising-pillars', name: 'Rising Pillars', background: '#050505',
    gravity: { x: 0, y: 1 }, release: { type: 'spread', y: 0.05 },
    collection: { type: 'line', y: 0.85 }, build: buildRisingPillars },

  { id: 'bubble-field', name: 'Bubble Field', background: '#04060a',
    gravity: { x: 0, y: 0.16 }, release: { type: 'spread', y: 0.05 },
    collection: { type: 'line', y: 0.9 }, build: buildBubbleField },

  { id: 'serpentine-chambers', name: 'Serpentine Chambers', background: '#050505',
    gravity: { x: 0, y: 1 }, release: { type: 'spread', y: 0.04 },
    collection: { type: 'circle', x: 0.5, y: 0.9, r: 0.1 }, build: buildSerpentine },

  { id: 'vortex-well', name: 'Vortex Well', background: '#03040a',
    gravity: { x: 0, y: 0.05 }, release: { type: 'point', x: 0.06, y: 0.5 },
    collection: { type: 'circle', x: 0.58, y: 0.5, r: 0.045 }, build: buildVortex },

  { id: 'gravity-wells', name: 'Gravity Wells', background: '#0a0806',
    gravity: { x: 0, y: 0.2 }, release: { type: 'spread', y: 0.04 },
    collection: { type: 'line', y: 0.92 }, build: buildGravityWells },

  { id: 'diamond-funnel', name: 'Diamond Funnel', background: '#050505',
    gravity: { x: 0, y: 1 }, release: { type: 'spread', xMin: 0.35, xMax: 0.65, y: 0.04 },
    collection: { type: 'line', y: 0.92 }, build: buildDiamondFunnel },

  { id: 'twin-row-gate', name: 'Twin-Row Gate', background: '#04060a',
    gravity: { x: 0, y: 0.18 }, release: { type: 'spread', y: 0.05 },
    collection: { type: 'line', y: 0.92 }, build: buildTwinRowGate },

  { id: 'sieve-shelves', name: 'Sieve Shelves', background: '#050505',
    gravity: { x: 0, y: 1 }, release: { type: 'spread', y: 0.04 },
    collection: { type: 'line', y: 0.9 }, build: buildSieveShelves },

  { id: 'horseshoe-cups', name: 'Horseshoe Cups', background: '#04060a',
    gravity: { x: 0, y: 0.16 }, release: { type: 'spread', y: 0.04 },
    collection: { type: 'line', y: 0.9 }, build: buildHorseshoeCups },

  { id: 'hex-pachinko', name: 'Hex Pachinko', background: '#050505',
    gravity: { x: 0, y: 0.14 }, release: { type: 'spread', y: 0.04 },
    collection: { type: 'line', y: 0.9 }, build: buildHexPachinko },

  { id: 'repulsor-chaos', name: 'Repulsor Chaos', background: '#03040a',
    gravity: { x: 0, y: 0.25 }, release: { type: 'spread', xMin: 0, xMax: 0.3, y: 0.06 },
    collection: { type: 'circle', x: 0.68, y: 0.42, r: 0.04 }, build: buildRepulsorChaos },
];
