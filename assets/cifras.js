/* Lee cifras escritas a la colombiana y las vuelve números de verdad.
   «$ 1.234.567,89» → 1234567.89 · «1.234.567» → 1234567 · «12,5 %» → 0.125 · «(1.200)» → -1200
   Si un texto no es claramente una cifra, se deja como texto: es mejor no tocar que dañar. */
(function (raiz) {
  'use strict';

  var MONEDA = /^(?:COP\s*\$?|\$)\s*|\s*(?:COP|\$)$/gi;
  var MILES = /^\d{1,3}(?:\.\d{3})+(?:,\d+)?$/;   // 1.234.567 o 1.234.567,89
  var SIMPLE = /^\d+(?:,\d+)?$/;                    // 1234567 o 1234,5

  /* Devuelve null si no es una cifra, o { valor, decimales, porcentaje, moneda }.
     En los porcentajes, valor ya viene dividido por 100 (12,5 % → 0.125), como los guarda Excel. */
  function leer(texto) {
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

    if (!MILES.test(t) && !SIMPLE.test(t)) return null;
    var partes = t.split(',');
    var entero = partes[0].replace(/\./g, '');
    var dec = partes[1] || '';
    // Códigos que empiezan en cero («007», «0012») no son cifras; «0» y «0,5» sí.
    if (entero.length > 1 && entero.charAt(0) === '0') return null;
    // Más de 15 dígitos: Excel pierde precisión (cuentas, radicados). Se deja como texto.
    if ((entero + dec).length > 15) return null;

    var valor = Number(entero + (dec ? '.' + dec : ''));
    if (!isFinite(valor)) return null;
    if (negativo) valor = -valor;
    var decimales = dec.length;
    if (porcentaje) {
      valor = Number((valor / 100).toFixed(Math.min(decimales + 2, 12)));
    }
    return { valor: valor, decimales: decimales, porcentaje: porcentaje, moneda: moneda };
  }

  /* La cifra para un CSV que va a abrir un Excel en español: coma decimal y sin puntos de miles. */
  function paraCsv(c) {
    if (c.porcentaje) return (c.valor * 100).toFixed(c.decimales).replace('.', ',') + '%';
    return c.valor.toFixed(c.decimales).replace('.', ',');
  }

  var Cifras = { leer: leer, paraCsv: paraCsv };
  if (typeof module !== 'undefined' && module.exports) module.exports = Cifras;
  else raiz.Cifras = Cifras;
})(this);
