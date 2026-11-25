// Co-evolución repartida entre varios hilos (worker_threads): cada hilo carga la simulación y juega las rondas que le
// llegan. Da exactamente el mismo resultado que coevolucionar() de un solo hilo, solo que más rápido.
// Uso: const { coevolucionarEnParalelo } = require('./paralelo.js'); await coevolucionarEnParalelo(opciones, alGeneracion, hilos)
// Ojo: los hilos cargan config.js tal cual; un cambio de reglas hecho con vm.runInThisContext en el hilo principal no les llega.
'use strict';
const { Worker, isMainThread, parentPort } = require('worker_threads');
const os = require('os');

if (!isMainThread) {
  const E = require('./cargar.js');
  parentPort.on('message', ({ k, ronda }) => parentPort.postMessage({ k, r: E.jugarRonda(E.crearRonda, ronda) }));
} else {
  const E = require('./cargar.js');

  // Juega un lote con los hilos dados: cada hilo libre coge la siguiente ronda (las rondas duran distinto).
  function jugarLote(hilos, lote) {
    return new Promise((resolver, fallar) => {
      const res = new Array(lote.length);
      let siguiente = 0, hechas = 0;
      const dar = w => { if (siguiente < lote.length) { w.postMessage({ k: siguiente, ronda: lote[siguiente] }); siguiente++; } };
      for (const w of hilos) {
        w.removeAllListeners('message').removeAllListeners('error');
        w.on('message', ({ k, r }) => { res[k] = r; if (++hechas === lote.length) resolver(res); else dar(w); });
        w.on('error', fallar);
      }
      if (!lote.length) return resolver(res);
      hilos.forEach(dar);
    });
  }

  // Un hilo por núcleo físico: medido en un Ryzen 5 3600, 6 hilos rinden igual que 11 (las rondas a la vez se pelean
  // por la caché y la memoria: ~2.2x más rápido que un hilo, no 6x) y así el PC sigue usable mientras entrena.
  async function coevolucionarEnParalelo(opciones = {}, alGeneracion = null, n = Math.max(1, Math.floor(os.availableParallelism() / 2))) {
    const hilos = Array.from({ length: n }, () => new Worker(__filename));
    try {
      const it = E.coevolucion(opciones, alGeneracion);
      let paso = it.next();
      while (!paso.done) paso = it.next(await jugarLote(hilos, paso.value));
      return paso.value;
    } finally {
      await Promise.all(hilos.map(w => w.terminate()));
    }
  }

  module.exports = { coevolucionarEnParalelo };
}
