/* Encuentra tablas en una página a partir de la posición del texto. Sin librerías.
   La idea viene de Camelot (camelot-dev, licencia MIT), en su modo «stream»; aquí está escrita
   desde cero para el navegador y no reutiliza su código.

   Entrada: los trozos de texto de una página, cada uno con su caja:
     { t: 'texto', x: izquierda, y: línea base (medida desde arriba), w: ancho, h: alto de la letra }
   Pasos:
     1. Renglones: trozos con la misma altura en la página.
     2. Segmentos: dentro de un renglón, los trozos pegados forman una celda candidata.
     3. Bloques: renglones seguidos con dos o más segmentos son una tabla candidata.
     4. Columnas: las franjas verticales donde ningún renglón del bloque tiene texto son los cortes.
     5. Filas: cada renglón es una fila; los renglones partidos de una misma celda se pueden unir. */
(function (raiz) {
  'use strict';

  function mediana(a) {
    if (!a.length) return 0;
    var b = a.slice().sort(function (p, q) { return p - q; });
    var m = b.length >> 1;
    return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2;
  }

  /* 1 y 2. Renglones con sus segmentos. */
  function renglones(trozos) {
    var utiles = trozos.filter(function (i) { return i.t && i.t.trim() && i.h > 0; });
    utiles.sort(function (a, b) { return a.y - b.y || a.x - b.x; });
    var lista = [];
    utiles.forEach(function (i) {
      var r = lista.length ? lista[lista.length - 1] : null;
      if (r && Math.abs(i.y - r.y) <= Math.min(i.h, r.h) * 0.35) {
        r.trozos.push(i);
        r.y = (r.y * (r.trozos.length - 1) + i.y) / r.trozos.length;
        r.h = Math.max(r.h, i.h);
      } else {
        lista.push({ y: i.y, h: i.h, trozos: [i] });
      }
    });
    lista.forEach(function (r) {
      r.trozos.sort(function (a, b) { return a.x - b.x; });
      r.segs = [];
      r.trozos.forEach(function (i) {
        var s = r.segs.length ? r.segs[r.segs.length - 1] : null;
        var hueco = s ? i.x - s.x1 : Infinity;
        // Un espacio entre palabras mide cerca de un cuarto del alto de la letra; entre columnas hay más.
        if (s && hueco < Math.max(i.h, s.h) * 0.6) {
          var pegar = hueco > Math.min(i.h, s.h) * 0.12 && !/\s$/.test(s.t) && !/^\s/.test(i.t);
          s.t += (pegar ? ' ' : '') + i.t;
          s.x1 = Math.max(s.x1, i.x + i.w);
          s.h = Math.max(s.h, i.h);
        } else {
          r.segs.push({ t: i.t, x0: i.x, x1: i.x + i.w, h: i.h, y: r.y });
        }
      });
      r.segs.forEach(function (s) { s.t = s.t.replace(/\s+/g, ' ').trim(); });
      r.segs = r.segs.filter(function (s) { return s.t; });
    });
    return lista.filter(function (r) { return r.segs.length; });
  }

  /* 3. Bloques: tramos de renglones seguidos que parecen tabla. */
  function recortar(b) {
    // De las puntas salen los renglones de un solo segmento (títulos, notas, texto corrido), salvo los que
    // están pegados a un renglón de la tabla: esos son parte de una celda cuyo texto ocupó varios renglones.
    var primero = -1, ultimo = -1;
    b.forEach(function (r, k) { if (r.segs.length >= 2) { if (primero < 0) primero = k; ultimo = k; } });
    if (primero < 0) return null;
    var ini = primero, fin = ultimo;
    while (ini > 0 && b[ini].y - b[ini - 1].y < Math.max(b[ini].h, b[ini - 1].h) * 1.0) ini--;
    while (fin < b.length - 1 && b[fin + 1].y - b[fin].y < Math.max(b[fin].h, b[fin + 1].h) * 1.5) fin++;
    var c = b.slice(ini, fin + 1);
    return c.filter(function (r) { return r.segs.length >= 2; }).length >= 2 ? c : null;
  }

  function bloques(lista) {
    var out = [], actual = null;
    function cerrar() {
      var c = actual ? recortar(actual) : null;
      if (c) out.push(c);
      actual = null;
    }
    lista.forEach(function (r, k) {
      if (actual) {
        var previo = actual[actual.length - 1];
        // Un salto grande (más de tres renglones de alto) corta la tabla.
        if (r.y - previo.y > Math.max(r.h, previo.h) * 3.6) cerrar();
      }
      if (!actual) {
        if (r.segs.length < 2) return;
        var antes = k > 0 ? lista[k - 1] : null;
        actual = antes && antes.segs.length < 2 && r.y - antes.y < Math.max(r.h, antes.h) ? [antes, r] : [r];
        return;
      }
      // Tres renglones seguidos de un solo segmento: ya es texto corrido, no tabla.
      var n = actual.length;
      if (r.segs.length < 2 && n >= 2 && actual[n - 1].segs.length < 2 && actual[n - 2].segs.length < 2) { cerrar(); return; }
      actual.push(r);
    });
    cerrar();
    return out;
  }

  /* 4. Columnas de un bloque.
     a) Se cuenta, punto por punto a lo ancho, cuántos renglones tienen texto ahí.
     b) Las franjas con texto en varios renglones son columnas; se tolera que uno que otro renglón
        cruce un corte (un título que abarca dos columnas, una celda que se desbordó).
     c) Un corte solo vale si algún renglón tiene una celda a cada lado; si no, es una sola columna
        con textos de distinto largo.
     d) El texto que quedó en tierra de nadie forma su propia columna (columnas casi vacías). */
  function solape(s, c) { return Math.min(s.x1, c.x1) - Math.max(s.x0, c.x0); }

  function columnas(bloque) {
    var segs = [];
    bloque.forEach(function (r) { segs = segs.concat(r.segs); });
    var x0 = Math.floor(Math.min.apply(null, segs.map(function (s) { return s.x0; })));
    var x1 = Math.ceil(Math.max.apply(null, segs.map(function (s) { return s.x1; })));
    var ancho = Math.max(1, x1 - x0 + 1);
    var cuenta = new Uint16Array(ancho);
    segs.forEach(function (s) {
      var a = Math.max(0, Math.round(s.x0) - x0), b = Math.min(ancho - 1, Math.round(s.x1) - x0);
      for (var x = a; x <= b; x++) cuenta[x]++;
    });
    var tolera = bloque.length >= 4 ? Math.max(1, Math.floor(bloque.length * 0.15)) : 0;

    var cols = [], ini = -1;
    for (var x = 0; x <= ancho; x++) {
      var lleno = x < ancho && cuenta[x] > tolera;
      if (lleno && ini < 0) ini = x;
      if (!lleno && ini >= 0) { cols.push({ x0: ini + x0, x1: x - 1 + x0 }); ini = -1; }
    }
    // Cortes de menos de 2 puntos no son cortes.
    cols = cols.reduce(function (out, c) {
      var u = out[out.length - 1];
      if (u && c.x0 - u.x1 < 2) u.x1 = c.x1; else out.push(c);
      return out;
    }, []);

    // c) Cada corte necesita al menos un renglón con una celda a cada lado.
    var k = 1;
    while (k < cols.length) {
      var izq = cols[k - 1], der = cols[k];
      var apoyo = bloque.some(function (r) {
        var enIzq = false, enDer = false;
        r.segs.forEach(function (s) {
          var a = solape(s, izq) > 1, b = solape(s, der) > 1;
          if (a && !b) enIzq = true;
          if (b && !a) enDer = true;
        });
        return enIzq && enDer;
      });
      if (apoyo) k++; else { izq.x1 = der.x1; cols.splice(k, 1); }
    }

    // Hasta dónde llega de verdad cada columna: la unión de las celdas que solo la tocan a ella.
    function tocadas(s) { return cols.filter(function (c) { return solape(s, c) > 1; }); }
    cols.forEach(function (c) { c.e0 = c.x0; c.e1 = c.x1; });
    segs.forEach(function (s) {
      var t = tocadas(s);
      if (t.length === 1) { t[0].e0 = Math.min(t[0].e0, s.x0); t[0].e1 = Math.max(t[0].e1, s.x1); }
    });

    // d) Texto que no toca ninguna columna. Si cabe bajo una celda larga de una columna vecina, es de esa
    //    columna (un encabezado corto sobre textos largos); si no, forma una columna casi vacía.
    var sueltos = segs.filter(function (s) { return !tocadas(s).length; })
      .sort(function (a, b) { return a.x0 - b.x0; });
    var extra = [];
    sueltos.forEach(function (s) {
      var casa = null;
      cols.forEach(function (c, i) {
        var sig = cols[i + 1], ant = cols[i - 1];
        var libre = (!sig || s.x1 < sig.e0) && (!ant || s.x0 > ant.e1);
        if (!casa && libre && Math.min(s.x1, c.e1) - Math.max(s.x0, c.e0) > 1) casa = c;
      });
      if (casa) { casa.x0 = Math.min(casa.x0, s.x0); casa.x1 = Math.max(casa.x1, s.x1); casa.e0 = Math.min(casa.e0, s.x0); casa.e1 = Math.max(casa.e1, s.x1); return; }
      var u = extra[extra.length - 1];
      if (u && s.x0 <= u.x1) { u.x1 = u.e1 = Math.max(u.x1, s.x1); } else extra.push({ x0: s.x0, x1: s.x1, e0: s.x0, e1: s.x1 });
    });
    return cols.concat(extra).sort(function (a, b) { return a.x0 - b.x0; });
  }

  /* Un segmento va a la columna que toca; si toca varias (un título que abarca dos), a la de más a la izquierda. */
  function columnaDe(seg, cols) {
    var cerca = 0, distancia = Infinity;
    for (var c = 0; c < cols.length; c++) {
      if (solape(seg, cols[c]) > 1) return c;
      var d = Math.max(cols[c].x0 - seg.x1, seg.x0 - cols[c].x1);
      if (d < distancia) { distancia = d; cerca = c; }
    }
    return cerca;
  }

  /* ¿Las columnas de B chocan con las de A? Chocan si un corte de A queda tapado por texto
     en la mitad o más de los renglones de B: son dos tablas distintas, no una. */
  function chocan(a, b) {
    var cols = columnas(a);
    var renglonesB = b.filter(function (r) { return r.segs.length >= 2; });
    if (renglonesB.length < 2) return false;
    for (var c = 1; c < cols.length; c++) {
      if (cols[c].e0 - cols[c - 1].e1 < 2) continue;
      var medio = (cols[c - 1].e1 + cols[c].e0) / 2;
      var tapan = renglonesB.filter(function (r) {
        return r.segs.some(function (s) { return s.x0 < medio - 1 && s.x1 > medio + 1; });
      }).length;
      if (tapan >= 2 && tapan >= renglonesB.length / 2) return true;
    }
    return false;
  }

  /* Dos tablas seguidas (con un subtítulo, una nota o un espacio entre ellas) llegan como un solo bloque.
     Se parte en el renglón suelto o en el espacio que las separa, si sus columnas chocan. */
  function partir(bloque) {
    var pasos = [];
    for (var i = 1; i < bloque.length; i++) pasos.push(bloque[i].y - bloque[i - 1].y);
    var orden = pasos.slice().sort(function (p, q) { return p - q; });
    var pasoAlto = orden.length ? orden[Math.floor((orden.length - 1) * 0.9)] : 0;
    var alto = mediana(bloque.map(function (r) { return r.h; }));
    for (var k = 1; k < bloque.length - 1; k++) {
      var r = bloque[k];
      var suelto = r.segs.length < 2 &&
        r.y - bloque[k - 1].y >= r.h * 1.5 && bloque[k + 1].y - r.y >= r.h * 1.5;
      var hueco = r.y - bloque[k - 1].y > pasoAlto * 1.8;
      if (!suelto && !hueco) continue;
      var arriba = recortar(bloque.slice(0, k));
      var abajo = recortar(bloque.slice(suelto ? k + 1 : k));
      if (!arriba || !abajo) continue;
      var titulo = suelto && r.h > alto * 1.15 && columnas(arriba).length >= 2 && columnas(abajo).length >= 2;
      if (titulo || chocan(arriba, abajo) || chocan(abajo, arriba)) return partir(arriba).concat(partir(abajo));
    }
    return [bloque];
  }

  /* 5. Filas. Con unirPartidos, los renglones de una misma celda (texto que no cupo en una línea) se juntan. */
  function filas(bloque, cols, unirPartidos) {
    var crudas = bloque.map(function (r) {
      var celdas = cols.map(function () { return []; });
      r.segs.forEach(function (s) { celdas[columnaDe(s, cols)].push(s); });
      var llenas = celdas.filter(function (c) { return c.length; }).length;
      return { y: r.y, h: r.h, celdas: celdas, llenas: llenas };
    });
    var grupos = [];
    if (unirPartidos && crudas.length > 2) {
      var pasos = [];
      for (var i = 1; i < crudas.length; i++) pasos.push(crudas[i].y - crudas[i - 1].y);
      var pasoTipico = mediana(pasos);
      var alto = mediana(crudas.map(function (f) { return f.h; }));
      var rala = function (f) { return f.llenas <= Math.max(1, Math.floor(cols.length / 2)); };
      crudas.forEach(function (f, k) {
        var g = grupos[grupos.length - 1];
        if (g) {
          var previa = g[g.length - 1];
          var paso = f.y - previa.y;
          var muyJuntas = paso < alto * 0.95;
          var juntas = paso < alto * 1.5 && paso < pasoTipico * 0.8 && (rala(f) || rala(previa));
          if (muyJuntas || juntas) { g.push(f); return; }
        }
        grupos.push([f]);
      });
    } else {
      grupos = crudas.map(function (f) { return [f]; });
    }
    return grupos.map(function (g) {
      return cols.map(function (_, c) {
        var segs = [];
        g.forEach(function (f) { segs = segs.concat(f.celdas[c]); });
        segs.sort(function (a, b) { return a.y - b.y || a.x0 - b.x0; });
        return segs.map(function (s) { return s.t; }).join(' ');
      });
    });
  }

  /* Tablas de una página. opciones: { unirPartidos: true } */
  function deLaPagina(trozos, opciones) {
    var op = opciones || {};
    var unir = op.unirPartidos !== false;
    var out = [];
    var partes = [];
    bloques(renglones(trozos)).forEach(function (b) { partes = partes.concat(partir(b)); });
    partes.forEach(function (b) {
      var cols = columnas(b);
      if (cols.length < 2) return;
      var f = filas(b, cols, unir);
      // Quita columnas y filas vacías.
      var usadas = cols.map(function (_, c) { return f.some(function (fila) { return fila[c]; }); });
      f = f.map(function (fila) { return fila.filter(function (_, c) { return usadas[c]; }); })
           .filter(function (fila) { return fila.some(function (v) { return v; }); });
      var nCols = f.length ? f[0].length : 0;
      if (nCols < 2 || f.length < 2) return;
      // Dos filas de dos columnas suelen ser un encabezado de página, no una tabla.
      if (f.length < 3 && nCols < 3) return;
      out.push({ filas: f });
    });
    return out;
  }

  /* Arreglos a mano sobre una tabla ya encontrada (devuelven filas nuevas, no cambian las que reciben). */
  function unirFilaConAnterior(f, r) {
    if (r <= 0 || r >= f.length) return f;
    var out = f.map(function (fila) { return fila.slice(); });
    out[r - 1] = out[r - 1].map(function (v, c) { return [v, out[r][c]].filter(Boolean).join(' '); });
    out.splice(r, 1);
    return out;
  }
  function unirColumnaConAnterior(f, c) {
    if (c <= 0 || !f.length || c >= f[0].length) return f;
    return f.map(function (fila) {
      var g = fila.slice();
      g[c - 1] = [g[c - 1], g[c]].filter(Boolean).join(' ');
      g.splice(c, 1);
      return g;
    });
  }
  function quitarFila(f, r) {
    if (r < 0 || r >= f.length || f.length <= 1) return f;
    return f.filter(function (_, k) { return k !== r; }).map(function (fila) { return fila.slice(); });
  }

  var Tablas = {
    deLaPagina: deLaPagina, renglones: renglones,
    unirFilaConAnterior: unirFilaConAnterior, unirColumnaConAnterior: unirColumnaConAnterior, quitarFila: quitarFila
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Tablas;
  else raiz.Tablas = Tablas;
})(this);
