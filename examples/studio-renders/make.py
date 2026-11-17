"""Render the studio-renders example media: one sphere on a studio floor, lit four ways. Run: python3 make.py
(needs Pillow and ffmpeg). Pure Python, no numpy: only the sphere's pixels are shaded per frame."""

import math
import subprocess
from pathlib import Path

from PIL import Image, ImageFilter

HERE = Path(__file__).parent
W, H, FPS, SECONDS = 480, 360, 24, 3
CENTRE, RADIUS, HORIZON = (W / 2, H * 0.44), H * 0.25, H * 0.62
KEY = (-0.55, 0.55, 0.63)

# [Agent] One setup per card: the backdrop tint, the sphere's base colour, and the second light (colour,
# direction, strength). The key light is the same in all of them, so only the second light changes.
SETUPS = {
    "key-only": dict(tint=(58, 47, 42), albedo=(0.78, 0.74, 0.70), light=None),
    "key-right": dict(tint=(50, 46, 44), albedo=(0.78, 0.74, 0.70), light=None, key=(0.6, 0.45, 0.66)),
    "warm-rim": dict(
        tint=(107, 52, 23), albedo=(0.95, 0.55, 0.25), light=((255, 180, 107), (0.8, 0.35, -0.5), 1.4)
    ),
    "cool-fill": dict(
        tint=(27, 75, 94), albedo=(0.35, 0.72, 0.80), light=((150, 205, 255), (-0.75, 0.1, 0.3), 0.7)
    ),
    "top-gel": dict(
        tint=(60, 42, 107), albedo=(0.68, 0.45, 0.95), light=((255, 120, 210), (0.0, 1.0, -0.2), 1.3)
    ),
}


def normalize(v):
    n = math.sqrt(sum(c * c for c in v))
    return tuple(c / n for c in v)


def backdrop(tint):
    image = Image.new("RGB", (W, H))
    pixels = image.load()
    for y in range(H):
        for x in range(W):
            if y < HORIZON:
                glow = max(0.0, 1 - math.hypot((x - W * 0.4) / W, (y - H * 0.05) / H) * 1.3)
                pixels[x, y] = tuple(int(8 + c * glow) for c in tint)
            else:
                depth = (y - HORIZON) / (H - HORIZON)
                pixels[x, y] = tuple(int(10 + c * (0.25 + 0.3 * depth)) for c in tint)
    shadow = Image.new("L", (W, H), 0)
    sx, sy = CENTRE[0], CENTRE[1] + RADIUS * 0.98
    for y in range(int(sy - 14), int(sy + 14)):
        for x in range(int(sx - RADIUS * 1.2), int(sx + RADIUS * 1.2)):
            d = ((x - sx) / (RADIUS * 1.15)) ** 2 + ((y - sy) / 12) ** 2
            if d < 1:
                shadow.putpixel((x, y), int(170 * (1 - d)))
    return Image.composite(Image.new("RGB", (W, H)), image, shadow.filter(ImageFilter.GaussianBlur(5)))


# [Agent] Lambert diffuse from the key and the second light, a Blinn specular highlight from the key, and a
# rim term that grows toward the silhouette, so a coloured back light wraps the edge like it does in a studio.
def shade(image, albedo, light, angle, key=KEY):
    pixels = image.load()
    key = normalize(key)
    if light:
        colour, (lx, ly, lz), strength = light
        second = normalize(
            (lx * math.cos(angle) - lz * math.sin(angle), ly, lx * math.sin(angle) + lz * math.cos(angle))
        )
    half = normalize((key[0], key[1], key[2] + 1))
    cx, cy = CENTRE
    for y in range(int(cy - RADIUS), int(cy + RADIUS) + 1):
        for x in range(int(cx - RADIUS), int(cx + RADIUS) + 1):
            nx, ny = (x - cx) / RADIUS, -(y - cy) / RADIUS
            r2 = nx * nx + ny * ny
            if r2 > 1:
                continue
            nz = math.sqrt(1 - r2)
            diffuse = max(0.0, nx * key[0] + ny * key[1] + nz * key[2])
            spec = max(0.0, nx * half[0] + ny * half[1] + nz * half[2]) ** 40
            rgb = [255 * a * (0.06 + 0.85 * diffuse) + 230 * spec for a in albedo]
            if light:
                lit = max(0.0, nx * second[0] + ny * second[1] + nz * second[2])
                rim = (1 - nz) ** 1.5
                rgb = [
                    c + k * a * strength * (0.45 * lit + 0.9 * rim * lit)
                    for c, k, a in zip(rgb, colour, albedo)
                ]
            edge = min(1.0, (1 - r2) * RADIUS / 1.5)
            old = pixels[x, y]
            pixels[x, y] = tuple(int(o + (min(255, c) - o) * edge) for o, c in zip(old, rgb))
    return image


def still(name):
    setup = SETUPS[name]
    return shade(backdrop(setup["tint"]), setup["albedo"], setup["light"], 0.0, setup.get("key", KEY))


def video(name, out):
    setup = SETUPS[name]
    base = backdrop(setup["tint"])
    args = f"ffmpeg -v error -y -f rawvideo -pix_fmt rgb24 -s {W}x{H} -r {FPS} -i -"
    args += " -c:v libx264 -preset slow -crf 24 -pix_fmt yuv420p -movflags +faststart"
    ffmpeg = subprocess.Popen([*args.split(), str(out)], stdin=subprocess.PIPE)
    # [Agent] The second light swings ±35° and back once per clip, so the loop is seamless.
    for i in range(FPS * SECONDS):
        angle = math.radians(35) * math.sin(2 * math.pi * i / (FPS * SECONDS))
        ffmpeg.stdin.write(shade(base.copy(), setup["albedo"], setup["light"], angle).tobytes())
    ffmpeg.stdin.close()
    ffmpeg.wait()


# [Agent] A colour grade as plain per-channel curves: lift the shadows, tint them teal and the highlights
# warm.
def grade(image, lift, shadows, highlights):
    def curve(channel):
        return lambda v: int(
            min(
                255,
                lift
                + v * (1 - lift / 255)
                + shadows[channel] * (1 - v / 255)
                + highlights[channel] * v / 255,
            )
        )

    return Image.merge("RGB", [band.point(curve(i)) for i, band in enumerate(image.split())])


def main():
    for folder in ("in", "out"):
        (HERE / folder).mkdir(exist_ok=True)
    still("key-only").save(HERE / "in" / "key-only.png", optimize=True)
    still("key-right").save(HERE / "in" / "key-right.png", optimize=True)
    for name in ("warm-rim", "cool-fill", "top-gel"):
        video(name, HERE / "out" / f"{name}.mp4")
        still(name).save(HERE / "out" / f"{name}.png", optimize=True)
    warm = Image.open(HERE / "out" / "warm-rim.png")
    grade(warm, 0, (0, 0, 0), (0, 0, 0)).save(HERE / "out" / "grade-neutral.png", optimize=True)
    grade(warm, 12, (-6, 10, 18), (14, 4, -10)).save(HERE / "out" / "grade-teal-orange.png", optimize=True)


if __name__ == "__main__":
    main()
