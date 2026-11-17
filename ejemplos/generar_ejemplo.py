"""Genera los PDF de ejemplo de la herramienta. Todo es FICTICIO.

    python ejemplos/generar_ejemplo.py

Crea, junto a este archivo:
  - presupuesto-ficticio.pdf   presupuesto aprobado de un proyecto inventado (tres tablas, dos páginas)
  - escaneado-ficticio.pdf     una página que es solo una imagen, para probar el aviso de «PDF escaneado»

Los datos de las tablas viven aquí (TABLAS) y las pruebas los leen para comparar.
Necesita reportlab (pip install reportlab).
"""
from __future__ import annotations

import datetime
import pathlib
import zlib

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

AQUI = pathlib.Path(__file__).resolve().parent
FECHA_FIJA = datetime.datetime(2026, 1, 15, 9, 0, 0)

VINO = colors.HexColor("#603338")
COBRE = colors.HexColor("#9c5635")
MARFIL = colors.HexColor("#f2ebdc")
TINTA = colors.HexColor("#2a231f")
BORDE = colors.HexColor("#cbc2ac")


def pesos(n: int) -> str:
    """1234567 -> «$ 1.234.567»; negativos entre paréntesis."""
    s = f"{abs(n):,}".replace(",", ".")
    return f"($ {s})" if n < 0 else f"$ {s}"


def porc(x: float) -> str:
    """12.5 -> «12,5 %»."""
    return f"{x:.1f}".replace(".", ",") + " %"


# ---------- Tabla 1: presupuesto por rubro (página 1) ----------
RUBROS = [
    # código, descripción, cantidad, valor unitario
    ("1.1", "Coordinación del proyecto", 12, 6_500_000),
    ("1.2", "Profesional de campo", 24, 3_800_000),
    ("2.1", "Talleres con familias productoras de las cuatro veredas del proyecto", 16, 2_450_000),
    ("2.2", "Insumos para viveros comunitarios", 4, 9_875_500),
    ("3.1", "Transporte fluvial y terrestre", 10, 1_320_000),
    ("3.2", "Materiales de formación", 320, 28_500),
    ("4.1", "Auditoría externa", 1, 14_000_000),
]
_tot1 = sum(c * v for _, _, c, v in RUBROS)
TABLA_1 = [["Código", "Rubro", "Cantidad", "Valor unitario", "Total", "% del total"]]
for cod, desc, cant, vu in RUBROS:
    TABLA_1.append([cod, desc, str(cant), pesos(vu), pesos(cant * vu), porc(cant * vu / _tot1 * 100)])
TABLA_1.append(["", "Total aprobado", "", "", pesos(_tot1), porc(100)])

# ---------- Tabla 2: desembolsos (página 1) ----------
DESEMBOLSOS = [
    ("Primero", "02/02/2026", "Firma del convenio", 40.0),
    ("Segundo", "15/07/2026", "Informe de avance aprobado", 35.0),
    ("Tercero", "30/11/2026", "Informe técnico intermedio", 15.0),
    ("Cuarto", "26/02/2027", "Informe final y auditoría", 10.0),
]
TABLA_2 = [["Desembolso", "Fecha", "Condición", "Porcentaje", "Valor"]]
for nom, fecha, cond, p in DESEMBOLSOS:
    TABLA_2.append([nom, fecha, cond, porc(p), pesos(round(_tot1 * p / 100))])
TABLA_2.append(["Total", "", "", porc(100), pesos(_tot1)])

# ---------- Tabla 3: contrapartida por aliado (página 2) ----------
ALIADOS = [
    # aliado, en dinero, en especie, ajuste
    ("Asociación Semillas del Río", 18_000_000, 12_500_000, 0),
    ("Alcaldía de Puerto Ejemplo", 25_000_000, 8_400_000, -3_200_000),
    ("Universidad Ejemplo del Oriente", 0, 21_750_000, 0),
    ("Cooperativa Ejemplo La Ceiba", 6_500_000, 4_300_000, -1_150_000),
]
TABLA_3 = [["Aliado", "En dinero", "En especie", "Ajuste", "Total contrapartida"]]
for nom, din, esp, aj in ALIADOS:
    TABLA_3.append([nom, pesos(din), pesos(esp), pesos(aj), pesos(din + esp + aj)])
TABLA_3.append([
    "Total",
    pesos(sum(a[1] for a in ALIADOS)),
    pesos(sum(a[2] for a in ALIADOS)),
    pesos(sum(a[3] for a in ALIADOS)),
    pesos(sum(a[1] + a[2] + a[3] for a in ALIADOS)),
])

TOTAL_APROBADO = _tot1
TOTAL_CONTRAPARTIDA = sum(a[1] + a[2] + a[3] for a in ALIADOS)
# (página, tabla dentro de la página, filas)
TABLAS = [(1, 1, TABLA_1), (1, 2, TABLA_2), (2, 1, TABLA_3)]


def _estilo_tabla(col_derecha: list[int], fila_total: bool = True) -> TableStyle:
    e = [
        ("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 8.5),
        ("FONT", (0, 1), (-1, -1), "Helvetica", 8.5),
        ("TEXTCOLOR", (0, 0), (-1, -1), TINTA),
        ("BACKGROUND", (0, 0), (-1, 0), MARFIL),
        ("LINEBELOW", (0, 0), (-1, 0), 0.8, VINO),
        ("LINEBELOW", (0, 1), (-1, -1), 0.4, BORDE),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
    ]
    for c in col_derecha:
        e.append(("ALIGN", (c, 0), (c, -1), "RIGHT"))
    if fila_total:
        e.append(("FONT", (0, -1), (-1, -1), "Helvetica-Bold", 8.5))
        e.append(("LINEABOVE", (0, -1), (-1, -1), 0.8, VINO))
    return TableStyle(e)


def _marco(c: canvas.Canvas, doc) -> None:
    ancho, alto = letter
    c.saveState()
    # Marca de agua en diagonal
    c.setFont("Helvetica-Bold", 54)
    c.setFillColor(colors.Color(0.61, 0.34, 0.21, alpha=0.10))
    c.translate(ancho / 2, alto / 2)
    c.rotate(38)
    c.drawCentredString(0, 0, "EJEMPLO FICTICIO")
    c.restoreState()
    c.saveState()
    c.setFont("Helvetica", 7.5)
    c.setFillColor(COBRE)
    c.drawString(20 * mm, alto - 12 * mm, "DOCUMENTO FICTICIO · hecho solo para probar la herramienta · ningún dato es real")
    c.setFillColor(colors.HexColor("#6e6456"))
    c.drawString(20 * mm, 11 * mm, "Proyecto, entidades, personas y cifras inventados.")
    c.drawRightString(ancho - 20 * mm, 11 * mm, f"Página {doc.page} de 2")
    c.restoreState()


def generar_presupuesto(destino: pathlib.Path) -> None:
    doc = SimpleDocTemplate(
        str(destino), pagesize=letter, leftMargin=20 * mm, rightMargin=20 * mm, topMargin=20 * mm, bottomMargin=18 * mm,
        title="Presupuesto aprobado (ejemplo ficticio)", author="Estado X", subject="Documento ficticio de ejemplo",
        creator="generar_ejemplo.py", invariant=1,
    )
    h1 = ParagraphStyle("h1", fontName="Helvetica", fontSize=20, leading=24, textColor=VINO, spaceAfter=4)
    h2 = ParagraphStyle("h2", fontName="Helvetica-Bold", fontSize=11, leading=14, textColor=VINO, spaceBefore=14, spaceAfter=6)
    p = ParagraphStyle("p", fontName="Helvetica", fontSize=9.5, leading=13.5, textColor=TINTA, alignment=TA_LEFT)
    celda = ParagraphStyle("celda", fontName="Helvetica", fontSize=8.5, leading=10.5, textColor=TINTA)

    def con_parrafos(filas, col):
        """La columna de texto largo va como párrafo, para que se parta en renglones como en un PDF real."""
        out = [filas[0]]
        for f in filas[1:-1]:
            g = list(f)
            g[col] = Paragraph(g[col], celda)
            out.append(g)
        out.append(filas[-1])
        return out

    partes = [
        Paragraph("Presupuesto aprobado", h1),
        Paragraph("Proyecto «Semillas del Río» · Convenio de cooperación N.º 000 de 2026 (ficticio)", p),
        Paragraph("Financiador: Fondo Ejemplo de Cooperación · Ejecutor: Asociación Semillas del Río · Cifras en pesos colombianos.", p),
        Paragraph("1. Presupuesto por rubro", h2),
    ]
    t1 = Table(con_parrafos(TABLA_1, 1), colWidths=[16 * mm, 62 * mm, 18 * mm, 28 * mm, 30 * mm, 22 * mm], repeatRows=1)
    t1.setStyle(_estilo_tabla([2, 3, 4, 5]))
    partes += [t1, Paragraph("2. Cronograma de desembolsos", h2)]
    t2 = Table(TABLA_2, colWidths=[26 * mm, 24 * mm, 66 * mm, 26 * mm, 34 * mm], repeatRows=1)
    t2.setStyle(_estilo_tabla([3, 4]))
    partes += [
        t2, Spacer(1, 10),
        Paragraph("Los desembolsos se giran contra la aprobación del informe de cada periodo. Los valores no ejecutados se reintegran al cierre.", p),
        PageBreak(),
        Paragraph("3. Contrapartida por aliado", h2),
        Paragraph("Aportes de los aliados del proyecto. Los ajustes negativos van entre paréntesis.", p),
        Spacer(1, 8),
    ]
    t3 = Table(TABLA_3, colWidths=[56 * mm, 30 * mm, 30 * mm, 28 * mm, 32 * mm], repeatRows=1)
    t3.setStyle(_estilo_tabla([1, 2, 3, 4]))
    partes += [
        t3, Spacer(1, 12),
        Paragraph("Este documento es un ejemplo ficticio creado para probar una herramienta de Estado X. No corresponde a ningún proyecto, entidad ni persona real.", p),
    ]
    doc.build(partes, onFirstPage=_marco, onLaterPages=_marco)


def generar_escaneado(destino: pathlib.Path) -> None:
    """Un PDF sin texto: la página es solo una imagen (como un escaneo)."""
    from reportlab.lib.utils import ImageReader

    ancho_px, alto_px = 170, 220
    filas = bytearray()
    for y in range(alto_px):
        filas.append(0)
        for x in range(ancho_px):
            en_tabla = 30 < x < 140 and 60 < y < 160
            linea = en_tabla and (y % 20 == 1 or x in (31, 80, 139))
            filas.append(90 if linea else (236 if en_tabla else 246))
    # PNG mínimo en escala de grises, sin librerías de imagen
    import struct

    def trozo(tipo: bytes, datos: bytes) -> bytes:
        return struct.pack(">I", len(datos)) + tipo + datos + struct.pack(">I", zlib.crc32(tipo + datos) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n" + trozo(b"IHDR", struct.pack(">IIBBBBB", ancho_px, alto_px, 8, 0, 0, 0, 0)) \
        + trozo(b"IDAT", zlib.compress(bytes(filas), 9)) + trozo(b"IEND", b"")
    import io

    c = canvas.Canvas(str(destino), pagesize=letter, invariant=1)
    c.setTitle("PDF escaneado (ejemplo ficticio)")
    c.setAuthor("Estado X")
    ancho, alto = letter
    c.drawImage(ImageReader(io.BytesIO(png)), 0, 0, width=ancho, height=alto)
    c.showPage()
    c.save()


if __name__ == "__main__":
    generar_presupuesto(AQUI / "presupuesto-ficticio.pdf")
    generar_escaneado(AQUI / "escaneado-ficticio.pdf")
    print("Listo:", "presupuesto-ficticio.pdf", "y", "escaneado-ficticio.pdf")
    print("Total aprobado:", pesos(TOTAL_APROBADO), "· Contrapartida:", pesos(TOTAL_CONTRAPARTIDA))
