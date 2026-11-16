"""Draws the Codeler logo (A, "team range") into every icon file VSCodium ships.
Run: python -I brand/make_icons.py   (from the codeler folder)
Shapes live here once; the SVGs and PNG/ICO/ICNS/BMP files are all generated from them."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
STABLE = ROOT / 'vscodium' / 'src' / 'stable'
RES = STABLE / 'resources'
MEDIA = STABLE / 'src' / 'vs' / 'workbench' / 'browser'

NAVY, BACK, FRONT, SNOW = '#081a30', '#1d5fa8', '#2b9bf4', '#e8f1ff'
# 64x64 design grid
PEAKS = [
    (BACK, [(6, 50), (22, 24), (34, 42)]),
    (BACK, [(30, 50), (44, 22), (58, 50)]),
    (FRONT, [(12, 50), (32, 14), (52, 50)]),
    (SNOW, [(26, 25), (32, 14), (38, 25), (35, 23), (32, 27), (29, 23)]),
]


def svg(tile=True, mono=None, opacity=None):
    pts = lambda p: ' '.join(f'{x},{y}' for x, y in p)
    body = ''.join(f'<polygon points="{pts(p)}" fill="{mono or c}"/>' for c, p in PEAKS if not (mono and c == SNOW))
    if mono:  # watermark: cut the snowcap out so the shape still reads in one colour
        body += f'<polygon points="{pts(PEAKS[3][1])}" fill="{mono}" fill-opacity="0.45"/>'
    bg = f'<rect width="64" height="64" rx="14" fill="{NAVY}"/>' if tile else ''
    op = f' opacity="{opacity}"' if opacity else ''
    return f'<svg width="64" height="64" viewBox="0 0 64 64"{op} xmlns="http://www.w3.org/2000/svg">{bg}{body}</svg>\n'


def png(size, tile=True, pad=0.0):
    """Render at 4x then shrink, for smooth edges without an SVG renderer."""
    S = size * 4
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    inset = S * pad
    k = (S - 2 * inset) / 64
    if tile:
        d.rounded_rectangle([inset, inset, S - inset - 1, S - inset - 1], radius=14 * k, fill=NAVY)
    for c, p in PEAKS:
        d.polygon([(inset + x * k, inset + y * k) for x, y in p], fill=c)
    return im.resize((size, size), Image.LANCZOS)


def on_bg(im, bg, size, logo, top=None):
    canvas = Image.new('RGB', size, bg)
    icon = png(logo)
    x = (size[0] - logo) // 2
    y = (size[1] - logo) // 2 if top is None else top
    canvas.paste(icon, (x, y), icon)
    return canvas


def main():
    master = png(1024)
    master.save(ROOT / 'brand' / 'codeler-1024.png')
    (ROOT / 'brand' / 'codeler.svg').write_text(svg())

    # Windows
    master.save(RES / 'win32' / 'code.ico', sizes=[(s, s) for s in (16, 20, 24, 32, 48, 64, 96, 128, 256)])
    png(150).save(RES / 'win32' / 'code_150x150.png')
    png(70).save(RES / 'win32' / 'code_70x70.png')
    font = None
    for f in ('C:/Windows/Fonts/segoeuib.ttf', 'C:/Windows/Fonts/arialbd.ttf'):
        if Path(f).exists():
            font = f
            break
    for scale, (w, h) in {100: (164, 314), 125: (192, 386), 150: (246, 459), 175: (273, 556), 200: (328, 604), 225: (355, 700), 250: (410, 797)}.items():
        logo = int(w * 0.55)
        img = on_bg(None, NAVY, (w, h), logo, top=int(h * 0.30))
        if font:
            d = ImageDraw.Draw(img)
            ft = ImageFont.truetype(font, int(w * 0.13))
            tw = d.textlength('Codeler', font=ft)
            d.text(((w - tw) / 2, int(h * 0.30) + logo + w * 0.06), 'Codeler', fill=SNOW, font=ft)
        img.save(RES / 'win32' / f'inno-big-{scale}.bmp')
    for scale, (w, h) in {100: (55, 55), 125: (64, 68), 150: (83, 80), 175: (92, 97), 200: (110, 106), 225: (119, 123), 250: (138, 140)}.items():
        on_bg(None, '#ffffff', (w, h), int(min(w, h) * 0.86)).save(RES / 'win32' / f'inno-small-{scale}.bmp')

    # macOS: Apple's grid leaves ~10% margin around the tile
    png(1024, pad=0.1).save(RES / 'darwin' / 'code.icns')

    # Linux + web server
    master.save(RES / 'linux' / 'code.png')
    (RES / 'linux' / 'code.svg').write_text(svg())
    png(192).save(RES / 'server' / 'code-192.png')
    png(512).save(RES / 'server' / 'code-512.png')
    master.save(RES / 'server' / 'favicon.ico', sizes=[(s, s) for s in (16, 24, 32, 48, 64, 128, 256)])

    # In-app: title-bar logo and the empty-editor watermark
    (MEDIA / 'media' / 'code-icon.svg').write_text(svg())
    ed = MEDIA / 'parts' / 'editor' / 'media'
    (ed / 'letterpress-dark.svg').write_text(svg(False, '#ffffff', 0.12))
    (ed / 'letterpress-hcDark.svg').write_text(svg(False, '#ffffff', 0.5))
    (ed / 'letterpress-light.svg').write_text(svg(False, '#000000', 0.12))
    (ed / 'letterpress-hcLight.svg').write_text(svg(False, '#000000', 0.5))
    print('icons written')


if __name__ == '__main__':
    main()
