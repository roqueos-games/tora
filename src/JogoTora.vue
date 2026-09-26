<template>
  <div
    ref="rootRef"
    class="ros-tora"
    :class="{ 'ros-tora--touch': isTouch, 'ros-tora--low': modoLeve }"
    :dir="estado.idioma === 'ar-AR' ? 'rtl' : 'ltr'"
  >
    <div ref="canvasHost" class="ros-tora__canvas" />

    <!-- HUD -->
    <div class="ros-tora__hud">
      <div class="ros-tora__stat ros-tora__stat--score">
        <span class="ros-tora__stat-label">{{ txt('score') }}</span>
        <span class="ros-tora__stat-value">{{ score }}</span>
      </div>
      <div class="ros-tora__level">
        <div class="ros-tora__level-top">
          <span>{{ txt('level', { n: level }) }}</span>
          <span class="ros-tora__best">★ {{ best }}</span>
        </div>
        <div class="ros-tora__bar">
          <div class="ros-tora__bar-fill" :style="{ width: levelPct + '%' }" />
        </div>
      </div>
      <div class="ros-tora__actions">
        <button class="ros-tora__icon-btn" :aria-label="txt('sound')" @click="toggleMute">
          <Icone :nome="muted ? 'mudo' : 'som'" :tamanho="20" />
        </button>
        <button class="ros-tora__icon-btn" :aria-label="txt('retry')" @click="restart">
          <Icone nome="reiniciar" :tamanho="20" />
        </button>
      </div>
    </div>

    <!-- Level-up toast -->
    <transition name="ros-tora-toast">
      <div v-if="levelToast" class="ros-tora__toast">
        <span class="ros-tora__toast-big">{{ txt('levelUp') }}</span>
        <span class="ros-tora__toast-sub">{{ txt('level', { n: level }) }}</span>
      </div>
    </transition>

    <!-- Start / Game over overlay -->
    <transition name="ros-tora-fade">
      <div v-if="overlay" class="ros-tora__overlay">
        <div class="ros-tora__card">
          <div class="ros-tora__logo">{{ txt('title') }}</div>
          <template v-if="overlay === 'start'">
            <p class="ros-tora__tagline">{{ txt('tagline') }}</p>
            <p class="ros-tora__hint">{{ isTouch ? txt('hintTouch') : txt('hintMouse') }}</p>
            <button class="ros-tora__play" @click="start">{{ txt('play') }}</button>
          </template>
          <template v-else>
            <p class="ros-tora__over">{{ txt('over') }}</p>
            <div class="ros-tora__final">
              <div>
                <span class="ros-tora__final-label">{{ txt('score') }}</span>
                <span class="ros-tora__final-value">{{ score }}</span>
              </div>
              <div>
                <span class="ros-tora__final-label">{{ txt('levelLabel') }}</span>
                <span class="ros-tora__final-value">{{ level }}</span>
              </div>
              <div v-if="isRecord" class="ros-tora__record">{{ txt('newRecord') }}</div>
            </div>
            <button class="ros-tora__play" @click="restart">{{ txt('retry') }}</button>
          </template>
        </div>
      </div>
    </transition>
  </div>
</template>

<script setup>
// O Tora. Fala com o sistema só pelo `host` do jogo-sdk: placar, áudio, modo
// leve, métricas e armazenamento chegam por ele, e é por isso que o mesmo
// arquivo roda dentro do RoqueOS, no `yarn dev` do repo e no teste.
//
// O que toca a GPU (renderer e as opções dele, pixel ratio, tamanho do canvas,
// tone mapping, sombras, materiais, texturas de madeira, ambiente PMREM, luzes,
// geometrias e o corte de qualidade do modo leve) veio do componente do RoqueOS
// SEM MUDANÇA, em 25/09/2026. Só mudou de onde vêm o modo leve, o áudio, o
// texto e o placar. Mexer ali pede teste no iPhone de verdade antes de subir:
// verde no desktop não é verde no iPhone.
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import * as THREE from 'three'
import { emModoE2E } from '@roqueos-games/jogo-sdk'
import {
  createGame,
  startGame,
  place as enginePlace,
  canPlaceAt,
  SIZE,
  TRAY,
  WOODS,
} from './engine.js'
import { criarSom } from './som.js'
import { traduzir } from './textos.js'
import Icone from './Icone.vue'

const props = defineProps({
  /** O host do contrato v1 do jogo-sdk. */
  host: { type: Object, required: true },
  /** `{ ativo, idioma, textos }`, reativo; quem escreve é o `montar` do jogo. */
  estado: { type: Object, required: true },
})

// O `initThree` lá embaixo tem um `host` só dele (o elemento do canvas) que
// esconde este dentro da função. Ficou assim porque aquele trecho é código de
// GPU e viaja sem mudança; ele não usa o host do SDK.
const host = props.host
const txt = (chave, valores) => traduzir(props.estado.textos, chave, valores)

const rootRef = ref(null)
const canvasHost = ref(null)
const isTouch = ref(false)
const muted = ref(false)
const score = ref(0)
const best = ref(0)
const level = ref(1)
const movesRef = ref(0)
const targetRef = ref(1)
const overlay = ref('start') // 'start' | 'over' | null
const levelToast = ref(false)
const isRecord = ref(false)
// O perfil leve para o CSS. O `lowEnd` de baixo é o mesmo valor, para o three.
const modoLeve = ref(false)

const levelPct = computed(() =>
  targetRef.value ? Math.min(100, Math.round((movesRef.value / targetRef.value) * 100)) : 0,
)

let game = createGame(1)
let lowEnd = false
let pararIdentidade = null

// ── Three.js globals ─────────────────────────────────────────────────────────
let renderer = null
let scene = null
let camera = null
let raycaster = null
let rafId = null
let resizeObserver = null
let disposables = []
let blockGroup = null // placed board blocks
let trayGroup = null // the three home pieces
let previewGroup = null // green/red target tiles while dragging
let burstGroup = null // clear-particles
const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
const woodMatCache = new Map()
let blockGeo = null
let previewGeo = null

// Board geometry constants (world units)
const CELL = 1
const GAP = 0.09
const BLOCK = CELL - GAP
const BLOCK_H = 0.5
const HALF = (SIZE - 1) / 2
const TRAY_SCALE = 0.64
const TRAY_Z = HALF + 1.9
const TRAY_SPREAD = 2.4 // horizontal gap between the three tray homes
const LIFT = 1.15 // how high a grabbed piece floats above the board

const worldX = (c) => c - HALF
const worldZ = (r) => r - HALF

// Drag state
let dragging = false
let dragGroup = null
let dragPiece = null
let dragIndex = -1
let dragTarget = new THREE.Vector3()
let pending = { r0: 0, c0: 0, ok: false }
let dragPointerId = null
const pointerNdc = new THREE.Vector2()

// Orbit camera (spherical around the board). Drag on empty space rotates the
// view (theta = around, phi = tilt); two-finger pinch / mouse wheel zooms. `fit`
// is the aspect-dependent base distance (set in frameCamera); zoom scales it.
const CAM_TARGET = new THREE.Vector3(0, -0.15, 1.0)
const orbit = { theta: 0, phi: 0.78, fit: 15, zoom: 1 }
const MIN_PHI = 0.26
const MAX_PHI = 1.16
const MIN_ZOOM = 0.6
const MAX_ZOOM = 1.75
const pointers = new Map() // pointerId → {x, y}
let orbitDown = null // { x, y, theta, phi } while dragging empty space
let pinch = null // { dist, zoom } while two fingers are down

const track = (o) => {
  disposables.push(o)
  return o
}

// ── Textures & materials (premium warm wood) ─────────────────────────────────
const makeWoodCanvas = (hex, seedShift = 0) => {
  const cv = document.createElement('canvas')
  cv.width = 128
  cv.height = 128
  let g = null
  try {
    g = cv.getContext('2d')
  } catch {
    g = null
  }
  if (!g) return cv
  const base = new THREE.Color(hex)
  const dark = base.clone().multiplyScalar(0.62)
  const light = base.clone().multiplyScalar(1.16)
  g.fillStyle = `rgb(${(base.r * 255) | 0},${(base.g * 255) | 0},${(base.b * 255) | 0})`
  g.fillRect(0, 0, 128, 128)
  // vertical wood grain: layered wavy streaks
  for (let i = 0; i < 46; i++) {
    const x = ((i * 17 + seedShift * 31) % 128) + Math.sin(i * 1.7 + seedShift) * 6
    const mix = (Math.sin(i * 2.3 + seedShift) + 1) / 2
    const col = dark.clone().lerp(light, mix)
    g.strokeStyle = `rgba(${(col.r * 255) | 0},${(col.g * 255) | 0},${(col.b * 255) | 0},${0.14 + mix * 0.16})`
    g.lineWidth = 0.7 + mix * 2.1
    g.beginPath()
    for (let y = 0; y <= 128; y += 8) {
      const wob = Math.sin(y * 0.05 + i * 0.9 + seedShift) * (3 + mix * 5)
      if (y === 0) g.moveTo(x + wob, y)
      else g.lineTo(x + wob, y)
    }
    g.stroke()
  }
  // fine speckle for roughness
  for (let i = 0; i < 900; i++) {
    const a = Math.random() * 0.06
    g.fillStyle = `rgba(0,0,0,${a})`
    g.fillRect(Math.random() * 128, Math.random() * 128, 1, 1)
  }
  return cv
}

const woodMaterial = (hex) => {
  if (woodMatCache.has(hex)) return woodMatCache.get(hex)
  let mat
  try {
    const cv = makeWoodCanvas(hex, hex.charCodeAt(1) || 0)
    const tex = track(new THREE.CanvasTexture(cv))
    tex.anisotropy = 4
    if (lowEnd) {
      mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.72, metalness: 0 })
    } else {
      mat = new THREE.MeshPhysicalMaterial({
        map: tex,
        bumpMap: tex,
        bumpScale: 0.06,
        roughness: 0.5,
        metalness: 0,
        clearcoat: 0.5,
        clearcoatRoughness: 0.28,
        envMapIntensity: 1.0,
      })
    }
  } catch {
    mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(hex) })
  }
  track(mat)
  woodMatCache.set(hex, mat)
  return mat
}

// Rounded, beveled cube so wood blocks read soft & catch light (stub-safe).
const roundedBox = (w, h, d, radius, seg = 3) => {
  try {
    const geo = new THREE.BoxGeometry(w, h, d, seg, seg, seg)
    const pos = geo.attributes.position
    const ix = w / 2 - radius
    const iy = h / 2 - radius
    const iz = d / 2 - radius
    for (let i = 0; i < pos.count; i++) {
      const cx = Math.max(-ix, Math.min(ix, pos.getX(i)))
      const cy = Math.max(-iy, Math.min(iy, pos.getY(i)))
      const cz = Math.max(-iz, Math.min(iz, pos.getZ(i)))
      const dx = pos.getX(i) - cx
      const dy = pos.getY(i) - cy
      const dz = pos.getZ(i) - cz
      const len = Math.hypot(dx, dy, dz) || 1
      pos.setXYZ(i, cx + (dx / len) * radius, cy + (dy / len) * radius, cz + (dz / len) * radius)
    }
    pos.needsUpdate = true
    geo.computeVertexNormals()
    return geo
  } catch {
    return new THREE.BoxGeometry(w, h, d)
  }
}

const buildEnvironment = () => {
  try {
    const cv = document.createElement('canvas')
    cv.width = 16
    cv.height = 64
    const g = cv.getContext('2d')
    const grad = g.createLinearGradient(0, 0, 0, 64)
    grad.addColorStop(0, '#fff2dc')
    grad.addColorStop(0.5, '#c79a63')
    grad.addColorStop(1, '#3a2716')
    g.fillStyle = grad
    g.fillRect(0, 0, 16, 64)
    const tex = track(new THREE.CanvasTexture(cv))
    tex.mapping = THREE.EquirectangularReflectionMapping
    const pmrem = new THREE.PMREMGenerator(renderer)
    const rt = pmrem.fromEquirectangular(tex)
    scene.environment = rt.texture
    pmrem.dispose()
  } catch {
    /* stub / unsupported — skip IBL, direct lights still render */
  }
}

// Frame the board + tray for the viewport aspect. Portrait (mobile) pulls back
// a touch and lowers the look-at so all three tray pieces stay on screen.
// Position the orbit camera from its spherical state around CAM_TARGET.
const updateCamera = () => {
  if (!camera) return
  const radius = orbit.fit * orbit.zoom
  const d = radius * Math.sin(orbit.phi)
  const y = radius * Math.cos(orbit.phi)
  camera.position.set(
    Math.sin(orbit.theta) * d,
    CAM_TARGET.y + y,
    CAM_TARGET.z + Math.cos(orbit.theta) * d,
  )
  camera.lookAt(CAM_TARGET)
}

// Only `fit` (base distance) depends on the viewport — portrait pulls back so
// the board width + tray fit. The user's theta/phi/zoom persist across resizes.
const frameCamera = (w, h) => {
  if (!camera) return
  const aspect = (w || 1) / (h || 1)
  camera.aspect = aspect
  orbit.fit = aspect < 0.7 ? 16.6 : 15
  camera.updateProjectionMatrix()
  updateCamera()
}

// ── Scene build ──────────────────────────────────────────────────────────────
const initThree = () => {
  const host = canvasHost.value
  const w = host.clientWidth || 480
  const h = host.clientHeight || 640

  renderer = new THREE.WebGLRenderer({ antialias: !lowEnd, alpha: false })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, lowEnd ? 1.25 : 2))
  renderer.setSize(w, h)
  try {
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.06
  } catch {
    /* stub */
  }
  if (!lowEnd) {
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
  }
  host.appendChild(renderer.domElement)

  scene = new THREE.Scene()
  scene.background = new THREE.Color(0xa97c48) // warm wood panel

  raycaster = new THREE.Raycaster()

  camera = new THREE.PerspectiveCamera(42, w / h, 0.1, 100)
  frameCamera(w, h)

  buildEnvironment()

  scene.add(new THREE.HemisphereLight(0xfff2df, 0x2a1c10, 0.62))
  const key = new THREE.DirectionalLight(0xfff0d8, 1.18)
  key.position.set(5.5, 13, 8.5)
  if (!lowEnd) {
    key.castShadow = true
    key.shadow.mapSize.set(1024, 1024)
    key.shadow.camera.left = -8
    key.shadow.camera.right = 8
    key.shadow.camera.top = 10
    key.shadow.camera.bottom = -8
    key.shadow.camera.far = 44
    key.shadow.bias = -0.0007
    key.shadow.radius = 4
  }
  scene.add(key)
  const fill = new THREE.DirectionalLight(0xffd9a0, 0.34)
  fill.position.set(-7, 5, 4)
  scene.add(fill)
  const spark = new THREE.PointLight(0xffffff, 0.4, 60)
  spark.position.set(-3, 9, 9)
  scene.add(spark)

  // Warm table floor (the reference's wood panel) — receives shadows.
  const tableMat = track(
    new THREE.MeshStandardMaterial({
      map: track(
        (() => {
          const tx = new THREE.CanvasTexture(makeWoodCanvas('#b3854f', 3))
          tx.wrapS = tx.wrapT = THREE.RepeatWrapping
          tx.repeat.set(4, 4)
          return tx
        })(),
      ),
      color: new THREE.Color(0xffffff),
      roughness: 0.9,
      metalness: 0,
    }),
  )
  const table = new THREE.Mesh(track(new THREE.PlaneGeometry(60, 60)), tableMat)
  table.rotation.x = -Math.PI / 2
  table.position.y = -0.32
  if (!lowEnd) table.receiveShadow = true
  scene.add(table)

  // Board tray: a raised walnut frame slab with a recessed dark playfield.
  const boardRoot = new THREE.Group()
  scene.add(boardRoot)
  const frameMat = track(
    new THREE.MeshStandardMaterial({
      map: track(new THREE.CanvasTexture(makeWoodCanvas('#7a5230', 7))),
      roughness: 0.6,
      metalness: 0,
    }),
  )
  const frame = new THREE.Mesh(roundedBox(SIZE + 0.9, 0.6, SIZE + 0.9, 0.22), frameMat)
  frame.position.y = -0.02
  if (!lowEnd) frame.receiveShadow = true
  boardRoot.add(frame)
  const wellMat = track(
    new THREE.MeshStandardMaterial({ color: new THREE.Color(0x2a1c12), roughness: 0.95 }),
  )
  const well = new THREE.Mesh(track(new THREE.BoxGeometry(SIZE + 0.28, 0.3, SIZE + 0.28)), wellMat)
  well.position.y = 0.16
  boardRoot.add(well)

  // Empty-cell sockets (dark recessed squares).
  const socketGeo = track(roundedBox(BLOCK, 0.12, BLOCK, 0.08))
  const socketMat = track(
    new THREE.MeshStandardMaterial({ color: new THREE.Color(0x3a281a), roughness: 0.98 }),
  )
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const s = new THREE.Mesh(socketGeo, socketMat)
      s.position.set(worldX(c), 0.24, worldZ(r))
      boardRoot.add(s)
    }
  }

  blockGeo = track(roundedBox(BLOCK, BLOCK_H, BLOCK, 0.11))
  previewGeo = track(roundedBox(BLOCK, 0.08, BLOCK, 0.08))

  blockGroup = new THREE.Group()
  scene.add(blockGroup)
  previewGroup = new THREE.Group()
  scene.add(previewGroup)
  trayGroup = new THREE.Group()
  scene.add(trayGroup)
  burstGroup = new THREE.Group()
  scene.add(burstGroup)
}

// ── Board + tray render ──────────────────────────────────────────────────────
const blockPool = []
const getBlock = (i) => {
  if (blockPool[i]) return blockPool[i]
  const m = new THREE.Mesh(blockGeo, woodMaterial(WOODS[0]))
  if (!lowEnd) m.castShadow = true
  m.userData.pop = 0
  blockGroup.add(m)
  blockPool[i] = m
  return m
}

const renderBoardBlocks = (animateNew = false) => {
  let i = 0
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const cell = game.grid[r][c]
      if (!cell) continue
      const m = getBlock(i++)
      m.visible = true
      m.material = woodMaterial(cell.color)
      m.position.set(worldX(c), BLOCK_H / 2 + 0.28, worldZ(r))
      if (animateNew && m.userData.wasEmpty) {
        m.userData.pop = 1 // scale-in
      }
      m.userData.wasEmpty = false
      const p = m.userData.pop || 0
      const s = 1 - p * 0.001
      m.scale.setScalar(s)
    }
  }
  for (let k = i; k < blockPool.length; k++) {
    if (blockPool[k]) {
      blockPool[k].visible = false
      blockPool[k].userData.wasEmpty = true
    }
  }
}

const buildPieceBlocks = (piece, scale, parent, color) => {
  const bw = (piece.w - 1) / 2
  const bh = (piece.h - 1) / 2
  for (const [dr, dc] of piece.cells) {
    const m = new THREE.Mesh(blockGeo, woodMaterial(color || piece.color))
    if (!lowEnd) m.castShadow = true
    m.scale.setScalar(scale)
    m.position.set((dc - bw) * CELL * scale, 0, (dr - bh) * CELL * scale)
    parent.add(m)
  }
}

const rebuildTray = () => {
  while (trayGroup.children.length) trayGroup.remove(trayGroup.children[0])
  for (let i = 0; i < TRAY; i++) {
    const piece = game.tray[i]
    if (!piece) continue
    const g = new THREE.Group()
    g.userData.trayIndex = i
    g.position.set((-1 + i) * TRAY_SPREAD, 0.34, TRAY_Z)
    g.userData.homeY = 0.34
    g.userData.phase = i * 1.3
    buildPieceBlocks(piece, TRAY_SCALE, g, piece.color)
    if (dragging && dragIndex === i) g.visible = false
    trayGroup.add(g)
  }
}

// ── Drag interaction ─────────────────────────────────────────────────────────
const setPointer = (e) => {
  const rect = renderer.domElement.getBoundingClientRect()
  pointerNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
  pointerNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
}

const pickTray = () => {
  raycaster.setFromCamera(pointerNdc, camera)
  const hits = raycaster.intersectObjects(trayGroup.children, true)
  for (const hit of hits) {
    let o = hit.object
    while (o && o.userData.trayIndex === undefined) o = o.parent
    if (o && game.tray[o.userData.trayIndex]) return o.userData.trayIndex
  }
  return -1
}

const startDrag = (index) => {
  dragging = true
  dragIndex = index
  dragPiece = game.tray[index]
  dragGroup = new THREE.Group()
  buildPieceBlocks(dragPiece, 1, dragGroup, dragPiece.color)
  scene.add(dragGroup)
  const home = trayGroup.children.find((c) => c.userData.trayIndex === index)
  if (home) home.visible = false
  updateDrag()
}

const updateDrag = () => {
  if (!dragging) return
  raycaster.setFromCamera(pointerNdc, camera)
  const hit = new THREE.Vector3()
  if (!raycaster.ray.intersectPlane(dragPlane, hit)) return
  // On touch, float the piece above the fingertip so it isn't hidden.
  if (isTouch.value) hit.z -= 1.15
  const cf = hit.x + HALF
  const rf = hit.z + HALF
  let c0 = Math.round(cf - (dragPiece.w - 1) / 2)
  let r0 = Math.round(rf - (dragPiece.h - 1) / 2)
  c0 = Math.max(0, Math.min(SIZE - dragPiece.w, c0))
  r0 = Math.max(0, Math.min(SIZE - dragPiece.h, r0))
  const ok = canPlaceAt(game.grid, dragPiece.cells, r0, c0)
  pending = { r0, c0, ok }
  dragTarget.set(worldX(c0), BLOCK_H / 2 + 0.28 + LIFT, worldZ(r0))
  renderPreview(r0, c0, ok)
}

const renderPreview = (r0, c0, ok) => {
  while (previewGroup.children.length) previewGroup.remove(previewGroup.children[0])
  if (!dragPiece) return
  const col = ok ? 0x63d17a : 0xd94f4f
  for (const [dr, dc] of dragPiece.cells) {
    const m = new THREE.Mesh(
      previewGeo,
      new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.5 }),
    )
    m.position.set(worldX(c0 + dc), 0.34, worldZ(r0 + dr))
    previewGroup.add(m)
  }
}

const clearPreview = () => {
  while (previewGroup.children.length) previewGroup.remove(previewGroup.children[0])
}

const endDrag = (commit) => {
  if (!dragging) return
  const idx = dragIndex
  const { r0, c0, ok } = pending
  dragging = false
  dragIndex = -1
  clearPreview()
  if (dragGroup) {
    scene.remove(dragGroup)
    dragGroup = null
  }
  dragPiece = null
  if (commit && ok) {
    commitPlace(idx, r0, c0)
  } else {
    const home = trayGroup.children.find((c) => c.userData.trayIndex === idx)
    if (home) home.visible = true
  }
}

// ── Place → score/clear/level/over ───────────────────────────────────────────
const commitPlace = (index, r0, c0) => {
  const res = enginePlace(game, index, r0, c0)
  if (!res.ok) return res
  score.value = game.score
  // O motor só conhece o recorde de quando a partida foi criada. O da conta
  // chega depois (o `syncRemote` da montagem, ou alguém que entra na conta com
  // o jogo aberto) e sobe só o `best` da tela. Copiar o do motor por cima, como
  // o componente antigo fazia, derrubava o ★ para os pontos da partida na
  // primeira jogada, e o fim da partida gravava esse número menor na chave da
  // galeria e na conta (o `save` do RoqueOS faz merge, não guarda o maior).
  // Achado na extração, em 25/09/2026.
  if (best.value > game.best) game.best = best.value
  best.value = game.best
  level.value = game.level
  movesRef.value = game.moves
  targetRef.value = game.target
  som.encaixar()
  if (res.lineCount > 0) {
    som.limpar(res.lineCount, game.combo)
    spawnBurst(res.clearedCells)
  }
  renderBoardBlocks(true)
  rebuildTray()
  if (res.leveledUp) {
    showLevelUp()
    som.subiuDeNivel()
  }
  if (res.over) endGame()
  return res
}

const spawnBurst = (cells) => {
  if (lowEnd) return
  for (const key of cells) {
    const r = Math.floor(key / SIZE)
    const c = key % SIZE
    for (let k = 0; k < 3; k++) {
      const m = new THREE.Mesh(
        track(new THREE.SphereGeometry(0.07, 6, 6)),
        new THREE.MeshBasicMaterial({ color: 0xffe6a8, transparent: true, opacity: 0.9 }),
      )
      m.position.set(
        worldX(c) + (Math.random() - 0.5) * 0.5,
        0.5,
        worldZ(r) + (Math.random() - 0.5) * 0.5,
      )
      m.userData.v = new THREE.Vector3(
        (Math.random() - 0.5) * 0.05,
        0.08 + Math.random() * 0.06,
        (Math.random() - 0.5) * 0.05,
      )
      m.userData.life = 1
      burstGroup.add(m)
    }
  }
}

const showLevelUp = () => {
  levelToast.value = true
  setTimeout(() => (levelToast.value = false), 1500)
}

const endGame = () => {
  isRecord.value = score.value > 0 && score.value >= best.value
  overlay.value = 'over'
  som.perdeu()
  persistScore()
  host.metricas.evento('game_over', { score: score.value, level: level.value })
}

// ── Sound ────────────────────────────────────────────────────────────────────
const som = criarSom(host.audio, () => muted.value)
// Chamado de dentro do gesto (o clique em Jogar), sem `await` antes: o iOS só
// libera o áudio assim.
const primeAudio = () => {
  try {
    host.audio.destravar()?.catch?.(() => {})
  } catch {
    /* best-effort */
  }
}

// ── Loop ─────────────────────────────────────────────────────────────────────
let lastT = 0
const loop = (ts) => {
  rafId = requestAnimationFrame(loop)
  if (!renderer || !scene || !camera) return
  const dt = Math.min(0.05, (ts - lastT) / 1000 || 0.016)
  lastT = ts
  const time = ts * 0.001

  // idle bob of the tray pieces
  for (const g of trayGroup.children) {
    g.position.y =
      (g.userData.homeY || 0.34) + Math.sin(time * 1.6 + (g.userData.phase || 0)) * 0.05
    g.rotation.y = Math.sin(time * 0.6 + (g.userData.phase || 0)) * 0.12
  }
  // grabbed piece follows toward the snapped target
  if (dragging && dragGroup) {
    dragGroup.position.lerp(dragTarget, 0.35)
    dragGroup.rotation.y *= 0.8
  }
  // block pop-in
  for (const m of blockPool) {
    if (!m || !m.visible) continue
    if (m.userData.pop > 0) {
      m.userData.pop = Math.max(0, m.userData.pop - dt * 3)
      const s = 1 - m.userData.pop * 0.55
      m.scale.setScalar(Math.min(1, s))
    }
  }
  // clear particles
  for (let i = burstGroup.children.length - 1; i >= 0; i--) {
    const p = burstGroup.children[i]
    p.userData.life -= dt * 1.6
    if (p.userData.life <= 0) {
      p.geometry?.dispose?.()
      p.material?.dispose?.()
      burstGroup.remove(p)
      continue
    }
    p.userData.v.y -= dt * 0.25
    p.position.addScaledVector(p.userData.v, dt * 30)
    p.material.opacity = Math.max(0, p.userData.life)
  }

  renderer.render(scene, camera)
}
const startLoop = () => {
  if (!rafId) {
    lastT = 0
    rafId = requestAnimationFrame(loop)
  }
}
const stopLoop = () => {
  if (rafId) cancelAnimationFrame(rafId)
  rafId = null
}

// ── Pointer wiring — drag a tray piece · orbit the view · pinch/wheel zoom ─────
const pinchDist = () => {
  const pts = [...pointers.values()]
  if (pts.length < 2) return 0
  return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)
}

const onPointerDown = (e) => {
  if (overlay.value) return
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
  try {
    renderer.domElement.setPointerCapture?.(e.pointerId)
  } catch {
    /* best-effort */
  }
  // Second finger → pinch-zoom (unless a piece is mid-drag, which keeps going).
  if (pointers.size >= 2) {
    orbitDown = null
    if (!dragging) pinch = { dist: pinchDist() || 1, zoom: orbit.zoom }
    return
  }
  setPointer(e)
  const idx = pickTray()
  if (idx >= 0) {
    dragPointerId = e.pointerId
    startDrag(idx) // grabbed a tray piece → move it
  } else {
    orbitDown = { x: e.clientX, y: e.clientY, theta: orbit.theta, phi: orbit.phi } // rotate the view
  }
}

const onPointerMove = (e) => {
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
  if (pinch && pointers.size >= 2) {
    const d = pinchDist()
    if (d > 0) {
      orbit.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, pinch.zoom * (pinch.dist / d)))
      updateCamera()
    }
    return
  }
  if (dragging) {
    if (e.pointerId !== dragPointerId) return
    setPointer(e)
    updateDrag()
    return
  }
  if (orbitDown) {
    orbit.theta = orbitDown.theta - (e.clientX - orbitDown.x) * 0.006
    orbit.phi = Math.min(
      MAX_PHI,
      Math.max(MIN_PHI, orbitDown.phi - (e.clientY - orbitDown.y) * 0.004),
    )
    updateCamera()
  }
}

const onPointerUp = (e) => {
  pointers.delete(e?.pointerId)
  if (dragging && (e?.pointerId === dragPointerId || e?.pointerId === undefined)) {
    endDrag(true)
    dragPointerId = null
  }
  if (pointers.size < 2) pinch = null
  if (pointers.size === 1) {
    // one finger remains after a pinch → reseed orbit so the view doesn't jump
    const [p] = [...pointers.values()]
    orbitDown = { x: p.x, y: p.y, theta: orbit.theta, phi: orbit.phi }
  } else if (pointers.size === 0) {
    orbitDown = null
  }
}

const onWheel = (e) => {
  if (overlay.value) return
  e.preventDefault()
  orbit.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, orbit.zoom + e.deltaY * 0.0009))
  updateCamera()
}

// ── Actions ──────────────────────────────────────────────────────────────────
const start = () => {
  primeAudio()
  startGame(game)
  score.value = 0
  level.value = 1
  movesRef.value = 0
  targetRef.value = game.target
  isRecord.value = false
  overlay.value = null
  for (const m of blockPool) if (m) m.userData.wasEmpty = true
  renderBoardBlocks()
  rebuildTray()
  host.metricas.evento('game_start')
}
const restart = () => {
  game = createGame(Math.floor(Math.random() * 1e9) || 1, { best: best.value })
  start()
}
// A chave `muted` vira `roqueos:tora:muted` no host, a mesma de antes da
// extração.
const toggleMute = () => {
  muted.value = !muted.value
  host.armazenamento.gravar('muted', muted.value ? '1' : '0')
}

// ── Persistence ──────────────────────────────────────────────────────────────
// As chaves `best` e `muted` viram `roqueos:tora:best` e `roqueos:tora:muted`
// no host, as mesmas de antes da extração: quem já jogava não perde o recorde,
// e a galeria continua lendo o best dali.
const loadLocal = () => {
  best.value = parseInt(host.armazenamento.ler('best'), 10) || 0
  muted.value = host.armazenamento.ler('muted') === '1'
}
const persistScore = () => {
  host.armazenamento.gravar('best', String(best.value))
  Promise.resolve()
    .then(() => host.placar.salvar({ best: best.value }))
    .catch(() => {})
}
// O placar da conta ganha do local quando é maior, e o local sobe quando é o
// maior. Convidado não tem placar na conta: o host devolve null e ignora o
// salvar.
const syncRemote = async () => {
  try {
    const remoto = await host.placar.carregar()
    const daConta = Number(remoto?.best) || 0
    if (daConta > best.value) {
      best.value = daConta
      host.armazenamento.gravar('best', String(daConta))
    } else if (best.value > daConta) {
      await host.placar.salvar({ best: best.value })
    }
  } catch (err) {
    console.error('[TORA] Score sync failed:', err)
  }
}

// ── Resize ───────────────────────────────────────────────────────────────────
const resize = () => {
  if (!renderer || !camera || !canvasHost.value) return
  const w = canvasHost.value.clientWidth || 480
  const h = canvasHost.value.clientHeight || 640
  renderer.setSize(w, h)
  frameCamera(w, h)
}

// ── Lifecycle ────────────────────────────────────────────────────────────────
// A janela que perde o foco para de desenhar; a que ganha volta. O `ativo` vem
// do host (a janela em foco, no RoqueOS). O Tora não tem teclado: é arrastar,
// girar a vista e dar zoom, tudo por ponteiro na própria tela.
watch(
  () => props.estado.ativo,
  (active) => {
    if (active === false) stopLoop()
    else startLoop()
  },
)
const onVisibility = () => {
  if (document.hidden) stopLoop()
  else if (props.estado.ativo !== false) startLoop()
}

onMounted(() => {
  lowEnd = Boolean(host.desempenho.modoLeve())
  modoLeve.value = lowEnd
  isTouch.value = 'ontouchstart' in window || navigator.maxTouchPoints > 0
  loadLocal()
  game = createGame(Math.floor(Math.random() * 1e9) || 1, { best: best.value })
  initThree()
  renderBoardBlocks()
  syncRemote()
  // Quem entra na conta com o jogo aberto vê o recorde da conta sem reabrir.
  pararIdentidade = host.identidade.aoMudar(() => syncRemote())
  startLoop()

  const el = renderer.domElement
  el.addEventListener('pointerdown', onPointerDown)
  el.addEventListener('pointermove', onPointerMove)
  el.addEventListener('pointerup', onPointerUp)
  el.addEventListener('pointercancel', onPointerUp)
  el.addEventListener('wheel', onWheel, { passive: false })
  document.addEventListener('visibilitychange', onVisibility)
  resizeObserver = new ResizeObserver(resize)
  resizeObserver.observe(canvasHost.value)

  if (emModoE2E()) {
    window.__tora = {
      get state() {
        return game
      },
      get orbit() {
        return orbit
      },
      start,
      place: (index, r, c) => commitPlace(index, r, c),
      // Cover aid: a rich marquetry of woods + a colourful tray, mid-game HUD.
      stage: () => {
        start()
        const pat = [0, 2, 4, 6, 1, 3, 5, 7]
        for (let r = 0; r < SIZE; r++) {
          for (let c = 0; c < SIZE; c++) {
            // leave a scattering of holes so lines read as "in progress"
            if ((r * 3 + c * 5) % 7 === 0 || (r === 3 && c > 4)) continue
            game.grid[r][c] = { color: WOODS[pat[(r + c) % pat.length]] }
          }
        }
        game.tray = [
          {
            shapeId: 'L0',
            cells: [
              [0, 0],
              [1, 0],
              [2, 0],
              [2, 1],
            ],
            w: 2,
            h: 3,
            color: WOODS[7],
            size: 4,
          },
          {
            shapeId: 'sq2',
            cells: [
              [0, 0],
              [0, 1],
              [1, 0],
              [1, 1],
            ],
            w: 2,
            h: 2,
            color: WOODS[5],
            size: 4,
          },
          {
            shapeId: 'i3h',
            cells: [
              [0, 0],
              [0, 1],
              [0, 2],
            ],
            w: 3,
            h: 1,
            color: WOODS[2],
            size: 3,
          },
        ]
        game.score = 1240
        game.level = 3
        game.moves = 5
        game.target = game.target || 19
        score.value = 1240
        level.value = 3
        movesRef.value = 5
        targetRef.value = 19
        renderBoardBlocks()
        rebuildTray()
      },
    }
  }
})

onUnmounted(() => {
  stopLoop()
  const el = renderer?.domElement
  el?.removeEventListener('pointerdown', onPointerDown)
  el?.removeEventListener('pointermove', onPointerMove)
  el?.removeEventListener('pointerup', onPointerUp)
  el?.removeEventListener('pointercancel', onPointerUp)
  el?.removeEventListener('wheel', onWheel)
  document.removeEventListener('visibilitychange', onVisibility)
  resizeObserver?.disconnect()
  pararIdentidade?.()
  for (const d of disposables) {
    try {
      d.dispose?.()
    } catch {
      /* best-effort */
    }
  }
  disposables = []
  blockPool.length = 0
  try {
    renderer?.dispose?.()
    if (renderer?.domElement?.parentNode)
      renderer.domElement.parentNode.removeChild(renderer.domElement)
  } catch {
    /* best-effort */
  }
  renderer = null
  scene = null
  camera = null
  if (emModoE2E()) delete window.__tora
})
</script>

<style scoped lang="scss">
.ros-tora {
  // Cores de identidade do jogo, como custom property para que um tema consiga
  // alcançá-las. As que vêm do sistema herdam o token do RoqueOS quando ele
  // existe e caem no valor que o tema padrão do RoqueOS dá, em 25/09/2026,
  // quando o jogo roda sozinho: fora do RoqueOS não há `tokens-root.scss`
  // nenhum carregado.
  --ros-tora-texto-100: var(--ros-text-100, #ffffff);
  --ros-tora-sombra-40: var(--ros-shadow-40, rgba(0, 0, 0, 0.4));
  --ros-tora-sombra-50: var(--ros-shadow-50, rgba(0, 0, 0, 0.5));
  --ros-tora-bg-1: #b98a52;
  --ros-tora-bg-2: #6e4f2c;
  --ros-tora-bg-3: #4a3419;
  --ros-tora-bg-4: rgba(38, 24, 12, 0.5);
  --ros-tora-line-1: rgba(255, 224, 170, 0.25);
  --ros-tora-fg-1: rgba(255, 235, 200, 0.65);
  --ros-tora-fg-2: #fff4e0;
  --ros-tora-fg-3: #ffd97a;
  --ros-tora-bg-5: rgba(20, 12, 6, 0.55);
  --ros-tora-bg-6: #ffcf6b;
  --ros-tora-bg-7: #ff9d3c;
  --ros-tora-fg-4: #ffe9c4;
  --ros-tora-bg-8: rgba(60, 40, 20, 0.7);
  --ros-tora-shadow-1: rgba(255, 176, 74, 0.8);
  --ros-tora-shadow-2: rgba(0, 0, 0, 0.5);
  --ros-tora-bg-9: rgba(30, 18, 8, 0.35);
  --ros-tora-bg-10: rgba(20, 12, 6, 0.72);
  --ros-tora-bg-11: rgba(40, 26, 13, 0.72);
  --ros-tora-line-2: rgba(255, 224, 170, 0.3);
  --ros-tora-fg-5: #ffe4b0;
  --ros-tora-shadow-3: rgba(255, 170, 70, 0.6);
  --ros-tora-fg-6: #fff2df;
  --ros-tora-fg-7: rgba(255, 235, 200, 0.6);
  --ros-tora-fg-8: #ffb27a;
  --ros-tora-fg-9: rgba(255, 235, 200, 0.55);
  --ros-tora-fg-10: #ffd54a;
  --ros-tora-fg-11: #40260d;
  --ros-tora-shadow-4: rgba(255, 157, 60, 0.4);
}

.ros-tora {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: radial-gradient(
    circle at 50% 30%,
    var(--ros-tora-bg-1),
    var(--ros-tora-bg-2) 75%,
    var(--ros-tora-bg-3)
  );
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
  touch-action: none;
}

.ros-tora__canvas {
  position: absolute;
  inset: 0;
}

.ros-tora__hud {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px calc(12px + env(safe-area-inset-top, 0px));
  padding-top: max(12px, env(safe-area-inset-top, 0px));
  z-index: 3;
  pointer-events: none;
}
.ros-tora__hud > * {
  pointer-events: auto;
}

.ros-tora__stat {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  background: var(--ros-tora-bg-4);
  backdrop-filter: blur(10px);
  border: 1px solid var(--ros-tora-line-1);
  border-radius: 14px;
  padding: 6px 14px;
  min-width: 78px;
}
.ros-tora__stat-label {
  font-size: 9px;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  color: var(--ros-tora-fg-1);
}
.ros-tora__stat-value {
  font-size: 22px;
  font-weight: 800;
  color: var(--ros-tora-fg-2);
  line-height: 1.05;
  font-variant-numeric: tabular-nums;
}

.ros-tora__level {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.ros-tora__level-top {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  font-weight: 700;
  color: var(--ros-tora-fg-2);
  text-shadow: 0 1px 3px var(--ros-tora-sombra-40);
}
.ros-tora__best {
  color: var(--ros-tora-fg-3);
}
.ros-tora__bar {
  height: 7px;
  border-radius: 5px;
  background: var(--ros-tora-bg-5);
  overflow: hidden;
}
.ros-tora__bar-fill {
  height: 100%;
  border-radius: 5px;
  background: linear-gradient(90deg, var(--ros-tora-bg-6), var(--ros-tora-bg-7));
  transition: width 0.35s ease;
}

.ros-tora__actions {
  display: flex;
  gap: 8px;
}
.ros-tora__icon-btn {
  width: 38px;
  height: 38px;
  border-radius: 12px;
  border: 1px solid var(--ros-tora-line-1);
  background: var(--ros-tora-bg-4);
  backdrop-filter: blur(10px);
  color: var(--ros-tora-fg-4);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.15s ease;
}
.ros-tora__icon-btn:hover {
  background: var(--ros-tora-bg-8);
}

.ros-tora__toast {
  position: absolute;
  top: 30%;
  left: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  z-index: 4;
  pointer-events: none;
}
.ros-tora__toast-big {
  font-size: 34px;
  font-weight: 900;
  color: var(--ros-tora-texto-100);
  letter-spacing: 2px;
  text-shadow:
    0 2px 14px var(--ros-tora-shadow-1),
    0 3px 8px var(--ros-tora-shadow-2);
}
.ros-tora__toast-sub {
  font-size: 14px;
  font-weight: 700;
  color: var(--ros-tora-fg-3);
}

.ros-tora__overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 5;
  background: radial-gradient(circle at 50% 40%, var(--ros-tora-bg-9), var(--ros-tora-bg-10));
  backdrop-filter: blur(3px);
}
.ros-tora__card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 30px 34px;
  border-radius: 24px;
  background: var(--ros-tora-bg-11);
  border: 1px solid var(--ros-tora-line-2);
  backdrop-filter: blur(18px) saturate(160%);
  box-shadow: 0 20px 60px var(--ros-tora-sombra-50);
  text-align: center;
  max-width: 86%;
}
.ros-tora__logo {
  font-size: 46px;
  font-weight: 900;
  letter-spacing: 6px;
  color: var(--ros-tora-fg-5);
  text-shadow: 0 3px 14px var(--ros-tora-shadow-3);
}
.ros-tora__tagline {
  font-size: 15px;
  color: var(--ros-tora-fg-6);
  margin: 0;
  max-width: 260px;
}
.ros-tora__hint {
  font-size: 12px;
  color: var(--ros-tora-fg-7);
  margin: 0;
}
.ros-tora__over {
  font-size: 20px;
  font-weight: 800;
  color: var(--ros-tora-fg-8);
  margin: 0;
}
.ros-tora__final {
  display: flex;
  gap: 26px;
  align-items: flex-end;
  flex-wrap: wrap;
  justify-content: center;
}
.ros-tora__final > div {
  display: flex;
  flex-direction: column;
  align-items: center;
}
.ros-tora__final-label {
  font-size: 10px;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  color: var(--ros-tora-fg-9);
}
.ros-tora__final-value {
  font-size: 30px;
  font-weight: 800;
  color: var(--ros-tora-fg-2);
}
.ros-tora__record {
  width: 100%;
  font-size: 13px;
  font-weight: 700;
  color: var(--ros-tora-fg-10);
}
.ros-tora__play {
  margin-top: 4px;
  padding: 12px 40px;
  border-radius: 14px;
  border: none;
  background: linear-gradient(135deg, var(--ros-tora-bg-6), var(--ros-tora-bg-7));
  color: var(--ros-tora-fg-11);
  font-size: 16px;
  font-weight: 800;
  letter-spacing: 0.5px;
  cursor: pointer;
  box-shadow: 0 8px 24px var(--ros-tora-shadow-4);
  transition: transform 0.12s ease;
}
.ros-tora__play:hover {
  transform: translateY(-2px);
}

.ros-tora-fade-enter-active,
.ros-tora-fade-leave-active {
  transition: opacity 0.3s ease;
}
.ros-tora-fade-enter-from,
.ros-tora-fade-leave-to {
  opacity: 0;
}
.ros-tora-toast-enter-active {
  transition: all 0.4s cubic-bezier(0.2, 1.4, 0.4, 1);
}
.ros-tora-toast-leave-active {
  transition: all 0.4s ease;
}
.ros-tora-toast-enter-from,
.ros-tora-toast-leave-to {
  opacity: 0;
  transform: translate(-50%, -30%) scale(0.7);
}

// O perfil leve vem do host (`desempenho.modoLeve`), não do atributo que o
// RoqueOS põe no <html>: fora do RoqueOS esse atributo não existe.
.ros-tora--low .ros-tora__card,
.ros-tora--low .ros-tora__stat,
.ros-tora--low .ros-tora__icon-btn {
  backdrop-filter: none;
}
</style>
