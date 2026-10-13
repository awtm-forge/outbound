# Builds the dashboard background: the supplied planet photo, rotated so its lit limb sweeps up to the top right
# of the workspace, plus thin orange light trails along the limb and a cool grey glow. usage: python3 -I make.py <photo> <out.webp> [preview.png]
import sys, math
from PIL import Image, ImageDraw, ImageFilter, ImageChops, ImageEnhance
src, out = sys.argv[1], sys.argv[2]
W, H = 2000, 1150                      # covers the workspace at 1.54x of a 1300px-wide reference
S = 1.538                              # asset px per workspace px
cx, cy, r = 1265 * S, 800 * S, 945 * S # planet circle, in asset px

photo = Image.open(src).convert('RGB')
# the photo's limb is a circle of radius ~1817 centred at (1000, 2017); scale it to our radius
k = r / 1817
photo = photo.resize((round(photo.width * k), round(photo.height * k)), Image.LANCZOS)
pcx, pcy = 1000 * k, 2017 * k          # circle centre in the scaled photo
ang = 40                               # rotate counter-clockwise so the lit top moves to the upper left
# rotate about the circle centre: pad so the centre is the image centre, then rotate
pad = round(max(pcy, photo.height - pcy, pcx, photo.width - pcx)) + 10
big = Image.new('RGB', (pad * 2, pad * 2), 'black')
big.paste(photo, (round(pad - pcx), round(pad - pcy)))
big = big.rotate(ang, resample=Image.BICUBIC, center=(pad, pad))
canvas = Image.new('RGB', (W, H), 'black')
canvas.paste(big, (round(cx - pad), round(cy - pad)))
# quieten the stars outside the planet a little and deepen the night side
mask_planet = Image.new('L', (W, H), 0); ImageDraw.Draw(mask_planet).ellipse((cx - r, cy - r, cx + r, cy + r), fill=255)
dim = ImageEnhance.Brightness(canvas).enhance(0.55)
canvas = Image.composite(canvas, dim, mask_planet)

def arc_layer(radius, width, color, blur, a0, a1):
    L = Image.new('RGB', (W, H), 'black'); d = ImageDraw.Draw(L)
    d.arc((cx - radius, cy - radius, cx + radius, cy + radius), a0, a1, fill=color, width=width)
    return L.filter(ImageFilter.GaussianBlur(blur)) if blur else L
glow = Image.new('RGB', (W, H), 'black')
# broad atmospheric glow, then fine trails at slightly different radii and lengths
for layer in [arc_layer(r + 6, 70, (150, 60, 10), 60, 200, 300),
              arc_layer(r + 2, 18, (255, 120, 30), 14, 205, 292),
              arc_layer(r - 1, 3, (255, 190, 110), 1.2, 208, 290),
              arc_layer(r + 26, 2, (230, 110, 40), 1.5, 214, 282),
              arc_layer(r + 52, 2, (170, 80, 30), 2, 222, 276),
              arc_layer(r - 34, 2, (120, 70, 40), 2, 212, 268),
              arc_layer(r + 90, 1, (110, 60, 30), 2.5, 228, 266)]:
    glow = ImageChops.add(glow, layer)
canvas = ImageChops.add(canvas, glow)
# cool grey light far to the upper left, as in the reference
cool = Image.new('RGB', (W, H), 'black'); ImageDraw.Draw(cool).ellipse((180, -520, 1150, 260), fill=(70, 78, 92))
canvas = ImageChops.add(canvas, cool.filter(ImageFilter.GaussianBlur(160)))
canvas.save(out, 'WEBP', quality=82, method=6)
if len(sys.argv) > 3: canvas.resize((W // 2, H // 2)).save(sys.argv[3])
print(out, canvas.size)
