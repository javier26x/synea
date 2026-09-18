"""Genera los iconos de Synea a partir del logo real.

USO (desde la raiz del repo):
    pip install pillow
    python3 scripts/gen-icons.py

Fuente: scripts/logo-synea.png, el logo de Synea tal como lo publica el propio
negocio (monograma + "Synea Studio Spa" sobre fondo claro). De ahi se recorta
solo el monograma, porque todos los lugares donde se usa el logo en la app son
circulos de 52 a 96 px: la palabra no se leeria.

Los colores del monograma son los del logo, no los del sitio: el verde del logo
(#12361b) es mas oscuro que el --jade de la paleta (#2f5d50).

Para volver al icono sobre fondo verde en vez de marfil, cambia FONDO por VERDE.
"""
import sys

try:
    from PIL import Image, ImageDraw
except ImportError:
    sys.exit('Falta Pillow: pip install pillow')

ORIGEN = 'scripts/logo-synea.png'

VERDE = (0x12, 0x36, 0x1b)     # trazo del monograma, muestreado del logo
MARFIL = (0xf8, 0xf5, 0xf0)    # --ivory del sitio y background_color del manifest
BRONCE = (0xb0, 0x8b, 0x57)    # --bronze, el anillo de logo.png
FONDO = MARFIL

SS = 4  # supersampling para bordes limpios


# ------------------------------------------------------- recorte del monograma
def extraer_monograma(ruta):
    """Devuelve el monograma en RGBA con fondo transparente.

    El logo trae el monograma arriba y el texto abajo. Se etiquetan las manchas
    de tinta y se toma la que empieza mas arriba (el trazo) junto con las que
    caen dentro de su caja (las dos chispas doradas).
    """
    im = Image.open(ruta).convert('RGB')
    w, h = im.size
    px = im.load()

    # Tinta = todo lo que se separa del fondo claro.
    tinta = [[min(px[x, y]) < 205 for x in range(w)] for y in range(h)]

    visto = [[False] * w for _ in range(h)]
    manchas = []
    for y0 in range(h):
        for x0 in range(w):
            if not tinta[y0][x0] or visto[y0][x0]:
                continue
            pila, caja = [(x0, y0)], [x0, y0, x0, y0]
            visto[y0][x0] = True
            while pila:
                x, y = pila.pop()
                caja = [min(caja[0], x), min(caja[1], y), max(caja[2], x), max(caja[3], y)]
                for dx in (-1, 0, 1):
                    for dy in (-1, 0, 1):
                        nx, ny = x + dx, y + dy
                        if 0 <= nx < w and 0 <= ny < h and tinta[ny][nx] and not visto[ny][nx]:
                            visto[ny][nx] = True
                            pila.append((nx, ny))
            manchas.append(caja)

    trazo = min(manchas, key=lambda c: (c[1], c[0]))
    x0, y0, x1, y1 = trazo
    for c in manchas:
        if c[0] >= trazo[0] and c[2] <= trazo[2] and c[1] >= trazo[1] and c[3] <= trazo[3]:
            x0, y0 = min(x0, c[0]), min(y0, c[1])
            x1, y1 = max(x1, c[2]), max(y1, c[3])

    # Alfa por distancia al fondo; el color se reconstruye sin premultiplicar
    # para que el dorado de las chispas no se lave contra el fondo nuevo.
    recorte = im.crop((x0, y0, x1 + 1, y1 + 1))
    rw, rh = recorte.size
    rpx = recorte.load()
    marca = Image.new('RGBA', (rw, rh), (0, 0, 0, 0))
    mpx = marca.load()
    for y in range(rh):
        for x in range(rw):
            r, g, b = rpx[x, y]
            a = (255 - min(r, g, b)) / 255.0
            if a <= 0.02:
                continue
            col = tuple(min(255, max(0, round((c - 255 * (1 - a)) / a))) for c in (r, g, b))
            mpx[x, y] = col + (round(a * 255),)
    return marca


def escalar(marca, lado):
    """Redimensiona premultiplicando, para que no aparezca un halo claro."""
    pre = Image.new('RGBA', marca.size)
    ppx, mpx = pre.load(), marca.load()
    for y in range(marca.size[1]):
        for x in range(marca.size[0]):
            r, g, b, a = mpx[x, y]
            ppx[x, y] = (r * a // 255, g * a // 255, b * a // 255, a)
    pre = pre.resize((lado, lado), Image.LANCZOS)
    out = Image.new('RGBA', pre.size)
    opx, ppx = out.load(), pre.load()
    for y in range(lado):
        for x in range(lado):
            r, g, b, a = ppx[x, y]
            if a == 0:
                continue
            col = (min(255, r * 255 // a), min(255, g * 255 // a), min(255, b * 255 // a))
            # El original son 48 px: al ampliarlo el borde queda difuso. Esta
            # curva sobre el alfa lo vuelve a cerrar sin dejarlo dentado.
            na = min(255, max(0, round((a - 128) * 2.1 + 128)))
            if na == 0:
                continue
            opx[x, y] = col + (na,)
    return out


# ---------------------------------------------------------------- composicion
def render(marca, n, *, forma='rounded', escala=0.62, anillo=False):
    m = n * SS
    lienzo = Image.new('RGBA', (m, m), (0, 0, 0, 0))
    d = ImageDraw.Draw(lienzo)
    if forma == 'circle':
        d.ellipse((0, 0, m - 1, m - 1), fill=FONDO + (255,))
        if anillo:
            grosor = max(2, round(m * 0.018))
            r = m * 0.045
            d.ellipse((r, r, m - 1 - r, m - 1 - r), outline=BRONCE + (255,), width=grosor)
    elif forma == 'square':
        d.rectangle((0, 0, m - 1, m - 1), fill=FONDO + (255,))
    else:
        d.rounded_rectangle((0, 0, m - 1, m - 1), radius=m * 0.22, fill=FONDO + (255,))

    # El monograma es mas alto que ancho: la escala manda sobre el alto.
    alto = round(m * escala)
    ancho = round(alto * marca.size[0] / marca.size[1])
    esc = escalar(marca, max(alto, ancho))
    esc = esc.resize((ancho, alto), Image.LANCZOS)
    lienzo.alpha_composite(esc, ((m - ancho) // 2, (m - alto) // 2))
    return lienzo.resize((n, n), Image.LANCZOS)


def guardar(im, ruta):
    # Son tres colores planos más el antialias: en paleta pesan una fracción de
    # lo que pesan en RGBA, y el logo se pide en cada carga de la página.
    paleta = im.quantize(colors=64, method=Image.FASTOCTREE)
    paleta.save(ruta, optimize=True)
    print(ruta, im.size[0])


marca = extraer_monograma(ORIGEN)
print('monograma', marca.size[0], 'x', marca.size[1], 'px en el logo original')

guardar(render(marca, 192), 'icons/icon-192.png')
guardar(render(marca, 512), 'icons/icon-512.png')
guardar(render(marca, 512, forma='square', escala=0.44), 'icons/icon-maskable-512.png')
# iOS recorta el icono por su cuenta y rellena de negro lo transparente, así que
# este va cuadrado y opaco, sin esquinas redondeadas propias.
guardar(render(marca, 180, forma='square', escala=0.56), 'icons/apple-touch-icon.png')
guardar(render(marca, 512, forma='circle', escala=0.56, anillo=True), 'icons/logo.png')
