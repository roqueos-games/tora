// O Tora inteiro, montado pelo contrato do jogo-sdk com o host falso.
//
// Nenhum mock de store, de analytics ou de i18n do RoqueOS: se o jogo ainda
// alcançasse algo do RoqueOS, este arquivo não rodaria fora dele. Os oito casos
// do teste que rodava no front antes da extração, em 25/09/2026, estão aqui
// (marcados com "Do front:"), com os do contrato em volta. O único mock é o do
// three, porque o jsdom não tem WebGL (ver threeStub.js).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { nextTick } from 'vue'
import * as THREE from 'three'
import { VERSAO_DO_CONTRATO } from '@roqueos-games/jogo-sdk'
import { criarHostFalso } from '@roqueos-games/jogo-sdk/host-falso'
import jogo from '../src/index.js'
import { SIZE, TRAY, SHAPES, bounds } from '../src/engine.js'
import ptBR from '../i18n/pt-BR.json'
import enUS from '../i18n/en-US.json'
import tela from '../src/JogoTora.vue?raw'

vi.mock('three', async () => (await import('./threeStub.js')).criarThreeFalso())

// A madeira é pintada num canvas 2D. O jsdom não tem canvas 2D; este contexto
// aceita qualquer chamada e não desenha nada.
const ctx2d = () =>
  new Proxy(
    {},
    {
      get: (_t, p) => {
        if (p === 'createLinearGradient' || p === 'createRadialGradient')
          return () => ({ addColorStop() {} })
        return () => {}
      },
      set: () => true,
    },
  )

// Um AudioContext que só conta os osciladores: é o que diz se o jogo tocou.
const criarAudioFalso = () => {
  const ctx = {
    state: 'running',
    currentTime: 0,
    destination: {},
    osciladores: 0,
    createOscillator() {
      ctx.osciladores++
      return {
        frequency: { setValueAtTime() {} },
        connect: (n) => n,
        start() {},
        stop() {},
      }
    },
    createGain() {
      return {
        gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
        connect: (n) => n,
      }
    },
  }
  return ctx
}

let el = null
let host = null
let montagem = null
// O laço do jogo roda no requestAnimationFrame. Aqui o quadro só anda quando o
// teste manda. É um mapa, e não "o último callback", porque as <transition> do
// Vue também pedem quadro e porque o jogo cancela o pedido quando para.
let fila = new Map()
let proximoId = 0
let relogio = 0
const rodar = (n = 1, passo = 16) => {
  for (let i = 0; i < n; i++) {
    relogio += passo
    const agora = [...fila.values()]
    fila.clear()
    for (const fn of agora) fn(relogio)
  }
}

const palco = () => {
  el = document.createElement('div')
  document.body.appendChild(el)
  return el
}
const montou = () =>
  vi.waitFor(() => {
    if (!el.querySelector('.ros-tora')) throw new Error('o Tora ainda não montou')
  })
const montarCom = async (h, { ativo = true } = {}) => {
  host = h
  montagem = jogo.mount(palco(), host, { windowId: 'w1', ativo })
  // O app só monta com o texto do idioma carregado.
  await montou()
  await nextTick()
}
const montar = ({ ativo = true, ...opcoesDoHost } = {}) =>
  montarCom(criarHostFalso({ jogoId: 'tora', ...opcoesDoHost }), { ativo })
const $ = (sel) => el.querySelector(sel)
const eventos = (nome) =>
  host.chamadas.filter((c) => c.capacidade === 'metricas' && c.args[0] === nome)
const canvas = () => $('.ros-tora__canvas canvas')
const renderizador = () => canvas().__renderizador
const disparar = (alvo, tipo, dados = {}) => {
  const e = new Event(tipo, { bubbles: true, cancelable: true })
  Object.assign(e, dados)
  alvo.dispatchEvent(e)
}
const tecla = (key) => window.dispatchEvent(new KeyboardEvent('keydown', { key }))
const peca = (shapeId, color = '#d9a441') => {
  const cells = SHAPES[shapeId].map(([r, c]) => [r, c])
  return { shapeId, cells, ...bounds(cells), color, size: cells.length }
}
const cheias = (grid) => grid.flat().filter(Boolean).length
// Deixa o tabuleiro cheio menos buracos soltos em diagonal (dois por linha e
// dois por coluna) e a bandeja com um ponto e dois 3×3. O ponto entra no canto
// sem fechar linha nem coluna, e nenhum 3×3 cabe em buraco solto: fim de jogo
// com um ponto de pontuação.
const armarFim = (st) => {
  for (let r = 0; r < SIZE; r++)
    for (let c = 0; c < SIZE; c++) st.grid[r][c] = (r + c) % 4 === 0 ? null : { color: '#000' }
  st.tray = [peca('dot'), peca('sq3'), peca('sq3')]
}
const jogarAteOFim = async () => {
  window.__tora.start()
  armarFim(window.__tora.state)
  const res = window.__tora.place(0, 0, 0)
  await nextTick()
  return res
}

describe('Tora pelo jogo-sdk', () => {
  let origCtx
  beforeEach(() => {
    window.__ROS_E2E__ = {} // instala o gancho __tora
    origCtx = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ctx2d())
    fila = new Map()
    proximoId = 0
    relogio = 0
    vi.stubGlobal('requestAnimationFrame', (fn) => {
      fila.set(++proximoId, fn)
      return proximoId
    })
    vi.stubGlobal('cancelAnimationFrame', (id) => fila.delete(id))
  })
  afterEach(() => {
    montagem?.desmontar()
    el?.remove()
    montagem = null
    el = null
    host = null
    HTMLCanvasElement.prototype.getContext = origCtx
    THREE.Raycaster.acertos = () => []
    delete window.__ROS_E2E__
    delete window.__tora
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('é um jogo do SDK, com o id que o catálogo e o recorde usam', () => {
    expect(jogo.id).toBe('tora')
    expect(jogo.versaoDoContrato).toBe(VERSAO_DO_CONTRATO)
    expect(jogo.capacidades).toEqual([])
  })

  // Do front: 'mounts and shows the start overlay'.
  it('abre na tela inicial, com o nome, o texto do idioma do host e o botão de jogar', async () => {
    await montar()
    expect($('.ros-tora__overlay')).not.toBeNull()
    expect($('.ros-tora__logo').textContent).toBe('TORA')
    expect($('.ros-tora__logo').textContent).toBe(ptBR.title)
    expect($('.ros-tora__tagline').textContent).toBe(ptBR.tagline)
    expect($('.ros-tora__play').textContent).toBe(ptBR.play)
    expect($('.ros-tora__stat-label').textContent).toBe(ptBR.score)
    expect(window.__tora.state.status).toBe('idle')
  })

  it('fala o idioma do host, e troca quando o host troca', async () => {
    await montar({ idioma: 'en-US' })
    expect($('.ros-tora__play').textContent).toBe(enUS.play)
    expect($('.ros-tora__level-top span').textContent).toBe('Level 1')
    host.disparar('idioma', 'pt-BR')
    await vi.waitFor(() => expect($('.ros-tora__play').textContent).toBe(ptBR.play))
    expect($('.ros-tora__level-top span').textContent).toBe('Nível 1')
  })

  it('em árabe o jogo se desenha da direita para a esquerda', async () => {
    await montar({ idioma: 'ar-AR' })
    expect($('.ros-tora').getAttribute('dir')).toBe('rtl')
  })

  // Do front: 'exposes an E2E hook with the game API'.
  it('expõe o gancho de QA window.__tora, que o QA do RoqueOS usa', async () => {
    await montar()
    expect(typeof window.__tora.start).toBe('function')
    expect(typeof window.__tora.place).toBe('function')
    expect(typeof window.__tora.stage).toBe('function')
    expect(window.__tora.orbit).toBeTruthy()
  })

  it('o clique em Jogar começa, destrava o áudio no mesmo gesto e manda game_start', async () => {
    await montar()
    expect(host.contar('audio', 'destravar')).toBe(0)
    $('.ros-tora__play').click()
    expect(host.contar('audio', 'destravar')).toBe(1)
    await nextTick()
    expect(window.__tora.state.status).toBe('playing')
    expect(eventos('game_start').map((c) => c.args)).toEqual([['game_start', {}]])
  })

  // Do front: 'start() begins play and fills the tray with three pieces'.
  it('começar enche a bandeja com três peças', async () => {
    await montar()
    window.__tora.start()
    expect(window.__tora.state.status).toBe('playing')
    expect(window.__tora.state.tray.filter(Boolean).length).toBe(TRAY)
  })

  // Do front: 'place() writes the piece to the grid and scores'.
  it('encaixar escreve a peça no tabuleiro e pontua', async () => {
    await montar()
    window.__tora.start()
    window.__tora.state.tray[0] = peca('dot')
    const res = window.__tora.place(0, 3, 4)
    expect(res.ok).toBe(true)
    expect(window.__tora.state.grid[3][4]).toEqual({ color: '#d9a441' })
    expect(window.__tora.state.score).toBeGreaterThan(0)
    await nextTick()
    expect($('.ros-tora__stat-value').textContent).toBe(String(window.__tora.state.score))
  })

  it('arrastar uma peça da bandeja para o tabuleiro a encaixa', async () => {
    await montar()
    window.__tora.start()
    await nextTick()
    const st = window.__tora.state
    // Um ponto, para o encaixe caber em qualquer casa que o arrasto escolher. A
    // bandeja desenhada continua a do sorteio; quem o arrasto lê é o motor.
    st.tray = [peca('dot'), peca('dot'), peca('dot')]
    // O raio acerta um bloco da primeira peça da bandeja.
    THREE.Raycaster.acertos = (objetos) => {
      const casa = objetos.find((g) => g.userData.trayIndex === 0)
      return casa ? [{ object: casa.children[0] ?? casa }] : []
    }
    const cv = canvas()
    disparar(cv, 'pointerdown', { pointerId: 1, clientX: 240, clientY: 600 })
    disparar(cv, 'pointermove', { pointerId: 1, clientX: 240, clientY: 320 })
    disparar(cv, 'pointerup', { pointerId: 1, clientX: 240, clientY: 320 })
    expect(cheias(st.grid)).toBe(1)
    expect(st.tray[0]).toBeNull()
    expect(st.score).toBe(1)
  })

  // Do front: 'stage() builds a rich mid-game board for the cover'.
  it('stage() monta um tabuleiro de meio de jogo para a capa', async () => {
    await montar()
    window.__tora.stage()
    expect(cheias(window.__tora.state.grid)).toBeGreaterThan(SIZE * 3)
    expect(window.__tora.state.tray.filter(Boolean).length).toBe(TRAY)
    expect(window.__tora.state.level).toBe(3)
  })

  // Do front: 'mouse wheel zooms the orbit camera (clamped)'.
  it('a roda do mouse dá zoom na câmera, até o limite', async () => {
    await montar()
    window.__tora.start() // tira a tela inicial: os controles da câmera só valem jogando
    const z0 = window.__tora.orbit.zoom
    disparar(canvas(), 'wheel', { deltaY: 400 })
    expect(window.__tora.orbit.zoom).toBeGreaterThan(z0)
    for (let i = 0; i < 40; i++) disparar(canvas(), 'wheel', { deltaY: 1000 })
    expect(window.__tora.orbit.zoom).toBeLessThanOrEqual(1.75)
  })

  // Do front: 'dragging empty space rotates the view (theta + phi)'.
  it('arrastar no vazio gira a vista, para o lado e para cima', async () => {
    await montar()
    window.__tora.start()
    const t0 = window.__tora.orbit.theta
    const p0 = window.__tora.orbit.phi
    disparar(canvas(), 'pointerdown', { pointerId: 1, clientX: 200, clientY: 200 })
    disparar(canvas(), 'pointermove', { pointerId: 1, clientX: 320, clientY: 260 })
    disparar(canvas(), 'pointerup', { pointerId: 1, clientX: 320, clientY: 260 })
    expect(window.__tora.orbit.theta).not.toBe(t0)
    expect(window.__tora.orbit.phi).not.toBe(p0)
  })

  it('na tela inicial a vista não gira nem dá zoom', async () => {
    await montar()
    const { theta, zoom } = window.__tora.orbit
    disparar(canvas(), 'wheel', { deltaY: 400 })
    disparar(canvas(), 'pointerdown', { pointerId: 1, clientX: 200, clientY: 200 })
    disparar(canvas(), 'pointermove', { pointerId: 1, clientX: 320, clientY: 260 })
    expect(window.__tora.orbit.zoom).toBe(zoom)
    expect(window.__tora.orbit.theta).toBe(theta)
  })

  it('só a janela ativa desenha, e nenhuma ouve o teclado', async () => {
    // O Tora não tem controle de teclado, nem antes da extração: tudo é
    // ponteiro no próprio canvas. O que o `ativo` do host controla é o laço de
    // desenho: a janela sem foco não gasta GPU.
    await montar()
    const r = renderizador()
    rodar(3)
    const desenhados = r.quadros
    expect(desenhados).toBeGreaterThan(0)

    montagem.ativar(false)
    await nextTick()
    rodar(5)
    expect(r.quadros).toBe(desenhados)

    for (const k of [' ', 'Enter', 'ArrowLeft']) tecla(k)
    await nextTick()
    expect(eventos('game_start')).toHaveLength(0)
    expect($('.ros-tora__overlay')).not.toBeNull()

    montagem.ativar(true)
    await nextTick()
    for (const k of [' ', 'Enter', 'ArrowLeft']) tecla(k)
    rodar(2)
    expect(r.quadros).toBeGreaterThan(desenhados)
    expect(eventos('game_start')).toHaveLength(0)
  })

  it('sem nada na bandeja que caiba, é fim de jogo: "Novo recorde!", game_over com o nome e os dados de antes, e o recorde na chave e na conta', async () => {
    await montar()
    const res = await jogarAteOFim()
    const st = window.__tora.state
    expect(res.over).toBe(true)
    expect(st.status).toBe('over')
    expect($('.ros-tora__over').textContent).toBe(ptBR.over)
    expect($('.ros-tora__record').textContent).toBe(ptBR.newRecord)
    expect(eventos('game_over').map((c) => c.args)).toEqual([
      ['game_over', { score: st.score, level: 1 }],
    ])
    expect(st.score).toBe(1)
    expect(host.storage.getItem('roqueos:tora:best')).toBe('1')
    await vi.waitFor(async () => expect(await host.placar.carregar()).toEqual({ best: 1 }))
  })

  it('fim de jogo abaixo do recorde não diz "Novo recorde!", e o recorde fica', async () => {
    const h = criarHostFalso({ jogoId: 'tora' })
    h.storage.setItem('roqueos:tora:best', '999999')
    await montarCom(h)
    // Espera o acerto com a conta da montagem, que sobe o recorde local.
    await vi.waitFor(() => expect(host.contar('placar', 'salvar')).toBe(1))
    await jogarAteOFim()
    expect($('.ros-tora__over')).not.toBeNull()
    expect($('.ros-tora__record')).toBeNull()
    expect($('.ros-tora__best').textContent).toContain('999999')
    expect(host.storage.getItem('roqueos:tora:best')).toBe('999999')
  })

  it('o recorde da conta que chega depois de montar não cai na primeira jogada nem no fim', async () => {
    // Defeito do componente antigo: o motor nascia com o recorde local (0) e
    // cada jogada copiava o recorde do motor por cima do da tela. O ★ caía de
    // 5000 para 1, e o fim da partida gravava 1 na chave da galeria e na conta.
    const h = criarHostFalso({ jogoId: 'tora' })
    await h.placar.salvar({ best: 5000 })
    await montarCom(h)
    await vi.waitFor(() => expect(host.storage.getItem('roqueos:tora:best')).toBe('5000'))
    $('.ros-tora__play').click()
    window.__tora.state.tray[0] = peca('dot')
    window.__tora.place(0, 3, 4)
    await nextTick()
    expect($('.ros-tora__best').textContent).toContain('5000')

    armarFim(window.__tora.state)
    window.__tora.place(0, 0, 0)
    await nextTick()
    expect(window.__tora.state.status).toBe('over')
    expect($('.ros-tora__record')).toBeNull()
    expect(host.storage.getItem('roqueos:tora:best')).toBe('5000')
    await vi.waitFor(async () => expect((await host.placar.carregar()).best).toBe(5000))
  })

  it('"Jogar de novo" recomeça com o tabuleiro vazio e a bandeja cheia', async () => {
    await montar()
    await jogarAteOFim()
    $('.ros-tora__play').click()
    await nextTick()
    const st = window.__tora.state
    expect(st.status).toBe('playing')
    expect(cheias(st.grid)).toBe(0)
    expect(st.tray.filter(Boolean).length).toBe(TRAY)
    // O cartão de fim sai com a <transition>: no DOM só o que está de saída.
    expect($('.ros-tora__overlay:not(.ros-tora-fade-leave-active)')).toBeNull()
    expect(eventos('game_start')).toHaveLength(2)
  })

  it('o som liga e desliga na mesma chave de antes da extração, e mudo não toca', async () => {
    const h = criarHostFalso({ jogoId: 'tora' })
    const audio = criarAudioFalso()
    h.audio.contexto = () => audio
    await montarCom(h)
    const botao = $('.ros-tora__icon-btn')
    expect(botao.getAttribute('aria-label')).toBe(ptBR.sound)
    window.__tora.start()
    window.__tora.state.tray[0] = peca('dot')
    window.__tora.place(0, 3, 4)
    expect(audio.osciladores).toBe(1)

    botao.click()
    expect(host.storage.getItem('roqueos:tora:muted')).toBe('1')
    window.__tora.state.tray[1] = peca('dot')
    window.__tora.place(1, 5, 5)
    expect(audio.osciladores).toBe(1)

    botao.click()
    expect(host.storage.getItem('roqueos:tora:muted')).toBe('0')
  })

  it('lê o recorde e o mudo das chaves de antes da extração', async () => {
    const h = criarHostFalso({ jogoId: 'tora' })
    h.storage.setItem('roqueos:tora:best', '1234')
    h.storage.setItem('roqueos:tora:muted', '1')
    await montarCom(h)
    expect($('.ros-tora__best').textContent).toContain('1234')
    // O ícone do botão de som é o de mudo (o X no alto-falante).
    expect($('.ros-tora__icon-btn').innerHTML).toContain('m15.5 9.5 5 5')
    $('.ros-tora__icon-btn').click()
    await nextTick()
    expect($('.ros-tora__icon-btn').innerHTML).not.toContain('m15.5 9.5 5 5')
  })

  it('o recorde da conta maior que o local vem para a tela e para a chave da galeria', async () => {
    const h = criarHostFalso({ jogoId: 'tora' })
    await h.placar.salvar({ best: 5000 })
    await montarCom(h)
    await vi.waitFor(() => expect(host.storage.getItem('roqueos:tora:best')).toBe('5000'))
    await nextTick()
    expect($('.ros-tora__best').textContent).toContain('5000')
  })

  it('o recorde local maior que o da conta sobe para a conta', async () => {
    const h = criarHostFalso({ jogoId: 'tora' })
    h.storage.setItem('roqueos:tora:best', '3000')
    await montarCom(h)
    await vi.waitFor(async () => expect(await host.placar.carregar()).toEqual({ best: 3000 }))
  })

  // Convidado: o host do RoqueOS devolve null no carregar e false no salvar.
  it('convidado joga com o recorde local, sem placar na conta', async () => {
    const h = criarHostFalso({ jogoId: 'tora' })
    h.placar = { carregar: async () => null, salvar: async () => false }
    await montarCom(h)
    await jogarAteOFim()
    expect($('.ros-tora__record').textContent).toBe(ptBR.newRecord)
    expect(host.storage.getItem('roqueos:tora:best')).toBe('1')
  })

  it('placar fora do ar não derruba o jogo nem apaga o recorde local', async () => {
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {})
    const h = criarHostFalso({ jogoId: 'tora' })
    h.placar = {
      carregar: async () => {
        throw new Error('offline')
      },
      salvar: async () => {
        throw new Error('offline')
      },
    }
    h.storage.setItem('roqueos:tora:best', '450')
    await montarCom(h)
    await vi.waitFor(() => expect(erro).toHaveBeenCalled())
    expect($('.ros-tora__best').textContent).toContain('450')
    await jogarAteOFim()
    expect($('.ros-tora__over')).not.toBeNull()
    expect(host.storage.getItem('roqueos:tora:best')).toBe('450')
  })

  it('entrar na conta com o jogo aberto busca o recorde da conta de novo', async () => {
    await montar()
    await vi.waitFor(() => expect(host.contar('placar', 'carregar')).toBe(1))
    host.disparar('identidade', { uid: 'u1', nome: 'Ana' })
    await vi.waitFor(() => expect(host.contar('placar', 'carregar')).toBe(2))
  })

  // O modo leve é a única coisa do código de GPU que muda de origem na
  // extração: vinha do composable do RoqueOS e agora vem do host.
  it('o perfil leve do host chega no three: sem antialias, sem sombra, pixel ratio menor', async () => {
    await montar({ modoLeve: true })
    expect($('.ros-tora').classList.contains('ros-tora--low')).toBe(true)
    const r = renderizador()
    expect(r.opcoes).toEqual({ antialias: false, alpha: false })
    expect(r.shadowMap.enabled).toBe(false)
    expect(r.pixelRatio).toBeLessThanOrEqual(1.25)
  })

  it('sem perfil leve o three nasce com antialias e sombra suave', async () => {
    await montar({ modoLeve: false })
    expect($('.ros-tora').classList.contains('ros-tora--low')).toBe(false)
    const r = renderizador()
    expect(r.opcoes).toEqual({ antialias: true, alpha: false })
    expect(r.shadowMap.enabled).toBe(true)
    expect(r.shadowMap.type).toBe(THREE.PCFSoftShadowMap)
  })

  // Do front: 'cleans up the E2E hook on unmount'.
  it('desmontar solta tudo: o gancho, o contexto WebGL, a tela, o laço e a escuta da conta', async () => {
    await montar()
    await vi.waitFor(() => expect(host.contar('placar', 'carregar')).toBe(1))
    const r = renderizador()
    expect(window.__tora).toBeTruthy()
    montagem.desmontar()
    expect(window.__tora).toBeUndefined()
    expect(r.descartado).toBe(true)
    expect(el.querySelector('.ros-tora')).toBeNull()
    expect(el.querySelector('canvas')).toBeNull()
    const quadros = r.quadros
    rodar(5)
    expect(r.quadros).toBe(quadros)
    host.disparar('identidade', { uid: 'u1', nome: 'Ana' })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(host.contar('placar', 'carregar')).toBe(1)
    // Desmontar de novo acontece de verdade (a janela fecha e o componente em
    // volta desmonta depois) e não pode lançar.
    expect(() => montagem.desmontar()).not.toThrow()
  })

  it('desmontar antes de o texto chegar não monta nada depois', async () => {
    host = criarHostFalso({ jogoId: 'tora' })
    montagem = jogo.mount(palco(), host, { ativo: true })
    montagem.desmontar()
    await new Promise((r) => setTimeout(r, 50))
    expect(el.querySelector('.ros-tora')).toBeNull()
  })

  it('toda chave que a tela usa existe no pt-BR', () => {
    const usadas = [...tela.matchAll(/txt\('([\w.]+)'/g)].map((m) => m[1])
    expect(usadas.length).toBeGreaterThan(10)
    const faltando = usadas.filter((k) => typeof ptBR[k] !== 'string')
    expect(faltando).toEqual([])
  })
})
