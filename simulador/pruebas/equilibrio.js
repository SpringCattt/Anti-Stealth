// Chequeo rápido de equilibrio (~1 min): juega N rondas por pareja de genes y mide resultado y comportamientos raros.
// Uso: node pruebas/equilibrio.js [rondas=20] [genes.json=mejores_genes.json] [porEquipo=3]
// Parejas: defecto contra defecto y, si el JSON es válido, entrenado contra entrenado y cruzadas.
// Métricas "IA burra" (por ronda): segundos-infiltrador dentro de la luz de un Guardián y segundos con dos Guardianes
// activos a menos de 1 casilla. Rondas distintas: si sale 1, la semilla no cambia nada la partida.
'use strict';
const path = require('path');
const E = require('./cargar.js');

const N = Number(process.argv[2]) || 20;
const rutaGenes = path.resolve(process.argv[3] || path.join(__dirname, '..', 'mejores_genes.json'));
const porEquipo = Number(process.argv[4]) || E.AGENTES_POR_EQUIPO;
const MUESTRA = 6; // ticks entre muestras de las métricas de comportamiento

const parejas = { 'defecto / defecto': [E.GENES_INFILTRADOR_POR_DEFECTO, E.GENES_GUARDIAN_POR_DEFECTO] };
try {
  const j = require(rutaGenes);
  const gi = E.limitarGenes(j.mejorInfiltrador.genes, E.RANGOS_INFILTRADOR), gg = E.limitarGenes(j.mejorGuardian.genes, E.RANGOS_GUARDIAN);
  Object.assign(parejas, { 'entrenado / entrenado': [gi, gg], 'defecto / entrenado': [E.GENES_INFILTRADOR_POR_DEFECTO, gg], 'entrenado / defecto': [gi, E.GENES_GUARDIAN_POR_DEFECTO] });
  console.log(`Genes entrenados: ${path.basename(rutaGenes)} (gen ${j.generacion ?? '?'}${j.enCurso ? ', a medias' : ''})`);
} catch (e) {
  console.log(`Sin genes entrenados válidos (${e.message}): solo defecto / defecto`);
}

function ronda(gi, gg, semilla) {
  const m = E.crearSimulacion(gi, gg, { semilla, porEquipo });
  const dt = MUESTRA * E.DT, n = m.mapa.ancho * m.mapa.alto;
  let enLuz = 0, juntos = 0;
  while (!m.terminada && m.ticks < E.TICKS_RONDA) {
    m.paso();
    if (m.enPreparacion || m.ticks % MUESTRA) continue;
    const luz = new Uint8Array(n), gs = m.equipos.guardianes.filter(g => g.activo);
    for (const g of gs) E.marcarIluminadas(m.mapa, g, luz);
    for (const i of m.equipos.infiltradores) if (i.activo && luz[E.celdaEn(m.mapa, i.x, i.y)]) enLuz += dt;
    for (let a = 0; a < gs.length; a++) for (let b = a + 1; b < gs.length; b++) if (Math.hypot(gs[a].x - gs[b].x, gs[a].y - gs[b].y) < 1) juntos += dt;
  }
  return { m, enLuz, juntos };
}

const t0 = Date.now();
const fmt = (v, d = 1) => v.toFixed(d).padStart(6);
console.log(`${N} rondas por pareja, ${porEquipo} contra ${porEquipo}\n`);
console.log('infiltrador / guardián  | gana inf | duración | derribos I→G  G→I | extraído | s en luz | s juntos | rondas distintas');
for (const [nombre, [gi, gg]] of Object.entries(parejas)) {
  const r = Array.from({ length: N }, (_, k) => ronda(gi, gg, k + 1));
  const media = f => r.reduce((s, x) => s + f(x), 0) / N;
  const gana = r.filter(x => x.m.ganador === 'infiltradores').length;
  const distintas = new Set(r.map(x => x.m.ticks + '|' + x.m.extraido)).size;
  console.log(`${nombre.padEnd(23)} | ${String(Math.round(100 * gana / N)).padStart(6)} % | ${fmt(media(x => x.m.t - x.m.preparacion))} s |` +
    ` ${fmt(media(x => x.m.stats.infiltradores.derribos), 2)} ${fmt(media(x => x.m.stats.guardianes.derribos), 2)} |` +
    ` ${fmt(media(x => x.m.extraido), 0)}   | ${fmt(media(x => x.enLuz))}   | ${fmt(media(x => x.juntos))}   | ${distintas}/${N}`);
}
console.log(`\n${((Date.now() - t0) / 1000).toFixed(1)} s`);
