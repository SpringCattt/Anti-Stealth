// Fitness de cada equipo al final de la ronda. Requiere config.js. Lo llama nucleo.js al terminar.
//
// Infiltradores = victoria (si extraen >= BOTIN_PARA_GANAR); da igual cuándo: sin bono por tiempo sobrante
//               + extraído · 3 + recogido · 1 + derribos · 60 + reanimaciones · 40 - caídas propias · 30
// Guardianes    = victoria (por tiempo o equipo infiltrador caído) + derribos · 60 + reanimaciones · 40
//               + confiscado · 2 + devuelto · 1 - extraído por el rival · 3 - caídas propias · 30
//               - segundos en la hierba tras la gracia · 15 - revelaciones · 50
// La victoria (1000) pesa más que cualquier ronda normal sin ella; derribos y reanimaciones desempatan entre derrotas.

const PESOS_FITNESS = {
  victoria: 1000,
  extraido: 3,
  recogido: 1,
  derribo: 60,
  reanimacion: 40,
  caida: 30,
  confiscado: 2,
  devuelto: 1,
  hierba: 15,
  revelacion: 50,
};

// Devuelve { infiltrador, guardian } a partir de motor.ganador, motor.t y motor.stats.
function evaluarFitness(motor) {
  const P = PESOS_FITNESS, si = motor.stats.infiltradores, sg = motor.stats.guardianes;
  const ganaI = motor.ganador === 'infiltradores';
  return {
    infiltrador: (ganaI ? P.victoria : 0) + P.extraido * si.extraido + P.recogido * si.recogido
      + P.derribo * si.derribos + P.reanimacion * si.reanimaciones - P.caida * si.caidas,
    guardian: (ganaI ? 0 : P.victoria) + P.derribo * sg.derribos + P.reanimacion * sg.reanimaciones
      + P.confiscado * sg.confiscado + P.devuelto * sg.devuelto - P.extraido * si.extraido - P.caida * sg.caidas
      - P.hierba * sg.segundosHierba - P.revelacion * sg.revelaciones,
  };
}
