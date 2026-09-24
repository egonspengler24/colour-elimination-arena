# Colour Elimination Arena

A browser game where 12 colours compete across a series of physics levels. Every
leg, all remaining colours release a share of a shared ~2,500-ball pool; a level
built from four composable physics primitives (walls, attractors, repulsors,
gravity) disturbs the balls on their way to a collection zone; balls sort live
into ranked, colour-coded bins at the bottom. The colour with the fewest balls
collected when everyone else finishes is eliminated, and the game moves to the
next leg with one fewer colour — until one colour remains.

Fully automatic: choose your colours and settings on the setup screen, press
Start and watch. There is a game clock and per-leg timer, a live leaderboard with
a log of each leg, game-speed buttons (1x to 8x), and background music (a bundled
default track, your own file, or none).

No build step and no dependencies to
install beyond [Matter.js](https://brm.io/matter-js/), vendored for the physics.

**Status: v1 plus setup screen.** Eleven levels are in and individually working,
but pacing is still being tuned leg by leg — some legs finish much faster than
others. See [SPEC.md](SPEC.md) for the full design and current status.

## Run locally

Open `index.html` in a browser, or serve the folder:

```bash
python3 -m http.server 8000
```

## Testing a leg's pacing

`test/harness.js` runs the real game step function headlessly on a virtual
clock. With the page open, inject it and call it from the console:

```js
(0, eval)(await (await fetch('test/harness.js')).text());
await __sim(3, 150); // level index, max seconds -> finish time, collection curve
```

## Credits

- Physics: [Matter.js](https://brm.io/matter-js/) (MIT).
- Default music: "Keep It Real" by Nick Petrov, from [Bensound.com](https://www.bensound.com).
- Gameplay concept inspired by the "team elimination marble race" genre of
  physics-simulation videos.

## Deploying

The site is static. On GitHub, go to *Settings → Pages* and serve from the
`main` branch, root folder.
