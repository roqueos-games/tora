// O som do Tora, procedural: nenhum arquivo de áudio, só osciladores ligados
// direto na saída. O AudioContext é do host (no RoqueOS, o compartilhado com os
// apps de música; fora dele, um próprio).
//
// As notas, os timbres, os volumes e o fato de tocar sem conferir se o contexto
// está rodando vieram do componente do RoqueOS como eram em 25/09/2026. O 2048
// confere o estado antes de tocar; o Tora nunca conferiu, e a extração não é o
// lugar de mudar como o jogo soa.

/**
 * @param {{ contexto: () => AudioContext | null }} audio a capacidade `audio` do host
 * @param {() => boolean} estaMudo
 */
export function criarSom(audio, estaMudo) {
  const tom = (freq, dur, tipo = 'sine', ganho = 0.12, depois = 0) => {
    if (estaMudo()) return
    let ctx
    try {
      ctx = audio.contexto()
    } catch {
      return
    }
    if (!ctx) return
    const t0 = ctx.currentTime + depois
    const osc = ctx.createOscillator()
    const g = ctx.createGain()
    osc.type = tipo
    osc.frequency.setValueAtTime(freq, t0)
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.exponentialRampToValueAtTime(ganho, t0 + 0.012)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    osc.connect(g).connect(ctx.destination)
    osc.start(t0)
    osc.stop(t0 + dur + 0.02)
  }

  return {
    /** A peça assentou no tabuleiro. */
    encaixar() {
      tom(150, 0.13, 'triangle', 0.14)
    },
    /** Fileiras limparam: uma nota a mais por linha, mais aguda a cada combo. */
    limpar(linhas, combo) {
      const base = 300 + combo * 40
      const escala = [0, 4, 7, 12]
      for (let i = 0; i < Math.min(4, linhas + 1); i++) {
        tom(base * Math.pow(2, escala[i] / 12), 0.22, 'sine', 0.12, i * 0.06)
      }
    },
    subiuDeNivel() {
      ;[523, 659, 784, 1046].forEach((f, i) => tom(f, 0.26, 'triangle', 0.1, i * 0.08))
    },
    perdeu() {
      ;[392, 330, 262].forEach((f, i) => tom(f, 0.34, 'sawtooth', 0.09, i * 0.1))
    },
  }
}
