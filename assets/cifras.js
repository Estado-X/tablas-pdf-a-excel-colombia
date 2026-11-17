/* Lee cifras escritas a la colombiana y las vuelve números de verdad.
   «$ 1.234.567,89» → 1234567.89 · «1.234.567» → 1234567 · «12,5 %» → 0.125 · «(1.200)» → -1200
   Si un texto no es claramente una cifra, se deja como texto: es mejor no tocar que dañar.

   Ojo con los presupuestos en dólares: «250,000» puede ser doscientos cincuenta mil (formato de
   Estados Unidos) o 250 con tres decimales. Suelto, ese texto es ambiguo y se deja como texto.
   El formato se decide por columna (formatoDeColumna): si en la columna hay cifras que solo pueden
   ser de Estados Unidos («12,000.50»), toda la columna se lee así; si hay de los dos formatos,
   la columna entera se queda como texto. Nunca se mezclan. */
(function (raiz) {
  'use strict';

  var MONEDA = /^(?:COP\s*\$?|USD\s*\$?|US\s*\$|\$)\s*|\s*(?:COP|USD|\$)$/gi;
  var MILES = /^\d{1,3}(?:\.\d{3})+(?:,\d+)?$/;       // 1.234.567 o 1.234.567,89
  var SIMPLE = /^\d+(?:,\d+)?$/;                        // 1234567 o 1234,5
  var AMBIGUA = /^[1-9]\d{0,2}(?:,\d{3})+$/;            // 250,000 · 1,500 · 1,234,567
  var MILES_US = /^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/;     // 1,234,567 o 1,234,567.89
  var SIMPLE_US = /^\d+(?:\.\d+)?$/;                    // 1234567 o 1234.5
  var SOLO_US = /^\d{1,3}(?:,\d{3})+\.\d+$/;           // coma de miles y punto decimal: 12,000.50
  var SOLO_CO = /^\d{1,3}(?:\.\d{3})+,\d+$/;           // punto de miles y coma decimal: 12.000,50

  /* Quita paréntesis, signo, moneda y porcentaje. Devuelve null si el texto no puede ser una cifra,
     o { cuerpo, negativo, porcentaje, moneda } con los dígitos y sus separadores en «cuerpo». */
  function partes(texto) {
    if (typeof texto !== 'string') return null;
    var t = texto.replace(/[\u00A0\u2007\u202F]/g, ' ').trim();
    if (!t || t.length > 40) return null;

    var negativo = false;
    var m = /^\((.*)\)$/.exec(t);
    if (m) { negativo = true; t = m[1].trim(); }

    var porcentaje = false;
    if (/%$/.test(t)) { porcentaje = true; t = t.slice(0, -1).trim(); }

    // El signo puede ir antes o después del signo de pesos: «-$ 1.200», «$ -1.200», «1.200-»
    var signo = /^[-\u2212\u2013]\s*/;
    if (signo.test(t)) { if (negativo) return null; negativo = true; t = t.replace(signo, ''); }
    var sinMoneda = t.replace(MONEDA, '');
    var moneda = sinMoneda !== t;
    t = sinMoneda.trim();
    if (moneda && porcentaje) return null;
    if (signo.test(t)) { if (negativo) return null; negativo = true; t = t.replace(signo, ''); }
    else if (/\d\s*[-\u2212]$/.test(t)) { if (negativo) return null; negativo = true; t = t.replace(/\s*[-\u2212]$/, ''); }
    if (!/^\d[\d.,]*$/.test(t)) return null;
    return { cuerpo: t, negativo: negativo, porcentaje: porcentaje, moneda: moneda };
  }

  /* Devuelve null si no es una cifra, o { valor, decimales, porcentaje, moneda }.
     formato: 'co' (por defecto), 'us' (coma de miles y punto decimal) o 'texto' (no convertir nada).
     En los porcentajes, valor ya viene dividido por 100 (12,5 % → 0.125), como los guarda Excel. */
  function leer(texto, formato) {
    if (formato === 'texto') return null;
    var p = partes(texto);
    if (!p) return null;
    var t = p.cuerpo, entero, dec;
    if (formato === 'us') {
      if (!MILES_US.test(t) && !SIMPLE_US.test(t)) return null;
      var us = t.split('.');
      entero = us[0].replace(/,/g, '');
      dec = us[1] || '';
    } else {
      // «250,000» suelto es ambiguo (¿250 mil o 250 con tres decimales?): se deja como texto.
      if (AMBIGUA.test(t)) return null;
      if (!MILES.test(t) && !SIMPLE.test(t)) return null;
      var co = t.split(',');
      entero = co[0].replace(/\./g, '');
      dec = co[1] || '';
    }
    // Códigos que empiezan en cero («007», «0012») no son cifras; «0» y «0,5» sí.
    if (entero.length > 1 && entero.charAt(0) === '0') return null;
    // Más de 15 dígitos: Excel pierde precisión (cuentas, radicados). Se deja como texto.
    if ((entero + dec).length > 15) return null;

    var valor = Number(entero + (dec ? '.' + dec : ''));
    if (!isFinite(valor)) return null;
    if (p.negativo) valor = -valor;
    var decimales = dec.length;
    if (p.porcentaje) valor = Number((valor / 100).toFixed(Math.min(decimales + 2, 12)));
    return { valor: valor, decimales: decimales, porcentaje: p.porcentaje, moneda: p.moneda };
  }

  /* Decide cómo leer una columna entera a partir de sus textos:
     'us'    hay cifras que solo pueden ser de Estados Unidos («12,000.50») y ninguna que solo pueda ser colombiana
     'texto' hay de las dos: no se convierte nada de esa columna
     'co'    lo demás */
  function formatoDeColumna(textos) {
    var us = false, co = false;
    (textos || []).forEach(function (texto) {
      var p = partes(texto);
      if (!p) return;
      if (SOLO_US.test(p.cuerpo)) us = true;
      else if (SOLO_CO.test(p.cuerpo)) co = true;
    });
    return us && co ? 'texto' : (us ? 'us' : 'co');
  }

  /* El formato de cada columna de una tabla (filas: [[texto, ...]]). */
  function formatos(filas) {
    var n = filas.length ? filas[0].length : 0, out = [];
    for (var c = 0; c < n; c++) out.push(formatoDeColumna(filas.map(function (f) { return f[c]; })));
    return out;
  }

  /* La cifra para un CSV que va a abrir un Excel en español: coma decimal y sin puntos de miles. */
  function paraCsv(c) {
    if (c.porcentaje) return (c.valor * 100).toFixed(c.decimales).replace('.', ',') + '%';
    return c.valor.toFixed(c.decimales).replace('.', ',');
  }

  var Cifras = { leer: leer, paraCsv: paraCsv, formatoDeColumna: formatoDeColumna, formatos: formatos };
  if (typeof module !== 'undefined' && module.exports) module.exports = Cifras;
  else raiz.Cifras = Cifras;
})(this);
