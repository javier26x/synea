"""Genera los iconos de Synea: monograma "S" sobre el verde de la marca.

USO (desde la raiz del repo):
    python3 scripts/gen-icons.py

Sin dependencias: rasteriza la S como el trazo de dos arcos y escribe el PNG a mano.
Cuando exista un logo real, se reemplaza subiendolo desde el panel (Configuracion > Logo).
"""
import math, struct, zlib

JADE   = (0x2f, 0x5d, 0x50)
BRONZE = (0xb0, 0x8b, 0x57)
IVORY  = (0xf8, 0xf5, 0xf0)
SS = 4  # supersampling


def s_path(cx, cy, k, steps=900):
    """Puntos del trazo de la S: arco superior + arco inferior, tangentes en el centro."""
    pts = []
    for a0, a1, ccy in ((90, 370, -0.5), (270, 550, 0.5)):
        c = (cx, cy + ccy * k)
        for i in range(steps):
            t = math.radians(a0 + (a1 - a0) * i / (steps - 1))
            pts.append((c[0] + 0.5 * k * math.cos(t), c[1] + 0.5 * k * math.sin(t)))
    return pts


def render(n, *, shape='rounded', pad=0.0, ring=False):
    """Devuelve un buffer RGBA de n x n."""
    m = n * SS
    cx = cy = m / 2.0
    k = 0.26 * m * (1 - pad)          # media altura de la S
    stroke = 0.26 * k
    pts = s_path(cx, cy, k)
    half = stroke / 2.0
    cell = max(1.0, half)
    # Rejilla espacial para no comparar cada pixel contra los 1800 puntos.
    grid = {}
    for px, py in pts:
        grid.setdefault((int(px // cell), int(py // cell)), []).append((px, py))

    radius = 0.22 * m                  # esquinas del cuadrado redondeado
    r_out = m / 2.0
    r_ring_o, r_ring_i = r_out * 0.955, r_out * 0.915

    acc = [[0] * (n * n) for _ in range(4)]
    for y in range(m):
        gy = int(y // cell)
        for x in range(m):
            # --- fondo ---
            if shape == 'circle':
                d = math.hypot(x - cx, y - cy)
                inside = d <= r_out
            elif shape == 'square':
                inside = True
            else:
                dx = max(radius - x, x - (m - radius), 0.0)
                dy = max(radius - y, y - (m - radius), 0.0)
                inside = math.hypot(dx, dy) <= radius
            if not inside:
                continue
            col = JADE
            if ring:
                d = math.hypot(x - cx, y - cy)
                if r_ring_i <= d <= r_ring_o:
                    col = BRONZE
            # --- monograma ---
            gx = int(x // cell)
            best = half + 1.0
            for ox in (-1, 0, 1):
                for oy in (-1, 0, 1):
                    for px, py in grid.get((gx + ox, gy + oy), ()):
                        dd = math.hypot(px - x, py - y)
                        if dd < best:
                            best = dd
                            if dd < half:
                                break
                    if best < half:
                        break
                if best < half:
                    break
            if best <= half:
                col = IVORY
            i = (y // SS) * n + (x // SS)
            acc[0][i] += col[0]; acc[1][i] += col[1]; acc[2][i] += col[2]; acc[3][i] += 1

    f = SS * SS
    buf = bytearray()
    for y in range(n):
        buf.append(0)
        for x in range(n):
            i = y * n + x
            cnt = acc[3][i]
            if cnt == 0:
                buf += b'\x00\x00\x00\x00'
            else:
                buf += bytes((round(acc[0][i] / cnt), round(acc[1][i] / cnt),
                              round(acc[2][i] / cnt), round(cnt * 255 / f)))
    return bytes(buf)


def write_png(path, n, raw):
    def chunk(tag, data):
        c = tag + data
        return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)
    png = (b'\x89PNG\r\n\x1a\n'
           + chunk(b'IHDR', struct.pack('>IIBBBBB', n, n, 8, 6, 0, 0, 0))
           + chunk(b'IDAT', zlib.compress(raw, 9))
           + chunk(b'IEND', b''))
    open(path, 'wb').write(png)
    print(path, n, len(png), 'bytes')


write_png('icons/icon-192.png', 192, render(192))
write_png('icons/icon-512.png', 512, render(512))
write_png('icons/icon-maskable-512.png', 512, render(512, shape='square', pad=0.22))
write_png('icons/apple-touch-icon.png', 180, render(180))
write_png('icons/logo.png', 512, render(512, shape='circle', ring=True))
