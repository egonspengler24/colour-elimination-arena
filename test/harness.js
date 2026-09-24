// Headless leg timer. Not loaded by the game; inject into the page with
//   (0, eval)(await (await fetch('test/harness.js')).text())
// then: await __sim(levelIndex, maxSeconds) -> metrics.
//
// It drives the real stepGame() on the simulation clock (60 steps per virtual
// second), so results don't depend on how fast the browser tab renders.

window.__sim = async function (levelIdx, maxSec = 150, opts = {}) {
  const ids = PALETTE.map((c) => c.id);
  startGame({
    colours: opts.colours || ids,
    names: {},
    totalBalls: opts.totalBalls || 2500,
    order: 'fixed',
    speed: 1,
  });
  paused = true; // stop the real rAF loop stepping; we step by hand
  legOrder = [levelIdx];
  legIndex = 0;
  startLeg();

  let jitters = 0, recycles = 0;
  const realRecycle = window.recycleStray;
  window.recycleStray = function () {
    const m = WALL_MARGIN + 100;
    for (const b of balls) {
      if (b.position.x < -m || b.position.x > W + m || b.position.y < -m || b.position.y > H + m) recycles++;
    }
    realRecycle();
  };

  const total = activeColours.length * allocation;
  const collectedAt = [];               // cumulative collected, sampled each virtual second
  let lastJ = lastJitterTime;
  const t0 = performance.now();
  let steps = 0;
  const sumCollected = () => activeColours.reduce((a, id) => a + bins.count(id), 0);

  while (!transitioning && legTime < maxSec * 1000) {
    stepGame();
    steps++;
    if (lastJitterTime !== lastJ) { jitters++; lastJ = lastJitterTime; }
    if (steps % 60 === 0) collectedAt.push(sumCollected());
    if (steps % 3000 === 0) await new Promise((r) => setTimeout(r, 0));
  }
  window.recycleStray = realRecycle;

  const finished = transitioning;
  const c = collectedAt;
  const at = (frac) => { const i = c.findIndex((v) => v >= total * frac); return i < 0 ? null : i + 1; };
  let peak = 0;
  for (let i = 1; i < c.length; i++) peak = Math.max(peak, c[i] - c[i - 1]);

  return {
    level: LEVELS[levelIdx].id,
    finished,
    legSec: +(legTime / 1000).toFixed(1),
    t10: at(0.1), t50: at(0.5), t90: at(0.9),
    peakPerSec: peak,
    avgPerSec: +(total / Math.max(1, legTime / 1000)).toFixed(0),
    jitters, recycles,
    wallMs: Math.round(performance.now() - t0),
  };
};
