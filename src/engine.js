/**
 * TORA — pure, deterministic wood-block-puzzle engine for the RoqueOS Games
 * gallery. An 8×8 board and a tray of three polyomino pieces: drag a piece onto
 * empty cells, and any fully-filled row OR column clears. You lose when none of
 * the three tray pieces fits anywhere; you clear a level by surviving a target
 * number of placements (then the pieces get gnarlier and the target grows).
 *
 * Framework-free and fully unit-testable — the component owns the Three.js
 * render, the drag interaction, sound and animation. Pieces do NOT rotate (you
 * place them as shown, Woody-style), so every orientation is its own shape in
 * the bag. Randomness is a seeded mulberry32 so runs are reproducible.
 */

export function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const SIZE = 8
export const TRAY = 3

// Warm wood tones — each piece takes one, and keeps it once placed, so the
// board reads like a marquetry of different woods rather than one flat colour.
export const WOODS = [
  '#d9a441', // honey oak
  '#c77b3b', // teak
  '#a9552e', // cherry
  '#8c5a3c', // walnut
  '#b8863f', // ash
  '#7c8f4b', // olive
  '#5f7d8c', // grey-blue driftwood
  '#9c5b86', // violet heartwood
]

// Normalized cell lists ([row, col], top-left at 0,0). Because pieces don't
// rotate, each orientation is a distinct shape. Grouped by "tier" (how hard it
// is to fit) so the bag can lean easy early and gnarly later.
export const SHAPES = {
  // tier 0 — trivially placeable
  dot: [[0, 0]],
  d2h: [
    [0, 0],
    [0, 1],
  ],
  d2v: [
    [0, 0],
    [1, 0],
  ],
  // tier 1 — small
  i3h: [
    [0, 0],
    [0, 1],
    [0, 2],
  ],
  i3v: [
    [0, 0],
    [1, 0],
    [2, 0],
  ],
  sq2: [
    [0, 0],
    [0, 1],
    [1, 0],
    [1, 1],
  ],
  Lc0: [
    [0, 0],
    [1, 0],
    [1, 1],
  ],
  Lc1: [
    [0, 0],
    [0, 1],
    [1, 0],
  ],
  Lc2: [
    [0, 0],
    [0, 1],
    [1, 1],
  ],
  Lc3: [
    [0, 1],
    [1, 0],
    [1, 1],
  ],
  // tier 2 — medium
  i4h: [
    [0, 0],
    [0, 1],
    [0, 2],
    [0, 3],
  ],
  i4v: [
    [0, 0],
    [1, 0],
    [2, 0],
    [3, 0],
  ],
  T0: [
    [0, 0],
    [0, 1],
    [0, 2],
    [1, 1],
  ],
  T1: [
    [0, 1],
    [1, 0],
    [1, 1],
    [2, 1],
  ],
  L0: [
    [0, 0],
    [1, 0],
    [2, 0],
    [2, 1],
  ],
  L1: [
    [0, 0],
    [0, 1],
    [0, 2],
    [1, 0],
  ],
  J0: [
    [0, 1],
    [1, 1],
    [2, 1],
    [2, 0],
  ],
  J1: [
    [0, 0],
    [1, 0],
    [1, 1],
    [1, 2],
  ],
  S0: [
    [0, 1],
    [0, 2],
    [1, 0],
    [1, 1],
  ],
  Z0: [
    [0, 0],
    [0, 1],
    [1, 1],
    [1, 2],
  ],
  // tier 3 — hard (big footprints)
  i5h: [
    [0, 0],
    [0, 1],
    [0, 2],
    [0, 3],
    [0, 4],
  ],
  i5v: [
    [0, 0],
    [1, 0],
    [2, 0],
    [3, 0],
    [4, 0],
  ],
  rect23: [
    [0, 0],
    [0, 1],
    [0, 2],
    [1, 0],
    [1, 1],
    [1, 2],
  ],
  rect32: [
    [0, 0],
    [0, 1],
    [1, 0],
    [1, 1],
    [2, 0],
    [2, 1],
  ],
  bigL: [
    [0, 0],
    [1, 0],
    [2, 0],
    [2, 1],
    [2, 2],
  ],
  sq3: [
    [0, 0],
    [0, 1],
    [0, 2],
    [1, 0],
    [1, 1],
    [1, 2],
    [2, 0],
    [2, 1],
    [2, 2],
  ],
}

const TIERS = [
  ['dot', 'd2h', 'd2v'],
  ['i3h', 'i3v', 'sq2', 'Lc0', 'Lc1', 'Lc2', 'Lc3'],
  ['i4h', 'i4v', 'T0', 'T1', 'L0', 'L1', 'J0', 'J1', 'S0', 'Z0'],
  ['i5h', 'i5v', 'rect23', 'rect32', 'bigL', 'sq3'],
]

const emptyGrid = () => Array.from({ length: SIZE }, () => new Array(SIZE).fill(null))

/** Footprint width/height of a normalized cell list. */
export function bounds(cells) {
  let w = 0
  let h = 0
  for (const [r, c] of cells) {
    if (c + 1 > w) w = c + 1
    if (r + 1 > h) h = r + 1
  }
  return { w, h }
}

/** Per-level tuning: how many placements to clear it, and the tier mix. */
export function levelConfig(level) {
  const lvl = Math.max(1, level)
  // Weighted tier probabilities that shift toward big pieces as levels climb.
  const t0 = Math.max(0.06, 0.34 - lvl * 0.03)
  const t1 = 0.4
  const t3 = Math.min(0.34, 0.04 + lvl * 0.035)
  const t2 = Math.max(0.12, 1 - t0 - t1 - t3)
  return {
    target: 10 + lvl * 3, // placements needed to clear the level
    weights: [t0, t1, t2, t3],
  }
}

function pickShapeId(rng, weights) {
  let x = rng()
  let tier = 0
  for (let i = 0; i < weights.length; i++) {
    if (x < weights[i]) {
      tier = i
      break
    }
    x -= weights[i]
    tier = i
  }
  const pool = TIERS[tier]
  return pool[Math.floor(rng() * pool.length)]
}

function makePiece(rng, weights) {
  const shapeId = pickShapeId(rng, weights)
  const cells = SHAPES[shapeId]
  return {
    shapeId,
    cells: cells.map(([r, c]) => [r, c]),
    ...bounds(cells),
    color: WOODS[Math.floor(rng() * WOODS.length)],
    size: cells.length,
  }
}

/** Fill any empty tray slots. Bias-guarantees at least one placeable piece. */
export function refillTray(state) {
  const { weights } = levelConfig(state.level)
  for (let i = 0; i < TRAY; i++) {
    if (!state.tray[i]) state.tray[i] = makePiece(state.rng, weights)
  }
  // Anti-frustration: if a freshly-filled full tray can't be placed at all,
  // reroll the largest piece down to a guaranteed-fittable small one.
  let guard = 0
  while (state.tray.every(Boolean) && !hasAnyMove(state) && guard < 12) {
    let big = 0
    for (let i = 1; i < TRAY; i++) if (state.tray[i].size > state.tray[big].size) big = i
    const small = TIERS[0][Math.floor(state.rng() * TIERS[0].length)]
    const cells = SHAPES[small]
    state.tray[big] = {
      shapeId: small,
      cells: cells.map(([r, c]) => [r, c]),
      ...bounds(cells),
      color: WOODS[Math.floor(state.rng() * WOODS.length)],
      size: cells.length,
    }
    guard++
  }
  return state
}

export function createGame(seed = 1, opts = {}) {
  return {
    status: 'idle', // 'idle' | 'playing' | 'over'
    seed: seed >>> 0,
    rng: mulberry32(seed),
    grid: emptyGrid(),
    tray: [null, null, null],
    score: 0,
    best: opts.best || 0,
    combo: 0,
    level: 1,
    moves: 0, // placements made in the current level
    target: levelConfig(1).target,
    lastClear: { rows: [], cols: [], count: 0 },
    leveledUp: false,
  }
}

export function startGame(state) {
  state.rng = mulberry32(state.seed)
  state.grid = emptyGrid()
  state.tray = [null, null, null]
  state.score = 0
  state.combo = 0
  state.level = 1
  state.moves = 0
  state.target = levelConfig(1).target
  state.lastClear = { rows: [], cols: [], count: 0 }
  state.leveledUp = false
  state.status = 'playing'
  refillTray(state)
  return state
}

/** True if every cell of `cells` offset by (r0,c0) is in-bounds and empty. */
export function canPlaceAt(grid, cells, r0, c0) {
  for (const [dr, dc] of cells) {
    const r = r0 + dr
    const c = c0 + dc
    if (r < 0 || c < 0 || r >= SIZE || c >= SIZE) return false
    if (grid[r][c]) return false
  }
  return true
}

/** Does `piece` fit anywhere on `grid`? */
export function anyPlacement(grid, piece) {
  for (let r = 0; r <= SIZE - piece.h; r++) {
    for (let c = 0; c <= SIZE - piece.w; c++) {
      if (canPlaceAt(grid, piece.cells, r, c)) return true
    }
  }
  return false
}

/** Can any current tray piece be placed somewhere? */
export function hasAnyMove(state) {
  return state.tray.some((p) => p && anyPlacement(state.grid, p))
}

/** Full rows + full cols on the grid (as index lists). */
export function fullLines(grid) {
  const rows = []
  const cols = []
  for (let r = 0; r < SIZE; r++) {
    if (grid[r].every((c) => c)) rows.push(r)
  }
  for (let c = 0; c < SIZE; c++) {
    let full = true
    for (let r = 0; r < SIZE; r++)
      if (!grid[r][c]) {
        full = false
        break
      }
    if (full) cols.push(c)
  }
  return { rows, cols }
}

/**
 * Place tray[index] with its top-left at (r0,c0). Clears full lines, scores,
 * refills the tray when empty, advances the level on hitting the target, and
 * flags game-over when nothing fits. Returns a result summary (also stashed on
 * state.lastClear / state.leveledUp for the render layer).
 */
export function place(state, index, r0, c0) {
  const nil = { ok: false }
  if (state.status !== 'playing') return nil
  const piece = state.tray[index]
  if (!piece || !canPlaceAt(state.grid, piece.cells, r0, c0)) return nil

  for (const [dr, dc] of piece.cells) state.grid[r0 + dr][c0 + dc] = { color: piece.color }
  state.tray[index] = null
  state.moves += 1

  let points = piece.cells.length // 1 per placed cell
  const { rows, cols } = fullLines(state.grid)
  const lineCount = rows.length + cols.length
  const clearedCells = new Set()
  if (lineCount > 0) {
    for (const r of rows) for (let c = 0; c < SIZE; c++) clearedCells.add(r * SIZE + c)
    for (const c of cols) for (let r = 0; r < SIZE; r++) clearedCells.add(r * SIZE + c)
    for (const key of clearedCells) state.grid[Math.floor(key / SIZE)][key % SIZE] = null
    state.combo += 1
    // 10 per cleared cell, ×lineCount (multi-line combo), ×combo streak.
    points += clearedCells.size * 10 * lineCount * state.combo
  } else {
    state.combo = 0
  }
  state.score += points
  if (state.score > state.best) state.best = state.score
  state.lastClear = { rows, cols, count: lineCount }

  // Level clear → survive `target` placements, then ramp up (board carries over).
  state.leveledUp = false
  if (state.moves >= state.target) {
    state.level += 1
    state.moves = 0
    state.target = levelConfig(state.level).target
    state.leveledUp = true
  }

  if (state.tray.every((p) => !p)) refillTray(state)
  if (!hasAnyMove(state)) state.status = 'over'

  return {
    ok: true,
    points,
    clearedRows: rows,
    clearedCols: cols,
    lineCount,
    clearedCells: [...clearedCells],
    leveledUp: state.leveledUp,
    over: state.status === 'over',
  }
}

export const isOver = (state) => state.status === 'over'
