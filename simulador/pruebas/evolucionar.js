// Ejecuta la co-evolución con semilla fija y escribe simulador/mejores_genes.json.
// Uso: node pruebas/evolucionar.js [semilla] [generaciones] [poblacion] [rivales] [salida.json]   (0 = valor por defecto)
// Juega las rondas en varios hilos (paralelo.js): mismo resultado que con uno, más rápido. HILOS=1 para uno solo.
// Guarda el mejor histórico al terminar cada generación (puntos de control): si se corta a mitad, el JSON sirve igual.
// CONTINUAR=1: arranca desde los mejores genes que ya hay en la salida (arranque en caliente) en vez de desde cero.
'use strict';
const fs = require('fs'), path = require('path');
const E = require('./cargar.js');
const { coevolucionarEnParalelo } = require('./paralelo.js');
const hilos = Number(process.env.HILOS) || undefined;
const [semilla, generaciones, poblacion, rivales] = process.argv.slice(2, 6).map(Number);
const opciones = { ...(semilla && { semilla }), ...(generaciones && { generaciones }), ...(poblacion && { poblacion }), ...(rivales && { rivales }) };
const p = { ...E.PARAMS_GA_POR_DEFECTO, ...opciones };
const salida = process.argv[6] || path.join(__dirname, '..', 'mejores_genes.json');
if (process.env.CONTINUAR === '1') {
  const previo = JSON.parse(fs.readFileSync(salida, 'utf8'));
  opciones.inicial = { infiltrador: previo.mejorInfiltrador.genes, guardian: previo.mejorGuardian.genes };
  console.log(`Continuando desde ${salida}${previo.enCurso ? ` (punto de control, gen ${previo.generacion})` : ''}`);
}
console.log(`Parametros: ${JSON.stringify(p)}\nRondas a simular: ${E.contarRondas(p)}\nSalida: ${salida}`);

// Comprueba que los genes guardados están en rango (si no, el genético tiene un error).
function validar(r) {
  for (const [genes, rangos] of [[r.mejorInfiltrador.genes, E.RANGOS_INFILTRADOR], [r.mejorGuardian.genes, E.RANGOS_GUARDIAN]]) {
    const l = E.limitarGenes(genes, rangos);
    for (const k in l) if (l[k] !== genes[k]) throw new Error('gen fuera de rango: ' + k);
  }
}

function guardar(datos) {
  validar(datos);
  const tmp = salida + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(datos, null, 2));
  fs.renameSync(tmp, salida); // escritura atómica: nunca queda un JSON a medias
}

(async () => {
  const t0 = Date.now();
  const r = await coevolucionarEnParalelo(opciones, g => {
    const s = (Date.now() - t0) / 1000;
    console.log(`gen ${String(g.generacion).padStart(3)} | mejor inf ${g.infiltrador.toFixed(1).padStart(7)} | mejor guard ${g.guardian.toFixed(1).padStart(7)} | rondas ${g.rondas} | ${s.toFixed(0)} s`);
    guardar({ parametros: g.parametros, enCurso: true, generacion: g.generacion, rondas: g.rondas, segundos: s,
      mejorInfiltrador: g.mejorInfiltrador, mejorGuardian: g.mejorGuardian });
  }, hilos);
  r.segundos = (Date.now() - t0) / 1000;
  guardar(r);
  console.log(`\nMejor Infiltrador: ${JSON.stringify(r.mejorInfiltrador)}\nMejor Guardian:    ${JSON.stringify(r.mejorGuardian)}`);
  console.log(`Infiltradores ganan (sacan el botin): ${r.pctMetaTotal.toFixed(1)}% de todas las rondas, ${r.pctMetaUltimaGeneracion.toFixed(1)}% en la ultima generacion; algun derribo en ${r.pctDerriboTotal.toFixed(1)}%`);
  console.log(`Tiempo: ${r.segundos.toFixed(1)} s`);
})().catch(e => { console.error(e); process.exitCode = 1; });
