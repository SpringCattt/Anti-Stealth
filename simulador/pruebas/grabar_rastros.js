// Graba por dónde pasan los Infiltradores entrenados (mejores_genes.json) y lo guarda en simulador/rastros.json.
// Los Guardianes lo usan para colocar sus gadgets donde más detecciones habrían conseguido (gadgets.js).
// Uso: node pruebas/grabar_rastros.js [rondas=60]
//
// Formato: { ancho, alto, rondas, pasos: [[moviendo, quieto], ...] }. Un "paso" es un Infiltrador durante una ventana
// de SENSOR.recarga s de una ronda (lo más que un sensor puede avisar de él): moviendo = casillas en las que estuvo
// andando o corriendo (un sensor lo notaría), quieto = casillas en las que estuvo agachado o parado (solo una cámara).
'use strict';
const fs = require('fs'), path = require('path');
const E = require('./cargar.js');
const rondas = Number(process.argv[2]) || 60;
const j = require(path.join(__dirname, '..', 'mejores_genes.json'));
const gi = E.limitarGenes(j.mejorInfiltrador.genes, E.RANGOS_INFILTRADOR), gg = E.limitarGenes(j.mejorGuardian.genes, E.RANGOS_GUARDIAN);
const MUESTRA_TICKS = 15; // cada 0.25 s

const pasos = [];
let ancho, alto;
for (let r = 0; r < rondas; r++) {
  const m = E.crearSimulacion(gi, gg, { semilla: 1000 + r });
  ({ ancho, alto } = m.mapa);
  const porClave = new Map(); // `${agente}:${ventana}` -> { moviendo: Set, quieto: Set }
  while (!m.terminada && m.ticks < E.TICKS_RONDA) {
    m.paso();
    if (m.enPreparacion || m.ticks % MUESTRA_TICKS) continue;
    for (const a of m.equipos.infiltradores) {
      if (!a.activo) continue;
      const clave = `${a.id}:${Math.floor((m.t - m.preparacion) / E.SENSOR.recarga)}`;
      if (!porClave.has(clave)) porClave.set(clave, { moviendo: new Set(), quieto: new Set() });
      const p = porClave.get(clave), c = E.celdaEn(m.mapa, a.x, a.y);
      (a.moviendose && a.modo !== 'sigilo' ? p.moviendo : p.quieto).add(c);
    }
  }
  for (const p of porClave.values()) pasos.push([[...p.moviendo], [...p.quieto].filter(c => !p.moviendo.has(c))]);
}
const salida = path.join(__dirname, '..', 'rastros.json');
fs.writeFileSync(salida, JSON.stringify({ ancho, alto, rondas, pasos }));
console.log(`${rondas} rondas, ${pasos.length} pasos -> ${salida} (${(fs.statSync(salida).size / 1024).toFixed(0)} KB)`);
