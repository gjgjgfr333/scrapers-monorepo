#!/usr/bin/env python3
"""
Actor icon: SVG → 512×512 PNG with rounded transparent corners, ready for Apify Console.

    python3 -I scripts/render-icon.py actors/<name>/.actor/icon.svg     # writes actors/<name>/.actor/icon.png

Renders with macOS Quick Look (qlmanage, no extra installs) and cuts the corners with Pillow: Quick Look fills
transparent areas with white, so draw the background as a full-bleed square in the SVG and let this script round it.
"""
import pathlib
import shutil
import subprocess
import sys
import tempfile

from PIL import Image, ImageChops, ImageDraw

SIZE = 512
RADIUS = 112


def main():
    if len(sys.argv) not in (2, 3):
        sys.exit('usage: render-icon.py <icon.svg> [out.png]')
    svg = pathlib.Path(sys.argv[1]).resolve()
    out = pathlib.Path(sys.argv[2]).resolve() if len(sys.argv) == 3 else svg.with_suffix('.png')
    if not shutil.which('qlmanage'):
        sys.exit('qlmanage not found: this script needs macOS')

    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run(['qlmanage', '-t', '-s', str(SIZE), '-o', tmp, str(svg)], check=True, capture_output=True)
        rendered = pathlib.Path(tmp) / f'{svg.name}.png'
        if not rendered.exists():
            sys.exit(f'Quick Look did not render {svg}: check that it is valid SVG with width/height 512')
        image = Image.open(rendered).convert('RGBA').resize((SIZE, SIZE), Image.LANCZOS)

    # rounded mask drawn at 4× and scaled down for smooth corners
    mask = Image.new('L', (SIZE * 4, SIZE * 4), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, SIZE * 4 - 1, SIZE * 4 - 1], radius=RADIUS * 4, fill=255)
    mask = mask.resize((SIZE, SIZE), Image.LANCZOS)
    image.putalpha(ImageChops.multiply(image.getchannel('A'), mask))
    image.save(out)
    print(out)


if __name__ == '__main__':
    main()
