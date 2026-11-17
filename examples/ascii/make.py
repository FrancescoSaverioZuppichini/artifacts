"""Render the ASCII toys of this page to MP4 and write page.json.
Run: python3 make.py (needs Pillow and ffmpeg)."""

import colorsys
import json
import math
import random
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).parent
COLS, ROWS, FPS, SECONDS = 100, 42, 24, 6
RAMP = ".,-~:;=!*#$@"
BACKGROUND = (12, 12, 14)
PALETTES = {
    "mono": lambda level: (225, 225, 225),
    "amber": lambda level: (255, int(120 + 70 * level), int(20 + 40 * level)),
    "green": lambda level: (int(40 + 120 * level), 255, int(60 + 80 * level)),
}


def load_font(size=15):
    for path in ["/System/Library/Fonts/Menlo.ttc", "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"]:
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default(size)


FONT = load_font()
CELL_W = round(FONT.getlength("M"))
CELL_H = 18
WIDTH, HEIGHT = COLS * CELL_W // 2 * 2, ROWS * CELL_H


# [Agent] A frame is a grid of (char, level) with level in 0..1. Each row is drawn once per colour level, with
# the other cells blanked, so a frame costs a few hundred draw calls instead of one per character.
def draw(grid, colour):
    image = Image.new("RGB", (WIDTH, HEIGHT), BACKGROUND)
    pen = ImageDraw.Draw(image)
    for y, row in enumerate(grid):
        for level in sorted({lv for ch, lv in row if ch != " "}):
            text = "".join(ch if lv == level else " " for ch, lv in row)
            pen.text((0, y * CELL_H), text, font=FONT, fill=colour(level))
    return image


def encode(frames, name, colour, stills=()):
    out = HERE / "out" / f"{name}.mp4"
    out.parent.mkdir(exist_ok=True)
    args = f"ffmpeg -v error -y -f rawvideo -pix_fmt rgb24 -s {WIDTH}x{HEIGHT} -r {FPS} -i -"
    args += " -c:v libx264 -preset slow -crf 26 -pix_fmt yuv420p -movflags +faststart"
    ffmpeg = subprocess.Popen([*args.split(), str(out)], stdin=subprocess.PIPE)
    for i, grid in enumerate(frames):
        image = draw(grid, colour)
        if i in stills:
            (HERE / "stills").mkdir(exist_ok=True)
            image.save(HERE / "stills" / f"{name}-{i:03d}.png", optimize=True)
        ffmpeg.stdin.write(image.tobytes())
    ffmpeg.stdin.close()
    ffmpeg.wait()
    return out


def shade(light):
    level = max(0.0, min(0.999, light))
    return RAMP[int(level * len(RAMP))], round(level * len(RAMP)) / len(RAMP)


# [Agent] The classic spinning torus: a circle of radius R1 swept around the y axis at distance R2, turned on
# two axes (A and B), projected with perspective, and shaded by the surface normal dotted with a light from
# behind the viewer. The z-buffer keeps the nearest point per cell. Cells are twice as tall as wide, so y is
# halved.
def donut(t):
    a, b = 1.0 + t * 1.2, 1.0 + t * 0.6
    r1, r2, k2 = 1.0, 2.0, 8.0
    k1 = ROWS * k2 * 3 / (8 * (r1 + r2)) * 1.6
    grid = [[(" ", 0)] * COLS for _ in range(ROWS)]
    depth = [[0.0] * COLS for _ in range(ROWS)]
    sa, ca, sb, cb = math.sin(a), math.cos(a), math.sin(b), math.cos(b)
    for i in range(90):
        theta = i * 2 * math.pi / 90
        st, ct = math.sin(theta), math.cos(theta)
        cx, cy = r2 + r1 * ct, r1 * st
        for j in range(240):
            phi = j * 2 * math.pi / 240
            sp, cp = math.sin(phi), math.cos(phi)
            x = cx * (cb * cp + sa * sb * sp) - cy * ca * sb
            y = cx * (sb * cp - sa * cb * sp) + cy * ca * cb
            ooz = 1 / (k2 + ca * cx * sp + cy * sa)
            col, row = int(COLS / 2 + k1 * ooz * x), int(ROWS / 2 - k1 * ooz * y / 2)
            light = cp * ct * sb - ca * ct * sp - sa * st + cb * (ca * st - ct * sa * sp)
            if 0 <= col < COLS and 0 <= row < ROWS and light > 0 and ooz > depth[row][col]:
                depth[row][col] = ooz
                grid[row][col] = shade(light / 1.5)
    return grid


# [Agent] A ray per cell hits a unit sphere; its normal is spun around y so the latitude/longitude checker
# turns, and lit by a fixed light from the upper left.
def sphere(t):
    grid = []
    light = (-0.5, 0.6, 0.62)
    for row in range(ROWS):
        line = []
        for col in range(COLS):
            x, y = (col - COLS / 2) / (ROWS * 0.9), -(row - ROWS / 2) / (ROWS * 0.45)
            if x * x + y * y > 1:
                line.append((" ", 0))
                continue
            z = math.sqrt(1 - x * x - y * y)
            lon = math.atan2(x, z) + t * 1.5
            checker = (int(lon / (math.pi / 6) + 100) + int((math.asin(y) + 2) / (math.pi / 8))) % 2
            lit = max(0.05, x * light[0] + y * light[1] + z * light[2])
            line.append(shade(lit * (0.55 + 0.45 * checker)))
        grid.append(line)
    return grid


def plasma(t):
    grid = []
    for row in range(ROWS):
        line = []
        for col in range(COLS):
            x, y = col / 6, row / 3
            v = (
                math.sin(x + t)
                + math.sin(y + t * 1.3)
                + math.sin((x + y + t) / 2)
                + math.sin(math.hypot(x - 8, y - 7) - t * 2)
            )
            line.append(shade((v + 4) / 8))
        grid.append(line)
    return grid


# [Agent] Matrix rain: each column has a falling head with a fading tail; the seed is fixed so every run of
# this script writes the same video.
def rain_frames(count):
    rng = random.Random(7)
    heads = [rng.uniform(-ROWS, ROWS) for _ in range(COLS)]
    speeds = [rng.uniform(0.3, 0.9) for _ in range(COLS)]
    glyphs = [[rng.choice("01ABCDEFXYZ$#*+=<>") for _ in range(COLS)] for _ in range(ROWS)]
    for _ in range(count):
        grid = []
        for row in range(ROWS):
            line = []
            for col in range(COLS):
                behind = heads[col] - row
                level = 0 if behind < 0 or behind > 16 else 1 - behind / 16
                line.append((glyphs[row][col], round(level, 1)) if level > 0 else (" ", 0))
            grid.append(line)
        heads = [h + s if h < ROWS + 16 else -rng.uniform(0, 10) for h, s in zip(heads, speeds)]
        if rng.random() < 0.5:
            glyphs[rng.randrange(ROWS)][rng.randrange(COLS)] = rng.choice("01ABCDEFXYZ$#*+=<>")
        yield grid


def rainbow(level):
    r, g, b = colorsys.hsv_to_rgb(0.55 + level * 0.5, 0.75, 0.35 + 0.65 * level)
    return int(r * 255), int(g * 255), int(b * 255)


def card(id, path, title, caption, badges, compare=None):
    size = f"{path.stat().st_size / 1e6:.1f} MB"
    item = {
        "id": id,
        "src": str(path.relative_to(HERE)),
        "title": title,
        "caption": caption,
        "badges": [*badges, size],
    }
    return item | ({"compare": compare} if compare else {})


def main():
    count = FPS * SECONDS
    times = [i / FPS for i in range(count)]
    donut_frames = [donut(t) for t in times]
    encode(donut_frames, "donut-mono", PALETTES["mono"], stills=(0, 30, 60, 90))
    encode(donut_frames, "donut-amber", PALETTES["amber"])
    sphere_out = encode((sphere(t) for t in times), "sphere", PALETTES["green"])
    plasma_out = encode((plasma(t) for t in times), "plasma", rainbow)
    rain_out = encode(rain_frames(count), "rain", PALETTES["green"])

    intro = (
        "Three more toys from the same renderer, written by `make.py` into this section of `page.json`. "
        "Generated text lives here because `{ }` and `<` need no escaping, unlike MDX prose."
    )
    toys = [
        card(
            "sphere",
            sphere_out,
            "checkered sphere",
            "a ray per cell, the normal spun round y",
            ["★", "green"],
        ),
        card("plasma", plasma_out, "plasma", "four sine waves summed, one hue per level", ["✅", "rainbow"]),
        card(
            "rain",
            rain_out,
            "matrix rain",
            "fixed seed, so every run writes the same video",
            ["❓ keep it?", "green"],
        ),
    ]
    section = {
        "id": "toys",
        "date": "Tue 17 Nov 2026 · 16:00",
        "title": "Other toys",
        "badges": ["✅ rendered", f"{FPS} fps", f"{COLS}×{ROWS} cells"],
        "blocks": [
            {"type": "Markdown", "text": intro},
            {"type": "Gallery", "title": "Videos", "items": toys},
            {"type": "Code", "title": "The plasma, in full", "text": PLASMA_SOURCE},
        ],
    }
    text = json.dumps({"sections": [section]}, ensure_ascii=False, indent=2) + "\n"
    target = HERE / "page.json"
    # [Agent] Rewrite only on a real change, via a temp file and a rename, so open tabs re-render only when
    # needed.
    if not target.exists() or target.read_text() != text:
        (HERE / "page.json.tmp").write_text(text)
        (HERE / "page.json.tmp").rename(target)


PLASMA_SOURCE = """def plasma(t):
    for row in range(ROWS):
        for col in range(COLS):
            x, y = col / 6, row / 3
            v = (math.sin(x + t) + math.sin(y + t * 1.3) + math.sin((x + y + t) / 2)
                 + math.sin(math.hypot(x - 8, y - 7) - t * 2))
            yield shade((v + 4) / 8)   # -4..4 → 0..1 → one of 12 characters"""

if __name__ == "__main__":
    main()
