import { describe, it, expect } from 'vitest'
import {
  mulberry32,
  createGame,
  startGame,
  canPlaceAt,
  anyPlacement,
  hasAnyMove,
  fullLines,
  place,
  bounds,
  levelConfig,
  refillTray,
  isOver,
  SIZE,
  TRAY,
  SHAPES,
} from '../src/engine.js'

// Build a piece object the way makePiece does, but deterministically.
const piece = (shapeId, color = '#fff') => {
  const cells = SHAPES[shapeId].map(([r, c]) => [r, c])
  const b = bounds(cells)
  return { shapeId, cells, ...b, color, size: cells.length }
}

describe('tora/engine — primitives', () => {
  it('mulberry32 is deterministic per seed', () => {
    const a = mulberry32(7)
    const b = mulberry32(7)
    expect([a(), a(), a()]).toEqual([b(), b(), b()])
    expect(mulberry32(8)()).not.toBe(mulberry32(7)())
  })

  it('bounds returns the footprint w/h', () => {
    expect(bounds([[0, 0]])).toEqual({ w: 1, h: 1 })
    expect(bounds(SHAPES.i4h)).toEqual({ w: 4, h: 1 })
    expect(bounds(SHAPES.i5v)).toEqual({ w: 1, h: 5 })
    expect(bounds(SHAPES.sq3)).toEqual({ w: 3, h: 3 })
  })

  it('levelConfig grows the target and keeps weights ~normalized', () => {
    const l1 = levelConfig(1)
    const l5 = levelConfig(5)
    expect(l5.target).toBeGreaterThan(l1.target)
    const sum = l1.weights.reduce((a, b) => a + b, 0)
    expect(sum).toBeGreaterThan(0.98)
    expect(sum).toBeLessThan(1.02)
    // harder levels lean toward the big-piece tier
    expect(l5.weights[3]).toBeGreaterThan(l1.weights[3])
  })
})

describe('tora/engine — placement checks', () => {
  it('canPlaceAt respects bounds and occupancy', () => {
    const g = createGame(1).grid
    expect(canPlaceAt(g, SHAPES.sq2, 0, 0)).toBe(true)
    expect(canPlaceAt(g, SHAPES.i4h, 0, SIZE - 3)).toBe(false) // runs off the right edge
    expect(canPlaceAt(g, SHAPES.i5v, SIZE - 4, 0)).toBe(false) // runs off the bottom
    g[0][1] = { color: '#000' }
    expect(canPlaceAt(g, SHAPES.d2h, 0, 0)).toBe(false) // (0,1) occupied
    expect(canPlaceAt(g, SHAPES.d2h, 0, 2)).toBe(true)
  })

  it('anyPlacement finds a spot when one exists and none when full', () => {
    const g = createGame(1).grid
    expect(anyPlacement(g, piece('dot'))).toBe(true)
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) g[r][c] = { color: '#000' }
    expect(anyPlacement(g, piece('dot'))).toBe(false)
  })

  it('hasAnyMove is true at game start, false on a full board', () => {
    const s = startGame(createGame(3))
    expect(hasAnyMove(s)).toBe(true)
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) s.grid[r][c] = { color: '#000' }
    expect(hasAnyMove(s)).toBe(false)
  })

  it('fullLines detects complete rows and columns', () => {
    const g = createGame(1).grid
    for (let c = 0; c < SIZE; c++) g[2][c] = { color: '#000' } // row 2 full
    for (let r = 0; r < SIZE; r++) g[r][5] = { color: '#000' } // col 5 full
    const { rows, cols } = fullLines(g)
    expect(rows).toEqual([2])
    expect(cols).toEqual([5])
  })
})

describe('tora/engine — lifecycle', () => {
  it('createGame is idle with an empty grid and empty tray', () => {
    const s = createGame(1)
    expect(s.status).toBe('idle')
    expect(s.tray).toEqual([null, null, null])
    expect(s.grid.length).toBe(SIZE)
    expect(s.grid.every((row) => row.every((c) => c === null))).toBe(true)
  })

  it('startGame fills the tray with 3 pieces and goes playing', () => {
    const s = startGame(createGame(42))
    expect(s.status).toBe('playing')
    expect(s.tray.filter(Boolean).length).toBe(TRAY)
    expect(s.tray.every((p) => Array.isArray(p.cells) && p.cells.length > 0)).toBe(true)
  })
})

describe('tora/engine — place', () => {
  it('writes cells, removes the tray piece, scores per cell', () => {
    const s = startGame(createGame(5))
    // keep two other pieces so the tray doesn't auto-refill after this place
    s.tray = [piece('sq2', '#aaa'), piece('dot'), piece('dot')]
    const res = place(s, 0, 0, 0)
    expect(res.ok).toBe(true)
    expect(res.points).toBe(4) // 4 cells, no clear
    expect(s.tray[0]).toBe(null)
    expect(s.grid[0][0]).toEqual({ color: '#aaa' })
    expect(s.grid[1][1]).toEqual({ color: '#aaa' })
    expect(s.score).toBe(4)
    expect(s.moves).toBe(1)
  })

  it('rejects an invalid placement (occupied / out of bounds)', () => {
    const s = startGame(createGame(5))
    s.tray = [piece('dot'), null, null]
    s.grid[0][0] = { color: '#000' }
    expect(place(s, 0, 0, 0).ok).toBe(false)
    expect(place(s, 0, -1, 0).ok).toBe(false)
    expect(s.tray[0]).not.toBe(null) // piece not consumed on failure
  })

  it('clears a completed row and bumps the combo', () => {
    const s = startGame(createGame(9))
    // Pre-fill row 0 except the last cell, then drop a dot to complete it.
    for (let c = 0; c < SIZE - 1; c++) s.grid[0][c] = { color: '#000' }
    s.tray = [piece('dot', '#fff'), null, null]
    const res = place(s, 0, 0, SIZE - 1)
    expect(res.ok).toBe(true)
    expect(res.lineCount).toBe(1)
    expect(res.clearedRows).toEqual([0])
    expect(s.grid[0].every((c) => c === null)).toBe(true) // row cleared
    expect(s.combo).toBe(1)
    expect(s.score).toBeGreaterThan(1) // cell + line-clear bonus
  })

  it('clears a completed column', () => {
    const s = startGame(createGame(11))
    for (let r = 0; r < SIZE - 1; r++) s.grid[r][3] = { color: '#000' }
    s.tray = [piece('dot', '#fff'), null, null]
    const res = place(s, 0, SIZE - 1, 3)
    expect(res.clearedCols).toEqual([3])
    for (let r = 0; r < SIZE; r++) expect(s.grid[r][3]).toBe(null)
  })

  it('resets the combo when a placement clears nothing', () => {
    const s = startGame(createGame(13))
    s.combo = 3
    s.tray = [piece('dot'), null, null]
    place(s, 0, 4, 4)
    expect(s.combo).toBe(0)
  })

  it('refills the tray once all three pieces are placed', () => {
    const s = startGame(createGame(21))
    s.tray = [piece('dot'), piece('dot'), piece('dot')]
    place(s, 0, 0, 0)
    place(s, 1, 0, 2)
    expect(s.tray.filter(Boolean).length).toBe(1)
    place(s, 2, 0, 4)
    // tray emptied → refilled to 3
    expect(s.tray.filter(Boolean).length).toBe(TRAY)
  })

  it('levels up after reaching the target number of placements', () => {
    const s = startGame(createGame(31))
    s.target = 2
    s.level = 1
    s.tray = [piece('dot'), piece('dot'), null]
    place(s, 0, 0, 0)
    expect(s.leveledUp).toBe(false)
    const res = place(s, 1, 0, 2)
    expect(res.leveledUp).toBe(true)
    expect(s.level).toBe(2)
    expect(s.moves).toBe(0)
    expect(s.target).toBe(levelConfig(2).target)
  })

  it('goes over when no tray piece fits after a placement', () => {
    const s = startGame(createGame(41))
    // Fill the whole board except a single cell (0,0), leave a lone dot.
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) s.grid[r][c] = { color: '#000' }
    s.grid[0][0] = null
    s.tray = [piece('dot'), null, null]
    const res = place(s, 0, 0, 0) // fills the last hole → clears row0+col0, but board otherwise packed
    expect(res.ok).toBe(true)
    // After clearing row 0 and col 0 there ARE empties again, so it should NOT be over.
    expect(isOver(s)).toBe(false)
  })

  it('refillTray guarantees at least one placeable piece (anti-frustration)', () => {
    const s = startGame(createGame(55))
    // Near-full board with a scattering of single holes that only a dot fits.
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) s.grid[r][c] = { color: '#000' }
    s.grid[0][0] = null
    s.grid[7][7] = null
    s.tray = [null, null, null]
    refillTray(s)
    expect(hasAnyMove(s)).toBe(true)
  })
})

describe('tora/engine: a última linha e a última coluna também são lugar', () => {
  /**
   * `r <= SIZE - piece.h` inclui a linha em que a peça encosta na borda de
   * baixo. Apertado para `<`, a varredura nunca chega lá: uma peça que só cabe
   * no canto inferior direito passa a ser lida como "não cabe", e a partida
   * termina em Game Over com o tabuleiro aberto na frente do jogador.
   */
  const soVaziaEm = (celulas) => {
    const g = Array.from({ length: SIZE }, () => new Array(SIZE).fill(null))
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) g[r][c] = { color: '#000' }
    for (const [r, c] of celulas) g[r][c] = null
    return g
  }

  it('acha a única vaga quando ela está no canto de baixo à direita', () => {
    const g = soVaziaEm([[SIZE - 1, SIZE - 1]])
    expect(canPlaceAt(g, SHAPES.dot, SIZE - 1, SIZE - 1)).toBe(true)
    expect(anyPlacement(g, piece('dot'))).toBe(true)
  })

  it('acha a peça de duas casas encostada na borda de baixo', () => {
    const g = soVaziaEm([
      [SIZE - 1, SIZE - 2],
      [SIZE - 1, SIZE - 1],
    ])
    expect(anyPlacement(g, piece('d2h'))).toBe(true)
  })

  it('e o Game Over continua sendo Game Over quando não há mesmo vaga', () => {
    const g = soVaziaEm([])
    expect(anyPlacement(g, piece('dot'))).toBe(false)
  })
})
