# Colour Elimination Arena — Design Specification (v0.2 draft)

Working title only — rename freely. Companion/spiritual successor to [`territory-plinko`](../territory-plinko/README.md) ("Plinko Conquest"): same foundation (static site, Matter.js, GitHub Pages), much more complex game loop. Directly inspired by the "marble race elimination" genre on YouTube (reference material below is from *Mega Team Elimination Marble Race #2* by MIKAN — used only for gameplay-mechanic inspiration, no assets/code reused).

Status: **v1 deployed** at https://egonspengler24.github.io/colour-elimination-arena/ (repo: [egonspengler24/colour-elimination-arena](https://github.com/egonspengler24/colour-elimination-arena)). All 11 levels for the 12-colour build are in place, individually verified, and had a first pacing-tuning pass (Bubble Field, Gravity Wells, Twin-Row Gate, Horseshoe Cups, Hex Pachinko were finishing in seconds — gravity and obstacle density adjusted, though not all are fully matched to Level 1's pace yet). Still open: further pacing/difficulty tuning based on real playtesting, and the deferred items in §8 (music, colour customisation, speed controls). This document remains the source of truth for design intent — update it if implementation diverges.

---

## 1. Concept

A fully automatic, hands-off physics spectacle. N colours start; every leg, physics disturbs a pool of balls, the worst-performing colour is eliminated, and the game proceeds until one colour remains. No player interaction during a run beyond pause/fullscreen — press Start and watch, like territory-plinko.

## 2. Game structure

- **N starting colours → N−1 legs → 1 winner.** Losing a leg removes exactly one colour.
- **v1 target: 12 colours, 11 legs.** Architecture must scale to 24 (or any N) later without rework — colour count is a parameter, not a hardcoded assumption.
- Each leg:
  1. All currently-active colours release their ball allocation (see §4) at the level's defined release point(s).
  2. The level's physics primitives (§3) disturb/guide the balls.
  3. Balls are collected on contact with the level's green collection zone(s) (§5) and sorted live into ranked per-colour bins (§6).
  4. **The leg ends the instant N−1 of the N active colours have fully collected their allocation.** The one remaining (still-short) colour is eliminated immediately — any balls still in flight at that moment are discarded/irrelevant, they don't get a chance to catch up.
  5. A "LEG N" title card transitions to the next leg with one fewer colour.
- **Level sequence is fixed**, not shuffled (confirmed) — see §5 for the proposed v1 order.

## 3. Physics primitives

Levels are built by composing four primitives (not fixed "mechanic types" — a small orthogonal toolkit):

1. **Walls** — static or moving obstacles, arbitrary shapes (pillars, peg grids, funnels, shelves, cups — see §5 for concrete examples from reference footage). Movement can be periodic/scripted (position over time).
2. **Attractor fields** — circular regions that pull balls toward their centre; strength and position can both change over time. Can double as the collection zone itself (a level's centre can simultaneously attract and collect).
3. **Repulsor fields** — circular regions that push balls away; same movable/animatable properties as attractors. Used to create chaotic scatter that balls must escape toward a collector.
4. **Gravity** — a global directional force, normally downward but configurable per-level (including upward, or changing direction during a level).

Any level is some combination of these four, plus its own release point(s) and collection zone(s) — levels do not need to use all four primitives.

**No ball-to-ball collision.** Balls only interact with level geometry and fields, not each other. This keeps ~2,500 simultaneous bodies performant and produces the flowing/overlapping "crowd of dots" look seen throughout the reference footage — including densely packed-looking clusters (§5, Level 3) which are just heavy visual overlap, not physical packing.

Engine: **Matter.js**, vendored locally (as in territory-plinko). Balls are simple circle bodies with ball–ball collision filtering disabled; attractor/repulsor forces are applied manually per physics tick (not native Matter constraints) based on distance to field centres.

## 4. Ball economy

- **Total ball pool stays constant across the whole game: ~2,500 balls**, split evenly across the *currently active* colours each leg.
- Per-colour allocation = `floor(2500 / activeColourCount)`, recalculated each leg as colours drop out. At 12 colours that's ~208/colour; if it ever got down to 2 colours it'd be ~1,250/colour. This keeps visual density roughly consistent whether it's an early crowded leg or a late 1-on-1 finale.
- Balls carry no state between legs — each leg is a fresh release of the current allocation.

## 5. Level library (v1)

A level is a data/config object, not hardcoded logic — see §5.1 for the schema shape. **v1 library: 12 levels**, directly derived from reference footage (`reference/levels/` in this project — screenshots from the inspiration video, kept for internal design reference only). This exceeds the ~8–12 target, so one is held in reserve.

**Collection zones are colour-agnostic** — any ball touching green geometry is collected immediately regardless of colour; sorting into the correct bin happens downstream (§6), not by physical position. A small pink/magenta triangle marks each level's release point, matching the reference footage's convention — worth keeping as a consistent visual cue.

### Proposed v1 sequence (fixed order, legs 1–11; #12 held in reserve for later expansion)

| Leg | Level name | Primitives used | Collection zone |
|---|---|---|---|
| 1 | **Rising Pillars** | Moving walls (pillars cycling up/down at staggered phases) + downward gravity | Full-width line, bottom |
| 2 | **Bubble Field** | Static walls (dense overlapping-circle mesh, pachinko-style) + gravity | Full-width line, bottom |
| 3 | **Serpentine Chambers** | Static walls (sealed U/O chambers linked by staggered baffle shelves, forcing a snaking path) + gravity | Single zone, localized at the far exit only (not full-width) |
| 4 | **Vortex Well** | One central attractor field (pulls balls into a spiral) + near-zero gravity | Single circular zone at the attractor's centre (attractor *is* the collector) |
| 5 | **Gravity Wells** | Multiple attractor fields (orbs) creating slingshot/orbital arcs + downward gravity | Full-width line, bottom |
| 6 | **Diamond Funnel** | Static walls (X-lattice diagonal grid forming a funnel) + gravity | Single point, bottom-centre |
| 7 | **Twin-Row Gate** | Static walls (two staggered rows of large circular gaps) + gravity | Full-width line, bottom |
| 8 | **Sieve Shelves** | Static/moving walls (three staggered rows of gapped horizontal platforms) + gravity | Full-width line, bottom |
| 9 | **Horseshoe Cups** | Static walls (two staggered rows of catch-and-release cup shapes) + gravity | Full-width line, bottom |
| 10 | **Hex Pachinko** | Static walls (five dense rows of small hex pegs) + gravity | Full-width line, bottom |
| 11 | **Repulsor Chaos** | Multiple moving repulsor fields scattering balls + one attractor/collector amid them + gravity | Single circular zone (glowing, amid the repulsors) |
| *(reserve)* | **Jagged Half-Pipe** | Static walls (large saw-toothed bowl funnelling to a narrow gap) + gravity | Single point, bottom-centre |

This order roughly ramps complexity (simple full-width drops early → interior-point/attractor-combo levels later), which feels like reasonable pacing, but it's easy to reorder since level identity and leg number are decoupled in the data model.

### 5.1 Level data shape (concept, not final schema)

Each level config will need, roughly:
- `walls`: list of shapes (position, size/path, optional motion script)
- `attractors` / `repulsors`: list of fields (position or motion path, radius, strength)
- `gravity`: vector, optionally time-varying
- `releasePoints`: where/how balls enter (single point, spread, multiple points)
- `collectionZones`: one or more trigger shapes (line, polygon, circle)
- optional per-level visual theming (background tint — reference footage varies this, e.g. Level 5's warm dark background vs. pure black elsewhere)

Kept data-driven specifically so a future level editor (§9) can generate/edit this same structure — v1 just hand-writes the configs.

## 6. Collection & ranking display

- On collection, a ball disappears from the physics sim and a **light-ray animation** streaks from its collection point down to its colour's bin at the bottom of the screen, incrementing that bin's count.
- **Bottom bins are literal live bar-chart columns**: each active colour's bar height grows in proportion to how many of its balls have been collected *this leg*, and bars **reorder live** (descending, left to right) as counts change — confirmed directly from reference footage (e.g. Leg 10 shows a clear descending staircase of bar heights).
- When a colour completes its full leg allocation, its bar **locks at full height and gets a checkmark badge** (confirmed choice, replacing the earlier "TBD" marker).
- **Eliminated colours persist in the bin row** as a visual "graveyard": once a colour is eliminated (loses a leg), its column turns into a black bar with an **X cross-hatch mark**, grouped together at the right-hand end of the row, and stays there for the rest of the game (confirmed pattern seen consistently in every reference screenshot from Leg 2 onward). This means the full bin row always shows all N starting colours — active ones ranked live on the left, eliminated ones parked as X'd-out columns on the right.
- Leg-end (§2.4) is detected directly from bin-full state, not a separate timer check.

## 7. Stall detection & recovery

- Some level/primitive combinations could theoretically reach a stable equilibrium where balls stop reaching the collection zone (e.g. balanced attractor/repulsor fields).
- **v1 approach (confirmed):** track time since the last successful collection. If no ball is collected for **8 seconds**, apply a **gentle random jitter impulse** to all balls still in play to break the deadlock. Expectation is this rarely triggers once levels are properly tuned — level testing is the primary defence, this is just a safety net.
- Recovery strategy is intentionally swappable later (force-collect remaining balls into current standings, or full leg restart) — implemented behind a config flag, not hardcoded, in case jitter proves insufficient once real levels are built.

## 8. v1 scope

**In scope:**
- 12 starting colours, **fixed palette (12-colour subset of territory-plinko's palette, chosen below), no name/colour customisation UI**
- 11 legs, level library of 12 levels (11 used in sequence, 1 held in reserve)
- ~2,500 total balls, evenly reallocated across active colours each leg
- No ball-to-ball collision
- Live-reordering, live-growing ranked collection bins with light-ray animation, checkmark badge on completion, X'd-out graveyard bars for eliminated colours
- Stall detection (8s threshold) with gentle jitter recovery
- Playback controls: **Pause and Fullscreen only** — no speed control (fixed 1×)
- Music: same pattern as territory-plinko — bundled default track (credited per its licence) + choose-your-own-file + no-music option, remembered in `localStorage`
- Fully automatic: press Start, watch to a winner
- Static site: plain HTML/CSS/JS, Matter.js vendored, no build step, deployable to GitHub Pages

**Explicitly deferred (not v1):**
- Colour/name customisation
- Speed controls (1×–16×)
- 24-colour (or other N) support beyond architectural readiness
- Visual level editor
- Alternate stall-recovery strategies
- Any recording/export feature

## 9. v2 / stretch goals (not now)

- **Level editor**: author walls (with shapes), attractors, repulsors, gravity, release/collection points visually, producing the same JSON schema §5.1 uses — deferred specifically so v1's data format is designed with this in mind rather than needing a rewrite.
- Support for other colour counts (24, 6, etc.) with an expanded or smarter-reused level library (the reserved 12th level, plus new ones, would come in here).
- Colour/name customisation UI, speed controls — same pattern as territory-plinko, just not built first.
- Reconsider stall recovery (force-collect / full restart) if jitter proves insufficient once real levels are built.

## 10. Remaining open items

Most prior open questions are now resolved (level order: fixed; stall threshold: 8s + gentle jitter; bin-full marker: checkmark; palette: reuse territory-plinko's; level references: provided, see §5). What's left:

1. **Level 3 & 12's non-full-width collection zones** — these need a slightly different visual treatment for the ray animation (starting from a localized point rather than sweeping along a line). Not a blocker, just noting it as an implementation detail to get right.
2. **Per-level background theming** — worth doing for visual variety (per reference footage), but purely cosmetic; can default to plain black and refine later.

Spec is otherwise considered **complete — ready for v1 implementation.**

## 11. v1 palette (12 colours)

territory-plinko's `ball` colour is always a hue-preserving "brightened" version of the tile colour (`brighten()` in [`js/teams.js`](../territory-plinko/js/teams.js) raises lightness/saturation but never shifts hue). That means its 24 solids actually only span **~9 truly distinct hues** — several entries (e.g. Forest/Green/Mint, or Navy/Periwinkle/Blue) render as near-identical ball colours once brightened, differing only in the original tile's lightness. That's fine at territory-plinko's scale (colour = a whole owned region, read at leisure) but riskier here, where colour ID has to be read at a glance from small, fast-moving dots.

Chosen 12 — one representative from each of the 9 distinct hues, plus three deliberate light/dark pairs within a hue (still distinguishable by lightness/saturation, and reflects the tonal variety seen in the reference footage — e.g. dark vs. vivid greens, medium vs. light greys):

| Colour | Hex (tile) | Hue | Note |
|---|---|---|---|
| Red | `#d40000` | 0° | |
| Orange | `#d9730d` | 30° | paired with Brown |
| Brown | `#7a3a00` | 29° | darker/muted partner to Orange |
| Mustard | `#a8a000` | 57° | the one yellow |
| Green | `#00a000` | 120° | paired with Forest |
| Forest | `#005a00` | 120° | darker partner to Green |
| Cyan | `#00b0b8` | 183° | the one cyan/teal |
| Blue | `#0000c8` | 240° | the one blue |
| Purple | `#6b00b5` | 276° | the one violet |
| Magenta | `#b400b4` | 300° | the one magenta |
| Grey | `#606060` | — | paired with Silver |
| Silver | `#b0b0b0` | — | lighter partner to Grey |

This is a judgement call, not a hard science — if any pairing reads as too similar once balls are actually flying around on screen, it's a one-line swap (e.g. drop Brown or Forest for Indigo/Teal/Navy and accept a closer-but-still-distinct hue instead of a same-hue shade pair).

---

*Next step once the above is settled: turn §5's level concepts into actual level configs (data, not code) for review, then begin implementation in the order: physics core (balls + 4 primitives, no visuals) → one level end-to-end → ranking/bin UI → full level library → music/setup screen → polish.*

---

## Appendix: reference footage index

Screenshots in `reference/levels/` (source: *Mega Team Elimination Marble Race #2*, MIKAN — inspiration only):

| File | Leg shown | Level concept |
|---|---|---|
| `SCR-20260922-rrae.jpeg` | 1 | Rising Pillars |
| `SCR-20260922-rrdg.png` | 2 | Bubble Field |
| `SCR-20260922-rrfv.png` | 3 | Serpentine Chambers |
| `SCR-20260922-rrka.png` | 4 | Vortex Well |
| `SCR-20260922-rrms.jpeg` | 5 | Gravity Wells |
| `SCR-20260922-rrpl.png` | 6 | Diamond Funnel |
| `SCR-20260922-rrso.jpeg` | 7 | Twin-Row Gate |
| `SCR-20260922-rrvg.jpeg` | 8 | Sieve Shelves |
| `SCR-20260922-rryn.jpeg` | 9 | Horseshoe Cups |
| `SCR-20260922-rsax.jpeg` | 10 | Hex Pachinko |
| `SCR-20260922-rsdh.jpeg` | 11 | Repulsor Chaos |
| `SCR-20260922-rsgr.jpeg` | 12 | Jagged Half-Pipe |
| `SCR-20260922-rrbt.jpeg` | 2 | (Browser chrome showing the source video title/channel — context only) |
