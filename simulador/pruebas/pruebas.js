// Pruebas sin DOM de la simulación Anti-Stealth v2.1.
// Ejecutar desde la raíz del repo:  node simulador/pruebas/pruebas.js
// Carga los mismos scripts que index.html (menos render.js y principal.js, que usan el DOM) con pruebas/cargar.js.
'use strict';
const assert = require('assert');
const E = require('./cargar.js');

let fallos = 0;
function prueba(nombre, fn) {
  try {
    fn();
    console.log('OK     ' + nombre);
  } catch (e) {
    fallos++;
    console.log('FALLO  ' + nombre + '\n       ' + (e.stack || e.message).split('\n').slice(0, 3).join('\n       '));
  }
}
const cerca = (a, b, eps = 1e-9) => assert(Math.abs(a - b) < eps, `${a} != ${b}`);
// Prueba con la regla de la hierba para Guardianes activada (por defecto está apagada).
const conHierba = fn => () => {
  require('vm').runInThisContext('HIERBA_PROHIBIDA_GUARDIAN = true');
  try { fn(); } finally { require('vm').runInThisContext('HIERBA_PROHIBIDA_GUARDIAN = false'); }
};

// Diseño sintético con el mismo formato que MAPA_DISENO: cada carácter es un código de casilla.
function diseno(lineas, marcadores) {
  return { ancho: lineas[0].length, alto: lineas.length, celdas: lineas.map(l => [...l]), marcadores };
}
// Motor sin IA (los agentes solo hacen lo que la prueba les manda) sobre un diseño sintético.
function motor(lineas, marcadores, porEquipo = 1) {
  return new E.GameEngine({ diseno: diseno(lineas, marcadores), headless: true, porEquipo, ia: false });
}
function ticks(m, n) { for (let i = 0; i < n; i++) m.paso(); }
const PASILLO = '.'.repeat(30);
// Guardián en x = 29.5 mirando al oeste, Infiltrador en x = 0.5 mirando al este: a 29 casillas nadie ve a nadie.
const pasillo = (porEquipo = 1, extra = {}) => motor([PASILLO], { G: [[29, 0]], S: [[0, 0]], ...extra }, porEquipo);
const celda = (m, x, y) => E.celdaEn(m.mapa, x, y);

// Huella exacta del estado (JSON conserva los float exactos).
function huella(m) {
  return JSON.stringify({
    ticks: m.ticks, fin: m.terminada, gan: m.ganador, fit: m.fitness, ext: m.extraido, stats: m.stats, suelo: m.suelo,
    bot: [...m.botines], inv: m.inventario, gad: m.gadgets.map(g => [g.tipo, g.x, g.y, g.hasta]),
    ag: m.agentes.map(a => [a.x, a.y, a.angulo, a.estado, a.bolsa, a.barra.valor, a.modo, a.accion && a.accion.tipo]),
  });
}

const rnd = E.mulberry32(12345);
const azar = R => Object.fromEntries(Object.entries(R).map(([k, [a, b]]) => [k, a + (b - a) * rnd()]));
const GENOMAS = [[E.GENES_INFILTRADOR_POR_DEFECTO, E.GENES_GUARDIAN_POR_DEFECTO]];
for (let i = 0; i < 4; i++) GENOMAS.push([azar(E.RANGOS_INFILTRADOR), azar(E.RANGOS_GUARDIAN)]);
const ronda = ([gi, gg], opciones) => E.crearSimulacion(gi, gg, opciones);

// ---------- 1. Bucle de tiempo fijo ----------

prueba('Constantes: TICK_MS = 1000/60, DT ≈ 0.0166 s, ronda máxima de 210 s', () => {
  assert.strictEqual(E.TICK_MS, 1000 / 60);
  assert(Math.abs(E.DT - 0.0166) < 0.0001);
  assert.strictEqual(E.TICKS_RONDA, (E.PREPARACION_S + E.TIEMPO_RONDA_S + E.BONO_PRIMERA_EXTRACCION_S) * 60);
});

prueba('simular(N) de una vez = N llamadas de 1 tick = 3 llamadas de N/3 (5 genomas)', () => {
  for (const gen of GENOMAS) {
    const a = E.simular(ronda(gen), 600);
    const b = ronda(gen);
    for (let i = 0; i < 600; i++) E.simular(b, 1);
    const c = ronda(gen);
    for (let i = 0; i < 3; i++) E.simular(c, 200);
    assert.strictEqual(huella(b), huella(a));
    assert.strictEqual(huella(c), huella(a));
  }
});

prueba('avanzar(ms) troceado de forma irregular = simular(los mismos ticks)', () => {
  for (const gen of GENOMAS.slice(0, 2)) {
    const r = E.mulberry32(777), m = ronda(gen);
    let total = 0;
    while (total < 10000) { const ms = r() * 60; E.avanzar(m, ms); total += ms; }
    assert(Math.abs(m.ticks - total / E.TICK_MS) <= 1, `${m.ticks} ticks para ${total} ms`);
    assert.strictEqual(huella(m), huella(E.simular(ronda(gen), m.ticks)));
  }
});

prueba(`El acumulador se limita a ${E.MAX_ACUMULADO_MS} ms (sin espiral de la muerte)`, () => {
  const m = ronda(GENOMAS[0]);
  E.avanzar(m, 5000);
  assert(m.ticks <= Math.ceil(E.MAX_ACUMULADO_MS / E.TICK_MS) && m.acumulador < E.TICK_MS);
});

prueba('Ronda terminada: más ticks no cambian nada', () => {
  const m = E.simular(ronda(GENOMAS[0]), E.TICKS_RONDA);
  assert(m.terminada);
  const antes = huella(m);
  E.simular(m, 100);
  E.avanzar(m, 200);
  assert.strictEqual(huella(m), antes);
});

// ---------- 2. A* dinámico ----------

const PASILLOS = E.mapaAlturas(diseno(['###########', '#.........#', '#.#######.#', '#.........#', '###########'], {}));
const UNICO = E.mapaAlturas(diseno(['#########', '#.......#', '#########'], {}));
const ABIERTO = E.mapaAlturas(diseno(Array(10).fill('..........'), {}));
const i = (mapa, cx, cy) => cx + cy * mapa.ancho;

function validarRuta(mapa, inicio, meta, ruta) {
  let prev = inicio, coste = 0;
  for (const c of ruta) {
    const x0 = prev % mapa.ancho, y0 = Math.floor(prev / mapa.ancho), x = c % mapa.ancho, y = Math.floor(c / mapa.ancho);
    const dx = x - x0, dy = y - y0;
    assert(Math.abs(dx) <= 1 && Math.abs(dy) <= 1 && (dx || dy), `salto no adyacente ${prev}->${c}`);
    assert(E.transitable(mapa, x, y), `casilla no transitable ${x},${y}`);
    if (dx && dy) assert(E.transitable(mapa, x0 + dx, y0) && E.transitable(mapa, x0, y0 + dy), 'corta una esquina');
    coste += Math.hypot(dx, dy);
    prev = c;
  }
  assert.strictEqual(prev, meta, 'la ruta no acaba en la meta');
  return coste;
}

prueba('A*: en el mapa real hay ruta de S a cada botín y de cada botín a la extracción (cajas y muros bloquean)', () => {
  const m = ronda(GENOMAS[0]), { S, B, E: ext = S } = E.MAPA_DISENO.marcadores, c = ([x, y]) => i(m.mapa, x, y);
  for (const b of B) {
    for (const [ini, fin] of [[c(S[0]), c(b)], [c(b), c(ext[0])]]) validarRuta(m.mapa, ini, fin, E.buscarRuta(m.mapa, ini, fin));
  }
  E.MAPA_DISENO.celdas.forEach((fila, z) => fila.forEach((ch, x) => assert.strictEqual(E.transitable(m.mapa, x, z), ch !== '#' && ch !== 'c')));
});

prueba('A*: sin ruta tras un muro; no corta esquinas; coste óptimo en campo abierto (3·√2 + 4)', () => {
  const muro = E.mapaAlturas(diseno(['...#...', '...#...', '...#...'], {}));
  assert.strictEqual(E.buscarRuta(muro, i(muro, 0, 1), i(muro, 6, 1)), null);
  const esquina = E.mapaAlturas(diseno(['.#', '#.'], {}));
  assert.strictEqual(E.buscarRuta(esquina, 0, 3), null);
  const ini = i(ABIERTO, 0, 0), meta = i(ABIERTO, 7, 3);
  cerca(validarRuta(ABIERTO, ini, meta, E.buscarRuta(ABIERTO, ini, meta)), 3 * Math.SQRT2 + 4);
});

prueba('A*: el coste extra decide entre cruzar la luz o rodear; Infinity es un muro', () => {
  const m = PASILLOS, ini = i(m, 1, 1), meta = i(m, 9, 1), luz = new Float32Array(m.ancho * m.alto), c = i(m, 5, 1);
  luz[c] = 0.2;
  const corta = E.buscarRuta(m, ini, meta, luz);       // cruzar: 8.2 < rodeo: 12
  luz[c] = 20;
  const larga = E.buscarRuta(m, ini, meta, luz);       // cruzar: 28 > rodeo: 12
  luz[c] = Infinity;
  const muro = E.buscarRuta(m, ini, meta, luz);
  assert(corta.includes(c) && corta.length === 8);
  assert(!larga.includes(c) && larga.length === 12);
  assert.deepStrictEqual(muro, larga);
  const u = new Float32Array(UNICO.ancho * UNICO.alto);
  u[i(UNICO, 4, 1)] = Infinity;
  assert.strictEqual(E.buscarRuta(UNICO, i(UNICO, 1, 1), i(UNICO, 7, 1), u), null);
  u[i(UNICO, 4, 1)] = 20;
  assert.strictEqual(E.buscarRuta(UNICO, i(UNICO, 1, 1), i(UNICO, 7, 1), u).length, 6);
});

prueba('A*: el Infiltrador encarece la luz actual (w_light), la huella reciente (w_huella) y el peligro (w_peligro)', () => {
  const m = pasillo();
  m.genesInfiltrador = { ...m.genesInfiltrador, w_light: 7, w_huella: 3, w_peligro: 11 };
  const g = m.equipos.guardianes[0], c = celda(m, 25.5, 0.5); // dentro de su luz (a 4 casillas, delante)
  m.equipos.infiltradores[0].x = 15.5; // a 10 casillas de esa luz, mirándola: la ve
  let coste = m.costeInfiltradores();
  assert.strictEqual(coste[c], 7, 'luz');
  g.angulo = g.anguloDeseado = 0; // ahora mira a la pared: la casilla queda con huella
  ticks(m, E.LUZ_REFRESCO_TICKS); // la luz se recalcula cada LUZ_REFRESCO_TICKS
  coste = m.costeInfiltradores();
  assert.strictEqual(coste[c], 3, 'huella');
  ticks(m, Math.ceil(4.1 / E.DT));
  assert.strictEqual(m.costeInfiltradores()[c], 0, 'la huella caduca');
  m.pizarras.infiltradores.publicarRuido(25.5, 0.5, 4, m.t);
  ticks(m, 1);
  assert.strictEqual(m.costeInfiltradores()[c], 11, 'peligro');
});

prueba('A*: con la regla de la hierba, le cuesta al Guardián y no al Infiltrador', conHierba(() => {
  const m = motor(['..g..', '.....'], { G: [[0, 0]], S: [[4, 1]] });
  const ruta = E.buscarRuta(m.mapa, celda(m, 0.5, 0.5), celda(m, 4.5, 0.5), m.costeGuardianes);
  assert(!ruta.includes(celda(m, 2.5, 0.5)), 'el Guardián cruza la hierba');
  assert(E.buscarRuta(m.mapa, celda(m, 0.5, 0.5), celda(m, 4.5, 0.5)).includes(celda(m, 2.5, 0.5)));
}));

// ---------- 3. Percepción ----------

prueba('rotateTowards: camino corto por 0° y tope de velocidad; PENALIZED solo recorta ALERT', () => {
  cerca(E.rotateTowards(350 * E.GRADOS, 10 * E.GRADOS, 1000, 1), 10 * E.GRADOS);
  cerca(E.rotateTowards(350 * E.GRADOS, 10 * E.GRADOS, E.VEL_GIRO.PATROL, E.DT), (350 + 75 / 60) * E.GRADOS);
  const a = pasillo().agentes[0];
  a.modo = 'correr'; a.dirX = 1;
  assert.strictEqual(a.modoGiro, 'PATROL');
  a.alerta = 1;
  assert.strictEqual(a.modoGiro, 'PENALIZED');
  a.modo = 'caminar';
  assert.strictEqual(a.modoGiro, 'ALERT');
});

prueba('Doble capa: de pie ve por encima de la caja; agachado (observador u objetivo) no; muro y humo tapan todo', () => {
  const visto = (medio, modoObs, modoObj, humo = false) => {
    const m = motor(['..' + medio + '..'], { G: [[0, 0]], S: [[4, 0]] }), [g, inf] = m.agentes;
    g.modo = modoObs; inf.modo = modoObj;
    if (humo) { E.lanzarGadget(m, inf, 'humo', 2.5, 0.5); ticks(m, E.HUMO.mecha * 60); }
    return E.intensidadVision(m.mapa, g, inf) > 0;
  };
  assert(visto('c', 'caminar', 'caminar'), 'de pie -> de pie: rayo alto ignora la caja');
  assert(!visto('c', 'caminar', 'sigilo'), 'de pie -> agachado: rayo bajo choca con la caja');
  assert(!visto('c', 'sigilo', 'caminar'), 'agachado -> cualquiera: rayo bajo');
  assert(!visto('#', 'caminar', 'caminar'), 'el muro tapa las dos capas');
  assert(visto('.', 'caminar', 'caminar') && !visto('.', 'caminar', 'caminar', true), 'el humo tapa como un muro');
});

prueba('Retardo de reacción: un ruido fuera de la vista no gira al agente hasta pasados 0.25 s', () => {
  const m = pasillo(), g = m.agentes[0], a0 = g.angulo;
  g.recibirEstimulo(g.x, g.y + 5, 'ruido');
  ticks(m, 14);
  cerca(g.angulo, a0);
  ticks(m, 2);
  assert(g.angulo !== a0, 'debería empezar a girar');
});

prueba('Pizarra: el contacto queda como LKP 5 s; lo sabe todo el equipo y gira solo quien lo tiene a <= radio_giro', () => {
  const m = pasillo(2), p = m.pizarras.guardianes, [g1, g2] = m.equipos.guardianes;
  g1.genes = { ...g1.genes, radio_giro: 40 }; g2.genes = { ...g2.genes, radio_giro: 0 };
  p.publicarContacto(99, 1, 0.5, 0);
  assert(p.contactos.has(99), 'en la pizarra al instante');
  assert(g1.estimulos.length === 1 && g1.estimulos[0].espera === 0.25, 'gira con retardo de reacción');
  assert.strictEqual(g2.estimulos.length, 0, 'radio_giro 0: no gira');
  p.limpiar(4.9); assert(p.contactos.has(99));
  p.limpiar(5.1); assert(!p.contactos.has(99));
});

// ---------- 4. Combate ----------

prueba('Aturdidor: a 4 casillas y a la vista derriba en 1.5 s; los Guardianes ganan cuando todos están eliminados', () => {
  const m = motor(['.....'], { G: [[0, 0]], S: [[4, 0]] }), inf = m.agentes[1];
  ticks(m, 85);
  assert.strictEqual(inf.estado, 'activo');
  ticks(m, 10);
  assert.strictEqual(inf.estado, 'inconsciente');
  assert(!m.terminada && m.stats.guardianes.derribos === 1, 'inconsciente no es eliminado: la ronda sigue');
  inf.derribos = E.MAX_DERRIBOS - 1;
  inf.estado = 'activo';
  m.derribarAgente(inf, 'guardianes');
  ticks(m, 1);
  assert(inf.estado === 'eliminado' && m.terminada && m.ganador === 'guardianes');
});

prueba('Neutralización: 1 casilla por detrás del Guardián y sin ser visto, 1.0 s; decay del 50 %/s', () => {
  const m = motor(['.....'], { G: [[0, 0]], S: [[4, 0]] }), [g, inf] = m.agentes;
  g.x = 2.5; inf.x = 1.5; g.angulo = g.anguloDeseado = 0; inf.angulo = inf.anguloDeseado = 0;
  ticks(m, 30);
  cerca(g.barra.valor, 50, 1e-6);
  inf.x = 0.5; // a 2 casillas: fuera de rango
  ticks(m, 60);
  cerca(g.barra.valor, 0, 1e-6);
  inf.x = 1.5;
  ticks(m, 55);
  assert.strictEqual(g.estado, 'activo');
  ticks(m, 10);
  assert.strictEqual(g.estado, 'inconsciente');
  assert.strictEqual(m.stats.infiltradores.derribos, 1);
});

prueba('Reanimación: 5 s junto al caído con ruido; después 3 s sin poder coger botín; eliminado al MAX_DERRIBOS', () => {
  const m = pasillo(2, { B: [[5, 0]] }), [a, b] = m.equipos.infiltradores, oidos = [];
  m.pizarras.guardianes.publicarRuido = (...r) => oidos.push(r);
  m.equipos.guardianes.forEach(g => { g.x = 6.5; g.angulo = g.anguloDeseado = 0; }); // a 2 casillas, de espaldas: oyen el ruido
  a.x = 5.5; b.x = 4.5;
  m.derribarAgente(a, 'guardianes');
  assert.strictEqual(m.pizarras.infiltradores.caidos.length, 1);
  m.iniciarAccion(b, 'reanimar', a);
  ticks(m, 299);
  assert.strictEqual(a.estado, 'inconsciente');
  ticks(m, 2);
  assert(a.activo && m.stats.infiltradores.reanimaciones === 1 && oidos.length >= 9, `ruidos ${oidos.length}`);
  m.iniciarAccion(a, 'saquear', celda(m, 5.5, 0.5));
  ticks(m, 1);
  assert.strictEqual(a.accion, null, 'con cooldown no puede saquear');
  ticks(m, 180);
  m.iniciarAccion(a, 'saquear', celda(m, 5.5, 0.5));
  ticks(m, 121);
  assert.strictEqual(a.bolsa, E.BOLSA_CAPACIDAD);
  assert.strictEqual(m.botines.get(celda(m, 5.5, 0.5)), E.VALOR_BOTIN - E.BOLSA_CAPACIDAD);
  while (a.derribos < E.MAX_DERRIBOS - 1) { m.derribarAgente(a, 'guardianes'); a.reanimar(); }
  m.derribarAgente(a, 'guardianes');
  assert.strictEqual(a.estado, 'eliminado');
});

prueba('En un mismo sitio o se reanima o se saquea: gana la acción que empezó antes', () => {
  const escena = () => {
    const m = motor(['.....#....'], { G: [[9, 0]], S: [[0, 0]], B: [[1, 0]] }, 3); // Guardianes tras el muro
    const [caido, medico, ladron] = m.equipos.infiltradores;
    for (const i of [caido, medico, ladron]) { i.x = 1.5; i.y = 0.5; }
    m.derribarAgente(caido, 'guardianes');
    return { m, caido, medico, ladron, b: celda(m, 1.5, 0.5) };
  };
  let { m, caido, medico, ladron, b } = escena();
  m.iniciarAccion(medico, 'reanimar', caido);
  ticks(m, 1);
  m.iniciarAccion(ladron, 'saquear', b);
  ticks(m, 1);
  assert(medico.accion && !ladron.accion, 'mientras se reanima no se saquea');
  ({ m, caido, medico, ladron, b } = escena());
  m.iniciarAccion(ladron, 'saquear', b);
  ticks(m, 1);
  m.iniciarAccion(medico, 'reanimar', caido);
  ticks(m, 1);
  assert(ladron.accion && !medico.accion, 'mientras se saquea no se reanima');
});

prueba('irA: dentro de la casilla meta pero lejos del centro, va al centro (no se queda clavado)', () => {
  const m = pasillo(), [, inf] = m.agentes, meta = celda(m, 10.5, 0.5);
  inf.x = 10.05; inf.y = 0.5;
  assert.strictEqual(inf.irA(m, meta), false, 'aún no ha llegado');
  assert(inf.moviendose && inf.dirX > 0, 'se mueve hacia el centro');
  for (let k = 0; k < 30 && !inf.irA(m, meta); k++) m.paso(); // sin IA: la prueba hace de cerebro
  assert(inf.irA(m, meta) && Math.abs(inf.x - 10.5) < 0.15, `x = ${inf.x}`);
});

prueba('Huida: el Infiltrador descubierto deja de saquear y corre a la cubierta más cercana', () => {
  // Fila 0 a la vista del Guardián; (0,1) es un hueco tras el muro.
  const m = motor(['..........', '.#########'], { G: [[9, 0]], S: [[3, 0]], B: [[3, 0]] });
  m.ia = true;
  const [g, inf] = m.agentes;
  g.decidir = () => {}; // el Guardián solo mira
  g.angulo = g.anguloDeseado = Math.PI;
  inf.genes = { ...inf.genes, umbral_huida: 0, humo_huida: 0 }; // huye en cuanto lo ven, sin humo
  m.iniciarAccion(inf, 'saquear', celda(m, 3.5, 0.5));
  ticks(m, 1);
  assert(inf.quienMeVe(m).length && !inf.accion, 'suelta el saqueo al verse descubierto');
  ticks(m, 120);
  assert.strictEqual(celda(m, inf.x, inf.y), celda(m, 0.5, 1.5), `acaba en (${inf.x.toFixed(1)}, ${inf.y.toFixed(1)})`);
  assert.strictEqual(inf.quienMeVe(m).length, 0);
});

prueba('Conductas: prudencia fija el modo base; oír a un Guardián lo agacha; acecha quieto y luego sigue', () => {
  const escena = genes => {
    const m = motor(['.'.repeat(30)], { G: [[29, 0]], S: [[0, 0]], B: [[20, 0]] });
    m.ia = true;
    const [g, inf] = m.agentes;
    g.decidir = () => {}; g.angulo = g.anguloDeseado = 0; // de espaldas, no lo ve
    inf.genes = { ...inf.genes, umbral_sigilo: 0, umbral_correr: 0, humo_saqueo: 0, senuelo_distraccion: 0, ...genes };
    return { m, g, inf };
  };
  for (const [prudencia, modo] of [[0.1, 'correr'], [0.5, 'caminar'], [0.9, 'sigilo']]) {
    const { m, inf } = escena({ prudencia, paciencia_s: 0 });
    ticks(m, 2);
    assert.strictEqual(inf.modo, modo, 'prudencia ' + prudencia);
  }
  // Oído: un ruido de Guardián a <= radio_cautela lo agacha durante alerta_oido_s.
  let { m, inf } = escena({ prudencia: 0.1, radio_cautela: 8, alerta_oido_s: 1, paciencia_s: 0 });
  ticks(m, 1);
  inf.pizarra.publicarRuido(inf.x + 5, 0.5, 4, m.t);
  ticks(m, 2);
  assert.strictEqual(inf.modo, 'sigilo', 'agachado tras oírlo');
  ticks(m, 90);
  assert.strictEqual(inf.modo, 'correr', 'pasada la alerta vuelve a su modo base');
  // Acecho: amenaza a <= radio_cautela -> quieto; agotada la paciencia, sigue.
  let g;
  ({ m, g, inf } = escena({ prudencia: 0.5, radio_cautela: 8, alerta_oido_s: 0, paciencia_s: 1, agresividad: 0 }));
  inf.pizarra.contactos.set(g.id, { x: inf.x + 4, y: 0.5, t: 0 }); // LKP de un Guardián a 4 casillas
  const x0 = inf.x;
  ticks(m, 30);
  assert(Math.abs(inf.x - x0) < 0.05 && inf.acechando, 'acecha quieto');
  ticks(m, 60);
  assert(inf.x - x0 > 0.3, 'agotada la paciencia, avanza');
});

prueba('Guardián: anticipa (va por delante del contacto), busca escondites tras perderlo y corta la salida', () => {
  // Anticipación: contacto a (10, 0.5) moviéndose hacia +x a 3 c/s, visto hace 1 s.
  let m = pasillo(); m.ia = true;
  let [g] = m.agentes;
  g.genes = { ...g.genes, anticipacion: 1 };
  const pred = g.prediccion(m, { x: 10, y: 0.5, t: m.t - 1, vx: 3, vy: 0 });
  assert(pred.x > 13, 'se adelanta: ' + pred.x.toFixed(1));
  // Búsqueda: tras revisar una alerta junto a unas cajas, registra lo que queda detrás de ellas.
  m = motor(['..........', '....c.....', '..........'], { G: [[0, 1]], S: [[9, 2]] }); m.ia = true;
  [g] = m.agentes;
  g.genes = { ...g.genes, busqueda_s: 5 };
  g.empezarBusqueda(m, 2.5, 1.5);
  assert(g.busqueda && g.busqueda.puntos.includes(celda(m, 5.5, 1.5)), 'el escondite tras la caja está en la búsqueda');
  ticks(m, 1);
  assert(g.busqueda, 'sigue buscando');
  g.pizarra.contactos.set(99, { x: 9.5, y: 2.5, t: m.t + 1e-6, vx: 0, vy: 0 }); // algo nuevo en la pizarra
  ticks(m, 1);
  assert.strictEqual(g.busqueda, null, 'un contacto nuevo corta la búsqueda');
  // Corte: con un contacto dentro de la casa, el Guardián libre va a una puerta (casilla interior junto al jardín).
  m = E.crearSimulacion(E.GENES_INFILTRADOR_POR_DEFECTO, { ...E.GENES_GUARDIAN_POR_DEFECTO, cortar: 1 }, { semilla: 1 });
  ticks(m, E.PREPARACION_S * 60 + 1);
  g = m.equipos.guardianes[0];
  const [bx, by] = E.centroCelda(m.mapa, m.puntosB[0]);
  g.pizarra.contactos.set(99, { x: bx, y: by, t: m.t, vx: 0, vy: 0 });
  assert(g.cortar(m) && g.cortando !== null, 'corta');
  const cx = g.cortando % m.mapa.ancho, cy = (g.cortando - cx) / m.mapa.ancho;
  assert([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => m.mapa.hierba[cx + dx + (cy + dy) * m.mapa.ancho]), 'la casilla de corte da al jardín');
  // Como mucho CORTE_MAX_S en la puerta y luego enfriamiento.
  const [px, py] = E.centroCelda(m.mapa, g.cortando);
  g.x = px; g.y = py; g.ruta = null; g.meta = -1; // ya está en la puerta
  let k = 0;
  while (g.cortar(m) && k < 60 * (E.CORTE_MAX_S + 2)) { g.pizarra.contactos.get(99).t = m.t; m.t += E.DT; k++; }
  assert(k <= 60 * E.CORTE_MAX_S + 2, 'deja la puerta tras CORTE_MAX_S: ' + (k / 60).toFixed(1) + ' s');
  assert(!g.cortar(m), 'en enfriamiento no vuelve a cortar');
});

prueba('Infiltrador: recuerda por dónde pasan los Guardianes (memoria de patrullas) y lo evita en el A*', () => {
  const m = pasillo(), p = m.pizarras.infiltradores, c = celda(m, 15.5, 0.5);
  m.genesInfiltrador = { ...m.genesInfiltrador, w_memoria: 10, w_light: 0, w_huella: 0, w_peligro: 0 };
  ticks(m, 1);
  const antes = m.costeInfiltradores()[c];
  p.publicarContacto(0, 15.5, 0.5, m.t, c);
  ticks(m, 1);
  assert(m.costeInfiltradores()[c] > antes + 5, 'la casilla donde se vio un Guardián cuesta más');
  ticks(m, Math.round((E.MEMORIA_PATRULLA_S + 1) * 60));
  assert.strictEqual(m.costeInfiltradores()[c], antes, 'y se olvida con el tiempo');
});

// Genes con la salida o de la red forzada a ganar (sesgo alto en esa neurona de salida).
const forzarSalida = (genes, nEntradas, o) => {
  const k = (nEntradas + 1) * E.OCULTAS_RED + o * (E.OCULTAS_RED + 1);
  return { ...genes, ['p' + k]: 3 };
};

prueba('Red: observar da ENTRADAS_* valores en [0, 1]; con pesos a 0 elige la rutina; un sesgo alto fuerza su acción', () => {
  const m = E.crearSimulacion(E.GENES_INFILTRADOR_POR_DEFECTO, E.GENES_GUARDIAN_POR_DEFECTO, { semilla: 1 });
  ticks(m, E.PREPARACION_S * 60 + 30);
  const [g] = m.equipos.guardianes, [i] = m.equipos.infiltradores;
  for (const [a, n] of [[i, E.ENTRADAS_INF], [g, E.ENTRADAS_GUA]]) {
    const o = a.observar(m);
    assert.strictEqual(o.length, n);
    assert(o.every(v => Number.isFinite(v) && v >= 0 && v <= 1), JSON.stringify(o));
  }
  assert.strictEqual(i.accionRed, 0, 'pesos a 0: rutina');
  assert.strictEqual(g.accionRed, 0, 'pesos a 0: rutina');
  const s = E.evaluarRed(forzarSalida(E.GENES_GUARDIAN_POR_DEFECTO, E.ENTRADAS_GUA, 1), g.observar(m), E.ACCIONES_GUA.length + E.MODOS_RED.length);
  assert.strictEqual(E.elegir(s, 0, E.ACCIONES_GUA.length), 1, 'el sesgo alto elige la acción 1');
});

prueba('Red: el Guardián que elige custodiar va al botín amenazado y se queda; el Infiltrador que elige esperar no se mueve', () => {
  const salidaCustodiar = E.ACCIONES_GUA.indexOf('custodiar'), salidaEsperar = E.ACCIONES_INF.indexOf('esperar');
  const gg = forzarSalida(E.GENES_GUARDIAN_POR_DEFECTO, E.ENTRADAS_GUA, salidaCustodiar);
  const gi = forzarSalida(E.GENES_INFILTRADOR_POR_DEFECTO, E.ENTRADAS_INF, salidaEsperar);
  const m = E.crearSimulacion(gi, gg, { semilla: 1 });
  ticks(m, E.PREPARACION_S * 60 + 1);
  const [i] = m.equipos.infiltradores, x0 = i.x, y0 = i.y;
  ticks(m, 60 * 25);
  assert(Math.hypot(i.x - x0, i.y - y0) < 0.5, 'el Infiltrador que espera sigue en su sitio');
  const enBotin = m.equipos.guardianes.filter(g => g.activo && m.puntosB.some(b => { const [bx, by] = E.centroCelda(m.mapa, b); return Math.hypot(g.x - bx, g.y - by) <= E.FLANCO_ALERTA + 1; }));
  assert(enBotin.length >= 1, 'algún Guardián custodia un botín');
});

prueba('Red: emboscarSalida reparte a los Guardianes en esquinas de extracción distintas y van hacia ellas', () => {
  const gg = forzarSalida(E.GENES_GUARDIAN_POR_DEFECTO, E.ENTRADAS_GUA, E.ACCIONES_GUA.indexOf('emboscarSalida'));
  const gi = forzarSalida(E.GENES_INFILTRADOR_POR_DEFECTO, E.ENTRADAS_INF, E.ACCIONES_INF.indexOf('esperar'));
  const m = E.crearSimulacion(gi, gg, { semilla: 1 });
  ticks(m, E.PREPARACION_S * 60 + 60 * 3); // antes de cruzarse con los Infiltradores, que salen de esas esquinas
  const activos = m.equipos.guardianes, esquinas = activos.map(g => g.emboscando);
  assert(esquinas.every(Boolean) && new Set(esquinas).size === esquinas.length, 'cada uno en su esquina');
  for (const g of activos) assert.strictEqual(g.meta, g.emboscando.celda, `G${g.id} va a su esquina`);
});

prueba('Red: perseguirCargado va a donde se vio a alguien con botín (y sin nadie cargado hace la rutina)', () => {
  const m = pasillo();
  m.ia = true;
  const g = m.equipos.guardianes[0];
  g.genes = forzarSalida(E.GENES_GUARDIAN_POR_DEFECTO, E.ENTRADAS_GUA, E.ACCIONES_GUA.indexOf('perseguirCargado'));
  g.pizarra.contactos.set(99, { x: 15.5, y: 0.5, t: 0, botin: false });
  ticks(m, 1);
  assert.notStrictEqual(g.observar(m)[17], 1, 'sin botín visto la entrada está a 0');
  g.pizarra.publicarContacto(98, 10.5, 0.5, m.t, -1, true);
  assert.strictEqual(g.observar(m)[17], 1, 'entrada "visto con botín"');
  ticks(m, 1);
  assert.strictEqual(g.meta, celda(m, 10.5, 0.5), 'va a por el cargado, no a la otra alerta');
  assert.strictEqual(g.modo, 'correr');
});

prueba('Rutina: con vigias = 1 cada Guardián se queda en un punto B distinto en vez de patrullar', () => {
  const gi = forzarSalida(E.GENES_INFILTRADOR_POR_DEFECTO, E.ENTRADAS_INF, E.ACCIONES_INF.indexOf('esperar'));
  const m = E.crearSimulacion(gi, { ...E.GENES_GUARDIAN_POR_DEFECTO, vigias: 1 }, { semilla: 1 });
  ticks(m, E.PREPARACION_S * 60 + 60 * 40);
  const puntos = m.equipos.guardianes.map(g => m.puntosB.find(b => { const [bx, by] = E.centroCelda(m.mapa, b); return Math.hypot(g.x - bx, g.y - by) < 1; }));
  assert(puntos.every(p => p !== undefined) && new Set(puntos).size === puntos.length, JSON.stringify(puntos));
});

prueba('Rutina: si alguien fue visto con botín, solo el Guardián libre más cercano corta su salida', () => {
  const gi = forzarSalida(E.GENES_INFILTRADOR_POR_DEFECTO, E.ENTRADAS_INF, E.ACCIONES_INF.indexOf('esperar'));
  const m = E.crearSimulacion(gi, { ...E.GENES_GUARDIAN_POR_DEFECTO, cortar: 0 }, { semilla: 1 });
  ticks(m, E.PREPARACION_S * 60 + 1);
  const [bx, by] = E.centroCelda(m.mapa, m.puntosB[0]);
  m.pizarras.guardianes.publicarContacto(99, bx, by, m.t, -1, true);
  ticks(m, 2); // deciden uno tras otro: en el primer tick el lejano aún no sabe que el cercano va a cortar
  assert.strictEqual(m.equipos.guardianes.filter(g => g.cortando != null).length, 1);
});

prueba('Aguante: correr lo gasta en AGUANTE.max/gasto s; agotado camina hasta recuperar el mínimo; quieto recupera', () => {
  const m = pasillo(), [, inf] = m.agentes;
  inf.dirX = 1; inf.modo = 'correr';
  ticks(m, Math.round(E.AGUANTE.max / E.AGUANTE.gasto * 60) - 5);
  assert(!inf.agotado && inf.modo === 'correr', 'aún corre');
  inf.x = 2.5; ticks(m, 10);
  assert(inf.agotado && inf.modo === 'caminar' && inf.aguante <= 1, 'agotado: camina');
  inf.modo = 'correr'; inf.x = 2.5; ticks(m, 1);
  assert.strictEqual(inf.modo, 'caminar', 'agotado no puede volver a correr');
  inf.dirX = 0; inf.x = 2.5;
  ticks(m, Math.ceil(E.AGUANTE.minimoParaCorrer / E.AGUANTE.recuperaQuieto * 60) + 2);
  assert(!inf.agotado, 'quieto recupera lo bastante para volver a correr');
});

prueba('PEM: solo contra lo que estorba (cámara que lo mira o tapa su paso, sensor conocido en su ruta), nunca a través de una pared', () => {
  // Cámara al otro lado de un muro, a 3 casillas: no la ve, no le estorba.
  let m = motor(['......', '######', '......'], { G: [[5, 2]], S: [[0, 0]] });
  let inf = m.agentes[1];
  inf.x = 2.5; inf.y = 0.5;
  const cam = { tipo: 'camara', equipo: 'guardianes', x: 2.5, y: 2.5, angulo: Math.PI / 2, anguloBase: Math.PI / 2, desde: 0, altura: E.ALTURA.DE_PIE, vision: E.VISION.camara, hasta: Infinity, desactivadoHasta: -Infinity };
  assert(!inf.gadgetMolesto(m, cam), 'detrás de una pared no estorba');
  // Misma cámara en su sala, mirándolo: sí.
  m = pasillo(); inf = m.agentes[1];
  inf.x = 10.5;
  const cam2 = { ...cam, x: 13.5, y: 0.5, angulo: Math.PI, anguloBase: Math.PI };
  assert(!inf.gadgetMolesto(m, cam2), 'a la vista pero sin mirarlo aún ni cubrir su camino: no estorba');
  cam2.exposicion = new Map([[inf, 0.2]]);
  assert(inf.gadgetMolesto(m, cam2), 'lo está mirando (cuenta exposición): estorba');
  // Sensor: solo si lo conoce y está en su ruta.
  const sen = { tipo: 'sensor', equipo: 'guardianes', x: 12.5, y: 0.5, hasta: Infinity, desactivadoHasta: -Infinity };
  inf.ruta = [celda(m, 11.5, 0.5), celda(m, 12.5, 0.5)];
  assert(!inf.gadgetMolesto(m, sen), 'sensor que no conoce: no');
  inf.pizarra.sensoresVistos.add(sen);
  assert(inf.gadgetMolesto(m, sen), 'sensor conocido en su ruta: estorba');
});

prueba('Reanimar se cancela si el que reanima se aleja', () => {
  const m = pasillo(2), [a, b] = m.equipos.infiltradores;
  b.x = 1.5;
  m.derribarAgente(a, 'guardianes');
  m.iniciarAccion(b, 'reanimar', a);
  ticks(m, 60);
  b.x = 4.5;
  ticks(m, 1);
  assert.strictEqual(b.accion, null);
  assert.strictEqual(a.estado, 'inconsciente');
});

prueba('El aturdimiento se pasa: sin reanimación se levanta a los DESPERTAR_S, con el cooldown de botín', () => {
  const m = pasillo(2), [a] = m.equipos.infiltradores;
  m.derribarAgente(a, 'guardianes');
  ticks(m, E.DESPERTAR_S * 60 - 2);
  assert.strictEqual(a.estado, 'inconsciente');
  ticks(m, 3);
  assert(a.activo && a.cooldownBotin > 0);
});

// ---------- 5. Economía ----------

prueba('Bolsa: velocidad lineal hasta BOLSA_VEL_MIN; al caer 50 % al suelo y 50 % en el cuerpo', () => {
  const m = pasillo(2), [a, b] = m.equipos.infiltradores, llena = E.BOLSA_CAPACIDAD, media = llena / 2;
  a.bolsa = media;
  cerca(a.velocidad, 3.5 * (1 + E.BOLSA_VEL_MIN) / 2);
  a.bolsa = llena;
  cerca(a.velocidad, 3.5 * E.BOLSA_VEL_MIN);
  a.x = 3.5; b.x = 2.5;
  m.derribarAgente(a, 'guardianes');
  assert.strictEqual(a.bolsa, media);
  assert.deepStrictEqual(m.suelo, [{ x: 3.5, y: 0.5, valor: media }]);
  m.iniciarAccion(b, 'recoger', m.suelo[0]);
  ticks(m, Math.round(E.RECOGER_SUELO_S / E.DT) - 2);
  assert.strictEqual(b.bolsa, 0);
  ticks(m, 3);
  assert.strictEqual(b.bolsa, media);
  assert.strictEqual(m.suelo.length, 0);
});

prueba('Guardián: confisca el cuerpo en 3 s y lo devuelve a un punto B en 6 s', () => {
  const m = pasillo(2, { B: [[12, 0]] }), [a, b] = m.equipos.infiltradores, [g] = m.equipos.guardianes;
  m.equipos.guardianes[1].x = 29.5;
  a.x = 10.5; a.bolsa = 60;
  m.derribarAgente(a, 'guardianes');
  g.x = 11.5; g.angulo = g.anguloDeseado = 0; // de espaldas al otro Infiltrador (en x = 0.5)
  m.iniciarAccion(g, 'confiscar', a);
  ticks(m, 179);
  assert.strictEqual(g.bolsa, 0);
  ticks(m, 2);
  assert(g.bolsa === 30 && a.bolsa === 0 && m.stats.guardianes.confiscado === 30);
  g.x = 12.5;
  m.iniciarAccion(g, 'devolver', celda(m, 12.5, 0.5));
  ticks(m, 361);
  assert(g.bolsa === 0 && m.botines.get(celda(m, 12.5, 0.5)) === 130 && m.stats.guardianes.devuelto === 30);
});

prueba('Hierba (regla activada): > 2 s revela al Guardián (y cuesta fitness); > 5 s lo derriba', conHierba(() => {
  const m = motor(['g'.repeat(10) + '.'.repeat(20)], { G: [[2, 0]], S: [[29, 0]] }), [g] = m.agentes;
  g.angulo = g.anguloDeseado = Math.PI; // mira al oeste, lejos del Infiltrador
  ticks(m, 115);
  assert(!g.revelado && !m.pizarras.infiltradores.contactos.has(g.id));
  ticks(m, 10);
  assert(g.revelado && m.pizarras.infiltradores.contactos.has(g.id) && m.stats.guardianes.revelaciones === 1);
  ticks(m, 170);
  assert.strictEqual(g.estado, 'activo');
  ticks(m, 10);
  assert.strictEqual(g.estado, 'inconsciente');
  assert(m.stats.guardianes.segundosHierba > 2.9 && m.stats.infiltradores.derribos === 0);
}));

prueba('Victoria: lo extraído por el equipo suma hasta BOTIN_PARA_GANAR; la primera extracción suma 30 s al reloj', () => {
  const m = pasillo(2), [a, b] = m.equipos.infiltradores, mitad = E.BOTIN_PARA_GANAR / 2;
  a.bolsa = mitad;
  ticks(m, 1);
  assert(!m.terminada && m.extraido === mitad && a.bolsa === 0);
  cerca(m.tiempoRestante, 210 - E.DT, 1e-6);
  b.bolsa = mitad;
  ticks(m, 1);
  assert(m.terminada && m.ganador === 'infiltradores' && m.fitness.infiltrador > m.fitness.guardian);
  cerca(m.tiempoRestante, 210 - 2 * E.DT, 1e-6);
});

prueba('Sin botín suficiente gana el Guardián al acabarse el tiempo (180 + 30 s tras extraer de menos)', () => {
  const m = pasillo(), [, inf] = m.agentes;
  inf.bolsa = E.BOTIN_PARA_GANAR - 1;
  ticks(m, 1);
  E.simular(m, E.TICKS_RONDA);
  assert(m.terminada && m.ganador === 'guardianes' && m.ticks === 180 * 60 + 30 * 60, `ticks ${m.ticks}`);
});

// ---------- 6. Gadgets ----------

const camara = (x, angulo) => ({ tipo: 'camara', equipo: 'guardianes', x, y: 0.5, angulo, altura: E.ALTURA.DE_PIE, vision: E.VISION.camara, hasta: Infinity, desactivadoHasta: -Infinity });

prueba('Cámara: avisa tras CAMARA_DETECCION_S seguidos en su cono; un PEM a <= 4 la apaga 10 s', () => {
  const m = pasillo(), [, inf] = m.agentes, expo = Math.round(E.CAMARA_DETECCION_S * 60);
  m.gadgets.push(camara(20.5, Math.PI));
  inf.x = 17.5;
  ticks(m, expo - 2);
  assert(!m.pizarras.guardianes.contactos.has(inf.id), 'aún no lleva el tiempo de exposición');
  ticks(m, 3);
  assert(m.pizarras.guardianes.contactos.has(inf.id), 'expuesto el tiempo suficiente: alarma');
  m.pizarras.guardianes.contactos.clear();
  E.lanzarGadget(m, inf, 'pem', inf.x, inf.y);
  ticks(m, 595);
  assert(!m.pizarras.guardianes.contactos.has(inf.id), 'la cámara apagada no debería ver');
  ticks(m, 10 + expo);
  assert(m.pizarras.guardianes.contactos.has(inf.id), 'la cámara vuelve a funcionar');
});

prueba('Sensor: alerta en su sitio si el Infiltrador camina a <= radio (en sigilo no), luego se recarga; escondido', () => {
  const m = pasillo(), [, inf] = m.agentes, sensor = { tipo: 'sensor', equipo: 'guardianes', x: 10.5, y: 0.5, hasta: Infinity, desactivadoHasta: -Infinity };
  m.gadgets.push(sensor);
  const alertas = () => m.pizarras.guardianes.ruidos.filter(r => r.x === sensor.x && r.y === sensor.y).length;
  inf.x = 4.5; inf.dirX = 1; inf.modo = 'sigilo';
  ticks(m, 2);
  assert(!m.pizarras.infiltradores.sensoresVistos.has(sensor), 'a 6 casillas no lo ve: está escondido');
  ticks(m, 180);
  assert.strictEqual(alertas(), 0, 'en sigilo no avisa');
  assert(m.pizarras.infiltradores.sensoresVistos.has(sensor), 'al pasar cerca lo descubre');
  inf.x = 8.5; inf.modo = 'caminar';
  ticks(m, 5);
  assert.strictEqual(alertas(), 1, 'alerta en el sitio del sensor');
  assert(!m.pizarras.guardianes.contactos.has(inf.id), 'no da la posición exacta del Infiltrador');
  inf.x = 9.5; ticks(m, 5);
  assert.strictEqual(alertas(), 1, 'recargándose no avisa');
  inf.dirX = 0; // quieto mientras se recarga (caminando llegaría hasta el Guardián y lo tumbaría)
  ticks(m, E.SENSOR.recarga * 60);
  inf.dirX = 1; ticks(m, 5);
  assert(alertas() >= 1 && m.pizarras.guardianes.ruidos.some(r => r.x === sensor.x && m.t - r.t < 0.2), 'recargado vuelve a avisar');
});

prueba('Humo: suena al lanzarlo, tapa tras 1.5 s de mecha durante 8 s y a <= 1.5 casillas no oculta', () => {
  const m = pasillo(), [g, inf] = m.agentes;
  inf.x = 22.5;
  assert(E.intensidadVision(m.mapa, g, inf) > 0);
  E.lanzarGadget(m, inf, 'humo', 26, 0.5);
  assert(g.pizarra.ruidos.length === 1, 'el lanzamiento se oye');
  ticks(m, E.HUMO.mecha * 60 - 2);
  assert(E.intensidadVision(m.mapa, g, inf) > 0, 'durante la mecha aún no tapa');
  ticks(m, 5);
  assert.strictEqual(E.intensidadVision(m.mapa, g, inf), 0, 'ya tapa');
  inf.x = g.x - 1.2; // dentro del humo pero pegado al Guardián
  assert(E.intensidadVision(m.mapa, g, inf) > 0, 'de cerca se ve la silueta');
  inf.x = 22.5;
  ticks(m, E.HUMO.duracion * 60 - 10);
  assert.strictEqual(E.intensidadVision(m.mapa, g, inf), 0);
  ticks(m, 10);
  assert(E.intensidadVision(m.mapa, g, inf) > 0, 'el humo no se disipa');
  assert(m.mapa.humo.every(h => h === 0));
});

prueba('Humo: los Infiltradores ven a través; Guardianes y cámaras no', () => {
  const m = pasillo(), [g, inf] = m.agentes;
  inf.x = 22.5; inf.angulo = inf.anguloDeseado = 0; // mira al Guardián (29.5)
  E.lanzarGadget(m, inf, 'humo', 26, 0.5);
  ticks(m, E.HUMO.mecha * 60 + 2);
  assert.strictEqual(E.intensidadVision(m.mapa, g, inf), 0, 'el Guardián no ve a través');
  assert(E.intensidadVision(m.mapa, inf, g) > 0, 'el Infiltrador sí');
  const cam = { tipo: 'camara', equipo: 'guardianes', x: 29.5, y: 0.5, angulo: Math.PI, altura: E.ALTURA.DE_PIE, vision: E.VISION.camara };
  assert.strictEqual(E.intensidadVision(m.mapa, cam, inf), 0, 'la cámara tampoco');
});

prueba('Lanzar: como mucho LANZAMIENTO_MAX casillas y sin atravesar muros', () => {
  const m = motor(['..........#.........'], { G: [[19, 0]], S: [[0, 0]] }), inf = m.agentes[1];
  inf.x = 0.5;
  E.lanzarGadget(m, inf, 'senuelo', 9.5, 0.5);
  assert(Math.abs(m.gadgets[0].x - (0.5 + E.LANZAMIENTO_MAX)) < 1e-9, 'recortado al alcance: ' + m.gadgets[0].x);
  inf.x = 7.5;
  E.lanzarGadget(m, inf, 'senuelo', 15.5, 0.5);
  assert(m.gadgets[1].x < 10, 'el muro (x = 10) lo para: ' + m.gadgets[1].x);
});

prueba('Humo táctico: cubre el botín vigilado y la huida', () => {
  // Saqueo: botín en (5,0) que vigila una cámara; el Infiltrador va hacia él.
  let m = motor(['..........'], { G: [[9, 0]], S: [[0, 0]], B: [[5, 0]] });
  m.ia = true;
  let [g, inf] = m.agentes;
  g.decidir = () => {}; g.x = 9.5; g.angulo = g.anguloDeseado = 0; // de espaldas
  m.gadgets.push({ tipo: 'camara', equipo: 'guardianes', x: 8.5, y: 0.5, angulo: Math.PI, altura: E.ALTURA.DE_PIE, vision: E.VISION.camara, hasta: Infinity, desactivadoHasta: -Infinity });
  inf.genes = { ...inf.genes, humo_saqueo: 1, humo_cruce: 0, humo_huida: 0, umbral_huida: 100 };
  inf.x = 1.5;
  ticks(m, 2);
  assert(m.gadgets.some(h => h.tipo === 'humo' && Math.abs(h.x - 5.5) < 0.6), 'humo sobre el botín vigilado');
  // Huida: lo ven y lanza humo entre él y el Guardián.
  m = pasillo(); m.ia = true; [g, inf] = m.agentes;
  g.decidir = () => {}; g.angulo = g.anguloDeseado = Math.PI;
  inf.x = 26.5; inf.genes = { ...inf.genes, humo_saqueo: 0, humo_cruce: 0, humo_huida: 1, umbral_huida: 0 };
  ticks(m, 1);
  const h = m.gadgets.find(x => x.tipo === 'humo');
  assert(h && h.x > inf.x - 0.5 && h.x < g.x, 'humo hacia el Guardián: ' + (h && h.x));
});

prueba('Sabotaje: el Infiltrador apaga una cámara en SABOTAJE_S; un Guardián solo lo sabe al verla y la reactiva', () => {
  const m = motor(['.'.repeat(20)], { G: [[19, 0]], S: [[0, 0]] });
  m.ia = true;
  const [g, inf] = m.agentes;
  const cam = { tipo: 'camara', equipo: 'guardianes', x: 5.5, y: 0.5, angulo: Math.PI, anguloBase: Math.PI, desde: 0, altura: E.ALTURA.DE_PIE, vision: E.VISION.camara, hasta: Infinity, desactivadoHasta: -Infinity };
  m.gadgets.push(cam);
  g.decidir = () => {}; // primero, el Guardián quieto
  inf.genes = { ...inf.genes, sabotaje: 1, paciencia_s: 0, prudencia: 0.5, humo_saqueo: 0, humo_cruce: 0, senuelo_distraccion: 0 }; // sin humo: taparía la cámara al Guardián
  inf.x = 4.5; // junto a la cámara (que lo vea no importa: las cámaras no aturden)
  ticks(m, Math.round(E.SABOTAJE_S * 60) + 150); // margen: antes puede tapar la cámara con humo y esperar a que salga
  assert(cam.saboteada && m.t < cam.desactivadoHasta, 'cámara saboteada');
  // Ahora el Infiltrador se aparta. De espaldas a la cámara, el Guardián no sabe que está apagada: no va.
  inf.decidir = () => {}; inf.x = 0.5;
  g.decidir = E.Guardian.prototype.decidir;
  g.genes = { ...g.genes, prioridad_camaras: 1 };
  g.x = 12.5; g.angulo = g.anguloDeseado = 0; // a 7 casillas de la cámara, de espaldas
  ticks(m, 1);
  assert(!g.pizarra.camarasCaidas.has(cam), 'no lo sabe sin verla');
  g.angulo = g.anguloDeseado = Math.PI; // la ve: ahora lo sabe y va a reactivarla
  ticks(m, 60 * 8);
  assert(!cam.saboteada && m.t >= cam.desactivadoHasta, 'reactivada por el Guardián');
});

prueba('Herramientas: los Infiltradores recuperan 1 cada RECARGA_GADGET_S hasta el máximo', () => {
  const m = pasillo(), [, inf] = m.agentes;
  assert(E.lanzarGadget(m, inf, 'pem', inf.x, inf.y) && E.lanzarGadget(m, inf, 'pem', inf.x, inf.y));
  assert.strictEqual(m.inventario.infiltradores, E.GADGETS_POR_EQUIPO - 2);
  ticks(m, Math.round(E.RECARGA_GADGET_S * 60));
  assert.strictEqual(m.inventario.infiltradores, E.GADGETS_POR_EQUIPO - 1, 'una recargada');
  ticks(m, Math.round(E.RECARGA_GADGET_S * 60) * 2);
  assert.strictEqual(m.inventario.infiltradores, E.GADGETS_POR_EQUIPO, 'no pasa del máximo');
});

prueba('Señuelo: ruidos falsos cada 0.5 s durante 5 s; solo 4 herramientas por equipo', () => {
  const m = pasillo(), [, inf] = m.agentes, ruidos = [];
  const publicar = m.pizarras.guardianes.publicarRuido.bind(m.pizarras.guardianes);
  m.pizarras.guardianes.publicarRuido = (...r) => { ruidos.push(m.t); publicar(...r); };
  inf.x = 20.5; // a menos de LANZAMIENTO_MAX del punto de lanzamiento
  assert(E.lanzarGadget(m, inf, 'senuelo', 25.5, 0.5));
  ticks(m, 400);
  assert(ruidos.length >= 9 && ruidos.length <= 11 && ruidos.every(t => t <= 5 + 1e-9), JSON.stringify(ruidos));
  assert(E.lanzarGadget(m, inf, 'pem', 0.5, 0.5) && E.lanzarGadget(m, inf, 'pem', 0.5, 0.5) && E.lanzarGadget(m, inf, 'pem', 0.5, 0.5));
  assert(!E.lanzarGadget(m, inf, 'humo', 0.5, 0.5), 'la quinta herramienta no debería salir');
});

prueba('Colocación: cada gadget va donde detecta pasos que los anteriores no (no se amontonan)', () => {
  const m = motor(['.'.repeat(30)], { G: [[15, 0]], S: [[0, 0]], B: [[29, 0]] });
  const celdas = (a, b) => Array.from({ length: b - a + 1 }, (_, k) => a + k);
  // 10 pasos por x = 3..5 y 4 por x = 25..27, todos andando.
  const pasos = [...Array(10).fill([celdas(3, 5), []]), ...Array(4).fill([celdas(25, 27), []])];
  const antes = E.fijarRastros({ ancho: m.mapa.ancho, alto: m.mapa.alto, pasos });
  try {
    E.planificarGadgetsGuardianes(m, { ...E.GENES_GUARDIAN_POR_DEFECTO, proporcion_camaras: 0 });
    const xs = m.equipos.guardianes[0].pendientes.map(p => p.celda % m.mapa.ancho);
    const alcanza = (x, a, b) => x >= a - E.SENSOR.radio && x <= b + E.SENSOR.radio;
    assert(alcanza(xs[0], 3, 5), 'el primero donde pasa más gente: ' + xs);
    assert(alcanza(xs[1], 25, 27), 'el segundo donde aún no detecta nadie, no pegado al primero: ' + xs);
  } finally { E.fijarRastros(antes); }
});

prueba('Preparación: los Guardianes colocan todo lo que planean (como mucho round(proporcion_camaras · 4) cámaras) sin reloj ni Infiltradores', () => {
  for (const [p, camaras] of [[0, 0], [0.5, 2], [1, 4]]) {
    const m = E.crearSimulacion(E.GENES_INFILTRADOR_POR_DEFECTO, { ...E.GENES_GUARDIAN_POR_DEFECTO, proporcion_camaras: p });
    const inf = m.equipos.infiltradores.map(i => [i.x, i.y]), gua = m.equipos.guardianes.map(g => [g.x, g.y]);
    assert.strictEqual(m.gadgets.length, 0, 'nada colocado antes de empezar');
    const planeados = m.equipos.guardianes.flatMap(g => g.pendientes);
    assert(planeados.length >= E.GADGETS_POR_EQUIPO, 'al menos uno por hueco');
    ticks(m, E.PREPARACION_S * 60);
    assert(m.enPreparacion && m.tiempoRestante === E.TIEMPO_RONDA_S, 'el reloj no corre');
    assert.deepStrictEqual(m.equipos.infiltradores.map(i => [i.x, i.y]), inf, 'los Infiltradores esperan');
    assert.notDeepStrictEqual(m.equipos.guardianes.map(g => [g.x, g.y]), gua, 'los Guardianes se mueven');
    assert.strictEqual(m.gadgets.filter(g => g.tipo === 'camara').length, camaras);
    assert.strictEqual(m.gadgets.length, planeados.length, 'llega a colocar todo lo planeado');
    assert.strictEqual(m.inventario.guardianes, 0);
    for (const c of m.gadgets.filter(g => g.tipo === 'camara')) { // solo en paredes
      const cx = Math.floor(c.x), cy = Math.floor(c.y);
      assert([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => m.mapa.altura[cx + dx + (cy + dy) * m.mapa.ancho] >= E.ALTURA.MURO), 'cámara sin pared');
    }
    ticks(m, 1);
    assert(!m.enPreparacion && m.tiempoRestante < E.TIEMPO_RONDA_S, 'empieza la ronda');
  }
});

prueba('Luz: los Infiltradores solo conocen la linterna a su alcance y sin paredes en medio (de espaldas también)', () => {
  const m = pasillo(); // Guardián en x = 29.5 mirando al oeste; Infiltrador en x = 0.5
  const inf = m.equipos.infiltradores[0], c = celda(m, 25.5, 0.5);
  ticks(m, 1);
  assert.strictEqual(m.costeInfiltradores()[c], 0, 'a 25 casillas no la ve');
  inf.x = 15.5;
  inf.angulo = inf.anguloDeseado = Math.PI; // a 10 casillas, de espaldas: la ve igual (periférica)
  ticks(m, E.LUZ_REFRESCO_TICKS);
  assert(m.costeInfiltradores()[c] > 0, 'luz a la vista');
  const t = motor(['.....#....'], { G: [[9, 0]], S: [[0, 0]] }); // misma escena con un muro en medio
  t.equipos.guardianes[0].angulo = t.equipos.guardianes[0].anguloDeseado = Math.PI;
  ticks(t, 1);
  assert.strictEqual(t.costeInfiltradores()[celda(t, 7.5, 0.5)], 0, 'el muro tapa la luz');
});

prueba('Guardián: al llegar a una alerta y no ver a nadie la descarta y va a la más reciente', () => {
  const m = motor(['.'.repeat(30)], { G: [[0, 0]], S: [[29, 0]] });
  m.ia = true;
  const g = m.equipos.guardianes[0], p = g.pizarra;
  p.contactos.set(99, { x: 0.5, y: 0.5, t: 0 }); // LKP vieja a sus pies
  p.ruidos.push({ x: 10.5, y: 0.5, radio: 4, t: 0 });
  ticks(m, 2);
  assert(!p.contactos.has(99), 'LKP revisada');
  p.ruidos.push({ x: 5.5, y: 0.5, radio: 4, t: m.t }); // ruido nuevo, más lejos que nada pero más reciente
  ticks(m, 1);
  assert.strictEqual(g.meta, celda(m, 5.5, 0.5), 'va al ruido más reciente');
});

prueba('Guardianes: dos que acuden a la misma alerta no acaban en la misma casilla ni mirando igual', () => {
  const m = motor(['.'.repeat(20), '.'.repeat(20), '.'.repeat(20), '.'.repeat(20), '.'.repeat(20)], { G: [[0, 0], [0, 4]], S: [[19, 4]] }, 2);
  m.ia = true;
  const [a, b] = m.equipos.guardianes;
  for (const g of [a, b]) g.genes = { ...g.genes, investigar: 1 };
  m.equipos.infiltradores.forEach(i => { i.decidir = () => {}; });
  const ruido = () => a.pizarra.ruidos.push({ x: 10.5, y: 2.5, radio: 4, t: m.t });
  let dMin = Infinity, flanco = 0;
  for (let k = 0; k < 8 * 60; k++) {
    if (k % 60 === 0) ruido();
    m.paso();
    if (k < 150) continue; // ya han llegado
    dMin = Math.min(dMin, Math.hypot(a.x - b.x, a.y - b.y));
    flanco = Math.max(flanco, ...[a, b].map(g => Math.hypot(g.x - 10.5, g.y - 2.5)));
  }
  assert(dMin >= 1, `se juntan a ${dMin.toFixed(2)} casillas`);
  assert(flanco >= E.FLANCO_ALERTA - 0.6, 'uno cubre el punto desde el flanco');
});

// ---------- 7. Fitness, genes y rondas completas ----------

prueba('Fitness durante la ronda: ser visto resta al Infiltrador; al Guardián solo le suma tenerlo a tiro del aturdidor', () => {
  const m = pasillo(); // Guardián en x = 29.5 mirando al oeste, Infiltrador en x = 0.5
  m.equipos.infiltradores[0].x = 23.5; // a 6 casillas: lo ve, pero fuera del aturdidor
  m.equipos.infiltradores[0].angulo = m.equipos.infiltradores[0].anguloDeseado = 0;
  const g = m.equipos.guardianes[0];
  g.x = 29.5; g.angulo = g.anguloDeseado = Math.PI;
  ticks(m, 60);
  const lejos = m.stats.infiltradores.segundosVisto;
  assert(lejos > 0.5, 'a 6 casillas lo ve');
  assert.strictEqual(m.stats.guardianes.segundosAturdiendo, 0, 'de lejos lo ve pero no puntúa');
  m.equipos.infiltradores[0].x = 26.5;
  ticks(m, 60);
  assert(m.stats.infiltradores.segundosVisto > lejos + 0.5, 'a 3 casillas lo ve ~1 s');
  assert(m.stats.guardianes.segundosAturdiendo > 0.5);
  m.ganador = 'guardianes';
  const con = E.evaluarFitness(m);
  m.stats.infiltradores.segundosVisto = 0; m.stats.guardianes.segundosAturdiendo = 0;
  const sin = E.evaluarFitness(m);
  assert(con.infiltrador < sin.infiltrador && con.guardian > sin.guardian);
});

prueba('aDistancia da lo mismo que Math.hypot(dx, dy) <= r, también justo en el borde', () => {
  const rnd = E.mulberry32(4);
  for (let k = 0; k < 200000; k++) {
    const r = [1.5, 4.5, 9, 12, 13][k % 5], a = rnd() * 2 * Math.PI;
    const d = k % 2 ? r * (1 + (rnd() - 0.5) * 1e-12) : rnd() * 2 * r; // la mitad pegados al borde
    const dx = Math.cos(a) * d, dy = Math.sin(a) * d;
    assert.strictEqual(E.aDistancia(dx, dy, r), Math.hypot(dx, dy) <= r, `${dx}, ${dy}, ${r}`);
  }
  assert(E.aDistancia(3, 4, 5) && !E.aDistancia(3, 4.000001, 5) && E.aDistancia(0, 0, 0));
});

prueba('Fitness: finito; ganar puntúa más; la hierba y el botín extraído restan al Guardián', () => {
  const m = pasillo();
  m.ganador = 'guardianes';
  const base = E.evaluarFitness(m);
  m.stats.guardianes.segundosHierba = 3;
  assert(E.evaluarFitness(m).guardian < base.guardian);
  m.stats.infiltradores.extraido = 100;
  const conBotin = E.evaluarFitness(m);
  assert(conBotin.infiltrador > base.infiltrador && conBotin.guardian < base.guardian);
  m.ganador = 'infiltradores';
  const gana = E.evaluarFitness(m);
  assert(gana.infiltrador > conBotin.infiltrador && gana.guardian < conBotin.guardian);
  for (const f of [base, conBotin, gana]) assert(Number.isFinite(f.infiltrador) && Number.isFinite(f.guardian));
});

prueba('limitarGenes recorta al rango y rechaza genes ausentes o no numéricos', () => {
  const g = E.limitarGenes({ ...E.GENES_INFILTRADOR_POR_DEFECTO, w_light: -5, wait_time_s: 99 }, E.RANGOS_INFILTRADOR);
  assert(g.w_light === 0 && g.wait_time_s === 10);
  assert.throws(() => E.limitarGenes({ w_light: 1 }, E.RANGOS_INFILTRADOR));
  assert.throws(() => E.limitarGenes({ ...E.GENES_GUARDIAN_POR_DEFECTO, sweepAngle: NaN }, E.RANGOS_GUARDIAN));
});

prueba('Rondas completas 3v3 en el mapa real: terminan, fitness finito y repetibles', () => {
  console.log('       genoma  | ganador       | tiempo  | extraído | derribos I/G | fitness inf / guard | ms');
  GENOMAS.forEach((gen, n) => {
    const t0 = process.hrtime.bigint(), m = E.simular(ronda(gen), E.TICKS_RONDA);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    assert(m.terminada && Number.isFinite(m.fitness.infiltrador) && Number.isFinite(m.fitness.guardian));
    assert.strictEqual(m.ganador === 'infiltradores', m.extraido >= E.BOTIN_PARA_GANAR);
    assert.strictEqual(huella(E.simular(ronda(gen), E.TICKS_RONDA)), huella(m), 'no determinista');
    console.log(`       ${n ? 'azar ' + n + ' ' : 'defecto'} | ${m.ganador.padEnd(13)} | ${m.t.toFixed(1).padStart(5)} s | ${String(m.extraido).padStart(8)} | ${m.stats.infiltradores.derribos}/${m.stats.guardianes.derribos}          | ${m.fitness.infiltrador.toFixed(0).padStart(6)} / ${m.fitness.guardian.toFixed(0).padStart(6)}     | ${ms.toFixed(0)}`);
  });
});

prueba('5 contra 5 también termina y es repetible', () => {
  const a = E.simular(ronda(GENOMAS[0], { porEquipo: 5 }), E.TICKS_RONDA);
  assert(a.terminada && a.agentes.length === 10);
  assert.strictEqual(huella(E.simular(ronda(GENOMAS[0], { porEquipo: 5 }), E.TICKS_RONDA)), huella(a));
});

console.log(fallos ? `\n${fallos} prueba(s) fallida(s)` : '\nTodas las pruebas pasan');
process.exitCode = fallos ? 1 : 0;
