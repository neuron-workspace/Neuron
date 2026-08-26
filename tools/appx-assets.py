"""Draw the Windows Store tile set from Neuron's mark.

Run when the brand changes; the output is committed under build/appx:

    python tools/appx-assets.py

Why this draws rather than resizes. electron-builder looks for a directory
called `appx` under buildResources and, finding none, quietly substitutes its
own sample images -- the Electron atom. That is what shipped in
0.4.4-beta.3 and what Microsoft rejected under certification rule 10.1.1.11,
"app must not use default or placeholder images".

build/icon.png is 640x640, and the largest tile at 400% scale wants 1240px, so
resizing would mean upscaling the very images certification is looking at. The
mark in build/icon.svg is five rotated polygons on a rounded rectangle, which
is cheap to draw exactly at any size, so that is what happens here. Keep this
in step with build/icon.svg by hand -- it is deliberately not an SVG renderer,
because pulling one in for eight polygons is not worth the dependency.
"""
import math
import os
from PIL import Image, ImageDraw


def scaled(base, scale):
    """Half-up, because Python's round() is not.

    round(106.5) is 106 in Python and 107 almost everywhere else, including the
    Windows scaling convention and the test that checks these files. Two
    rounding rules disagreeing over a half-pixel is not worth debugging twice.
    """
    return math.floor(base * scale / 100 + 0.5)

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
OUT = os.path.join(ROOT, 'build', 'appx')

# Straight from build/icon.svg, in its 512-unit viewBox.
VIEWBOX = 512
CORNER_RADIUS = 112
PLATE = (0, 0, 0, 255)
MARK = (255, 255, 255, 255)
BRANCH = [(-24, -136), (24, -136), (16, 6), (-16, 6)]
BRANCHES = 5

# Supersample, then average down. These are small images whose edges are the
# whole design, and aliasing on a 16px taskbar icon is exactly what looks cheap.
SS = 4


def _asterisk(draw, cx, cy, unit):
    """The five-branch mark, centred on (cx, cy), scaled so 512 units == unit."""
    k = unit / VIEWBOX
    for i in range(BRANCHES):
        angle = math.radians(i * (360 / BRANCHES))
        cos, sin = math.cos(angle), math.sin(angle)
        points = [
            (cx + (x * cos - y * sin) * k, cy + (x * sin + y * cos) * k)
            for x, y in BRANCH
        ]
        draw.polygon(points, fill=MARK)


def icon(size):
    """The full app icon: the mark on its rounded black plate, edge to edge."""
    img = Image.new('RGBA', (size * SS, size * SS), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle(
        [0, 0, size * SS - 1, size * SS - 1],
        radius=CORNER_RADIUS / VIEWBOX * size * SS,
        fill=PLATE,
    )
    _asterisk(d, size * SS / 2, size * SS / 2, size * SS)
    return img.resize((size, size), Image.LANCZOS)


# The mark does not fill its own box: the branches reach 136 units out of a
# 512-unit viewBox, so the drawn shape is only 2*136/512 across. Scaling by the
# box would leave the tiles looking mostly empty, so `coverage` means the
# fraction of the tile the VISIBLE mark should span, and this converts.
MARK_EXTENT = 2 * 136 / VIEWBOX


def tile(width, height, coverage=0.60):
    """A tile: the bare mark, centred, transparent behind it.

    The tile's own background comes from `backgroundColor` in the appx config,
    so painting a black plate here would only put a slightly-different black
    square inside it.
    """
    img = Image.new('RGBA', (width * SS, height * SS), (0, 0, 0, 0))
    unit = min(width, height) * SS * coverage / MARK_EXTENT
    _asterisk(ImageDraw.Draw(img), width * SS / 2, height * SS / 2, unit)
    return img.resize((width, height), Image.LANCZOS)


# The names electron-builder maps into AppxManifest.xml. LargeTile and SmallTile
# are its spellings for Square310x310Logo and Square71x71Logo -- see
# app-builder-lib/out/targets/AppxTarget.js.
SQUARE_TILES = {
    'Square44x44Logo': 44,
    'Square150x150Logo': 150,
    'SmallTile': 71,
    'LargeTile': 310,
    'StoreLogo': 50,
}
SCALES = [100, 125, 150, 200, 400]
# Sizes Windows asks for by name: taskbar, Start list, jump lists, Alt+Tab.
TARGET_SIZES = [16, 20, 24, 30, 32, 36, 40, 48, 56, 60, 64, 72, 80, 96, 256]


def main():
    os.makedirs(OUT, exist_ok=True)
    written = []

    def save(name, img):
        path = os.path.join(OUT, name)
        img.save(path, 'PNG', optimize=True)
        written.append((name, img.size))

    for name, base in SQUARE_TILES.items():
        # Square44x44Logo and StoreLogo are the app's own icon; the bigger tiles
        # are the mark on the tile plate.
        render = icon if name in ('Square44x44Logo', 'StoreLogo') else (lambda s: tile(s, s))
        for scale in SCALES:
            size = scaled(base, scale)
            save(f'{name}.png' if scale == 100 else f'{name}.scale-{scale}.png', render(size))

    for scale in SCALES:
        w, h = scaled(310, scale), scaled(150, scale)
        save('Wide310x150Logo.png' if scale == 100 else f'Wide310x150Logo.scale-{scale}.png', tile(w, h, 0.42))

    # Target-size variants exist so Windows never rescales the 44px tile for a
    # 16px taskbar slot. "altform-unplated" is the one drawn without the system
    # plate behind it, which is what the taskbar actually uses.
    for size in TARGET_SIZES:
        save(f'Square44x44Logo.targetsize-{size}.png', icon(size))
        save(f'Square44x44Logo.targetsize-{size}_altform-unplated.png', icon(size))

    for name, size in sorted(written):
        print(f'  {name:<52} {size[0]}x{size[1]}')
    print(f'\n{len(written)} assets written to build/appx')


if __name__ == '__main__':
    main()
