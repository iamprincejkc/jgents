"""Pixel art desenhada à mão (mapas de caracteres): o mark do JGENTS em 32x32 e 16x16 e a placa
"JGENTS" e textos do og-image com uma fonte bitmap proporcional (5x7, com acentos).

O mark é um tile azul-marinho com um J âmbar e o ponto verde de "agente online", desenhado à mão nos
dois tamanhos (o de 16 não é redução do de 32). Ele substituiu o prédio do Habblaud em 2026-10-16.
"""

from __future__ import annotations

import numpy as np
from PIL import Image

# Paleta amostrada da arte nativa da IA (logo-mark, já quantizada): um tom por material.
PALETTE: dict[str, str] = {
    "O": "#111931",  # contorno azul-marinho
    "J": "#0e4060",  # contorno do telhado
    "L": "#d2efec",  # borda clara do telhado / brilho do vidro
    "R": "#3e8da0",  # telhado
    "U": "#61bac5",  # telhado (luz) / toldo
    "F": "#c9bab2",  # fachada
    "H": "#eadacb",  # fachada (luz)
    "f": "#8f7b7f",  # fachada (sombra)
    "K": "#3e526f",  # moldura das janelas
    "Y": "#fee074",  # janela acesa
    "y": "#fab63f",  # janela acesa (sombra)
    "S": "#20b6fd",  # tela azul
    "s": "#0b6bf0",  # tela azul (sombra)
    "W": "#db954f",  # madeira / vaso
    "w": "#ecb761",  # madeira (luz)
    "b": "#7c4116",  # madeira (sombra)
    "u": "#b05b39",  # vaso (sombra) / batente da porta
    "p": "#692a18",  # vaso (contorno)
    "G": "#67c53d",  # folha
    "g": "#198834",  # folha (meio-tom)
    "q": "#033e1f",  # folha (contorno)
    "D": "#a3d4e5",  # vidro da porta
    # mark do JGENTS
    "N": "#24304f",  # tile
    "T": "#34446e",  # tile (luz, borda de cima)
    "n": "#1a2340",  # tile (sombra) / sombra do J
    "A": "#fac665",  # J âmbar (a mesma cor do logotipo)
    "a": "#d9902e",  # J âmbar (sombra)
}

# Mark 32x32: tile azul-marinho arredondado, J âmbar com sombra de 1px e o ponto verde de "agente online".
MARK_32 = [
    "......OOOOOOOOOOOOOOOOOOOO......",
    "...OOTTTTTTTTTTTTTTTTTTTTTTOO...",
    "..ONNNNNNNNNNNNNNNNNNNNNNNNNNO..",
    ".ONNNNNNNNNNNNNNNNNNNNNNNNNNNNO.",
    ".ONNNNNNNNNNNNNNNNNNNNNNNNNNNNO.",
    ".ONNNNNNNNNNNNNNNNNNNNNNGGGNNNO.",
    "ONNNNNNNNNNNNNNNNNNNNNNGLGGGNNNO",
    "ONNNNNNNNAAAAAAAAAAAAANGGGGGNNNO",
    "ONNNNNNNNAAAAAAAAAAAAANGGGgGNNNO",
    "ONNNNNNNNAAAAAAAAAAAAAANGgGNNNNO",
    "ONNNNNNNNAAAAAAAAAAAAAanNNNNNNNO",
    "ONNNNNNNNNnnnnnnnAAAAAnnNNNNNNNO",
    "ONNNNNNNNNNNNNNNNAAAAAnNNNNNNNNO",
    "ONNNNNNNNNNNNNNNNAAAAAnNNNNNNNNO",
    "ONNNNNNNNNNNNNNNNAAAAAnNNNNNNNNO",
    "ONNNNNNNNNNNNNNNNAAAAAnNNNNNNNNO",
    "ONNNNNNAAAAANNNNNAAAAAnNNNNNNNNO",
    "ONNNNNNAAAAAnNNNNAAAAAnNNNNNNNNO",
    "ONNNNNNAAAAAnNNNNAAAAAnNNNNNNNNO",
    "ONNNNNNAAAAAnNNNNAAAAAnNNNNNNNNO",
    "ONNNNNNAAAAAnNNNNAAAAAnNNNNNNNNO",
    "ONNNNNNaAAAAANNNAAAAAanNNNNNNNNO",
    "ONNNNNNNAAAAAAAAAAAAAnnNNNNNNNNO",
    "ONNNNNNNaAAAAAAAAAAAanNNNNNNNNNO",
    "ONNNNNNNNaAAAAAAAAAannNNNNNNNNNO",
    "ONNNNNNNNNaaAAAAAaannNNNNNNNNNNO",
    ".ONNNNNNNNNnaaaaannnNNNNNNNNNNO.",
    ".ONNNNNNNNNNNnnnnnNNNNNNNNNNNNO.",
    ".ONNNNNNNNNNNNNNNNNNNNNNNNNNNNO.",
    "..ONNNNNNNNNNNNNNNNNNNNNNNNNNO..",
    "...OOnnnnnnnnnnnnnnnnnnnnnnOO...",
    "......OOOOOOOOOOOOOOOOOOOO......",
]

# Mark 16x16 (favicon): o mesmo tile, desenhado de novo nesse tamanho (não é redução do de 32).
MARK_16 = [
    ".OOOOOOOOOOOOOO.",
    "OTTTTTTTTTTTTTTO",
    "ONNNNNNNNNNNNNNO",
    "ONNNAAAAAAANGGNO",
    "ONNNaaaaAAANggNO",
    "ONNNNnnnAAAnNNNO",
    "ONNNNNNNAAAnNNNO",
    "ONNNNNNNAAAnNNNO",
    "ONNAAANNAAAnNNNO",
    "ONNAAAnNAAAnNNNO",
    "ONNAAAAAAAAnNNNO",
    "ONNNaAAAAAannNNO",
    "ONNNnaaaaannNNNO",
    "ONNNNnnnnnNNNNNO",
    "OnnnnnnnnnnnnnnO",
    ".OOOOOOOOOOOOOO.",
]

# Fonte bitmap proporcional (maiúsculas 5x7). Célula de 9 linhas: maiúsculas e ascendentes nas
# linhas 0-6, altura-x de 5 linhas (2-6), descendentes nas linhas 7-8 e acentos das minúsculas
# nas linhas 0-1. Glifos com 7 linhas não têm descendente. Espaço entre letras: 1px.
_GLYPHS: dict[str, list[str]] = {
    "A": [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
    "B": ["####.", "#...#", "#...#", "####.", "#...#", "#...#", "####."],
    "C": [".###.", "#...#", "#....", "#....", "#....", "#...#", ".###."],
    "D": ["####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."],
    "E": ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
    "F": ["#####", "#....", "#....", "####.", "#....", "#....", "#...."],
    "G": [".###.", "#...#", "#....", "#.###", "#...#", "#...#", ".####"],
    "H": ["#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
    "I": ["###", ".#.", ".#.", ".#.", ".#.", ".#.", "###"],
    "J": ["..###", "...#.", "...#.", "...#.", "#..#.", "#..#.", ".##.."],
    "K": ["#...#", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "#...#"],
    "L": ["#....", "#....", "#....", "#....", "#....", "#....", "#####"],
    "M": ["#...#", "##.##", "#.#.#", "#.#.#", "#...#", "#...#", "#...#"],
    "N": ["#...#", "##..#", "#.#.#", "#..##", "#...#", "#...#", "#...#"],
    "O": [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
    "P": ["####.", "#...#", "#...#", "####.", "#....", "#....", "#...."],
    "Q": [".###.", "#...#", "#...#", "#...#", "#.#.#", "#..#.", ".##.#"],
    "R": ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
    "S": [".####", "#....", "#....", ".###.", "....#", "....#", "####."],
    "T": ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
    "U": ["#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
    "V": ["#...#", "#...#", "#...#", "#...#", "#...#", ".#.#.", "..#.."],
    "W": ["#...#", "#...#", "#...#", "#.#.#", "#.#.#", "#.#.#", ".#.#."],
    "X": ["#...#", "#...#", ".#.#.", "..#..", ".#.#.", "#...#", "#...#"],
    "Y": ["#...#", "#...#", ".#.#.", "..#..", "..#..", "..#..", "..#.."],
    "Z": ["#####", "....#", "...#.", "..#..", ".#...", "#....", "#####"],
    "a": [".....", ".....", ".###.", "....#", ".####", "#...#", ".####"],
    "b": ["#....", "#....", "####.", "#...#", "#...#", "#...#", "####."],
    "c": ["....", "....", ".###", "#...", "#...", "#...", ".###"],
    "d": ["....#", "....#", ".####", "#...#", "#...#", "#...#", ".####"],
    "e": [".....", ".....", ".###.", "#...#", "#####", "#....", ".###."],
    "f": ["..##", ".#..", ".#..", "###.", ".#..", ".#..", ".#.."],
    "g": [".....", ".....", ".####", "#...#", "#...#", "#...#", ".####", "....#", ".###."],
    "h": ["#....", "#....", "####.", "#...#", "#...#", "#...#", "#...#"],
    "i": [".#.", "...", "##.", ".#.", ".#.", ".#.", "###"],
    "j": ["...#", "....", "..##", "...#", "...#", "...#", "...#", "#..#", ".##."],
    "k": ["#...", "#...", "#..#", "#.#.", "##..", "#.#.", "#..#"],
    "l": ["##.", ".#.", ".#.", ".#.", ".#.", ".#.", "###"],
    "m": [".....", ".....", "##.#.", "#.#.#", "#.#.#", "#.#.#", "#.#.#"],
    "n": [".....", ".....", "####.", "#...#", "#...#", "#...#", "#...#"],
    "o": [".....", ".....", ".###.", "#...#", "#...#", "#...#", ".###."],
    "p": [".....", ".....", "####.", "#...#", "#...#", "#...#", "####.", "#....", "#...."],
    "q": [".....", ".....", ".####", "#...#", "#...#", "#...#", ".####", "....#", "....#"],
    "r": ["....", "....", "#.##", "##..", "#...", "#...", "#..."],
    "s": [".....", ".....", ".####", "#....", ".###.", "....#", "####."],
    "t": [".#..", ".#..", "###.", ".#..", ".#..", ".#..", "..##"],
    "u": [".....", ".....", "#...#", "#...#", "#...#", "#...#", ".####"],
    "v": [".....", ".....", "#...#", "#...#", "#...#", ".#.#.", "..#.."],
    "w": [".....", ".....", "#...#", "#...#", "#.#.#", "#.#.#", ".#.#."],
    "x": [".....", ".....", "#...#", ".#.#.", "..#..", ".#.#.", "#...#"],
    "y": [".....", ".....", "#...#", "#...#", "#...#", "#...#", ".####", "....#", ".###."],
    "z": [".....", ".....", "#####", "...#.", "..#..", ".#...", "#####"],
    "0": [".###.", "#...#", "#..##", "#.#.#", "##..#", "#...#", ".###."],
    "1": ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."],
    "2": [".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"],
    "3": ["####.", "....#", "....#", ".###.", "....#", "....#", "####."],
    "4": ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
    "5": ["#####", "#....", "####.", "....#", "....#", "#...#", ".###."],
    "6": [".###.", "#....", "#....", "####.", "#...#", "#...#", ".###."],
    "7": ["#####", "....#", "...#.", "..#..", ".#...", ".#...", ".#..."],
    "8": [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
    "9": [".###.", "#...#", "#...#", ".####", "....#", "....#", ".###."],
    " ": ["...", "...", "...", "...", "...", "...", "..."],
    ".": [".", ".", ".", ".", ".", ".", "#"],
    ",": ["..", "..", "..", "..", "..", "..", ".#", "#."],
    "!": ["#", "#", "#", "#", "#", ".", "#"],
    "?": [".###.", "#...#", "....#", "...#.", "..#..", ".....", "..#.."],
    ":": [".", ".", "#", ".", ".", ".", "#"],
    "-": ["....", "....", "....", "####", "....", "....", "...."],
    "'": ["#", "#", ".", ".", ".", ".", "."],
    "/": ["....#", "....#", "...#.", "..#..", ".#...", "#....", "#...."],
    "%": ["##..#", "##..#", "...#.", "..#..", ".#...", "#..##", "#..##"],
}

# Acentos das minúsculas (linhas 0-1), alinhados pela direita/centro conforme a largura do glifo.
_ACCENTS: dict[str, tuple[str, str]] = {
    "acute": ("...#.", "..#.."),
    "grave": (".#...", "..#.."),
    "circ": ("..#..", ".#.#."),
    "tilde": (".##.#", "#..#."),
}
_ACCENTED: dict[str, tuple[str, str]] = {
    "á": ("a", "acute"), "à": ("a", "grave"), "â": ("a", "circ"), "ã": ("a", "tilde"),
    "é": ("e", "acute"), "ê": ("e", "circ"), "ó": ("o", "acute"), "ô": ("o", "circ"),
    "õ": ("o", "tilde"), "ú": ("u", "acute"), "í": ("i", "acute"),
}


def _build_font() -> dict[str, list[str]]:
    font = {ch: rows + ["." * len(rows[0])] * (9 - len(rows)) for ch, rows in _GLYPHS.items()}
    for ch, (base, accent) in _ACCENTED.items():
        rows = list(font[base])
        width = len(rows[0])
        top, bottom = _ACCENTS[accent]
        if width < 5:  # glifos estreitos (i): acento centralizado de 3 colunas
            top, bottom = top[1:4], bottom[1:4]
        rows[0], rows[1] = top, bottom
        font[ch] = rows
    c = list(font["c"])
    c[7], c[8] = ".#..", "##.."
    font["ç"] = c
    return font


FONT: dict[str, list[str]] = _build_font()
CELL_HEIGHT = 9
CAP_HEIGHT = 7


def hex_rgba(value: str) -> tuple[int, int, int, int]:
    value = value.lstrip("#")
    return int(value[0:2], 16), int(value[2:4], 16), int(value[4:6], 16), 255


def render_map(rows: list[str], palette: dict[str, str] = PALETTE) -> Image.Image:
    """Converte um mapa de caracteres em imagem RGBA ('.' = transparente)."""
    width = len(rows[0])
    if any(len(r) != width for r in rows):
        raise ValueError("mapa com linhas de larguras diferentes")
    img = np.zeros((len(rows), width, 4), dtype=np.uint8)
    for y, row in enumerate(rows):
        for x, ch in enumerate(row):
            if ch != ".":
                img[y, x] = hex_rgba(palette[ch])
    return Image.fromarray(img, "RGBA")


def _glyph(ch: str) -> list[str]:
    if ch not in FONT:
        raise KeyError(f"a fonte bitmap não tem o caractere {ch!r}")
    return FONT[ch]


def text_width(text: str) -> int:
    return sum(len(_glyph(ch)[0]) + 1 for ch in text) - 1 if text else 0


def draw_text(img: Image.Image, x: int, y: int, text: str, color: str) -> None:
    """Escreve `text` com a fonte bitmap; (x, y) = canto superior esquerdo da célula (linha 0)."""
    px = img.load()
    rgba = hex_rgba(color)
    for ch in text:
        glyph = _glyph(ch)
        for gy, row in enumerate(glyph):
            for gx, bit in enumerate(row):
                if bit == "#":
                    px[x + gx, y + gy] = rgba
        x += len(glyph[0]) + 1


def text_image(text: str, color: str, scale: int = 1, shadow: str | None = None) -> Image.Image:
    """Texto como imagem RGBA (altura = célula de 9 linhas), com sombra opcional de 1px, ampliado por inteiro."""
    w, h = text_width(text) + (1 if shadow else 0), CELL_HEIGHT + (1 if shadow else 0)
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    if shadow:
        draw_text(img, 1, 1, text, shadow)
    draw_text(img, 0, 0, text, color)
    return img.resize((w * scale, h * scale), Image.NEAREST) if scale > 1 else img


def signage() -> Image.Image:
    """Placa da recepção, 64x16: chapa azul-marinho com bisel, parafusos e "JGENTS"."""
    w, h = 64, 16
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    px = img.load()
    outline, top, face, bottom = hex_rgba("#1c2541"), hex_rgba("#3a4a70"), hex_rgba("#2a3656"), hex_rgba("#222b47")
    for y in range(h):
        for x in range(w):
            if x in (0, w - 1) and y in (0, h - 1):
                continue  # cantos arredondados
            if x in (0, w - 1) or y in (0, h - 1):
                px[x, y] = outline
            elif y == 1:
                px[x, y] = top
            elif y == h - 2:
                px[x, y] = bottom
            else:
                px[x, y] = face
    for sx in (3, w - 4):  # parafusos
        px[sx, 7] = hex_rgba("#c9d3e3")
        px[sx, 8] = hex_rgba("#7d8aa3")
    # texto centralizado com sombra de 1px; "J" âmbar (a cor do mark) e "GENTS" claro
    tx, ty = (w - text_width("JGENTS")) // 2, 4
    rest_x = tx + text_width("J") + 1
    draw_text(img, tx, ty + 1, "J", "#151c33")
    draw_text(img, rest_x, ty + 1, "GENTS", "#151c33")
    draw_text(img, tx, ty, "J", "#fac665")
    draw_text(img, rest_x, ty, "GENTS", "#f4f1ea")
    return img


def mark(size: int) -> Image.Image:
    if size == 32:
        return render_map(MARK_32)
    if size == 16:
        return render_map(MARK_16)
    raise ValueError(f"mark desenhado só existe em 16 e 32 px (pedido: {size})")
