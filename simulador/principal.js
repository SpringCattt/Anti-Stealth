// Arranque en el navegador. Usa los genes de mejores_genes.json si se pueden leer (servidor local) y si no los de
// genes.js. Parámetros de la URL: ?n=5 agentes por equipo (por defecto AGENTES_POR_EQUIPO), ?semilla=123 para repetir
// una ronda. Teclas: espacio pausa, R ronda nueva, Tab muestra/oculta el panel. El panel está en inglés (como el README).

const contenedor = document.getElementById('escena');
const hud = document.getElementById('hud');
const parametros = new URLSearchParams(location.search);
const porEquipo = Number(parametros.get('n')) || AGENTES_POR_EQUIPO;
let pausa = false;

addEventListener('keydown', e => {
  if (e.code === 'Space') { pausa = !pausa; e.preventDefault(); }
  if (e.code === 'KeyP') pausa = true;
  if (e.code === 'KeyR') location.reload();
  if (e.code === 'Tab') { hud.hidden = !hud.hidden; e.preventDefault(); } // sin preventDefault el foco salta fuera
});

// Textos del panel: los nombres internos (en español) a inglés.
const MODO_EN = { sigilo: 'S', caminar: 'W', correr: 'R' };
const ACCION_EN = { saquear: 'loot', recoger: 'pick up', reanimar: 'revive', confiscar: 'confiscate', devolver: 'return', sabotear: 'sabotage', reactivar: 'reactivate' };
const EQUIPO_EN = { infiltradores: 'infiltrators', guardianes: 'guards' };

async function cargarGenes() {
  try {
    const r = await fetch('mejores_genes.json', { cache: 'no-store' });
    if (!r.ok) throw new Error(r.status);
    const datos = await r.json();
    // limitarGenes lanza si el JSON es de una versión con otros genes: entonces se usan los de por defecto.
    const gi = limitarGenes(datos.mejorInfiltrador.genes, RANGOS_INFILTRADOR), gg = limitarGenes(datos.mejorGuardian.genes, RANGOS_GUARDIAN);
    return { gi, gg, origen: 'mejores_genes.json' + (datos.enCurso ? ` (gen ${datos.generacion}, still training)` : '') };
  } catch {
    return { gi: GENES_INFILTRADOR_POR_DEFECTO, gg: GENES_GUARDIAN_POR_DEFECTO, origen: 'default genes' };
  }
}

function textoHud(m, origen) {
  const equipo = lista => lista.map(a => `${a.estado === 'activo' ? MODO_EN[a.modo] : a.estado === 'inconsciente' ? 'z' : 'x'}${a.accion ? '·' + (ACCION_EN[a.accion.tipo] || a.accion.tipo) : ''}`).join(' ');
  const contactos = m.pizarras.guardianes.contactosVigentes(m.t);
  return [
    (m.enPreparacion ? `GUARDS SETTING UP: ${(m.preparacion - m.t).toFixed(1)} s` : `t ${(m.t - m.preparacion).toFixed(1)} s · ${Math.max(0, m.tiempoRestante).toFixed(1)} s left`) + `${pausa ? ' · PAUSED' : ''}${m.terminada ? ` · OVER: ${EQUIPO_EN[m.ganador]} win` : ''}`,
    `Extracted ${m.extraido.toFixed(0)} / ${BOTIN_PARA_GANAR} · on the floor ${m.suelo.reduce((s, p) => s + p.valor, 0).toFixed(0)} · gadgets I ${m.inventario.infiltradores} / G ${m.inventario.guardianes}`,
    `Infiltrators: ${equipo(m.equipos.infiltradores)} · knockdowns ${m.stats.infiltradores.derribos} · revives ${m.stats.infiltradores.reanimaciones}`,
    `Guards:       ${equipo(m.equipos.guardianes)} · knockdowns ${m.stats.guardianes.derribos} · confiscated ${m.stats.guardianes.confiscado.toFixed(0)} · on grass ${m.stats.guardianes.segundosHierba.toFixed(1)} s`,
    `Guards know: ${contactos.map(c => `#${c.id} ${c.visto ? 'SEEN' : 'last seen'}`).join(', ') || 'no contacts'} · noises ${m.pizarras.guardianes.ruidos.length}`,
    m.fitness ? `Fitness: infiltrators ${m.fitness.infiltrador.toFixed(0)} · guards ${m.fitness.guardian.toFixed(0)}` : `Genes: ${origen} · ${porEquipo} vs ${porEquipo}`,
    'S/W/R = sneak/walk/run · z knocked out · x out · space pause · R new round · Tab hide panel',
    'Mouse: drag to rotate · right button to pan · wheel to zoom · V vision cones',
  ].join('\n');
}

// Ventana de fin de ronda (centrada): quién gana, en cuánto tiempo, derribos de cada bando y R para otra ronda.
// stats.X.derribos = derribos que HIZO el bando X.
const fin = document.getElementById('fin');
function mostrarFin(m) {
  const s = m.t - m.preparacion, tiempo = `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  fin.innerHTML = `<h1 class="${m.ganador}">${m.ganador === 'infiltradores' ? 'Infiltrators win' : 'Guards win'}</h1>`
    + `<div>Round time: ${tiempo}</div>`
    + `<div><span class="infiltradores">Infiltrators</span> knocked down ${m.stats.infiltradores.derribos} guard(s)</div>`
    + `<div><span class="guardianes">Guards</span> knocked down ${m.stats.guardianes.derribos} infiltrator(s)</div>`
    + `<div class="tecla">Press R for a new round</div>`;
  fin.hidden = false;
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
    hud.textContent = textoHud(motor, origen) + `\nseed ${semilla}`;
    if (motor.terminada && fin.hidden) mostrarFin(motor);
    requestAnimationFrame(fotograma);
  };
  requestAnimationFrame(fotograma);
}).catch(e => { hud.textContent = 'Error: ' + e.message; });
