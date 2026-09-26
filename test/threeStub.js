// Um three de mentira para o teste. O jsdom não tem WebGL: o WebGLRenderer de
// verdade lança ao criar o contexto, e o jogo nem monta. Este dublê é o mock do
// `ROSTora.spec.js` do RoqueOS (o que o teste do Tora usava lá, até 25/09/2026):
// vetores, cor, plano, cena, grupo, malha, câmera, luzes com sombra, os três
// materiais, textura de canvas, as três geometrias e o raycaster do arrasto.
//
// Três coisas a mais que lá:
// - o renderer guarda as opções com que nasceu, o pixel ratio, quantos quadros
//   desenhou e se foi descartado, e se pendura no próprio canvas. É assim que o
//   teste confere que o modo leve do host chega no código de GPU (sem
//   antialias, sem sombra, pixel ratio menor), que a janela sem foco para de
//   desenhar e que desmontar solta o contexto, sem abrir o componente por dentro;
// - `Raycaster.acertos` decide o que o raio acerta. Por padrão nada (arrastar é
//   girar a vista, como lá); o teste troca para acertar uma peça da bandeja e
//   joga o arrasto de verdade, do pointerdown ao encaixe;
// - `Object3D.add` anota o `parent`, que o `pickTray` do jogo sobe para achar a
//   peça dona do bloco acertado.
//
// Sem `PMREMGenerator`, como lá: o `buildEnvironment` do jogo cai no `catch` e
// segue sem luz de ambiente, só com as luzes diretas.
// Uso: vi.mock('three', async () => (await import('./threeStub.js')).criarThreeFalso())
export function criarThreeFalso() {
  class Vec2 {
    constructor(x = 0, y = 0) {
      this.x = x
      this.y = y
    }
    set(x, y) {
      this.x = x
      this.y = y
      return this
    }
  }
  class Vec3 {
    constructor(x = 0, y = 0, z = 0) {
      this.x = x
      this.y = y
      this.z = z
    }
    set(x, y, z) {
      this.x = x
      this.y = y
      this.z = z
      return this
    }
    setScalar(s) {
      return this.set(s, s, s)
    }
    lerp() {
      return this
    }
    addScaledVector() {
      return this
    }
    copy(v) {
      return this.set(v.x, v.y, v.z)
    }
  }
  class Color {
    constructor() {
      this.r = 0.8
      this.g = 0.6
      this.b = 0.3
    }
    clone() {
      return new Color()
    }
    multiplyScalar() {
      return this
    }
    lerp() {
      return this
    }
  }
  class Plane {
    constructor(n, c) {
      this.normal = n
      this.constant = c
    }
  }
  class Object3D {
    constructor() {
      this.children = []
      this.parent = null
      this.position = new Vec3()
      this.scale = new Vec3(1, 1, 1)
      this.rotation = new Vec3()
      this.userData = {}
      this.visible = true
    }
    add(...filhos) {
      for (const f of filhos) f.parent = this
      this.children.push(...filhos)
    }
    remove(x) {
      this.children = this.children.filter((c) => c !== x)
    }
  }
  const posAttr = {
    count: 0,
    getX: () => 0,
    getY: () => 0,
    getZ: () => 0,
    setXYZ() {},
    needsUpdate: false,
  }
  class Geometry {
    constructor() {
      this.attributes = { position: posAttr }
    }
    computeVertexNormals() {}
    dispose() {}
  }
  class Material {
    constructor(opcoes = {}) {
      Object.assign(this, opcoes)
      this.opacity = opcoes.opacity ?? 1
    }
    dispose() {}
  }
  class Texture {
    constructor() {
      this.repeat = { set() {} }
      this.wrapS = 0
      this.wrapT = 0
      this.anisotropy = 1
      this.mapping = 0
    }
    dispose() {}
  }
  class Mesh extends Object3D {
    constructor(geo, mat) {
      super()
      this.geometry = geo
      this.material = mat
    }
  }
  class Light extends Object3D {
    constructor() {
      super()
      this.shadow = { mapSize: { set() {} }, camera: {}, bias: 0, radius: 0 }
    }
  }
  class Camera extends Object3D {
    constructor() {
      super()
      this.aspect = 1
    }
    lookAt() {}
    updateProjectionMatrix() {}
  }
  class WebGLRenderer {
    constructor(opcoes = {}) {
      this.opcoes = opcoes
      this.pixelRatio = 1
      this.quadros = 0
      this.descartado = false
      this.domElement = document.createElement('canvas')
      this.domElement.width = 480
      this.domElement.height = 640
      this.domElement.getBoundingClientRect = () => ({ left: 0, top: 0, width: 480, height: 640 })
      this.domElement.__renderizador = this
      this.shadowMap = { enabled: false, type: 0 }
    }
    setPixelRatio(r) {
      this.pixelRatio = r
    }
    setSize() {}
    render() {
      this.quadros++
    }
    dispose() {
      this.descartado = true
    }
  }
  class Raycaster {
    /** O que o raio acerta, dado o que o jogo pediu para testar. */
    static acertos = () => []
    constructor() {
      this.ray = { intersectPlane: (_p, t) => t }
    }
    setFromCamera() {}
    intersectObjects(objetos) {
      return Raycaster.acertos(objetos)
    }
  }
  return {
    Vector2: Vec2,
    Vector3: Vec3,
    Color,
    Plane,
    Scene: Object3D,
    Group: Object3D,
    Mesh,
    PerspectiveCamera: Camera,
    WebGLRenderer,
    Raycaster,
    CanvasTexture: Texture,
    HemisphereLight: Light,
    DirectionalLight: Light,
    PointLight: Light,
    MeshPhysicalMaterial: class extends Material {},
    MeshStandardMaterial: class extends Material {},
    MeshBasicMaterial: class extends Material {},
    BoxGeometry: Geometry,
    PlaneGeometry: Geometry,
    SphereGeometry: Geometry,
    PCFSoftShadowMap: 1,
    ACESFilmicToneMapping: 1,
    SRGBColorSpace: 'srgb',
    EquirectangularReflectionMapping: 1,
    RepeatWrapping: 1,
  }
}
