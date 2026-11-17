/* Arma un .xlsx real (Office Open XML) sin librerías: unas pocas partes XML dentro de un .zip.
   Adaptado de Estado-X/facturas-colombia (assets/excel.js, licencia MIT, Copyright (c) 2026 Estado X):
   https://github.com/Estado-X/facturas-colombia
   De allá vienen el escape de XML, la celda, la hoja y la protección contra fórmulas; aquí el libro
   es genérico: una hoja por tabla, con las cifras como números de verdad. */
(function (raiz) {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function columna(i) { var s = ''; i++; while (i > 0) { var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }

  // Estilos: 0 normal · 1 encabezado · 2 entero · 3 dos decimales · 4 otros decimales
  //          5 porcentaje sin decimales · 6 con uno · 7 con dos · 8 texto literal (quotePrefix)
  var E = { NORMAL: 0, ENCABEZADO: 1, ENTERO: 2, DECIMAL: 3, DECIMALES: 4, PCT0: 5, PCT1: 6, PCT2: 7, LITERAL: 8 };
  var ESTILOS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<numFmts count="3"><numFmt numFmtId="164" formatCode="#,##0.00"/><numFmt numFmtId="165" formatCode="#,##0.0#####"/><numFmt numFmtId="166" formatCode="0.0%"/></numFmts>' +
    '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
    '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFF2EBDC"/><bgColor indexed="64"/></patternFill></fill></fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="9">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +
    '<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="9" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="10" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" quotePrefix="1"/>' +
    '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

  /* El estilo de una cifra leída por Cifras.leer: { valor, decimales, porcentaje } */
  function estiloCifra(c) {
    if (c.porcentaje) return c.decimales === 0 ? E.PCT0 : (c.decimales === 1 ? E.PCT1 : E.PCT2);
    return c.decimales === 0 ? E.ENTERO : (c.decimales === 2 ? E.DECIMAL : E.DECIMALES);
  }

  /* v: texto, número o { n: número, s: estilo }. Aquí nunca se escribe una fórmula. */
  function celda(ref, v, estilo) {
    if (v && typeof v === 'object' && typeof v.n === 'number') { estilo = v.s; v = v.n; }
    if (typeof v === 'number' && isFinite(v)) return '<c r="' + ref + '"' + (estilo ? ' s="' + estilo + '"' : '') + '><v>' + v + '</v></c>';
    if (v === null || v === undefined || v === '') return '';
    // Texto que empieza como fórmula: se marca como texto literal para que Excel nunca lo calcule.
    if (/^[=+\-@\t\r]/.test(String(v)) && !estilo) estilo = E.LITERAL;
    return '<c r="' + ref + '" t="inlineStr"' + (estilo ? ' s="' + estilo + '"' : '') + '><is><t xml:space="preserve">' + esc(v) + '</t></is></c>';
  }

  /* filas: [[valor, ...]] · anchos: ancho por columna · filasEncabezado: índices de fila con estilo de encabezado */
  function hoja(filas, anchos, filasEncabezado) {
    var x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">';
    if (anchos && anchos.length) x += '<cols>' + anchos.map(function (w, i) { return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>'; }).join('') + '</cols>';
    x += '<sheetData>';
    filas.forEach(function (fila, r) {
      var enc = filasEncabezado && filasEncabezado.indexOf(r) >= 0;
      x += '<row r="' + (r + 1) + '">';
      fila.forEach(function (v, c) { x += celda(columna(c) + (r + 1), v, enc ? E.ENCABEZADO : 0); });
      x += '</row>';
    });
    return x + '</sheetData></worksheet>';
  }

  /* Excel no acepta en el nombre de una hoja  : \ / ? * [ ]  ni más de 31 caracteres, ni nombres repetidos. */
  function nombresDeHoja(nombres) {
    var vistos = {};
    return nombres.map(function (n, i) {
      var limpio = String(n || '').replace(/[:\\\/?*\[\]\u0000-\u001F]/g, ' ').replace(/^'+|'+$/g, '').trim().slice(0, 31) || ('Hoja ' + (i + 1));
      var base = limpio, k = 2;
      while (vistos[limpio.toLowerCase()]) { var cola = ' (' + k++ + ')'; limpio = base.slice(0, 31 - cola.length) + cola; }
      vistos[limpio.toLowerCase()] = true;
      return limpio;
    });
  }

  function anchosDe(filas) {
    var w = [];
    filas.forEach(function (fila) {
      fila.forEach(function (v, c) {
        var t = v && typeof v === 'object' ? String(v.n) : String(v == null ? '' : v);
        w[c] = Math.max(w[c] || 8, Math.min(60, t.length + 3));
      });
    });
    for (var i = 0; i < w.length; i++) if (!w[i]) w[i] = 8;
    return w;
  }

  /* hojas: [{ nombre, filas, anchos (opcional), encabezados: [índices de fila] (opcional) }] → Uint8Array del .xlsx */
  function crear(hojas, Zip, fechaZip) {
    var nombres = nombresDeHoja(hojas.map(function (h) { return h.nombre; }));
    var XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
    var tipos = '', rels = '', lista = '', archivos = [];
    hojas.forEach(function (h, i) {
      var n = i + 1;
      tipos += '<Override PartName="/xl/worksheets/sheet' + n + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
      rels += '<Relationship Id="rId' + n + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + n + '.xml"/>';
      lista += '<sheet name="' + esc(nombres[i]) + '" sheetId="' + n + '" r:id="rId' + n + '"/>';
      archivos.push({ nombre: 'xl/worksheets/sheet' + n + '.xml', datos: hoja(h.filas, h.anchos || anchosDe(h.filas), h.encabezados) });
    });
    var cabeza = [
      { nombre: '[Content_Types].xml', datos: XML +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        tipos +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        '</Types>' },
      { nombre: '_rels/.rels', datos: XML +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '</Relationships>' },
      { nombre: 'xl/workbook.xml', datos: XML +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        '<sheets>' + lista + '</sheets></workbook>' },
      { nombre: 'xl/_rels/workbook.xml.rels', datos: XML +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + rels +
        '<Relationship Id="rId' + (hojas.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
        '</Relationships>' }
    ];
    return Zip.crear(cabeza.concat(archivos, [{ nombre: 'xl/styles.xml', datos: ESTILOS }]), fechaZip);
  }

  var Excel = { crear: crear, columna: columna, estiloCifra: estiloCifra, nombresDeHoja: nombresDeHoja, ESTILO: E };
  if (typeof module !== 'undefined' && module.exports) module.exports = Excel;
  else raiz.Excel = Excel;
})(this);
