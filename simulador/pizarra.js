// Pizarra compartida por equipo (radio). Requiere config.js.
// Lo nuevo que se publica llega a cada miembro como estímulo con RETARDO_REACCION_S (Agente.recibirEstimulo).

class TeamBlackboard {
  // nCeldas: tamaño del mapa, para la huella de luz (último instante en que se vio iluminada cada casilla).
  constructor(equipo, nCeldas) {
    this.equipo = equipo;
    this.miembros = [];
    this.contactos = new Map(); // id del enemigo -> { x, y, t } (t = último instante visto)
    this.ruidos = [];           // { x, y, radio, t }
    this.caidos = [];           // { agente, x, y, t } mientras el aliado siga inconsciente
    this.luzVista = new Float64Array(nCeldas).fill(-Infinity);
    this.camarasCaidas = new Set(); // cámaras propias que algún miembro ha visto saboteadas (Guardianes)
    this.sensoresVistos = new Set(); // sensores enemigos que algún miembro ha visto (Infiltradores)
    this.marcas = new Map();          // casilla -> último instante en que se vio a un enemigo ahí (memoria de patrullas)
  }

  // Contacto visual: posición exacta cada tick mientras se ve; al perderse queda como LKP durante LKP_S.
  // Guarda también la velocidad estimada (suavizada) para anticipar hacia dónde va, y apunta la casilla en la
  // memoria de avistamientos (marcas: celda -> último instante visto).
  publicarContacto(id, x, y, t, celda = -1) {
    const previo = this.contactos.get(id);
    let vx = 0, vy = 0;
    if (previo && t > previo.t && t - previo.t <= 1) {
      const dt = t - previo.t;
      vx = 0.8 * (previo.vx || 0) + 0.2 * (x - previo.x) / dt;
      vy = 0.8 * (previo.vy || 0) + 0.2 * (y - previo.y) / dt;
    } else if (previo && t === previo.t) { vx = previo.vx || 0; vy = previo.vy || 0; }
    this.contactos.set(id, { x, y, t, vx, vy });
    if (celda >= 0) this.marcas.set(celda, t);
    if (!previo || t - previo.t > LKP_S) this.avisar(x, y, 'contacto');
  }

  publicarRuido(x, y, radio, t) {
    this.ruidos.push({ x, y, radio, t });
    this.avisar(x, y, 'ruido');
  }

  publicarCaido(agente, t) {
    this.caidos.push({ agente, x: agente.x, y: agente.y, t });
    this.avisar(agente.x, agente.y, 'caido');
  }

  avisar(x, y, tipo) {
    for (const m of this.miembros) m.recibirEstimulo(x, y, tipo);
  }

  // Contactos aún válidos; visto = se ve en este mismo instante, si no es Last Known Position.
  contactosVigentes(t) {
    return [...this.contactos].map(([id, c]) => ({ id, ...c, visto: c.t === t }));
  }

  // Puntos que encarecen el A* de este equipo: contactos, ruidos enemigos y caídos recientes.
  puntosPeligro(t) {
    const caidos = this.caidos.filter(c => t - c.t <= PELIGRO_CAIDO_S);
    return [...this.contactos.values(), ...this.ruidos, ...caidos];
  }

  limpiar(t) {
    for (const [c, tm] of this.marcas) if (t - tm > MEMORIA_PATRULLA_S) this.marcas.delete(c);
    for (const [id, c] of this.contactos) if (t - c.t > LKP_S) this.contactos.delete(id);
    this.ruidos = this.ruidos.filter(r => t - r.t <= RUIDO_MEMORIA_S);
    this.caidos = this.caidos.filter(c => c.agente.estado === 'inconsciente');
  }
}
