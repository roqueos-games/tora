# Changelog

## 0.1.0 (25/09/2026)

- O Tora sai do repositório do RoqueOS e passa a falar com ele só pelo `jogo-sdk` 0.1.0.
  Motor, render 3D, som, visual, chaves de armazenamento (`best`, `muted`), nomes de evento
  (`game_start`, `game_over`) e o gancho `window.__tora` ficam como eram. O código que toca a
  GPU (renderer, tone mapping, sombras, materiais, texturas de madeira, luzes, pixel ratio,
  perfil leve) veio sem mudança.
- `three` vira `peerDependency`: o RoqueOS fornece o dele, na mesma versão de antes.
- Texto nos dez idiomas em `i18n/` (com o nome do jogo, que o logo mostra), ícones SVG
  próprios no lugar dos do Material, e o jogo roda sozinho com `yarn dev`.
- A janela sem foco para de desenhar, como antes; o foco agora vem do host.
- O recorde da conta que chega depois de o jogo abrir não cai mais na primeira jogada. Antes,
  cada jogada copiava o recorde que o motor tinha ao nascer (o local) por cima do da tela, e o
  fim da partida gravava esse número menor na chave da galeria e na conta.
- Entrar na conta com o jogo aberto traz o recorde da conta sem reabrir o jogo.
- O perfil leve do aparelho chega pelo host e liga a classe `ros-tora--low`.
