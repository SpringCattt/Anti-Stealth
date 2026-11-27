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

const CAMARA_EN_PARED = 0.45; // la cámara se monta en la cara del muro, no en el centro de la casilla

// --- Colocación aprendida (Guardianes): los genes eligen el sitio de cada gadget ---
// Cada posición i (0 .. POSICIONES_GADGET-1) son 3 genes en [0, 1]: gadget{i}_x y gadget{i}_y (un punto del mapa en
// proporción a su ancho y alto) y gadget{i}_giro (hacia dónde mira, si es cámara). El gadget va a la casilla candidata
// libre más cercana a ese punto: así una mutación pequeña lo mueve un poco, no a la otra punta. Los huecos de cámara
// usan las posiciones 0 .. nCamaras-1 y los de sensores las siguientes (SENSOR.porHueco por hueco).
// Nada decide "qué sitio es bueno" a mano: lo que hace ganar se queda (genético). Un sitio al que su Guardián no llega
// en la preparación se pierde, y eso también lo aprende.
const POSICIONES_GADGET = GADGETS_POR_EQUIPO * SENSOR.porHueco;
const CACHE_CANDIDATOS = new WeakMap();

// Candidatos de un mapa (una vez por mapa): casillas libres para sensores; para cámaras, cada casilla libre con un muro
// al lado (4 vecinas) y sus orientaciones posibles: en la cara de ese muro (a CAMARA_EN_PARED del centro) mirando hacia
// fuera, de frente o a ±45°.
function candidatosDelMapa(motor) {
  if (CACHE_CANDIDATOS.has(motor.diseno)) return CACHE_CANDIDATOS.get(motor.diseno);
  const mapa = motor.mapa, sensores = [], camaras = [];
  for (let c = 0; c < mapa.ancho * mapa.alto; c++) {
    const cx = c % mapa.ancho, cy = (c - cx) / mapa.ancho;
    if (!transitable(mapa, cx, cy)) continue;
    sensores.push({ celda: c, x: cx + 0.5, y: cy + 0.5 });
    const opciones = [];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (alturaEn(mapa, cx + dx, cy + dy) < ALTURA.MURO) continue;
      const fuera = Math.atan2(-dy, -dx);
      for (const giro of [-Math.PI / 4, 0, Math.PI / 4]) {
        opciones.push({ celda: c, x: cx + 0.5 + dx * CAMARA_EN_PARED, y: cy + 0.5 + dy * CAMARA_EN_PARED, angulo: fuera + giro, normal: fuera });
      }
    }
    if (opciones.length) camaras.push({ celda: c, x: cx + 0.5, y: cy + 0.5, opciones });
  }
  const candidatos = { sensores, camaras };
  CACHE_CANDIDATOS.set(motor.diseno, candidatos);
  return candidatos;
}

// Plan de gadgets: round(proporcion_camaras · N) cámaras y el resto huecos de sensores. Cada gadget se asigna a un
// Guardián (k % n), que lo lleva durante la preparación (Guardian.pendientes).
function planificarGadgetsGuardianes(motor, genes) {
  const { sensores, camaras } = candidatosDelMapa(motor), guardianes = motor.equipos.guardianes, mapa = motor.mapa;
  const masCercano = (lista, i, usado) => {
    const px = genes[`gadget${i}_x`] * mapa.ancho, py = genes[`gadget${i}_y`] * mapa.alto;
    let mejor = null, dMin = Infinity;
    for (const c of lista) {
      const d = (c.x - px) ** 2 + (c.y - py) ** 2;
      if (d < dMin && !usado.has(c.celda)) { dMin = d; mejor = c; }
    }
    if (mejor) usado.add(mejor.celda);
    return mejor;
  };
  const nCamaras = Math.round(genes.proporcion_camaras * GADGETS_POR_EQUIPO), conCamara = new Set(), conSensor = new Set();
  for (let k = 0; k < GADGETS_POR_EQUIPO; k++) {
    if (k < nCamaras) {
      const c = masCercano(camaras, k, conCamara);
      if (!c) continue;
      const o = c.opciones[Math.min(c.opciones.length - 1, Math.floor(genes[`gadget${k}_giro`] * c.opciones.length))];
      guardianes[k % guardianes.length].pendientes.push({ tipo: 'camara', celda: o.celda, x: o.x, y: o.y, angulo: o.angulo, normal: o.normal });
    } else {
      for (let s = 0; s < SENSOR.porHueco; s++) {
        const c = masCercano(sensores, nCamaras + SENSOR.porHueco * (k - nCamaras) + s, conSensor);
        if (c) guardianes[(k + s) % guardianes.length].pendientes.push({ tipo: 'sensor', celda: c.celda, extra: s > 0 }); // el extra no gasta hueco
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
