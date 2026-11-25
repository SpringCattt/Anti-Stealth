// Mapa de alturas y raycasting 2D de doble capa (DDA sobre la rejilla). Requiere config.js.
// Coordenadas en casillas: la casilla (cx, cy) ocupa [cx, cx+1) x [cy, cy+1); su centro es (cx+0.5, cy+0.5).
// En MAPA_DISENO es celdas[z][x]: cx = x, cy = z. Índice de casilla = cx + cy·ancho.

// { ancho, alto, altura, hierba, humo, marcadores } desde el objeto MAPA_DISENO de Godot.
// humo: contador por casilla de granadas activas (lo mantiene el motor); con humo > 0 la casilla tapa toda la visión.
function mapaAlturas(diseno) {
  const { ancho, alto } = diseno;
  if (diseno.celdas.length !== alto) throw new Error(`MAPA_DISENO: ${diseno.celdas.length} filas, se esperaban ${alto}`);
  const altura = new Uint8Array(ancho * alto), hierba = new Uint8Array(ancho * alto);
  diseno.celdas.forEach((fila, z) => {
    if (fila.length !== ancho) throw new Error(`MAPA_DISENO: la fila ${z} mide ${fila.length}, se esperaba ${ancho}`);
    fila.forEach((c, x) => {
      altura[x + z * ancho] = ALTURA_DE_CODIGO[c] || ALTURA.SUELO;
      hierba[x + z * ancho] = c === 'g' ? 1 : 0;
    });
  });
  return { ancho, alto, altura, hierba, humo: new Uint8Array(ancho * alto), marcadores: diseno.marcadores || {} };
}

function dentro(mapa, cx, cy) {
  return cx >= 0 && cy >= 0 && cx < mapa.ancho && cy < mapa.alto;
}

// Fuera de la rejilla cuenta como muro.
function alturaEn(mapa, cx, cy) {
  return dentro(mapa, cx, cy) ? mapa.altura[cx + cy * mapa.ancho] : ALTURA.MURO;
}

// Para la visión el humo es un muro (altura 3); para el movimiento no existe.
function alturaVisionEn(mapa, cx, cy) {
  return dentro(mapa, cx, cy) && mapa.humo[cx + cy * mapa.ancho] ? ALTURA.MURO : alturaEn(mapa, cx, cy);
}

// Se puede pisar: suelo (las cajas y los muros bloquean el paso).
function transitable(mapa, cx, cy) {
  return alturaEn(mapa, cx, cy) === ALTURA.SUELO;
}

// ¿Math.hypot(dx, dy) <= r? Mismo resultado, pero sin hypot (lento) salvo en la franja de redondeo junto al borde.
function aDistancia(dx, dy, r) {
  const d2 = dx * dx + dy * dy, r2 = r * r;
  if (d2 > r2 * (1 + 1e-9)) return false;
  if (d2 < r2 * (1 - 1e-9)) return true;
  return Math.hypot(dx, dy) <= r;
}

function celdaEn(mapa, x, y) {
  return Math.floor(x) + Math.floor(y) * mapa.ancho;
}

function centroCelda(mapa, c) {
  const cx = c % mapa.ancho;
  return [cx + 0.5, (c - cx) / mapa.ancho + 0.5];
}

// Distancia desde (x, y) en dirección ang hasta la primera celda con altura de visión >= capa, o max si no hay ninguna.
// DDA (Amanatides-Woo): salta de borde de celda en borde de celda, sin muestrear. conHumo = false: el humo no tapa.
function distanciaRayo(mapa, x, y, ang, capa, max, conHumo = true) {
  const ancho = mapa.ancho, alto = mapa.alto, altura = mapa.altura, humo = mapa.humo, MURO = ALTURA.MURO;
  const dx = Math.cos(ang), dy = Math.sin(ang);
  let cx = Math.floor(x), cy = Math.floor(y);
  const pasoX = dx > 0 ? 1 : -1, pasoY = dy > 0 ? 1 : -1;
  const deltaX = dx === 0 ? Infinity : Math.abs(1 / dx), deltaY = dy === 0 ? Infinity : Math.abs(1 / dy);
  let tX = dx === 0 ? Infinity : (dx > 0 ? cx + 1 - x : x - cx) * deltaX;
  let tY = dy === 0 ? Infinity : (dy > 0 ? cy + 1 - y : y - cy) * deltaY;
  for (;;) {
    let t;
    if (tX < tY) { cx += pasoX; t = tX; tX += deltaX; } else { cy += pasoY; t = tY; tY += deltaY; }
    if (t >= max) return max;
    // = alturaVisionEn / alturaEn en línea (fuera de la rejilla es muro; con conHumo, el humo también).
    const h = cx < 0 || cy < 0 || cx >= ancho || cy >= alto ? MURO : conHumo && humo[cx + cy * ancho] ? MURO : altura[cx + cy * ancho];
    if (h >= capa) return t;
  }
}

function lineaDeVista(mapa, x0, y0, x1, y1, capa, conHumo = true) {
  const d = Math.hypot(x1 - x0, y1 - y0);
  return d === 0 || distanciaRayo(mapa, x0, y0, Math.atan2(y1 - y0, x1 - x0), capa, d, conHumo) >= d;
}

// Diferencia angular con signo en [-PI, PI].
function difAngulo(a, b) {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}

// De pie -> de pie: rayo alto (las cajas no tapan). Cualquier otro caso: rayo bajo.
function capaVision(observador, objetivo) {
  return observador.altura === ALTURA.DE_PIE && objetivo.altura === ALTURA.DE_PIE ? RAYO_ALTO : RAYO_BAJO;
}

// obs: { x, y, angulo, altura, vision }; obj: { x, y, altura }. Sirve igual para agentes y cámaras.
// 0 = no lo ve. Si lo ve: 1 sin caída de luz; con caída, de 1 (pegado) a LUZ_MIN (borde del alcance).
function intensidadVision(mapa, obs, obj) {
  const v = obs.vision;
  if (!aDistancia(obj.x - obs.x, obj.y - obs.y, v.alcance)) return 0;
  const d = Math.hypot(obj.x - obs.x, obj.y - obs.y);
  if (d > 0 && Math.abs(difAngulo(Math.atan2(obj.y - obs.y, obj.x - obs.x), obs.angulo)) > v.apertura / 2) return 0;
  // El humo tapa a Guardianes y cámaras (salvo a <= HUMO.vistaCerca: se distingue la silueta); los Infiltradores
  // ven a través de él. Muros y cajas tapan a todos.
  if (!lineaDeVista(mapa, obs.x, obs.y, obj.x, obj.y, capaVision(obs, obj), tapaHumo(obs, d))) return 0;
  return v.caida ? 1 - (1 - LUZ_MIN) * d / v.alcance : 1;
}

// ¿Le tapa el humo la vista a este observador a distancia d? (agentes y cámaras; obs.equipo puede faltar = Guardián)
function tapaHumo(obs, d) {
  return obs.equipo !== 'infiltradores' && d > HUMO.vistaCerca;
}

// Solo para dibujar: [[x, y, d], ...] de los rayos del cono en la capa dada, de borde a borde.
function poligonoVision(mapa, obs, capa) {
  const { apertura, alcance } = obs.vision, n = Math.ceil(apertura / PASO_RAYO_RENDER), puntos = [];
  for (let i = 0; i <= n; i++) {
    const a = obs.angulo - apertura / 2 + apertura * i / n, d = distanciaRayo(mapa, obs.x, obs.y, a, capa, alcance, obs.equipo !== 'infiltradores');
    puntos.push([obs.x + Math.cos(a) * d, obs.y + Math.sin(a) * d, d]);
  }
  return puntos;
}

// Casillas transitables cuyo centro ilumina el observador (alguien de pie ahí sería visible: rayo alto).
// Marca 1 en "luz" (Uint8Array del tamaño del mapa). Solo recorre el cuadrado del alcance. lista (opcional) recibe
// las casillas marcadas por primera vez.
function marcarIluminadas(mapa, obs, luz, lista = null) {
  const r = Math.ceil(obs.vision.alcance), cx0 = Math.floor(obs.x), cy0 = Math.floor(obs.y);
  const punto = { x: 0, y: 0, altura: ALTURA.DE_PIE };
  const ojo = { x: obs.x, y: obs.y, angulo: obs.angulo, altura: ALTURA.DE_PIE, vision: obs.vision };
  for (let cy = Math.max(0, cy0 - r); cy <= Math.min(mapa.alto - 1, cy0 + r); cy++) {
    for (let cx = Math.max(0, cx0 - r); cx <= Math.min(mapa.ancho - 1, cx0 + r); cx++) {
      const c = cx + cy * mapa.ancho;
      if (luz[c] || mapa.altura[c] !== ALTURA.SUELO) continue; // = !transitable (cx, cy ya está dentro)
      punto.x = cx + 0.5; punto.y = cy + 0.5;
      if (intensidadVision(mapa, ojo, punto) > 0) { luz[c] = 1; if (lista) lista.push(c); }
    }
  }
}
