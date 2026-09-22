# Colour Elimination Arena

A browser game where 12 colours compete across a series of physics levels. Every
leg, all remaining colours release a share of a shared ~2,500-ball pool; a level
built from four composable physics primitives (walls, attractors, repulsors,
gravity) disturbs the balls on their way to a collection zone; balls sort live
into ranked, colour-coded bins at the bottom. The colour with the fewest balls
collected when everyone else finishes is eliminated, and the game moves to the
next leg with one fewer colour — until one colour remains.

Fully automatic: press Start and watch. No build step and no dependencies to
install beyond [Matter.js](https://brm.io/matter-js/), vendored for the physics.

**Status: early v1.** Eleven levels are in and individually working, but pacing
and difficulty are still being tuned — some legs finish much faster than
others. See [SPEC.md](SPEC.md) for the full design and current status.

## Run locally

Open `index.html` in a browser, or serve the folder:

```bash
python3 -m http.server 8000
```

## Credits

- Physics: [Matter.js](https://brm.io/matter-js/) (MIT).
- Gameplay concept inspired by the "team elimination marble race" genre of
  physics-simulation videos.

## Deploying

The site is static. On GitHub, go to *Settings → Pages* and serve from the
`main` branch, root folder.
