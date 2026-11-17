/* Las tablas del PDF, a Excel · Estado X
   Todo pasa en el navegador: el PDF se lee con pdf.js (incluida en assets/vendor/pdfjs) y nunca se envía.
   Los textos que vienen del PDF o del nombre del archivo se escriben siempre con textContent. */
import * as pdfjs from './vendor/pdfjs/pdf.min.mjs';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;

const { Tablas, Cifras, Excel, Zip } = window;
const LIMITE_MB = 150;
const LIMITE_PAGINAS = 500;
const FILAS_VISTA = 40;

const $ = (id) => document.getElementById(id);
const zona = $('zona'), entrada = $('archivo'), estado = $('estado');
const opCifras = $('op-cifras'), opRenglones = $('op-renglones');
const seccion = $('resultado'), resumen = $('resumen'), lista = $('tablas'), barraTexto = $('barra-texto');
const btnExcel = $('btn-excel');

/* Lo que se leyó del último PDF. paginas: los trozos de texto de cada página, para volver a buscar
   tablas sin leer el archivo otra vez. */
let doc = null;
let turno = 0;

function el(etiqueta, clase, texto) {
  const e = document.createElement(etiqueta);
  if (clase) e.className = clase;
  if (texto != null) e.textContent = texto;
  return e;
}

function avisar(texto, tipo, detalle) {
  estado.replaceChildren();
  if (!texto) return;
  const caja = el('div', 'aviso' + (tipo ? ' aviso--' + tipo : ''));
  caja.append(el('p', 'aviso__titulo', texto));
  if (detalle) caja.append(el('p', 'aviso__texto', detalle));
  estado.append(caja);
}

function listaDePaginas(nums) {
  // [1,2,3,5] → «1 a 3 y 5»
  const tramos = [];
  nums.forEach((n) => {
    const u = tramos[tramos.length - 1];
    if (u && n === u[1] + 1) u[1] = n; else tramos.push([n, n]);
  });
  const partes = tramos.map(([a, b]) => (a === b ? String(a) : (b === a + 1 ? a + ' y ' + b : a + ' a ' + b)));
  if (partes.length <= 1) return partes.join('');
  return partes.slice(0, -1).join(', ') + ' y ' + partes[partes.length - 1];
}

function fechaHoy(d) {
  const p = (n) => String(n).padStart(2, '0');
  return p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

/* ---------- Leer el PDF ---------- */
async function leerPdf(datos, nombre) {
  const miTurno = ++turno;
  seccion.hidden = true;
  doc = null;
  avisar('Leyendo el PDF…');
  let pdf;
  const tarea = pdfjs.getDocument({
    data: datos, isEvalSupported: false, disableFontFace: true, useSystemFonts: false,
    enableXfa: false, useWorkerFetch: false, stopAtErrors: false, verbosity: 0,
  });
  try {
    pdf = await tarea.promise;
  } catch (e) {
    if (miTurno !== turno) return;
    if (e && e.name === 'PasswordException') {
      avisar('Este PDF tiene clave.', 'error', 'Ábrelo con su clave, guárdalo sin ella (o imprímelo a un PDF nuevo) y vuelve a intentarlo.');
    } else {
      avisar('No pudimos leer este archivo.', 'error', 'Revisa que sea un PDF y que no esté dañado.');
    }
    return;
  }
  try {
    const total = pdf.numPages;
    const hasta = Math.min(total, LIMITE_PAGINAS);
    const paginas = [];
    const sinTexto = [];
    for (let n = 1; n <= hasta; n++) {
      if (miTurno !== turno) return;
      if (hasta > 3) avisar('Leyendo la página ' + n + ' de ' + hasta + '…');
      const pagina = await pdf.getPage(n);
      const vista = pagina.getViewport({ scale: 1 });
      const contenido = await pagina.getTextContent();
      const trozos = [];
      let letras = 0;
      contenido.items.forEach((it) => {
        if (!it.str || !it.str.trim()) return;
        letras += it.str.trim().length;
        const m = pdfjs.Util.transform(vista.transform, it.transform);
        // El texto girado (marcas de agua en diagonal, sellos) no hace parte de las tablas.
        if (Math.abs(m[1]) > 0.02 * Math.abs(m[0] || 1) || Math.abs(m[2]) > 0.02 * Math.abs(m[3] || 1)) return;
        const alto = Math.hypot(m[2], m[3]) || it.height;
        trozos.push({ t: it.str, x: m[4], y: m[5], w: it.width, h: alto });
      });
      if (!letras) sinTexto.push(n);
      paginas.push(trozos);
      pagina.cleanup();
    }
    if (miTurno !== turno) return;
    doc = { nombre, total, leidas: hasta, paginas, sinTexto, tablas: [], fecha: new Date() };
    buscarTablas();
    mostrar(true);
  } catch (e) {
    if (miTurno === turno) avisar('No pudimos leer este archivo.', 'error', 'El PDF se abrió, pero algo falló al leer su texto.');
  } finally {
    tarea.destroy().catch(() => {});
  }
}

function buscarTablas() {
  doc.tablas = [];
  doc.paginas.forEach((trozos, i) => {
    Tablas.deLaPagina(trozos, { unirPartidos: opRenglones.checked }).forEach((t, k) => {
      doc.tablas.push({
        pagina: i + 1, numero: k + 1, filas: t.filas, original: t.filas,
        incluir: true, arreglar: false, todas: false,
      });
    });
  });
}

/* ---------- Mostrar ---------- */
function nombreHoja(t) { return 'Pág ' + t.pagina + ' · Tabla ' + t.numero; }
function tamano(t) {
  const f = t.filas.length, c = t.filas[0] ? t.filas[0].length : 0;
  return f + (f === 1 ? ' fila' : ' filas') + ' × ' + c + (c === 1 ? ' columna' : ' columnas');
}

function mostrar(alTerminar) {
  const d = doc;
  if (d.sinTexto.length === d.leidas) {
    seccion.hidden = true;
    avisar('Este PDF es una imagen; esta herramienta solo lee PDF con texto.', 'error',
      'Pásalo primero por un reconocimiento de texto (OCR) en tu computador —lo traen muchos programas de escáner y lectores de PDF— y vuelve a abrirlo aquí.');
    return;
  }
  const notas = [];
  if (d.sinTexto.length) {
    notas.push((d.sinTexto.length === 1 ? 'La página ' : 'Las páginas ') + listaDePaginas(d.sinTexto) +
      (d.sinTexto.length === 1 ? ' es una imagen y no se pudo leer.' : ' son imágenes y no se pudieron leer.'));
  }
  if (d.total > d.leidas) notas.push('Se leyeron las primeras ' + d.leidas + ' páginas de ' + d.total + '.');
  if (!d.tablas.length) {
    seccion.hidden = true;
    avisar('No encontramos tablas en este PDF.', 'error',
      ['Si las ves en el documento, puede que estén pegadas como imagen o que tengan una sola columna.'].concat(notas).join(' '));
    return;
  }
  avisar(notas.length ? 'Ojo con este PDF.' : '', 'nota', notas.join(' '));
  seccion.hidden = false;
  resumen.textContent = d.nombre + ' · ' + (d.leidas === 1 ? '1 página leída' : d.leidas + ' páginas leídas');
  lista.replaceChildren(...d.tablas.map(tarjeta));
  actualizarBarra();
  if (alTerminar) {
    $('t-resultado').focus({ preventScroll: true });
    seccion.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  }
}

function actualizarBarra() {
  const n = doc.tablas.filter((t) => t.incluir).length;
  btnExcel.disabled = n === 0;
  barraTexto.textContent = n === 0 ? 'Marca al menos una tabla para descargar.'
    : (n === 1 ? 'Una tabla, en su hoja' : n + ' tablas, una hoja por tabla') + ', más la hoja «Origen».';
}

function tarjeta(t, indice) {
  const art = el('article', 'tabla');
  art.dataset.indice = indice;
  const cab = el('div', 'tabla__cab');
  const titulos = el('div', 'tabla__titulos');
  const h3 = el('h3', 'tabla__nombre', 'Página ' + t.pagina + ' · Tabla ' + t.numero);
  h3.id = 'tabla-' + indice;
  titulos.append(h3, el('p', 'tabla__tamano', tamano(t)));

  const acciones = el('div', 'tabla__acciones');
  const marca = el('label', 'marca');
  const caja = document.createElement('input');
  caja.type = 'checkbox'; caja.checked = t.incluir;
  caja.setAttribute('aria-label', 'Incluir en el Excel: página ' + t.pagina + ', tabla ' + t.numero);
  caja.addEventListener('change', () => { t.incluir = caja.checked; art.classList.toggle('tabla--fuera', !t.incluir); actualizarBarra(); });
  marca.append(caja, el('span', null, 'Incluir en el Excel'));

  const bArreglar = el('button', 'boton boton--linea boton--chico', t.arreglar ? 'Listo' : 'Arreglar');
  bArreglar.type = 'button';
  bArreglar.setAttribute('aria-pressed', String(t.arreglar));
  bArreglar.addEventListener('click', () => { t.arreglar = !t.arreglar; repintar(indice, '.boton[aria-pressed]'); });

  const bCsv = el('button', 'boton boton--linea boton--chico', 'CSV');
  bCsv.type = 'button';
  bCsv.setAttribute('aria-label', 'Descargar CSV de la página ' + t.pagina + ', tabla ' + t.numero);
  bCsv.addEventListener('click', () => descargarCsv(t));
  acciones.append(marca, bArreglar, bCsv);

  if (t.filas !== t.original) {
    const bDeshacer = el('button', 'enlace', 'Deshacer arreglos');
    bDeshacer.type = 'button';
    bDeshacer.addEventListener('click', () => { t.filas = t.original; repintar(indice, '.boton[aria-pressed]'); });
    acciones.append(bDeshacer);
  }
  cab.append(titulos, acciones);
  art.append(cab);
  if (t.arreglar) art.append(el('p', 'tabla__ayuda', 'Une una columna con la de su izquierda (←), una fila con la de arriba (↑) o quita una fila que sobra (×).'));

  const marco = el('div', 'tabla__marco');
  marco.tabIndex = 0;
  marco.setAttribute('role', 'region');
  marco.setAttribute('aria-labelledby', h3.id);
  marco.append(vista(t, indice));
  art.append(marco);

  if (t.filas.length > FILAS_VISTA) {
    const bTodas = el('button', 'enlace', t.todas ? 'Ver menos filas' : 'Ver las ' + t.filas.length + ' filas');
    bTodas.type = 'button';
    bTodas.addEventListener('click', () => { t.todas = !t.todas; repintar(indice, '.tabla > .enlace'); });
    art.append(bTodas);
  }
  art.classList.toggle('tabla--fuera', !t.incluir);
  return art;
}

/* Vuelve a pintar una tarjeta y deja el foco donde estaba: en el botón que se usó (o en su vecino). */
function repintar(indice, foco) {
  const vieja = lista.children[indice];
  let puesto = -1;
  if (foco === '.mini') puesto = Array.from(vieja.querySelectorAll('.mini')).indexOf(document.activeElement);
  const nueva = tarjeta(doc.tablas[indice], indice);
  vieja.replaceWith(nueva);
  let destino = foco ? nueva.querySelector(foco) : null;
  if (puesto >= 0) {
    const minis = nueva.querySelectorAll('.mini');
    if (minis.length) destino = minis[Math.min(puesto, minis.length - 1)];
  }
  destino = destino || nueva.querySelector('button');
  if (destino) destino.focus({ preventScroll: true });
}

function vista(t, indice) {
  const convertir = opCifras.checked;
  const tabla = el('table', 'vista');
  const nCols = t.filas[0].length;
  const letras = el('tr');
  letras.append(el('th', 'vista__esquina'));
  for (let c = 0; c < nCols; c++) {
    const th = el('th', 'vista__letra');
    th.scope = 'col';
    th.append(el('span', null, Excel.columna(c)));
    if (t.arreglar && c > 0) {
      const b = el('button', 'mini', '←');
      b.type = 'button';
      b.title = 'Unir con la columna ' + Excel.columna(c - 1);
      b.setAttribute('aria-label', 'Unir la columna ' + Excel.columna(c) + ' con la columna ' + Excel.columna(c - 1));
      b.addEventListener('click', () => { t.filas = Tablas.unirColumnaConAnterior(t.filas, c); repintar(indice, '.mini'); });
      th.append(b);
    }
    letras.append(th);
  }
  const cabeza = el('thead'); cabeza.append(letras);
  const cuerpo = el('tbody');
  const tope = t.todas ? t.filas.length : Math.min(t.filas.length, FILAS_VISTA);
  for (let r = 0; r < tope; r++) {
    const tr = el('tr');
    const num = el('th', 'vista__num');
    num.scope = 'row';
    num.append(el('span', null, String(r + 1)));
    if (t.arreglar) {
      if (r > 0) {
        const b = el('button', 'mini', '↑');
        b.type = 'button';
        b.title = 'Unir con la fila de arriba';
        b.setAttribute('aria-label', 'Unir la fila ' + (r + 1) + ' con la fila ' + r);
        b.addEventListener('click', () => { t.filas = Tablas.unirFilaConAnterior(t.filas, r); repintar(indice, '.mini'); });
        num.append(b);
      }
      if (t.filas.length > 1) {
        const q = el('button', 'mini', '×');
        q.type = 'button';
        q.title = 'Quitar esta fila';
        q.setAttribute('aria-label', 'Quitar la fila ' + (r + 1));
        q.addEventListener('click', () => { t.filas = Tablas.quitarFila(t.filas, r); repintar(indice, '.mini'); });
        num.append(q);
      }
    }
    tr.append(num);
    t.filas[r].forEach((texto) => {
      const td = el('td', null, texto);
      if (convertir && Cifras.leer(texto)) td.className = 'num';
      tr.append(td);
    });
    cuerpo.append(tr);
  }
  tabla.append(cabeza, cuerpo);
  if (tope < t.filas.length) {
    const pie = el('tfoot'), tr = el('tr'), td = el('td', 'vista__mas', '… y ' + (t.filas.length - tope) + ' filas más (todas van al Excel)');
    td.colSpan = nCols + 1; tr.append(td); pie.append(tr); tabla.append(pie);
  }
  return tabla;
}

/* ---------- Descargas ---------- */
function bajar(bytes, tipo, nombre) {
  const url = URL.createObjectURL(new Blob([bytes], { type: tipo }));
  const a = document.createElement('a');
  a.href = url; a.download = nombre; a.hidden = true;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function base() {
  // Nombre de archivo sin la extensión ni caracteres que Windows no acepta.
  return (doc.nombre.replace(/\.pdf$/i, '').replace(/[\\/:*?"<>|\u0000-\u001F]/g, ' ').trim() || 'tablas').slice(0, 80);
}

function valorExcel(texto, convertir) {
  if (convertir) {
    const c = Cifras.leer(texto);
    if (c) return { n: c.valor, s: Excel.estiloCifra(c) };
  }
  return texto;
}

function descargarExcel() {
  const convertir = opCifras.checked;
  const elegidas = doc.tablas.filter((t) => t.incluir);
  if (!elegidas.length) return;
  const hojas = elegidas.map((t) => ({
    nombre: nombreHoja(t),
    filas: t.filas.map((f) => f.map((v) => valorExcel(v, convertir))),
  }));
  const leidas = [];
  for (let n = 1; n <= doc.leidas; n++) if (doc.sinTexto.indexOf(n) < 0) leidas.push(n);
  const origen = [
    ['Origen de las tablas', ''],
    ['Archivo', doc.nombre],
    ['Fecha de lectura', fechaHoy(doc.fecha)],
    ['Páginas del PDF', doc.total],
    ['Páginas leídas', listaDePaginas(leidas)],
    ['Páginas sin texto (imagen)', doc.sinTexto.length ? listaDePaginas(doc.sinTexto) : 'Ninguna'],
    ['Cifras convertidas a números', convertir ? 'Sí' : 'No'],
    [],
    ['Hoja', 'Página', 'Tabla', 'Filas', 'Columnas'],
  ];
  const filaTitulos = origen.length - 1;
  elegidas.forEach((t) => origen.push([nombreHoja(t), t.pagina, t.numero, t.filas.length, t.filas[0].length]));
  origen.push([], ['Antes de usar estas hojas, revisa que sus totales cuadren con los del PDF.'],
    ['Hecho con «Las tablas del PDF, a Excel», de Estado X: https://estado-x.github.io/tablas-pdf-a-excel-colombia/']);
  hojas.push({ nombre: 'Origen', filas: origen, anchos: [30, 44, 10, 10, 12], encabezados: [0, filaTitulos] });
  const bytes = Excel.crear(hojas, Zip, doc.fecha);
  bajar(bytes, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', base() + ' - tablas.xlsx');
}

function celdaCsv(texto, convertir) {
  let v = texto;
  const c = Cifras.leer(texto);
  if (convertir && c) v = Cifras.paraCsv(c);
  // Un texto que empieza como fórmula se guarda con apóstrofo, para que la hoja de cálculo no lo calcule.
  else if (/^[=+\-@\t\r]/.test(v) && !c) v = "'" + v;
  return /[";\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}

function descargarCsv(t) {
  const convertir = opCifras.checked;
  // Punto y coma y coma decimal: así lo abre un Excel configurado para Colombia. BOM para las tildes.
  const texto = '\uFEFF' + t.filas.map((f) => f.map((v) => celdaCsv(v, convertir)).join(';')).join('\r\n') + '\r\n';
  bajar(new TextEncoder().encode(texto), 'text/csv;charset=utf-8', base() + ' - pag ' + t.pagina + ' tabla ' + t.numero + '.csv');
}

/* ---------- Entradas ---------- */
function abrirArchivo(archivo) {
  if (!archivo) return;
  const esPdf = archivo.type === 'application/pdf' || /\.pdf$/i.test(archivo.name);
  if (!esPdf) { seccion.hidden = true; avisar('Ese archivo no es un PDF.', 'error', 'Elige un archivo que termine en .pdf.'); return; }
  if (archivo.size > LIMITE_MB * 1024 * 1024) { seccion.hidden = true; avisar('Ese PDF pesa más de ' + LIMITE_MB + ' MB.', 'error', 'Parte el documento y abre solo las páginas que tienen las tablas.'); return; }
  archivo.arrayBuffer().then((b) => leerPdf(new Uint8Array(b), archivo.name),
    () => avisar('No pudimos abrir ese archivo.', 'error'));
}

$('btn-elegir').addEventListener('click', () => entrada.click());
entrada.addEventListener('change', () => { abrirArchivo(entrada.files[0]); entrada.value = ''; });

$('btn-ejemplo').addEventListener('click', async () => {
  avisar('Abriendo el ejemplo…');
  try {
    const r = await fetch('ejemplos/presupuesto-ficticio.pdf');
    if (!r.ok) throw new Error(String(r.status));
    await leerPdf(new Uint8Array(await r.arrayBuffer()), 'presupuesto-ficticio.pdf');
  } catch (e) {
    avisar('No pudimos abrir el ejemplo.', 'error', 'Vuelve a cargar la página e inténtalo de nuevo.');
  }
});

['dragenter', 'dragover'].forEach((tipo) => zona.addEventListener(tipo, (e) => { e.preventDefault(); zona.classList.add('zona--sobre'); }));
['dragleave', 'drop'].forEach((tipo) => zona.addEventListener(tipo, (e) => { e.preventDefault(); if (tipo === 'drop' || !zona.contains(e.relatedTarget)) zona.classList.remove('zona--sobre'); }));
zona.addEventListener('drop', (e) => { const f = e.dataTransfer && e.dataTransfer.files; if (f && f.length) abrirArchivo(f[0]); });
// Si el PDF cae fuera de la zona, que el navegador no lo abra y saque a la persona de la página.
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

opCifras.addEventListener('change', () => { if (doc && doc.tablas.length) doc.tablas.forEach((_, i) => lista.children[i].replaceWith(tarjeta(doc.tablas[i], i))); });
opRenglones.addEventListener('change', () => { if (doc) { buscarTablas(); mostrar(false); } });
btnExcel.addEventListener('click', descargarExcel);

document.documentElement.dataset.lista = 'si';
