// Gadgets y herramientas (GADGETS_POR_EQUIPO por equipo y ronda). Requiere config.js y raycast.js; los usa nucleo.js.
// Un gadget es { tipo, equipo, x, y, hasta, desactivadoHasta, ... }:
//  Guardianes (los colocan durante los PREPARACION_S previos a la ronda, donde dice planificarGadgetsGuardianes):
//   - camara: cono de VISION.camara a altura 2 que barre (CAMARA_BARRIDO); lo que ve va a la pizarra.
//   - sensor: avisa por radio si un Infiltrador camina o corre a <= SENSOR.radio (en sigilo no lo nota); luego se
//     recarga SENSOR.recarga s.
//  Infiltradores (lanzados por la IA durante la ronda):
//   - humo: suena al lanzarlo (radio HUMO.ruido) y, pasada la mecha, las casillas a <= HUMO.radio tapan la visión
//     (altura 3) durante HUMO.duracion, salvo a <= HUMO.vistaCerca (raycast.js).
//   - senuelo: ruidos falsos de radio SENUELO.ruido cada RUIDO_INTERVALO_S durante SENUELO.duracion.
//   - pem: instantáneo; desactiva los gadgets enemigos a <= PEM.radio durante PEM.duracion (queda 0.5 s para dibujarlo).

// --- Colocación (Guardianes): donde más Infiltradores habrían detectado ---
// Datos: RASTROS (rastros.json, lo graba pruebas/grabar_rastros.js con los equipos entrenados; lo cargan cargar.js y
// principal.js). Es una lista de "pasos": un Infiltrador durante una ventana de SENSOR.recarga s, con las casillas por
// las que pasó andando/corriendo y en las que estuvo agachado o quieto. Sin rastros (o de otro mapa), cada ruta más
// corta de una esquina a un punto B cuenta como un paso.
// Un sensor detecta un paso si este anduvo o corrió a <= SENSOR.radio (en sigilo no lo nota). Una cámara, si el paso
// tocó alguna casilla de las que ve en todo su barrido.
// shortcut: la cámara no cuenta los CAMARA_DETECCION_S que necesita ni en qué punto del barrido está; si se queda
// corto, simular la cámara sobre las posiciones grabadas con su tiempo.
let RASTROS = null;
const CACHE_TACTICA = new WeakMap();
const CAMARA_EN_PARED = 0.45; // la cámara se monta en la cara del muro, no en el centro de la casilla

// Pasos de los rastros si son de este mapa; si no, las rutas más cortas de cada esquina de salida a cada punto B.
function pasosInfiltradores(motor) {
  const mapa = motor.mapa;
  if (RASTROS && RASTROS.ancho === mapa.ancho && RASTROS.alto === mapa.alto) return RASTROS.pasos;
  const salidas = []; // una salida por grupo de casillas S contiguas (una por esquina)
  for (const [x, y] of mapa.marcadores.S || []) {
    if (!salidas.some(([a, b]) => Math.abs(a - x) + Math.abs(b - y) <= 4)) salidas.push([x, y]);
  }
  const pasos = [];
  for (const [sx, sy] of salidas) for (const b of motor.puntosB) pasos.push([buscarRuta(mapa, sx + sy * mapa.ancho, b) || [], []]);
  return pasos;
}

// Candidatos de sensor (cada casilla libre) y de cámara (en una pared), cada uno con los pasos que detecta (detecta:
// índices de pasos, sin repetir). Se calcula una vez por mapa y rastros (cache): no depende de los genes.
function tacticaDelMapa(motor) {
  const cache = CACHE_TACTICA.get(motor.diseno);
  if (cache && cache.rastros === RASTROS) return cache;
  const mapa = motor.mapa, n = mapa.ancho * mapa.alto, pasos = pasosInfiltradores(motor);
  const moviendo = Array.from({ length: n }, () => []), tocada = Array.from({ length: n }, () => []); // casilla -> pasos
  pasos.forEach(([mov, quieto], p) => {
    for (const c of mov) { moviendo[c].push(p); tocada[c].push(p); }
    for (const c of quieto) tocada[c].push(p);
  });
  const unir = (listas, celdas) => { const s = new Set(); for (const c of celdas) for (const p of listas[c]) s.add(p); return [...s]; };

  const sensores = [];
  for (let c = 0; c < n; c++) {
    const cx = c % mapa.ancho, cy = (c - cx) / mapa.ancho;
    if (!transitable(mapa, cx, cy)) continue;
    const detecta = unir(moviendo, celdasEnRadio(mapa, cx + 0.5, cy + 0.5, SENSOR.radio));
    if (detecta.length) sensores.push({ celda: c, detecta });
  }
  // Cámaras: solo en paredes. Casilla libre con un muro al lado (4 vecinas): la cámara va en la cara de ese muro (a
  // CAMARA_EN_PARED del centro) y mira hacia fuera, de frente o a ±45°; ve lo que cubre todo su barrido.
  const vision = { ...VISION.camara, apertura: VISION.camara.apertura + 2 * CAMARA_BARRIDO.amplitud };
  const camaras = [], punto = { x: 0, y: 0, altura: ALTURA.DE_PIE }, r = Math.ceil(vision.alcance);
  for (let c = 0; c < n; c++) {
    const cx = c % mapa.ancho, cy = (c - cx) / mapa.ancho;
    if (!transitable(mapa, cx, cy)) continue;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (alturaEn(mapa, cx + dx, cy + dy) < ALTURA.MURO) continue;
      const fuera = Math.atan2(-dy, -dx);
      for (const giro of [-Math.PI / 4, 0, Math.PI / 4]) {
        const obs = { x: cx + 0.5 + dx * CAMARA_EN_PARED, y: cy + 0.5 + dy * CAMARA_EN_PARED, angulo: fuera + giro, altura: ALTURA.DE_PIE, vision };
        const ve = [];
        for (let y = Math.max(0, cy - r); y <= Math.min(mapa.alto - 1, cy + r); y++) {
          for (let x = Math.max(0, cx - r); x <= Math.min(mapa.ancho - 1, cx + r); x++) {
            const i = x + y * mapa.ancho;
            if (!tocada[i].length) continue; // por ahí no pasó nadie: no suma
            punto.x = x + 0.5; punto.y = y + 0.5;
            if (intensidadVision(mapa, obs, punto) > 0) ve.push(i);
          }
        }
        const detecta = unir(tocada, ve);
        if (detecta.length) camaras.push({ celda: c, x: obs.x, y: obs.y, angulo: obs.angulo, normal: fuera, detecta });
      }
    }
  }
  const tactica = { rastros: RASTROS, nPasos: pasos.length, sensores, camaras };
  CACHE_TACTICA.set(motor.diseno, tactica);
  return tactica;
}

// Plan de gadgets: round(proporcion_camaras · N) cámaras y el resto huecos de sensores (SENSOR.porHueco sensores cada
// uno). Se eligen uno a uno (voraz): cada vez el candidato que detecta más pasos que AÚN no detecta ningún gadget ya
// elegido (a igualdad, el que más detecta en total). Así un segundo gadget encima del primero no suma nada.
// Cada gadget se asigna a un Guardián (k % n), que lo lleva durante la preparación (Guardian.pendientes), y solo vale
// una casilla a la que ese Guardián llega a tiempo corriendo desde donde dejó el anterior (si no, se perdería).
const HOLGURA_PREPARACION = 1.3; // el tiempo real de llegar es ~1.3 veces el de la ruta ideal (giros, choques); medido
function planificarGadgetsGuardianes(motor, genes) {
  const { nPasos, sensores, camaras } = tacticaDelMapa(motor), guardianes = motor.equipos.guardianes, mapa = motor.mapa;
  const detectado = new Uint8Array(nPasos);
  const nuevos = cand => { let k = 0; for (const p of cand.detecta) if (!detectado[p]) k++; return k; };
  // Por Guardián: dónde estará tras dejar lo que ya lleva, cuánto tiempo de preparación habrá gastado y las distancias.
  const ruta = guardianes.map(g => ({ celda: celdaEn(mapa, g.x, g.y), tiempo: 0, dist: null }));
  const mejorDe = (lista, usado, quien) => {
    const r = ruta[quien];
    r.dist ??= distanciasDesde(mapa, r.celda);
    let mejor = null, gana = -1, total = -1;
    for (const cand of lista) {
      if (usado.has(cand.celda) || r.tiempo + r.dist[cand.celda] / MODOS.correr.velocidad * HOLGURA_PREPARACION > PREPARACION_S) continue;
      const g = nuevos(cand);
      if (g > gana || (g === gana && cand.detecta.length > total)) { mejor = cand; gana = g; total = cand.detecta.length; }
    }
    if (!mejor) return null;
    usado.add(mejor.celda);
    for (const p of mejor.detecta) detectado[p] = 1;
    r.tiempo += r.dist[mejor.celda] / MODOS.correr.velocidad * HOLGURA_PREPARACION;
    r.celda = mejor.celda;
    r.dist = null;
    return mejor;
  };
  const nCamaras = Math.round(genes.proporcion_camaras * GADGETS_POR_EQUIPO), conCamara = new Set(), conSensor = new Set();
  for (let k = 0; k < GADGETS_POR_EQUIPO; k++) {
    if (k < nCamaras) {
      const quien = k % guardianes.length, c = mejorDe(camaras, conCamara, quien);
      if (c) guardianes[quien].pendientes.push({ tipo: 'camara', celda: c.celda, x: c.x, y: c.y, angulo: c.angulo, normal: c.normal });
    } else {
      for (let s = 0; s < SENSOR.porHueco; s++) {
        const quien = (k + s) % guardianes.length, c = mejorDe(sensores, conSensor, quien);
        if (c) guardianes[quien].pendientes.push({ tipo: 'sensor', celda: c.celda, extra: s > 0 }); // el extra no gasta hueco
      }
    }
  }
}

// El Guardián deja el siguiente gadget pendiente (sensor en el suelo, cámara en la pared). Las cámaras barren ±amplitud.
function colocarGadget(motor, guardian) {
  const plan = guardian.pendientes.shift(), { tipo, angulo } = plan;
  const [x, y] = plan.x !== undefined ? [plan.x, plan.y] : centroCelda(motor.mapa, plan.celda); // cámaras: en la pared
  const gadget = { tipo, equipo: 'guardianes', x, y, hasta: Infinity, desactivadoHasta: -Infinity };
  if (tipo === 'camara') Object.assign(gadget, { angulo, anguloBase: angulo, normal: plan.normal, desde: motor.t, altura: ALTURA.DE_PIE, vision: VISION.camara });
  motor.gadgets.push(gadget);
  if (!plan.extra) motor.inventario.guardianes--;
  motor.stats.guardianes.gadgets++;
}

// Ángulo de una cámara en el instante t: de -amplitud a +amplitud a velocidad constante, con una pausa en cada extremo.
function anguloBarrido(g, t) {
  const { amplitud, velocidad, pausa } = CAMARA_BARRIDO;
  if (amplitud <= 0 || velocidad <= 0) return g.anguloBase;
  const tramo = 2 * amplitud / velocidad, periodo = 2 * (tramo + pausa), f = ((t - g.desde) % periodo + periodo) % periodo;
  let off;
  if (f < tramo) off = -amplitud + velocidad * f;
  else if (f < tramo + pausa) off = amplitud;
  else if (f < 2 * tramo + pausa) off = amplitud - velocidad * (f - tramo - pausa);
  else off = -amplitud;
  if (g.normal === undefined) return g.anguloBase + off;
  // En la pared: el cono nunca se mete en el muro (como mucho 90° respecto a la perpendicular, contando su apertura).
  const lim = Math.PI / 2 - VISION.camara.apertura / 2;
  return g.normal + Math.max(-lim, Math.min(lim, difAngulo(g.anguloBase + off, g.normal)));
}

// ¿Puede avisar ya el sensor? (no está recargándose)
function sensorArmado(s, t) {
  return t >= (s.recargaHasta ?? -Infinity);
}

// Casillas cuyo centro está a <= radio de (x, y).
function celdasEnRadio(mapa, x, y, radio) {
  const celdas = [];
  for (let cy = Math.max(0, Math.floor(y - radio)); cy <= Math.min(mapa.alto - 1, Math.floor(y + radio)); cy++) {
    for (let cx = Math.max(0, Math.floor(x - radio)); cx <= Math.min(mapa.ancho - 1, Math.floor(x + radio)); cx++) {
      if (Math.hypot(cx + 0.5 - x, cy + 0.5 - y) <= radio) celdas.push(cx + cy * mapa.ancho);
    }
  }
  return celdas;
}

// Lanza una herramienta del equipo del agente. Devuelve false si no quedan. (x, y) se recorta al mapa.
function lanzarGadget(motor, agente, tipo, x, y) {
  const equipo = agente.equipo;
  if (motor.inventario[equipo] <= 0) return false;
  motor.inventario[equipo]--;
  motor.stats[equipo].gadgets++;
  // Se lanza a mano: como mucho LANZAMIENTO_MAX casillas y sin atravesar muros (por encima de las cajas sí).
  const dx = x - agente.x, dy = y - agente.y, d = Math.hypot(dx, dy);
  if (d > 1e-6) {
    const tope = Math.min(d, LANZAMIENTO_MAX, distanciaRayo(motor.mapa, agente.x, agente.y, Math.atan2(dy, dx), RAYO_ALTO, d, false) - 0.3);
    x = agente.x + dx / d * Math.max(0, tope);
    y = agente.y + dy / d * Math.max(0, tope);
  }
  x = Math.min(motor.mapa.ancho - 0.5, Math.max(0.5, x));
  y = Math.min(motor.mapa.alto - 0.5, Math.max(0.5, y));
  const t = motor.t, gadget = { tipo, equipo, x, y, desactivadoHasta: -Infinity };
  if (tipo === 'humo') {
    // Se arma ahora (ruido del lanzamiento) y tapa la visión desde activaDesde (actualizarGadgets).
    gadget.activaDesde = t + HUMO.mecha;
    gadget.activo = false;
    gadget.hasta = gadget.activaDesde + HUMO.duracion;
    gadget.celdas = celdasEnRadio(motor.mapa, x, y, HUMO.radio);
    motor.emitirRuido(gadget, HUMO.ruido);
  } else if (tipo === 'senuelo') {
    gadget.hasta = t + SENUELO.duracion;
    gadget.ultimoRuido = -Infinity;
  } else if (tipo === 'pem') {
    gadget.hasta = t + 0.5;
    for (const o of motor.gadgets) {
      if (o.equipo !== equipo && Math.hypot(o.x - x, o.y - y) <= PEM.radio) o.desactivadoHasta = t + PEM.duracion;
    }
  } else {
    throw new Error('Gadget desconocido: ' + tipo);
  }
  motor.gadgets.push(gadget);
  return true;
}

// Un tick de gadgets: caducan, y los activos (no desactivados por PEM) vigilan o hacen ruido.
function actualizarGadgets(motor) {
  const t = motor.t, infiltradores = motor.equipos.infiltradores;
  motor.gadgets = motor.gadgets.filter(g => {
    if (t >= g.hasta) {
      if (g.tipo === 'humo' && g.activo) for (const c of g.celdas) motor.mapa.humo[c]--;
      return false;
    }
    if (g.tipo === 'humo' && !g.activo && t >= g.activaDesde - 1e-9) {
      g.activo = true;
      for (const c of g.celdas) motor.mapa.humo[c]++;
    }
    if (t < g.desactivadoHasta) return true;
    if (g.tipo === 'camara') {
      if (g.anguloBase !== undefined) g.angulo = anguloBarrido(g, t);
      // Detección con exposición: da la alarma solo si lo tiene en el cono CAMARA_DETECCION_S seguidos (cruzar rápido
      // por un hueco del barrido no la dispara). Fuera del cono el contador se pierde.
      g.exposicion ??= new Map();
      for (const i of infiltradores) {
        const e = i.activo && intensidadVision(motor.mapa, g, i) > 0 ? (g.exposicion.get(i) || 0) + DT : 0;
        g.exposicion.set(i, e);
        if (e > 0) motor.stats.infiltradores.segundosCamara += DT;
        if (e > 0 && e >= CAMARA_DETECCION_S - 1e-9) motor.pizarras.guardianes.publicarContacto(i.id, i.x, i.y, t, -1, i.bolsa > 0);
      }
    } else if (g.tipo === 'sensor' && sensorArmado(g, t)) {
      // Tras avisar se recarga SENSOR.recarga s (un Infiltrador puede hacerlo saltar a propósito como cebo y cruzar).
      const i = infiltradores.find(i => i.activo && i.moviendose && i.modo !== 'sigilo' && Math.hypot(i.x - g.x, i.y - g.y) <= SENSOR.radio);
      if (i) {
        motor.pizarras.guardianes.publicarRuido(g.x, g.y, SENSOR.radio, t); // alerta en el sensor, no la posición exacta
        motor.pizarras.infiltradores.sensoresVistos.add(g); // el que lo hace saltar sabe que estaba ahí
        g.recargaHasta = t + SENSOR.recarga;
      }
    } else if (g.tipo === 'senuelo' && t - g.ultimoRuido >= RUIDO_INTERVALO_S - 1e-9) {
      g.ultimoRuido = t;
      motor.emitirRuido(g, SENUELO.ruido);
    }
    return true;
  });
}
