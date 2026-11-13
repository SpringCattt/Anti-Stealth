// Arranque en el navegador. Usa los genes de mejores_genes.json si se pueden leer (servidor local) y si no los de
// genes.js. Parámetros de la URL: ?n=5 agentes por equipo (por defecto AGENTES_POR_EQUIPO), ?semilla=123 para repetir
// una ronda. Teclas: espacio pausa, R ronda nueva.

const contenedor = document.getElementById('escena');
const hud = document.getElementById('hud');
const parametros = new URLSearchParams(location.search);
const porEquipo = Number(parametros.get('n')) || AGENTES_POR_EQUIPO;
let pausa = false;

addEventListener('keydown', e => {
  if (e.code === 'Space') { pausa = !pausa; e.preventDefault(); }
  if (e.code === 'KeyP') pausa = true;
  if (e.code === 'KeyR') location.reload();
});

async function cargarGenes() {
  try {
    const r = await fetch('mejores_genes.json', { cache: 'no-store' });
    if (!r.ok) throw new Error(r.status);
    const datos = await r.json();
    // limitarGenes lanza si el JSON es de una versión con otros genes: entonces se usan los de por defecto.
    const gi = limitarGenes(datos.mejorInfiltrador.genes, RANGOS_INFILTRADOR), gg = limitarGenes(datos.mejorGuardian.genes, RANGOS_GUARDIAN);
    return { gi, gg, origen: 'mejores_genes.json' + (datos.enCurso ? ` (gen ${datos.generacion}, entrenando)` : '') };
  } catch {
    return { gi: GENES_INFILTRADOR_POR_DEFECTO, gg: GENES_GUARDIAN_POR_DEFECTO, origen: 'genes por defecto' };
  }
}

function textoHud(m, origen) {
  const equipo = lista => lista.map(a => `${a.estado === 'activo' ? a.modo[0].toUpperCase() : a.estado === 'inconsciente' ? 'z' : 'x'}${a.accion ? '·' + a.accion.tipo : ''}`).join(' ');
  const contactos = m.pizarras.guardianes.contactosVigentes(m.t);
  return [
    (m.enPreparacion ? `PREPARACIÓN de los Guardianes: ${(m.preparacion - m.t).toFixed(1)} s` : `t ${(m.t - m.preparacion).toFixed(1)} s · quedan ${Math.max(0, m.tiempoRestante).toFixed(1)} s`) + `${pausa ? ' · PAUSA' : ''}${m.terminada ? ` · FIN: ganan los ${m.ganador}` : ''}`,
    `Extraído ${m.extraido.toFixed(0)} / ${BOTIN_PARA_GANAR} · en el suelo ${m.suelo.reduce((s, p) => s + p.valor, 0).toFixed(0)} · gadgets I ${m.inventario.infiltradores} / G ${m.inventario.guardianes}`,
    `Infiltradores: ${equipo(m.equipos.infiltradores)} · derribos ${m.stats.infiltradores.derribos} · reanimaciones ${m.stats.infiltradores.reanimaciones}`,
    `Guardianes:    ${equipo(m.equipos.guardianes)} · derribos ${m.stats.guardianes.derribos} · confiscado ${m.stats.guardianes.confiscado.toFixed(0)} · hierba ${m.stats.guardianes.segundosHierba.toFixed(1)} s`,
    `Pizarra guardianes: ${contactos.map(c => `#${c.id} ${c.visto ? 'VISTO' : 'LKP'}`).join(', ') || 'sin contactos'} · ruidos ${m.pizarras.guardianes.ruidos.length}`,
    m.fitness ? `Fitness: infiltradores ${m.fitness.infiltrador.toFixed(0)} · guardianes ${m.fitness.guardian.toFixed(0)}` : `Genes: ${origen} · ${porEquipo} contra ${porEquipo}`,
    'S/C/R = sigilo/caminar/correr · z inconsciente · x eliminado · espacio pausa · R ronda nueva',
    'Ratón: arrastrar gira · botón derecho desplaza · rueda zoom · V conos lógicos',
  ].join('\n');
}

cargarGenes().then(({ gi, gg, origen }) => {
  const semilla = Number(parametros.get('semilla')) || Math.floor(Math.random() * 2 ** 32);
  const motor = new GameEngine({ headless: false, porEquipo, semilla, genesInfiltrador: gi, genesGuardian: gg });
  const render = new RenderCenital(contenedor, motor);
  Object.assign(window, { motor, render }); // para inspeccionar desde la consola del navegador
  let anterior = null;
  // Mismo bucle que GameEngine.iniciar, más la pausa: con pausa no se acumula tiempo.
  const fotograma = t => {
    if (anterior !== null && !pausa) motor.avanzar(t - anterior);
    anterior = t;
    render.dibujar(motor);
    hud.textContent = textoHud(motor, origen) + `\nsemilla ${semilla}`;
    requestAnimationFrame(fotograma);
  };
  requestAnimationFrame(fotograma);
}).catch(e => { hud.textContent = 'Error: ' + e.message; });
