// IA del Guardián. Requiere agente.js y red.js. Cada TICKS_DECISION su red (genes p0, p1, ...) elige una acción de
// ACCIONES_GUA y un modo (MODOS_RED) a partir de observar(). La acción 0, "rutina", es la IA programada de abajo; las
// demás fuerzan una conducta (custodiar el botín amenazado, cortar la salida, buscar, esperar, patrullar, investigar).
// Rutina, prioridades en cada tick (la primera que aplica gana):
//  1. Enemigo a la vista: lo encara; se acerca hasta 0.8·rango del aturdidor (el motor carga la barra mientras lo ve).
//  2. Lleva botín confiscado: lo devuelve al punto B más cercano (DEVOLVER_S).
//  3. Ve un cuerpo infiltrador con bolsa o botín en el suelo: va y lo confisca (CONFISCAR_S).
//  4. Vigía (gen vigias): se queda en su punto B. Si alguien fue visto con botín, el libre más cercano corta su salida.
//  4b. Reanimar a un compañero caído o acudir a una alerta de la pizarra (el orden lo decide prioridad_reanimar).
//     A cada alerta acuden solo los round(investigar · activos) Guardianes más cercanos (mínimo 1).
//  5. Patrulla G -> cada B -> G; en cada punto barre ±sweepAngle/2 durante (1 - patrol_bias) · VIGILANCIA_MAX_S.
// Con HIERBA_PROHIBIDA_GUARDIAN la hierba exterior le cuesta COSTE_HIERBA_GUARDIAN en el A* (si no, sale libremente).

class Guardian extends Agente {
  // punto: índice inicial en motor.patrulla. fase: desfase del barrido (rad), para que no barran todos a la vez.
  constructor(id, x, y, angulo, pizarra, genes, punto, fase) {
    super(id, 'guardianes', x, y, angulo, pizarra, genes);
    this.punto = punto;
    this.fase = fase;
    this.vigilancia = 0; // s que lleva vigilando el punto de patrulla actual
    this.pendientes = []; // gadgets que debe colocar en la preparación: { tipo, celda }
  }

  costeRuta(motor) {
    return motor.costeGuardianes;
  }

  pensar(motor) {
    if (motor.enPreparacion) return this.preparar(motor);
    if (motor.ticks >= (this.proximaDecision ?? 0)) {
      const s = evaluarRed(this.genes, this.observar(motor), ACCIONES_GUA.length + MODOS_RED.length);
      this.accionRed = elegir(s, 0, ACCIONES_GUA.length);
      this.modoRed = elegir(s, ACCIONES_GUA.length, MODOS_RED.length);
      this.proximaDecision = motor.ticks + TICKS_DECISION;
    }
    const accion = ACCIONES_GUA[this.accionRed];
    if (accion !== 'custodiar') this.custodiando = null;
    if (accion !== 'emboscarSalida') this.emboscando = null;
    this[accion](motor);
    if (MODOS_RED[this.modoRed]) this.modo = MODOS_RED[this.modoRed];
  }

  // Lo que sabe el Guardián, en [0, 1] (ENTRADAS_GUA valores): lo que ve y su pizarra.
  observar(motor) {
    const p = this.pizarra, t = motor.t, alertas = [...p.contactos.values(), ...p.ruidos];
    const nueva = alertas.length ? alertas.reduce((a, b) => (a.t >= b.t ? a : b)) : null;
    const total = VALOR_BOTIN * Math.max(1, motor.puntosB.length);
    let queda = 0;
    for (const v of motor.botines.values()) queda += v;
    const [bx, by] = centroCelda(motor.mapa, this.botinAmenazado(motor));
    return [
      this.enemigoVisto ? 1 : 0,
      this.enemigoVisto ? 1 - Math.min(this.distanciaA(this.enemigoVisto), 10) / 10 : 0,
      p.contactos.size ? 1 : 0,
      nueva ? Math.max(0, 1 - (t - nueva.t) / LKP_S) : 0,
      nueva ? 1 - Math.min(this.distanciaA(nueva), 30) / 30 : 0,
      p.ruidos.length ? 1 : 0,
      p.caidos.length ? 1 : 0,
      p.camarasCaidas.size ? 1 : 0,
      this.bolsa > 0 ? 1 : 0,
      this.botinVisible(motor) ? 1 : 0,
      Math.max(0, 1 - queda / total),
      Math.max(0, motor.tiempoRestante) / TIEMPO_RONDA_S,
      1 - Math.min(Math.hypot(bx - this.x, by - this.y), 40) / 40,
      this.barra.valor / BARRA_MAX,
      Math.min(1, motor.equipos.guardianes.filter(a => a.activo).length / AGENTES_POR_EQUIPO),
      (this.accionRed || 0) / ACCIONES_GUA.length,
      this.aguante / AGUANTE.max,
      [...p.contactos.values()].some(c => c.botin) ? 1 : 0,
    ];
  }

  // Botín más amenazado: el punto B más cercano a la alerta más reciente; sin alertas, el que más botín ha perdido;
  // si no falta botín en ninguno, el más cercano.
  botinAmenazado(motor) {
    const p = this.pizarra, alertas = [...p.contactos.values(), ...p.ruidos];
    if (alertas.length) { const a = alertas.reduce((x, y) => (x.t >= y.t ? x : y)); return this.masCercanaA(motor, motor.puntosB, a.x, a.y); }
    const robado = motor.puntosB.reduce((m, b) => (motor.botines.get(b) < motor.botines.get(m) ? b : m), motor.puntosB[0]);
    return motor.botines.get(robado) < VALOR_BOTIN ? robado : this.masCercana(motor, motor.puntosB);
  }

  // --- Acciones de la red (la 0, rutina, es la IA programada) ---
  // Custodiar: va al botín más amenazado y se queda allí girando despacio (si otro ya lo custodia, desde un flanco).
  custodiar(motor) {
    const b = this.botinAmenazado(motor), [x, y] = centroCelda(motor.mapa, b);
    const antes = motor.equipos.guardianes.filter(o => o !== this && o.activo && o.custodiando === b && o.id < this.id).length;
    this.custodiando = b;
    if (this.irA(motor, antes ? this.celdaFlanco(motor.mapa, { x, y }, antes, antes + 1) : b)) this.anguloDeseado = this.fase + motor.t * 0.8;
  }
  cortarYa(motor) { if (!this.cortar(motor, true)) this.rutina(motor); }
  buscarYa(motor) {
    if (!this.busqueda) {
      const alertas = [...this.pizarra.contactos.values(), ...this.pizarra.ruidos];
      const a = alertas.length ? alertas.reduce((x, y) => (x.t >= y.t ? x : y)) : this;
      this.empezarBusqueda(motor, a.x, a.y, Math.max(this.genes.busqueda_s, 5));
    }
    if (!this.buscar(motor)) this.rutina(motor);
  }
  esperar(motor) {
    this.parar();
    this.anguloDeseado = this.fase + motor.t * 0.8;
  }
  investigarYa(motor) { if (!this.investigar(motor)) this.rutina(motor); }

  // Emboscar: espera en la esquina de extracción más cercana al botín amenazado, mirando hacia la casa. Si ya hay
  // otros emboscando, cada uno coge la siguiente esquina por cercanía.
  emboscarSalida(motor) {
    if (this.enemigoVisto) return this.perseguir(motor, this.enemigoVisto);
    const [bx, by] = centroCelda(motor.mapa, this.botinAmenazado(motor)), esquinas = this.esquinas(motor);
    const orden = [...esquinas].sort((a, b) => Math.hypot(a.x - bx, a.y - by) - Math.hypot(b.x - bx, b.y - by));
    const antes = motor.equipos.guardianes.filter(o => o !== this && o.activo && o.emboscando && o.id < this.id).length;
    const e = orden[antes % orden.length];
    this.emboscando = e;
    this.modo = Math.hypot(e.x - this.x, e.y - this.y) > this.genes.umbral_correr ? 'correr' : 'caminar';
    if (this.irA(motor, e.celda)) this.anguloDeseado = Math.atan2(motor.mapa.alto / 2 - this.y, motor.mapa.ancho / 2 - this.x) + Math.sin(this.fase + motor.t) * 0.4;
  }

  // Una casilla por esquina de extracción: la más cercana al centro del mapa (calculado una vez por partida).
  esquinas(motor) {
    if (motor.esquinas) return motor.esquinas;
    const mapa = motor.mapa, mx = mapa.ancho / 2, my = mapa.alto / 2, porEsquina = new Map();
    for (const c of motor.extraccion) {
      const [x, y] = centroCelda(mapa, c), k = (x < mx ? 0 : 1) + (y < my ? 0 : 2), d = Math.hypot(x - mx, y - my);
      if (!porEsquina.has(k) || d < porEsquina.get(k).d) porEsquina.set(k, { celda: c, x, y, d });
    }
    return (motor.esquinas = [...porEsquina.values()]);
  }

  // Perseguir al que lleva botín: si lo ve, a por él; si no, a donde se le vio cargando por última vez (anticipado).
  perseguirCargado(motor) {
    if (this.enemigoVisto && this.enemigoVisto.bolsa > 0) return this.perseguir(motor, this.enemigoVisto);
    const cargados = [...this.pizarra.contactos.values()].filter(c => c.botin);
    if (!cargados.length) return this.rutina(motor);
    const c = cargados.reduce((a, b) => (a.t >= b.t ? a : b)), destino = this.prediccion(motor, c);
    this.modo = 'correr';
    if (this.irA(motor, celdaEn(motor.mapa, destino.x, destino.y))) this.descartarAlerta(c);
  }

  // --- Rutina: la IA programada (acción 0) ---
  rutina(motor) {
    const g = this.genes;
    if (this.enemigoVisto) return this.perseguir(motor, this.enemigoVisto);
    if (this.bolsa > 0) {
      this.modo = 'caminar';
      const b = this.masCercana(motor, motor.puntosB);
      if (b !== undefined && this.irA(motor, b)) motor.iniciarAccion(this, 'devolver', b);
      return;
    }
    const botin = this.botinVisible(motor);
    this.objetivoBotin = botin ? botin.objetivo : null;
    if (botin) {
      this.modo = 'caminar';
      if (this.irA(motor, botin.celda)) motor.iniciarAccion(this, botin.tipo, botin.objetivo);
      return;
    }
    if (this.vigilarBotin(motor)) return;
    const cargado = this.cargadoReciente();
    if (cargado && this.cortar(motor, true, cargado)) return; // al que lleva botín se le espera en su salida
    if (this.buscar(motor)) return;
    let tareas = g.prioridad_reanimar >= 0.5 ? [this.reanimarAliado, this.investigar] : [this.investigar, this.reanimarAliado];
    tareas = g.prioridad_camaras >= 0.5 ? [this.reactivarCamara, ...tareas] : [...tareas, this.reactivarCamara];
    for (const tarea of tareas) if (tarea.call(this, motor)) return;
    if (this.cortar(motor)) return;
    this.cortando = null;
    this.enPuerta = 0;
    this.patrullar(motor);
  }

  // Preparación: corre a dejar cada gadget pendiente (sin enemigos el ruido no importa) y luego ocupa su puesto.
  preparar(motor) {
    if (!this.pendientes.length) return this.patrullar(motor);
    this.modo = 'correr';
    if (this.irA(motor, this.pendientes[0].celda)) colocarGadget(motor, this);
  }

  // --- Anticipación: punto donde estará un contacto (posición + velocidad · (antigüedad + anticipacion · 2 s)), a como
  // mucho 8 casillas, recortado en el primer obstáculo. Los ruidos no tienen velocidad: su propio punto.
  prediccion(motor, al) {
    if (!al.vx && !al.vy) return { x: al.x, y: al.y };
    const h = Math.min(4, motor.t - al.t + this.genes.anticipacion * 2), dx = al.vx * h, dy = al.vy * h, d = Math.hypot(dx, dy);
    if (d < 0.5) return { x: al.x, y: al.y };
    let lejos = Math.max(0, Math.min(d, 8, distanciaRayo(motor.mapa, al.x, al.y, Math.atan2(dy, dx), RAYO_ALTO, 8) - 0.5));
    const punto = () => ({ x: al.x + dx / d * lejos, y: al.y + dy / d * lejos });
    while (lejos > 0 && !transitable(motor.mapa, Math.floor(punto().x), Math.floor(punto().y))) lejos = Math.max(0, lejos - 1); // encima de una caja
    return punto();
  }

  // --- Búsqueda: tras revisar una alerta sin ver a nadie, recorre hasta 4 escondites cercanos (casillas a <= RADIO_BUSQUEDA
  // que no se ven a ras de suelo desde el punto: detrás de cajas y esquinas), durante busqueda_s.
  empezarBusqueda(motor, x, y, duracion = this.genes.busqueda_s) {
    if (duracion <= 0) return;
    const mapa = motor.mapa, escondites = [];
    for (const c of celdasEnRadio(mapa, x, y, RADIO_BUSQUEDA)) {
      const cx = c % mapa.ancho, cy = (c - cx) / mapa.ancho;
      if (transitable(mapa, cx, cy) && !lineaDeVista(mapa, x, y, cx + 0.5, cy + 0.5, RAYO_BAJO)) escondites.push(c);
    }
    const puntos = [];
    let px = x, py = y;
    while (puntos.length < 4 && escondites.length) { // el más cercano al último elegido
      let k = 0, dMin = Infinity;
      escondites.forEach((c, i) => { const [ex, ey] = centroCelda(mapa, c), d = Math.hypot(ex - px, ey - py); if (d < dMin) { dMin = d; k = i; } });
      const [c] = escondites.splice(k, 1);
      puntos.push(c);
      [px, py] = centroCelda(mapa, c);
    }
    this.busqueda = { desde: motor.t, hasta: motor.t + duracion, puntos };
  }

  buscar(motor) {
    const b = this.busqueda, p = this.pizarra;
    // Algo nuevo en la pizarra (contacto, ruido o caído posterior al inicio) manda más que seguir registrando escondites.
    const nuevo = [...p.contactos.values(), ...p.ruidos, ...p.caidos].some(a => a.t > (b ? b.desde : Infinity));
    if (!b || nuevo || motor.t >= b.hasta || !b.puntos.length) { this.busqueda = null; return false; }
    this.modo = 'caminar';
    if (this.irA(motor, b.puntos[0])) { b.puntos.shift(); this.mirarAtras = Math.max(this.mirarAtras, 0.5); }
    return true;
  }

  // --- Corte: con un contacto vigente, el Guardián libre más cercano va a la puerta por la que saldría hacia su
  // extracción más cercana (primera casilla de jardín de esa ruta) y espera ahí barriendo con la linterna hacia dentro.
  // Como mucho CORTE_MAX_S en la puerta; después no vuelve a cortar hasta pasados CORTE_ENFRIAMIENTO_S.
  cortar(motor, forzado = false, contacto = null) {
    if ((!forzado && this.genes.cortar < 0.5) || motor.t < (this.corteLibreDesde ?? -Infinity)) return false;
    const contactos = [...this.pizarra.contactos.values()];
    if (!contactos.length) return false;
    const c = contacto || contactos.reduce((a, b) => (a.t >= b.t ? a : b)), mapa = motor.mapa, origen = celdaEn(mapa, c.x, c.y);
    const cache = motor.cortes ??= new Map();
    if (!cache.has(origen)) {
      const ext = this.masCercanaA(motor, motor.extraccion, c.x, c.y), ruta = ext === undefined ? null : buscarRuta(mapa, origen, ext);
      let puerta = null, previa = origen;
      for (const k of ruta || []) { if (mapa.hierba[k]) { puerta = previa; break; } previa = k; }
      cache.set(origen, puerta);
    }
    const puerta = cache.get(origen);
    if (puerta === null) return false;
    // Solo uno corta: el libre más cercano a la puerta (los demás siguen con lo suyo).
    const [px, py] = centroCelda(mapa, puerta), d = Math.hypot(px - this.x, py - this.y);
    if (motor.equipos.guardianes.some(o => o !== this && o.activo && o.cortando === puerta && Math.hypot(px - o.x, py - o.y) < d)) return false;
    this.cortando = puerta;
    this.modo = d > this.genes.umbral_correr ? 'correr' : 'caminar';
    if (this.irA(motor, puerta)) {
      this.enPuerta = (this.enPuerta || 0) + DT;
      if (this.enPuerta >= CORTE_MAX_S) { this.enPuerta = 0; this.cortando = null; this.corteLibreDesde = motor.t + CORTE_ENFRIAMIENTO_S; return false; }
      const base = Math.atan2(c.y - this.y, c.x - this.x); // barrido de ±sweepAngle/2 mirando hacia el contacto
      this.anguloDeseado = base + Math.sin(this.fase + this.enPuerta * 1.5) * this.genes.sweepAngle / 2;
    }
    return true;
  }

  // Contacto más reciente de alguien visto con botín (null si no hay).
  cargadoReciente() {
    const cargados = [...this.pizarra.contactos.values()].filter(c => c.botin);
    return cargados.length ? cargados.reduce((a, b) => (a.t >= b.t ? a : b)) : null;
  }

  // Vigías: los round(vigias · activos) Guardianes activos de menor id se quedan cada uno en un punto B que
  // aún tenga botín (los más llenos primero) en vez de patrullar; si son más que los puntos, desde un flanco.
  vigilarBotin(motor) {
    const activos = motor.equipos.guardianes.filter(a => a.activo), k = activos.indexOf(this);
    if (k >= Math.round(this.genes.vigias * activos.length)) return false;
    const puntos = motor.puntosB.filter(b => motor.botines.get(b) > 0).sort((a, b) => motor.botines.get(b) - motor.botines.get(a));
    if (!puntos.length) return false;
    const b = puntos[k % puntos.length], vuelta = Math.floor(k / puntos.length), [x, y] = centroCelda(motor.mapa, b);
    this.modo = 'caminar';
    if (this.irA(motor, vuelta ? this.celdaFlanco(motor.mapa, { x, y }, vuelta, vuelta + 1) : b)) this.anguloDeseado = this.fase + motor.t * 0.8;
    return true;
  }

  masCercanaA(motor, celdas, x, y) {
    let mejor, dMin = Infinity;
    for (const c of celdas) { const [cx, cy] = centroCelda(motor.mapa, c), d = Math.hypot(cx - x, cy - y); if (d < dMin) { dMin = d; mejor = c; } }
    return mejor;
  }

  perseguir(motor, e) {
    this.busqueda = null;
    const d = this.distanciaA(e);
    this.modo = d > this.genes.umbral_correr ? 'correr' : 'caminar';
    if (d > ATURDIDOR.rango * 0.8) this.irA(motor, celdaEn(motor.mapa, e.x, e.y));
    else this.parar();
    this.anguloDeseado = Math.atan2(e.y - this.y, e.x - this.x);
  }

  // Casilla de la lista más cercana en línea recta (undefined si la lista está vacía).
  masCercana(motor, celdas) {
    return this.masCercanaA(motor, celdas, this.x, this.y);
  }

  // Cuerpos infiltradores con bolsa y montones del suelo que ve (alcance de su luz y línea de vista a ras de suelo).
  botinVisible(motor) {
    const candidatos = [
      ...motor.equipos.infiltradores.filter(i => !i.activo && i.bolsa > 0).map(i => ({ tipo: 'confiscar', objetivo: i, x: i.x, y: i.y })),
      ...motor.suelo.map(p => ({ tipo: 'recoger', objetivo: p, x: p.x, y: p.y })),
    ];
    // Lo que ya tiene otro Guardián (en curso o de camino) no se repite.
    const cogidos = new Set(motor.equipos.guardianes.filter(a => a !== this && a.activo).map(a => a.accion ? a.accion.objetivo : a.objetivoBotin));
    let mejor = null, dMin = Infinity;
    for (const c of candidatos) {
      const d = this.distanciaA(c);
      if (cogidos.has(c.objetivo)) continue;
      if (d < dMin && d <= this.vision.alcance && lineaDeVista(motor.mapa, this.x, this.y, c.x, c.y, RAYO_BAJO)) {
        dMin = d;
        mejor = { ...c, celda: celdaEn(motor.mapa, c.x, c.y) };
      }
    }
    return mejor;
  }

  // A cada caído va solo el Guardián activo más cercano (reanima uno; los demás siguen con lo suyo).
  reanimarAliado(motor) {
    const otros = motor.equipos.guardianes.filter(a => a.activo && a !== this);
    let mejor = null, dMin = Infinity;
    for (const c of this.pizarra.caidos) {
      const d = this.distanciaA(c.agente);
      const otroMasCerca = otros.some(a => a.distanciaA(c.agente) < d || (a.distanciaA(c.agente) === d && a.id < this.id));
      if (c.agente !== this && !otroMasCerca && d < dMin) { dMin = d; mejor = c.agente; }
    }
    if (!mejor) return false;
    this.modo = dMin > this.genes.umbral_correr ? 'correr' : 'caminar';
    if (dMin <= RANGO_INTERACCION || this.irA(motor, celdaEn(motor.mapa, mejor.x, mejor.y))) motor.iniciarAccion(this, 'reanimar', mejor);
    return true;
  }

  // Cámara saboteada que algún Guardián ha visto (pizarra): va el Guardián activo más cercano y la reactiva.
  reactivarCamara(motor) {
    const otros = motor.equipos.guardianes.filter(a => a.activo && a !== this);
    let mejor = null, dMin = Infinity;
    for (const c of this.pizarra.camarasCaidas) {
      if (!c.saboteada) continue;
      const d = this.distanciaA(c);
      if (d < dMin && !otros.some(a => a.distanciaA(c) < d || (a.distanciaA(c) === d && a.id < this.id))) { dMin = d; mejor = c; }
    }
    if (!mejor) return false;
    this.modo = dMin > this.genes.umbral_correr ? 'correr' : 'caminar';
    if (dMin <= RANGO_INTERACCION || this.irA(motor, celdaEn(motor.mapa, mejor.x, mejor.y))) motor.iniciarAccion(this, 'reactivar', mejor);
    return true;
  }

  // Alertas de la pizarra (contactos y ruidos) a las que este Guardián es de los más cercanos. Va a la más reciente
  // (a igualdad, la más cercana): un rastro de ruidos nuevo pesa más que una LKP vieja, p. ej. dentro de un humo.
  investigar(motor) {
    const activos = motor.equipos.guardianes.filter(a => a.activo);
    const acuden = Math.max(1, Math.round(this.genes.investigar * activos.length));
    const alertas = [...this.pizarra.contactos.values(), ...this.pizarra.ruidos];
    let mejor = null, dMin = Infinity, puesto = 0;
    for (const al of alertas) {
      const d = this.distanciaA(al);
      const masCerca = activos.filter(a => a !== this && (a.distanciaA(al) < d || (a.distanciaA(al) === d && a.id < this.id))).length;
      if (masCerca < acuden && (!mejor || al.t > mejor.t || (al.t === mejor.t && d < dMin))) { dMin = d; mejor = al; puesto = masCerca; }
    }
    if (!mejor) return false;
    const g = this.genes;
    this.modo = dMin > g.umbral_correr ? 'correr' : dMin < g.umbral_sigilo ? 'sigilo' : 'caminar';
    // El más cercano revisa el punto; los demás lo rodean a FLANCO_ALERTA casillas, cada uno por un lado, y lo encaran.
    const destino = this.prediccion(motor, mejor);
    if (puesto === 0) {
      if (this.irA(motor, celdaEn(motor.mapa, destino.x, destino.y))) { this.descartarAlerta(mejor); this.empezarBusqueda(motor, destino.x, destino.y); }
    } else if (this.irA(motor, this.celdaFlanco(motor.mapa, mejor, puesto, acuden))) {
      this.anguloDeseado = Math.atan2(mejor.y - this.y, mejor.x - this.x);
    }
    return true;
  }

  // Casilla transitable a ~FLANCO_ALERTA del punto, en el ángulo puesto · 2π / n (la propia del punto si no hay).
  celdaFlanco(mapa, p, puesto, n) {
    const ang = puesto * 2 * Math.PI / n;
    for (let r = FLANCO_ALERTA; r >= 1; r -= 0.5) {
      const x = p.x + Math.cos(ang) * r, y = p.y + Math.sin(ang) * r;
      if (transitable(mapa, Math.floor(x), Math.floor(y)) && lineaDeVista(mapa, x, y, p.x, p.y, RAYO_ALTO)) return celdaEn(mapa, x, y);
    }
    return celdaEn(mapa, p.x, p.y);
  }

  // Llegó a la alerta y no ve a nadie (si viera a alguien estaría persiguiendo): ya está revisada para todo el equipo.
  descartarAlerta(alerta) {
    const p = this.pizarra;
    for (const [id, c] of p.contactos) if (c === alerta) p.contactos.delete(id);
    p.ruidos = p.ruidos.filter(r => r !== alerta);
  }

  patrullar(motor) {
    const ruta = motor.patrulla, puesto = this.punto % ruta.length;
    // Con más Guardianes que puestos se comparten: el que no es el primero (por id) vigila desde un flanco del puesto.
    const antes = motor.equipos.guardianes.filter(a => a.activo && a !== this && a.punto % ruta.length === puesto && a.id < this.id).length;
    let destino = ruta[puesto];
    if (antes) {
      const [px, py] = centroCelda(motor.mapa, destino);
      destino = this.celdaFlanco(motor.mapa, { x: px, y: py }, antes, antes + 1);
    }
    this.modo = 'caminar';
    if (!this.irA(motor, destino)) { this.vigilancia = 0; return; }
    const [sx, sy] = centroCelda(motor.mapa, ruta[(this.punto + 1) % ruta.length]);
    const base = Math.atan2(sy - this.y, sx - this.x);
    this.vigilancia += DT;
    this.anguloDeseado = base + Math.sin(this.fase + this.vigilancia * 1.5) * this.genes.sweepAngle / 2;
    if (this.vigilancia >= (1 - this.genes.patrol_bias) * VIGILANCIA_MAX_S) {
      // Siguiente puesto que no tenga ya otro Guardián activo (si están todos cogidos, el siguiente sin más).
      const ocupados = new Set(motor.equipos.guardianes.filter(a => a.activo && a !== this).map(a => a.punto % ruta.length));
      let k = 1;
      while (k < ruta.length && ocupados.has((this.punto + k) % ruta.length)) k++;
      this.punto = (this.punto + (k < ruta.length ? k : 1)) % ruta.length;
      this.vigilancia = 0;
    }
  }
}
