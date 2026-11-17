"""Pruebas de la página, en un navegador de verdad.

    pip install playwright openpyxl reportlab
    python -m playwright install chromium
    python pruebas/probar.py

Levanta un servidor local solo para la prueba, abre la página con Chromium y revisa: que cargue sin
errores ni pedidos a internet, que el PDF de ejemplo dé las tablas esperadas, la conversión de cifras,
el Excel y el CSV descargados, los avisos (PDF escaneado, con clave, archivo que no es PDF), la
protección contra fórmulas y HTML, el celular (390 px) y el uso con teclado.
Los PDF de prueba que no están en ejemplos/ se crean en una carpeta temporal y se borran al final.
"""
from __future__ import annotations

import functools
import http.server
import pathlib
import sys
import tempfile
import threading
import traceback

import openpyxl
from playwright.sync_api import sync_playwright
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle

RAIZ = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ / "ejemplos"))
import generar_ejemplo as ejemplo  # noqa: E402

EJEMPLO = RAIZ / "ejemplos" / "presupuesto-ficticio.pdf"
ESCANEADO = RAIZ / "ejemplos" / "escaneado-ficticio.pdf"


class Silencioso(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):  # sin ruido en la terminal
        pass


def servidor():
    manejador = functools.partial(Silencioso, directory=str(RAIZ))
    s = http.server.ThreadingHTTPServer(("127.0.0.1", 0), manejador)
    threading.Thread(target=s.serve_forever, daemon=True).start()
    return s, f"http://127.0.0.1:{s.server_address[1]}/"


# ---------- PDF de prueba que se crean al vuelo ----------
def pdf_tabla(destino: pathlib.Path, filas, clave: str | None = None):
    doc = SimpleDocTemplate(str(destino), pagesize=letter, encrypt=clave)
    t = Table(filas, colWidths=[150, 130, 130])
    t.setStyle(TableStyle([("FONT", (0, 0), (-1, -1), "Helvetica", 9), ("ALIGN", (1, 0), (-1, -1), "RIGHT")]))
    doc.build([t])


FILAS_PELIGROSAS = [
    ["Concepto", "Valor", "Nota"],
    ["=1+1", "$ 1.000", "@SUM(A1:A2)"],
    ["+57 300 000 0000", "(2.500,50)", "-no es una cifra"],
    ["<img src=x onerror=window.pwn=1>", "12,5 %", "<b>negrilla</b>"],
    ["Total", "-1.500,50", "007"],
]


def pdf_mixto(destino: pathlib.Path):
    """Página 1: solo una imagen. Página 2: una tabla con texto."""
    c = canvas.Canvas(str(destino), pagesize=letter)
    c.setFillGray(0.85)
    c.rect(60, 300, 400, 300, fill=1, stroke=0)
    c.showPage()
    c.setFont("Helvetica", 10)
    y = 700
    for a, b, d in [("Rubro", "Enero", "Febrero"), ("Personal", "1.200.000", "1.250.000"), ("Viajes", "300.000", "0"), ("Total", "1.500.000", "1.250.000")]:
        c.drawString(72, y, a)
        c.drawRightString(330, y, b)
        c.drawRightString(450, y, d)
        y -= 20
    c.save()


HTML_NAVEGADOR = """<html><body style="font:11px Arial;margin:30px">
<h2>Informe financiero trimestral (ficticio)</h2>
<p>El siguiente cuadro resume la ejecución del periodo. Los valores están en pesos colombianos y corresponden al corte del 30/09/2026, según los registros contables del proyecto y sus soportes.</p>
<table border="1" cellspacing="0" cellpadding="3" style="border-collapse:collapse;font:10px Arial;width:100%">
<tr><th rowspan="2">Componente</th><th colspan="2">Presupuesto</th><th colspan="2">Ejecución</th><th rowspan="2">Observaciones</th></tr>
<tr><th>Aprobado</th><th>Ajustado</th><th>Valor</th><th>%</th></tr>
<tr><td>Fortalecimiento organizativo de las juntas de acción comunal del municipio</td><td align="right">120.000.000</td><td align="right">118.500.000</td><td align="right">96.450.320,50</td><td align="right">81,4 %</td><td>Sin novedad</td></tr>
<tr><td>Dotación</td><td align="right">45.000.000</td><td align="right">45.000.000</td><td align="right">45.000.000</td><td align="right">100 %</td><td></td></tr>
<tr><td>Seguimiento y evaluación</td><td align="right">30.000.000</td><td align="right">31.500.000</td><td align="right">12.800.000</td><td align="right">40,6 %</td><td>Retraso por lluvias en el segundo trimestre del año</td></tr>
<tr><td><b>Total</b></td><td align="right">195.000.000</td><td align="right">195.000.000</td><td align="right">154.250.320,50</td><td align="right">79,1 %</td><td></td></tr>
</table>
<p>Nota: los valores negativos se muestran entre paréntesis.</p>
<table style="font:10px Arial;margin-top:20px">
<tr><td width="200">Rendimientos financieros</td><td width="120" align="right">1.250.300</td></tr>
<tr><td>Gastos bancarios</td><td align="right">(310.450)</td></tr>
<tr><td>Diferencia en cambio</td><td align="right">-85.000</td></tr>
<tr><td>Neto</td><td align="right">854.850</td></tr>
</table></body></html>"""


# ---------- Ayudas ----------
def tablas_en_pantalla(page):
    """[(título, tamaño, filas)] leídas de la vista previa."""
    return page.evaluate(
        """() => Array.from(document.querySelectorAll('#tablas .tabla')).map(a => [
            a.querySelector('.tabla__nombre').textContent,
            a.querySelector('.tabla__tamano').textContent,
            Array.from(a.querySelectorAll('.vista tbody tr')).map(tr => Array.from(tr.querySelectorAll('td')).map(td => td.textContent))
        ])"""
    )


def abrir(page, ruta: pathlib.Path, nombre: str | None = None):
    """Abre un PDF y espera a que la página muestre las tablas de ESE archivo (no las del anterior)."""
    if nombre:
        page.set_input_files("#archivo", {"name": nombre, "mimeType": "application/pdf", "buffer": ruta.read_bytes()})
    else:
        page.set_input_files("#archivo", str(ruta))
    page.wait_for_function(
        "(n) => !document.querySelector('#resultado').hidden && document.querySelector('#resumen').textContent.startsWith(n + ' · ')",
        arg=nombre or ruta.name, timeout=20000)


def bajar_excel(page, carpeta: pathlib.Path, nombre: str) -> pathlib.Path:
    with page.expect_download() as d:
        page.click("#btn-excel")
    destino = carpeta / nombre
    d.value.save_as(str(destino))
    return destino


class Corrida:
    def __init__(self):
        self.ok = 0
        self.fallas: list[str] = []

    def prueba(self, nombre, fn):
        try:
            fn()
            self.ok += 1
            print(f"  ok     {nombre}")
        except Exception:  # noqa: BLE001
            self.fallas.append(nombre)
            print(f"  FALLA  {nombre}")
            traceback.print_exc()


def main() -> int:
    if not EJEMPLO.exists() or not ESCANEADO.exists():
        ejemplo.generar_presupuesto(EJEMPLO)
        ejemplo.generar_escaneado(ESCANEADO)
    srv, url = servidor()
    c = Corrida()
    tmp = tempfile.TemporaryDirectory()
    carpeta = pathlib.Path(tmp.name)
    with sync_playwright() as pw:
        navegador = pw.chromium.launch()
        ctx = navegador.new_context(viewport={"width": 1280, "height": 900}, accept_downloads=True, locale="es-CO")
        page = ctx.new_page()
        errores: list[str] = []
        pedidos: list[str] = []
        page.on("console", lambda m: errores.append(m.text) if m.type in ("error", "warning") else None)
        page.on("pageerror", lambda e: errores.append(str(e)))
        page.on("request", lambda r: pedidos.append(r.url))

        def cargar(p=page):
            p.goto(url)
            p.wait_for_function("() => document.documentElement.dataset.lista === 'si'")

        # 1. Carga
        def t_carga():
            cargar()
            assert page.title() == "Las tablas del PDF, a Excel · Estado X"
            assert page.evaluate("document.characterSet") == "UTF-8"
            assert page.locator("#resultado").is_hidden()
            assert not errores, errores

        c.prueba("carga sin errores de consola", t_carga)

        # 2. Ejemplo
        def t_ejemplo():
            page.click("#btn-ejemplo")
            page.wait_for_selector("#tablas .tabla")
            vistas = tablas_en_pantalla(page)
            assert len(vistas) == 3, len(vistas)
            for (pag, num, filas), (titulo, tam, vistas_filas) in zip(ejemplo.TABLAS, vistas):
                assert titulo == f"Página {pag} · Tabla {num}", titulo
                assert tam == f"{len(filas)} filas × {len(filas[0])} columnas", tam
                assert vistas_filas == filas, (titulo, vistas_filas)
            assert "presupuesto-ficticio.pdf" in page.inner_text("#resumen")
            assert "2 páginas leídas" in page.inner_text("#resumen")
            # La marca de agua en diagonal no se cuela en ninguna tabla.
            assert "EJEMPLO FICTICIO" not in page.inner_text("#tablas")
            assert page.inner_text("#estado").strip() == "", page.inner_text("#estado")
            assert not errores, errores

        c.prueba("el PDF de ejemplo da las tres tablas esperadas, celda por celda", t_ejemplo)

        # 3. Cifras
        def t_cifras():
            casos = {
                "$ 1.234.567,89": 1234567.89, "1.234.567": 1234567, "12,5 %": 0.125, "(1.200)": -1200,
                "($ 3.200.000)": -3200000, "-$ 1.200": -1200, "$ -1.200,5": -1200.5, "100,0 %": 1, "0": 0,
                "0,5": 0.5, "−1.500": -1500, "COP 5.000": 5000, "12%": 0.12, "2026": 2026, "$ 0": 0,
                "(12,5 %)": -0.125, "1 234": None,
                # Lo que NO es cifra se queda como texto
                "007": None, "1.5": None, "1.1": None, "12/03/2026": None, "900.123.456-7": None,
                "1,234,567.89": None, "abc": None, "=1+1": None, "1234567890123456": None, "": None,
                "3.1.2": None, "$": None, "12 34": None, "+57 300": None,
            }
            salida = page.evaluate("(ts) => ts.map(t => { const c = Cifras.leer(t); return c ? c.valor : null; })", list(casos))
            for (texto, esperado), real in zip(casos.items(), salida):
                assert real == esperado, (texto, esperado, real)
            assert page.evaluate("Cifras.paraCsv(Cifras.leer('$ 1.234.567,89'))") == "1234567,89"
            assert page.evaluate("Cifras.paraCsv(Cifras.leer('12,5 %'))") == "12,5%"
            n = page.locator("#tablas .tabla").first.locator("td.num").count()
            assert n == 30, n  # 7 rubros × 4 cifras + total y porcentaje de la última fila

        c.prueba("cifras colombianas: pesos, miles, decimales, porcentajes y negativos", t_cifras)

        # 4. Excel con cifras convertidas
        def t_excel():
            ruta = bajar_excel(page, carpeta, "con-cifras.xlsx")
            assert ruta.name.endswith(".xlsx")
            wb = openpyxl.load_workbook(ruta)
            assert wb.sheetnames == ["Pág 1 · Tabla 1", "Pág 1 · Tabla 2", "Pág 2 · Tabla 1", "Origen"], wb.sheetnames
            h1 = wb["Pág 1 · Tabla 1"]
            assert h1.max_row == 9 and h1.max_column == 6
            assert h1["A1"].value == "Código" and h1["B4"].value == "Talleres con familias productoras de las cuatro veredas del proyecto"
            assert h1["A2"].value == "1.1" and h1["A2"].data_type == "s"  # «1.1» es un código, no una cifra
            assert h1["C2"].value == 12 and h1["D2"].value == 6500000 and h1["E2"].value == 78000000
            assert h1["D2"].number_format == "#,##0", h1["D2"].number_format
            assert abs(h1["F2"].value - 0.274) < 1e-9 and h1["F2"].number_format == "0.0%", (h1["F2"].value, h1["F2"].number_format)
            # Los totales cuadran: la suma de la columna es el total del PDF.
            assert sum(h1.cell(r, 5).value for r in range(2, 9)) == h1["E9"].value == ejemplo.TOTAL_APROBADO
            h2 = wb["Pág 1 · Tabla 2"]
            assert h2["B2"].value == "02/02/2026"  # las fechas se dejan como texto, tal cual
            assert sum(h2.cell(r, 5).value for r in range(2, 6)) == h2["E6"].value == ejemplo.TOTAL_APROBADO
            assert abs(sum(h2.cell(r, 4).value for r in range(2, 6)) - 1) < 1e-9
            h3 = wb["Pág 2 · Tabla 1"]
            assert h3["D3"].value == -3200000 and h3["D6"].value == -4350000  # negativos entre paréntesis
            assert sum(h3.cell(r, 5).value for r in range(2, 6)) == h3["E6"].value == ejemplo.TOTAL_CONTRAPARTIDA
            o = wb["Origen"]
            datos = {o.cell(r, 1).value: o.cell(r, 2).value for r in range(1, o.max_row + 1)}
            assert datos["Archivo"] == "presupuesto-ficticio.pdf"
            assert datos["Páginas del PDF"] == 2 and datos["Páginas leídas"] == "1 y 2"
            assert datos["Cifras convertidas a números"] == "Sí"
            import re
            assert re.fullmatch(r"\d{2}/\d{2}/\d{4} \d{2}:\d{2}", datos["Fecha de lectura"]), datos["Fecha de lectura"]
            assert datos["Pág 2 · Tabla 1"] == 2
            # Ninguna celda es una fórmula.
            for ws in wb:
                for fila in ws.iter_rows():
                    for cel in fila:
                        assert cel.data_type != "f", cel.coordinate

        c.prueba("Excel: hojas, celdas, números de verdad, totales que cuadran y hoja «Origen»", t_excel)

        # 5. Sin convertir + elegir tablas
        def t_sin_convertir():
            page.uncheck("#op-cifras")
            assert page.locator("#tablas td.num").count() == 0
            page.locator("#tablas .tabla").nth(1).locator(".marca input").uncheck()
            assert "2 tablas" in page.inner_text("#barra-texto")
            ruta = bajar_excel(page, carpeta, "sin-cifras.xlsx")
            wb = openpyxl.load_workbook(ruta)
            assert wb.sheetnames == ["Pág 1 · Tabla 1", "Pág 2 · Tabla 1", "Origen"], wb.sheetnames
            assert wb["Pág 1 · Tabla 1"]["E2"].value == "$ 78.000.000"
            assert wb["Pág 2 · Tabla 1"]["D3"].value == "($ 3.200.000)"
            assert wb["Pág 1 · Tabla 1"]["F2"].value == "27,4 %"
            o = wb["Origen"]
            assert any(o.cell(r, 2).value == "No" for r in range(1, o.max_row + 1))
            # Sin ninguna tabla marcada no hay descarga.
            for i in (0, 2):
                page.locator("#tablas .tabla").nth(i).locator(".marca input").uncheck()
            assert page.locator("#btn-excel").is_disabled()
            page.check("#op-cifras")
            for i in range(3):
                page.locator("#tablas .tabla").nth(i).locator(".marca input").check()
            assert page.locator("#btn-excel").is_enabled()

        c.prueba("«Convertir cifras» apagado deja el texto tal cual; se elige qué tablas van", t_sin_convertir)

        # 6. CSV
        def t_csv():
            with page.expect_download() as d:
                page.locator("#tablas .tabla").nth(2).get_by_role("button", name="Descargar CSV").click()
            destino = carpeta / "t3.csv"
            d.value.save_as(str(destino))
            assert d.value.suggested_filename == "presupuesto-ficticio - pag 2 tabla 1.csv", d.value.suggested_filename
            crudo = destino.read_bytes()
            assert crudo.startswith(b"\xef\xbb\xbf")
            lineas = crudo.decode("utf-8-sig").split("\r\n")
            assert lineas[0] == "Aliado;En dinero;En especie;Ajuste;Total contrapartida", lineas[0]
            assert lineas[2] == "Alcaldía de Puerto Ejemplo;25000000;8400000;-3200000;30200000", lineas[2]
            assert len(lineas) == 7 and lineas[6] == ""

        c.prueba("CSV por tabla: punto y coma, tildes y cifras sin puntos de miles", t_csv)

        # 7. Renglones partidos y arreglos a mano
        def t_arreglos():
            page.uncheck("#op-renglones")
            page.wait_for_function("() => document.querySelector('#tablas .tabla__tamano').textContent.startsWith('11 filas')")
            t1 = page.locator("#tablas .tabla").first
            t1.get_by_role("button", name="Arreglar").click()
            # El rubro 2.1 quedó en tres renglones (filas 4, 5 y 6): se unen a mano.
            t1.get_by_role("button", name="Unir la fila 5 con la fila 4", exact=True).click()
            t1 = page.locator("#tablas .tabla").first
            t1.get_by_role("button", name="Unir la fila 5 con la fila 4", exact=True).click()
            filas = tablas_en_pantalla(page)[0][2]
            assert filas == ejemplo.TABLAS[0][2], filas
            # Unir dos columnas y deshacer.
            t1 = page.locator("#tablas .tabla").first
            t1.get_by_role("button", name="Unir la columna B con la columna A", exact=True).click()
            filas = tablas_en_pantalla(page)[0][2]
            assert filas[1][0] == "1.1 Coordinación del proyecto" and len(filas[0]) == 5, filas[1]
            t1 = page.locator("#tablas .tabla").first
            t1.get_by_role("button", name="Quitar la fila 9", exact=True).click()
            assert len(tablas_en_pantalla(page)[0][2]) == 8
            page.locator("#tablas .tabla").first.get_by_role("button", name="Deshacer arreglos").click()
            assert len(tablas_en_pantalla(page)[0][2]) == 11
            page.check("#op-renglones")
            page.wait_for_function("() => document.querySelector('#tablas .tabla__tamano').textContent.startsWith('9 filas')")

        c.prueba("renglones partidos: se unen solos o a mano; unir columnas, quitar filas y deshacer", t_arreglos)

        # 8. PDF escaneado
        def t_escaneado():
            page.set_input_files("#archivo", str(ESCANEADO))
            page.wait_for_selector("#estado .aviso--error")
            texto = page.inner_text("#estado")
            assert "Este PDF es una imagen; esta herramienta solo lee PDF con texto." in texto, texto
            assert "reconocimiento de texto" in texto
            assert page.locator("#resultado").is_hidden()

        c.prueba("un PDF sin texto (escaneado) da el aviso claro", t_escaneado)

        # 9. Otros avisos
        def t_avisos():
            no_pdf = carpeta / "notas.txt"
            no_pdf.write_text("hola", encoding="utf-8")
            page.set_input_files("#archivo", str(no_pdf))
            page.wait_for_function("() => document.querySelector('#estado').textContent.includes('no es un PDF')")
            falso = carpeta / "falso.pdf"
            falso.write_bytes(b"esto no es un pdf de verdad")
            page.set_input_files("#archivo", str(falso))
            page.wait_for_function("() => document.querySelector('#estado').textContent.includes('No pudimos leer este archivo')")
            con_clave = carpeta / "con-clave.pdf"
            pdf_tabla(con_clave, FILAS_PELIGROSAS, clave="secreta")
            page.set_input_files("#archivo", str(con_clave))
            page.wait_for_function("() => document.querySelector('#estado').textContent.includes('tiene clave')")
            mixto = carpeta / "mixto.pdf"
            pdf_mixto(mixto)
            abrir(page, mixto)
            assert "La página 1 es una imagen y no se pudo leer." in page.inner_text("#estado")
            vistas = tablas_en_pantalla(page)
            assert len(vistas) == 1 and vistas[0][0] == "Página 2 · Tabla 1" and vistas[0][2][3] == ["Total", "1.500.000", "1.250.000"], vistas
            sin_tablas = carpeta / "carta.pdf"
            cv = canvas.Canvas(str(sin_tablas), pagesize=letter)
            cv.setFont("Helvetica", 11)
            for i, linea in enumerate(["Bogotá, 15/01/2026", "Señores del comité:", "Esta carta no tiene tablas.", "Cordialmente."]):
                cv.drawString(72, 700 - 18 * i, linea)
            cv.save()
            page.set_input_files("#archivo", str(sin_tablas))
            page.wait_for_function("() => document.querySelector('#estado').textContent.includes('No encontramos tablas')")
            assert page.locator("#resultado").is_hidden()

        c.prueba("avisos: archivo que no es PDF, PDF dañado, con clave, página en imagen y PDF sin tablas", t_avisos)
        errores.clear()  # el PDF dañado y el de clave dejan avisos esperados de la biblioteca

        # 10. Fórmulas y HTML
        def t_inyeccion():
            malo = carpeta / "peligroso.pdf"
            pdf_tabla(malo, FILAS_PELIGROSAS)
            # El nombre lleva una fórmula y HTML (Windows no deja crear ese archivo: se le pasa en memoria).
            abrir(page, malo, nombre="=cmd() <b>x<b>.pdf")
            vistas = tablas_en_pantalla(page)
            assert vistas[0][2] == FILAS_PELIGROSAS, vistas[0][2]
            # El texto del PDF y el nombre del archivo se muestran como texto: nada se vuelve HTML.
            assert page.locator("#resultado img, #resultado b, #estado img").count() == 0
            assert page.evaluate("window.pwn") is None
            assert "=cmd() <b>x<b>.pdf" in page.inner_text("#resumen")
            ruta = bajar_excel(page, carpeta, "peligroso.xlsx")
            wb = openpyxl.load_workbook(ruta)
            ws = wb.worksheets[0]
            for ref in ("A2", "C2", "A3", "C3"):
                assert ws[ref].data_type == "s" and ws[ref].quotePrefix, (ref, ws[ref].data_type, ws[ref].quotePrefix)
            assert ws["A2"].value == "=1+1" and ws["C2"].value == "@SUM(A1:A2)"
            assert ws["B2"].value == 1000 and ws["B3"].value == -2500.5 and ws["B3"].number_format == "#,##0.00"
            assert ws["B5"].value == -1500.5 and ws["C5"].value == "007"
            assert abs(ws["B4"].value - 0.125) < 1e-12
            o = wb["Origen"]
            assert o["B2"].value == "=cmd() <b>x<b>.pdf" and o["B2"].data_type == "s" and o["B2"].quotePrefix
            with page.expect_download() as d:
                page.get_by_role("button", name="Descargar CSV").click()
            destino = carpeta / "peligroso.csv"
            d.value.save_as(str(destino))
            lineas = destino.read_bytes().decode("utf-8-sig").split("\r\n")
            assert lineas[1] == "'=1+1;1000;'@SUM(A1:A2)", lineas[1]
            assert lineas[2] == "'+57 300 000 0000;-2500,50;'-no es una cifra", lineas[2]
            assert lineas[4] == "Total;-1500,50;007", lineas[4]
            page.uncheck("#op-cifras")
            with page.expect_download() as d:
                page.get_by_role("button", name="Descargar CSV").click()
            d.value.save_as(str(destino))
            lineas = destino.read_bytes().decode("utf-8-sig").split("\r\n")
            assert lineas[4] == "Total;-1.500,50;007", lineas[4]  # una cifra negativa no lleva apóstrofo
            assert lineas[2].startswith("'+57 300 000 0000;(2.500,50);'-no")
            page.check("#op-cifras")
            assert not errores, errores

        c.prueba("fórmulas y HTML dentro del PDF o del nombre quedan como texto (Excel, CSV y pantalla)", t_inyeccion)

        # 11. PDF hecho por un navegador: celdas combinadas y renglones partidos
        def t_navegador():
            p2 = ctx.new_page()
            p2.set_content(HTML_NAVEGADOR)
            ruta = carpeta / "informe-navegador.pdf"
            p2.pdf(path=str(ruta), format="Letter")
            p2.close()
            abrir(page, ruta)
            vistas = tablas_en_pantalla(page)
            assert len(vistas) == 2, [v[:2] for v in vistas]
            assert vistas[0][1] == "5 filas × 6 columnas", vistas[0][1]
            assert vistas[0][2][0] == ["Componente", "Presupuesto Aprobado", "Ajustado", "Ejecución Valor", "%", "Observaciones"], vistas[0][2][0]
            assert vistas[0][2][1] == ["Fortalecimiento organizativo de las juntas de acción comunal del municipio", "120.000.000", "118.500.000", "96.450.320,50", "81,4 %", "Sin novedad"], vistas[0][2][1]
            assert vistas[0][2][3][5] == "Retraso por lluvias en el segundo trimestre del año"
            assert vistas[1][2] == [["Rendimientos financieros", "1.250.300"], ["Gastos bancarios", "(310.450)"], ["Diferencia en cambio", "-85.000"], ["Neto", "854.850"]], vistas[1][2]
            wb = openpyxl.load_workbook(bajar_excel(page, carpeta, "navegador.xlsx"))
            h = wb.worksheets[0]
            assert h["D2"].value == 96450320.5 and h["D5"].value == 154250320.5
            assert abs(sum(h.cell(r, 4).value for r in range(2, 5)) - h["D5"].value) < 0.001
            m = wb.worksheets[1]
            assert m["B1"].value + m["B2"].value + m["B3"].value == m["B4"].value == 854850

        c.prueba("PDF hecho por un navegador: celdas combinadas, renglones partidos y dos tablas seguidas", t_navegador)

        # 12. Nada sale a internet
        def t_sin_internet():
            fuera = [u for u in pedidos if not u.startswith(url) and not u.startswith(("blob:", "data:"))]
            assert not fuera, fuera
            assert any(u.endswith("assets/vendor/pdfjs/pdf.worker.min.mjs") for u in pedidos)
            # Y ningún pedido lleva datos: solo se piden los archivos de la propia página.
            assert all(".pdf" not in u or "/ejemplos/" in u for u in pedidos), pedidos
            csp = page.get_attribute('meta[http-equiv="Content-Security-Policy"]', "content")
            assert "connect-src 'self'" in csp and "default-src 'self'" in csp
            html = (RAIZ / "index.html").read_text(encoding="utf-8")
            for rastro in ("googletagmanager", "google-analytics", "gtag(", "fbq(", "hotjar", "fonts.googleapis", "plausible", "clarity.ms"):
                assert rastro not in html, rastro

        c.prueba("no pide nada a internet: todo sale de la propia página y no hay rastreadores", t_sin_internet)

        # 13. Celular
        def t_celular():
            cel = navegador.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, has_touch=True, is_mobile=True, locale="es-CO")
            p = cel.new_page()
            errs: list[str] = []
            p.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
            p.on("pageerror", lambda e: errs.append(str(e)))
            cargar(p)
            ancho = lambda: p.evaluate("[document.documentElement.scrollWidth, document.documentElement.clientWidth]")  # noqa: E731
            a = ancho()
            assert a[0] <= a[1], a
            p.tap("#btn-ejemplo")
            p.wait_for_selector("#tablas .tabla")
            a = ancho()
            assert a[0] <= a[1], a
            p.locator("#tablas .tabla").first.get_by_role("button", name="Arreglar").tap()
            a = ancho()
            assert a[0] <= a[1], a
            # La tabla ancha se desplaza dentro de su marco, no la página.
            m = p.evaluate("(() => { const m = document.querySelector('.tabla__marco'); return [m.scrollWidth, m.clientWidth]; })()")
            assert m[0] > m[1], m
            # Los botones se pueden tocar: al menos 44 px de alto los principales.
            for sel in ("#btn-elegir", "#btn-ejemplo", "#btn-excel"):
                assert p.locator(sel).bounding_box()["height"] >= 44, sel
            p.set_input_files("#archivo", str(ESCANEADO))
            p.wait_for_selector("#estado .aviso--error")
            a = ancho()
            assert a[0] <= a[1], a
            assert not errs, errs
            cel.close()

        c.prueba("celular (390 px): sin desplazamiento lateral, con y sin tablas", t_celular)

        # 14. Escritorio
        def t_escritorio():
            cargar()
            a = page.evaluate("[document.documentElement.scrollWidth, document.documentElement.clientWidth]")
            assert a[0] <= a[1], a
            page.click("#btn-ejemplo")
            page.wait_for_selector("#tablas .tabla")
            a = page.evaluate("[document.documentElement.scrollWidth, document.documentElement.clientWidth]")
            assert a[0] <= a[1], a

        c.prueba("escritorio (1280 px): sin desplazamiento lateral", t_escritorio)

        # 15. Teclado
        def t_teclado():
            cargar()
            foco = lambda: page.evaluate("(() => { const e = document.activeElement; return e.id || e.getAttribute('aria-label') || e.textContent.trim().slice(0, 60); })()")  # noqa: E731
            page.keyboard.press("Tab")
            assert foco() == "Ir a abrir un PDF", foco()
            page.keyboard.press("Tab")
            assert foco() == "btn-elegir", foco()
            page.keyboard.press("Tab")
            assert foco() == "btn-ejemplo", foco()
            page.keyboard.press("Enter")
            page.wait_for_selector("#tablas .tabla")
            page.wait_for_function("() => document.activeElement.id === 't-resultado'")
            page.keyboard.press("Tab")
            assert foco() == "btn-excel", foco()
            page.keyboard.press("Tab")
            assert foco().startswith("Incluir en el Excel: página 1, tabla 1"), foco()
            page.keyboard.press("Space")
            assert "2 tablas" in page.inner_text("#barra-texto")
            page.keyboard.press("Space")
            page.keyboard.press("Tab")
            assert foco() == "Arreglar", foco()
            page.keyboard.press("Enter")
            assert foco() == "Listo", foco()  # el foco se queda en el botón después de repintar
            page.keyboard.press("Tab")
            assert foco().startswith("Descargar CSV"), foco()
            page.keyboard.press("Tab")  # el marco de la tabla, para desplazarla con las flechas
            assert page.evaluate("document.activeElement.className") == "tabla__marco"
            page.keyboard.press("Tab")
            assert foco() == "Unir la columna B con la columna A", foco()
            page.keyboard.press("Enter")
            assert tablas_en_pantalla(page)[0][1] == "9 filas × 5 columnas"
            assert foco() == "Unir la columna B con la columna A", foco()  # sigue en el mismo sitio
            # Todo lo que se puede pulsar es un botón, un enlace o una casilla de verdad.
            raros = page.evaluate("Array.from(document.querySelectorAll('[onclick], div[role=button], span[role=button]')).length")
            assert raros == 0
            # Cada casilla tiene nombre y el foco se ve.
            sin_nombre = page.evaluate("""Array.from(document.querySelectorAll('input[type=checkbox]')).filter(i => !(i.getAttribute('aria-label') || (i.closest('label') && i.closest('label').textContent.trim()))).length""")
            assert sin_nombre == 0
            page.focus("#btn-excel")
            page.keyboard.press("Shift+Tab")
            page.keyboard.press("Tab")
            contorno = page.evaluate("getComputedStyle(document.activeElement).outlineStyle")
            assert contorno == "solid", contorno

        c.prueba("teclado: se llega a todo con Tab, Enter y Espacio, y el foco no se pierde", t_teclado)

        # 16. Contraste de los textos principales (WCAG AA: 4,5 a 1)
        def t_contraste():
            page.mouse.move(2, 2)
            page.wait_for_timeout(500)  # que terminen las transiciones de color
            pares = page.evaluate(
                """() => {
                  const lum = (c) => { const v = c.match(/[\\d.]+/g).slice(0, 3).map(Number).map(x => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
                  const fondo = (e) => { while (e) { const b = getComputedStyle(e).backgroundColor; if (b && !/rgba\\(0, 0, 0, 0\\)|transparent/.test(b)) return b; e = e.parentElement; } return 'rgb(255,255,255)'; };
                  const sel = ['.bajada', '.nota', '.kicker', '.zona__texto', '.zona__pie', '.opcion', '.tabla__tamano', '.vista td', '.vista td.num', '.vista__letra', '.barra__texto', '.limites__uno', '.hablamos p', '.firma', '.pie p', '#btn-excel', '#btn-ejemplo', '.boton--claro', '.hablamos .kicker'];
                  return sel.map(s => { const e = document.querySelector(s); if (!e) return [s, 0]; const a = lum(getComputedStyle(e).color), b = lum(fondo(e)); return [s, (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)]; });
                }"""
            )
            bajos = [(s, round(r, 2)) for s, r in pares if r < 4.5]
            assert not bajos, bajos

        c.prueba("contraste suficiente en los textos (4,5 a 1 o más)", t_contraste)

        navegador.close()
    srv.shutdown()
    try:
        tmp.cleanup()
    except OSError:
        pass
    print(f"\n{c.ok} pruebas bien, {len(c.fallas)} con falla.")
    for f in c.fallas:
        print("  -", f)
    return 1 if c.fallas else 0


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
