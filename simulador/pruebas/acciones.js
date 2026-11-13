// Qué hace la red: % del tiempo en cada acción y modo, por bando, con los genes de un JSON (por defecto mejores_genes.json).
// Uso: node pruebas/acciones.js [rondas=10] [genes.json]
'use strict';
const path = require('path');
const E = require('./cargar.js');
const N = Number(process.argv[2]) || 10;
const j = require(path.resolve(process.argv[3] || path.join(__dirname, '..', 'mejores_genes.json')));
const gi = E.limitarGenes(j.mejorInfiltrador.genes, E.RANGOS_INFILTRADOR), gg = E.limitarGenes(j.mejorGuardian.genes, E.RANGOS_GUARDIAN);
const cuenta = { infiltradores: {}, guardianes: {} };
let gana = 0;
for (let s = 1; s <= N; s++) {
  const m = E.crearSimulacion(gi, gg, { semilla: s });
  while (!m.terminada && m.ticks < E.TICKS_RONDA) {
    m.paso();
    if (m.enPreparacion) continue;
    for (const a of m.agentes) {
      if (!a.activo || a.accionRed === undefined) continue;
      const nombre = (a.esGuardian ? E.ACCIONES_GUA : E.ACCIONES_INF)[a.accionRed] + (E.MODOS_RED[a.modoRed] ? '/' + E.MODOS_RED[a.modoRed] : '');
      cuenta[a.equipo][nombre] = (cuenta[a.equipo][nombre] || 0) + 1;
    }
  }
  if (m.ganador === 'infiltradores') gana++;
}
for (const [eq, c] of Object.entries(cuenta)) {
  const total = Object.values(c).reduce((a, b) => a + b, 0);
  console.log(eq + ':', Object.entries(c).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${(100 * v / total).toFixed(0)}%`).join(', '));
}
console.log(`infiltradores ganan ${gana}/${N}`);
