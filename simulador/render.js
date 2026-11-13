// Render 3D con Three.js (global THREE). Solo lee el estado del motor; nunca lo modifica (nucleo.js no lo carga).
// Mundo: x = cx, z = cy, y = altura. Muros h=3, cajas h=1, agentes de pie h=2 / agachados h=1 / caídos aplastados.
// Escena a oscuras (luz de luna muy tenue); cada linterna de Guardián es un foco real con sombras, así que se ve qué
// está iluminado y qué no. Cámara en perspectiva: arrastrar = girar, botón derecho = desplazar, rueda = zoom.
// Tecla V: muestra los conos lógicos (los que usa el motor) encima del suelo.

const COLOR_CODIGO = { '#': '#5a5a55', '.': '#b9b6ac', g: '#7fa84c', c: '#8d6e4a', B: '#f09e26', S: '#388ade', G: '#e6801a', E: '#1f9e75' };
const COLOR_EQUIPO = { guardianes: 0xe6801a, infiltradores: 0x388ade };
const COLOR_GADGET = { camara: 0xff3b3b, sensor: 0xff9ad5, humo: 0x9a9a9a, senuelo: 0x40e0ff, pem: 0x8a5cff };
const ALFA_CONO = 0.35;
const ALTURA_LINTERNA = 1.2; // poco por encima de las cajas (1): dejan detrás una sombra larga, como en la lógica (agachado tras caja = oculto)
const DURACION_ONDA_S = 0.6; // lo que se ve cada anillo de ruido (se emite uno cada RUIDO_INTERVALO_S)
const INTENSIDAD_LINTERNA = 60; // candelas (luces físicas de Three r155+); con decay 1.2 llega bien a ~9 casillas

class RenderCenital {
  constructor(contenedor, motor) {
    const { ancho, alto, altura } = motor.mapa;
    this.contenedor = contenedor;
    this.mapa = motor.mapa;
    this.verConos = false;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    contenedor.appendChild(this.renderer.domElement);
    this.escena = new THREE.Scene();
    this.escena.background = new THREE.Color(0x05070a);
    // Luz de luna: lo justo para adivinar el mapa a oscuras.
    this.escena.add(new THREE.HemisphereLight(0x5a6c8a, 0x0a0a10, 0.18));
    const luna = new THREE.DirectionalLight(0x8fa4c8, 0.12);
    luna.position.set(ancho * 0.3, 40, alto * 0.2);
    this.escena.add(luna);

    this.crearCamara(ancho, alto);
    addEventListener('resize', () => this.ajustar());
    addEventListener('keydown', e => { if (e.code === 'KeyV') this.verConos = !this.verConos; });
    this.ajustar();

    // Suelo: una textura de 1 píxel por casilla. DataTexture empieza por abajo (v = 0), así que las filas van invertidas.
    const datos = new Uint8Array(ancho * alto * 4), color = new THREE.Color();
    motor.diseno.celdas.forEach((fila, z) => fila.forEach((c, x) => {
      color.set(COLOR_CODIGO[c] || '#ff00ff');
      datos.set([color.r * 255, color.g * 255, color.b * 255, 255], (x + (alto - 1 - z) * ancho) * 4);
    }));
    const textura = new THREE.DataTexture(datos, ancho, alto);
    textura.magFilter = THREE.NearestFilter;
    textura.colorSpace = THREE.SRGBColorSpace;
    textura.needsUpdate = true;
    const suelo = new THREE.Mesh(new THREE.PlaneGeometry(ancho, alto), new THREE.MeshStandardMaterial({ map: textura, roughness: 0.9 }));
    suelo.rotation.x = -Math.PI / 2;
    suelo.position.set(ancho / 2, 0, alto / 2);
    suelo.receiveShadow = true;
    this.escena.add(suelo);

    // Muros (h = 3) y cajas (h = 1) en una sola malla instanciada; dan sombra a las linternas.
    const solidos = [];
    altura.forEach((h, i) => { if (h > 0) solidos.push(i); });
    const bloques = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ roughness: 0.85, shadowSide: THREE.FrontSide }), solidos.length);
    // shadowSide FrontSide: con las caras traseras (lo de por defecto) el suelo pegado detrás de un muro quedaba a la
    // misma profundidad que esa cara y salía iluminado (una franja de luz al otro lado del muro).
    const m = new THREE.Matrix4();
    solidos.forEach((i, k) => {
      const h = altura[i], cx = i % ancho, cy = (i - cx) / ancho;
      bloques.setMatrixAt(k, m.makeScale(1, h, 1).setPosition(cx + 0.5, h / 2, cy + 0.5));
      bloques.setColorAt(k, color.set(h >= ALTURA.MURO ? COLOR_CODIGO['#'] : COLOR_CODIGO.c));
    });
    bloques.castShadow = bloques.receiveShadow = true;
    this.escena.add(bloques);

    this.vistas = motor.agentes.map(a => this.crearVistaAgente(a));
    this.vistasCamara = new Map(); // gadget cámara -> malla de su cono
    this.vistasHumo = new Map();   // gadget humo -> columna de humo (da sombra: tapa las linternas como tapa la visión)
    this.capa = new THREE.Group(); // botín y resto de gadgets: se rehace en cada fotograma (son pocos)
    this.escena.add(this.capa);
    this.geoDisco = new THREE.CircleGeometry(1, 24);
    this.geoAnillo = new THREE.RingGeometry(0.85, 1, 32);
  }

  // Órbita casera (los controles de examples/js ya no existen en la build clásica de r158).
  crearCamara(ancho, alto) {
    this.camara = new THREE.PerspectiveCamera(45, 1, 0.5, 500);
    this.orbita = { objetivo: new THREE.Vector3(ancho / 2, 0, alto / 2), radio: Math.max(ancho, alto) * 1.2, theta: 0, phi: 0.75 };
    const lienzo = this.renderer.domElement;
    let arrastre = null;
    lienzo.addEventListener('contextmenu', e => e.preventDefault());
    lienzo.addEventListener('pointerdown', e => { arrastre = { x: e.clientX, y: e.clientY, boton: e.button }; lienzo.setPointerCapture(e.pointerId); });
    lienzo.addEventListener('pointerup', () => { arrastre = null; });
    lienzo.addEventListener('pointermove', e => {
      if (!arrastre) return;
      const dx = e.clientX - arrastre.x, dy = e.clientY - arrastre.y, o = this.orbita;
      arrastre.x = e.clientX; arrastre.y = e.clientY;
      if (arrastre.boton === 0) {
        o.theta -= dx * 0.005;
        o.phi = Math.min(1.5, Math.max(0.05, o.phi - dy * 0.005));
      } else {
        const paso = o.radio * 0.0015, c = Math.cos(o.theta), s = Math.sin(o.theta);
        o.objetivo.x -= (dx * c + dy * s) * paso;
        o.objetivo.z -= (-dx * s + dy * c) * paso;
      }
    });
    lienzo.addEventListener('wheel', e => {
      e.preventDefault();
      this.orbita.radio = Math.min(300, Math.max(8, this.orbita.radio * Math.exp(e.deltaY * 0.001)));
    }, { passive: false });
  }

  colocarCamara() {
    const o = this.orbita;
    // theta = 0: el norte del mapa (fila 0) queda arriba de la pantalla.
    this.camara.position.set(
      o.objetivo.x + o.radio * Math.sin(o.phi) * Math.sin(o.theta),
      o.radio * Math.cos(o.phi),
      o.objetivo.z + o.radio * Math.sin(o.phi) * Math.cos(o.theta));
    this.camara.lookAt(o.objetivo);
  }

  ajustar() {
    const w = this.contenedor.clientWidth, h = this.contenedor.clientHeight;
    this.renderer.setSize(w, h);
    this.camara.aspect = w / h;
    this.camara.updateProjectionMatrix();
  }

  // Abanico de triángulos con color RGBA por vértice (la caída de luz es el alfa). n = rayos del cono.
  crearCono(vision) {
    const n = Math.ceil(vision.apertura / PASO_RAYO_RENDER) + 2, geo = new THREE.BufferGeometry(), indices = [];
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 4), 4));
    for (let i = 1; i < n - 1; i++) indices.push(0, i, i + 1);
    geo.setIndex(indices);
    const cono = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
    cono.renderOrder = 1;
    cono.frustumCulled = false;
    this.escena.add(cono);
    return cono;
  }

  crearVistaAgente(a) {
    const color = COLOR_EQUIPO[a.equipo];
    const cuerpo = new THREE.Mesh(new THREE.CylinderGeometry(RADIO_AGENTE, RADIO_AGENTE, 1, 16),
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.12, roughness: 0.6 }));
    cuerpo.castShadow = false; // el foco está dentro del cuerpo
    const nariz = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.2, 0.12), new THREE.MeshBasicMaterial({ color: 0x000000 }));
    nariz.position.set(0.3, 0.4, 0);
    cuerpo.add(nariz);
    this.escena.add(cuerpo);
    const barra = color => {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.12), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, depthTest: false }));
      p.renderOrder = 3;
      this.escena.add(p);
      return p;
    };
    const vista = { cuerpo, cono: this.crearCono(a.vision), barra: barra(0xff2020), bolsa: barra(0xffd23f), accion: barra(0x50ff70) };
    if (a.esGuardian) {
      // Foco de la linterna: mismo alcance y apertura que la visión lógica; las sombras salen de muros, cajas y humo.
      const v = a.vision, foco = new THREE.SpotLight(0xfff1c4, INTENSIDAD_LINTERNA, v.alcance * 1.15, v.apertura / 2, 0.35, 1.2);
      foco.castShadow = true;
      foco.shadow.mapSize.set(1024, 1024);
      foco.shadow.camera.near = 0.05;
      foco.shadow.bias = -0.0005;
      this.escena.add(foco, foco.target);
      vista.foco = foco;
    }
    return vista;
  }

  dibujar(motor) {
    this.colocarCamara();
    motor.agentes.forEach((a, k) => {
      const { cuerpo, cono, barra, bolsa, accion, foco } = this.vistas[k], visible = a.estado !== 'eliminado';
      cuerpo.visible = visible;
      cono.visible = a.activo && this.verConos;
      if (foco) {
        foco.visible = a.activo;
        // En el centro del Guardián (a >= RADIO_AGENTE de cualquier muro): adelantado, al pegarse a un muro el foco
        // quedaba casi dentro y la luz se colaba al otro lado. Los cuerpos no dan sombra, así que no se tapa a sí mismo.
        foco.position.set(a.x, ALTURA_LINTERNA, a.y);
        foco.target.position.set(a.x + Math.cos(a.angulo) * 4, 0, a.y + Math.sin(a.angulo) * 4);
      }
      if (!visible) { barra.visible = bolsa.visible = accion.visible = false; return; }
      cuerpo.scale.y = a.activo ? a.altura : 0.2; // de pie 2, agachado 1, caído en el suelo
      cuerpo.position.set(a.x, cuerpo.scale.y / 2, a.y);
      cuerpo.rotation.y = -a.angulo;
      cuerpo.material.color.set(a.activo ? COLOR_EQUIPO[a.equipo] : 0x777777);
      const techo = cuerpo.scale.y + 0.35;
      this.barraSobre(barra, a, techo, a.barra.valor / BARRA_MAX);
      this.barraSobre(bolsa, a, techo + 0.18, a.bolsa / BOLSA_CAPACIDAD);
      this.barraSobre(accion, a, techo + 0.36, a.accion ? a.accion.progreso / a.accion.duracion : 0);
      if (cono.visible) this.actualizarCono(cono, a, a.altura === ALTURA.DE_PIE ? RAYO_ALTO : RAYO_BAJO, a.esGuardian ? [1, 0.95, 0.6] : [0.4, 1, 0.5]);
    });
    this.dibujarCapa(motor);
    this.renderer.render(this.escena, this.camara);
  }

  // Barra flotante sobre el agente, siempre de cara a la cámara; invisible si fraccion = 0.
  barraSobre(malla, a, y, fraccion) {
    malla.visible = fraccion > 0;
    malla.scale.x = Math.max(0.001, Math.min(1, fraccion));
    malla.position.set(a.x, y, a.y);
    malla.quaternion.copy(this.camara.quaternion);
  }

  // Se dibuja la capa con la que el observador ve a alguien de su misma altura: de pie el rayo alto, agachado el bajo.
  actualizarCono(cono, obs, capa, c) {
    const pos = cono.geometry.attributes.position, col = cono.geometry.attributes.color;
    const puntos = poligonoVision(this.mapa, obs, capa);
    pos.setXYZ(0, obs.x, 0.04, obs.y);
    col.setXYZW(0, ...c, ALFA_CONO);
    puntos.forEach(([x, y, d], i) => {
      pos.setXYZ(i + 1, x, 0.04, y);
      col.setXYZW(i + 1, ...c, obs.vision.caida ? ALFA_CONO * (1 - (1 - LUZ_MIN) * d / obs.vision.alcance) : ALFA_CONO);
    });
    pos.needsUpdate = col.needsUpdate = true;
  }

  // Disco (o anillo) plano de radio r sobre el suelo en (x, y). Brilla un poco para verse a oscuras.
  disco(x, y, r, color, alfa, anillo = false) {
    const d = new THREE.Mesh(anillo ? this.geoAnillo : this.geoDisco,
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: alfa, side: THREE.DoubleSide, depthWrite: false }));
    d.rotation.x = -Math.PI / 2;
    d.scale.set(r, r, 1);
    d.position.set(x, 0.06, y);
    d.renderOrder = 2;
    this.capa.add(d);
  }

  dibujarCapa(motor) {
    for (const hijo of this.capa.children) hijo.material.dispose();
    this.capa.clear();
    // Botín que queda en cada punto B (radio proporcional) y montones del suelo.
    for (const [c, valor] of motor.botines) {
      const [x, y] = centroCelda(this.mapa, c);
      this.disco(x, y, 0.25 + 0.5 * Math.min(1, valor / VALOR_BOTIN), 0xffd23f, valor > 0 ? 0.9 : 0.2);
    }
    for (const p of motor.suelo) this.disco(p.x, p.y, 0.35, 0xffd23f, 0.9, true);
    // Ruido: onda que crece hasta su radio real (hasta donde lo oye un enemigo) y se apaga en DURACION_ONDA_S.
    motor.ondas = motor.ondas.filter(o => motor.t - o.t < DURACION_ONDA_S);
    for (const o of motor.ondas) {
      const f = (motor.t - o.t) / DURACION_ONDA_S;
      this.disco(o.x, o.y, o.radio * Math.min(1, 0.3 + f), COLOR_EQUIPO[o.equipo], 0.55 * (1 - f), true);
    }
    const vivos = new Set();
    for (const g of motor.gadgets) {
      const apagado = motor.t < g.desactivadoHasta;
      vivos.add(g);
      if (g.tipo === 'camara') {
        if (!this.vistasCamara.has(g)) this.vistasCamara.set(g, this.crearCono(g.vision));
        const cono = this.vistasCamara.get(g);
        cono.visible = !apagado;
        if (!apagado) this.actualizarCono(cono, g, RAYO_ALTO, [1, 0.3, 0.3]);
        this.disco(g.x, g.y, 0.3, COLOR_GADGET.camara, apagado ? 0.3 : 1);
      } else if (g.tipo === 'sensor') {
        this.disco(g.x, g.y, SENSOR.radio, COLOR_GADGET.sensor, apagado || !sensorArmado(g, motor.t) ? 0.12 : 0.6, true); // recargándose: casi invisible
      } else if (g.tipo === 'humo') {
        if (!g.activo) { this.disco(g.x, g.y, 0.25, COLOR_GADGET.humo, 1); continue; } // granada en el suelo, con la mecha
        if (!this.vistasHumo.has(g)) {
          const humo = new THREE.Mesh(new THREE.CylinderGeometry(HUMO.radio, HUMO.radio, ALTURA.MURO, 24),
            new THREE.MeshStandardMaterial({ color: 0x8a8a8a, transparent: true, opacity: 0.8, depthWrite: false }));
          humo.position.set(g.x, ALTURA.MURO / 2, g.y);
          humo.castShadow = true;
          this.escena.add(humo);
          this.vistasHumo.set(g, humo);
        }
      } else if (g.tipo === 'senuelo') {
        this.disco(g.x, g.y, 0.3 + (motor.t * 2 % 1) * SENUELO.ruido * 0.3, COLOR_GADGET.senuelo, 0.8, true);
      } else if (g.tipo === 'pem') {
        this.disco(g.x, g.y, PEM.radio, COLOR_GADGET.pem, 0.8, true);
      }
    }
    const quitar = (mapa, g, malla) => { if (!vivos.has(g)) { this.escena.remove(malla); malla.geometry.dispose(); malla.material.dispose(); mapa.delete(g); } };
    for (const [g, cono] of this.vistasCamara) quitar(this.vistasCamara, g, cono);
    for (const [g, humo] of this.vistasHumo) quitar(this.vistasHumo, g, humo);
  }
}
