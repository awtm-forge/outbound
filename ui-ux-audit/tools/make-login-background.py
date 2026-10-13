# Builds the sign-in background: a dark planet on the left whose limb flares orange centre-left, a second horizon
# sweeping to the lower right, thin orbital arcs, a little orange haze and dust. Planet texture comes from the supplied
# photograph. usage: python3 -I make-login-background.py <photo> <out.webp> [preview.png]
import sys, math, random
from PIL import Image, ImageDraw, ImageFilter, ImageChops, ImageEnhance
src, out = sys.argv[1], sys.argv[2]
W, H = 1920, 1080
s = W / 1672                                  # geometry was measured on a 1672 x 941 reference
pcx, pcy, pr = 129 * s, 852 * s, 673 * s      # the planet
hcx, hcy, hr = -754 * s, 4435 * s, 4296 * s   # the far horizon
ocx, ocy, orr = 1118 * s, 346 * s, 428 * s    # one orbital ring
fx, fy = 575 * s, 349 * s                     # the flare, where the two horizons meet
random.seed(7)

def disc(cx, cy, r):
    m = Image.new('L', (W, H), 0); ImageDraw.Draw(m).ellipse((cx - r, cy - r, cx + r, cy + r), fill=255); return m
def arc(cx, cy, r, a0, a1, width, color, blur=0):
    L = Image.new('RGB', (W, H), 'black'); ImageDraw.Draw(L).arc((cx - r, cy - r, cx + r, cy + r), a0, a1, fill=color, width=width)
    return L.filter(ImageFilter.GaussianBlur(blur)) if blur else L
def glow(x, y, r, color):
    L = Image.new('RGB', (W, H), 'black'); ImageDraw.Draw(L).ellipse((x - r, y - r, x + r, y + r), fill=color)
    return L.filter(ImageFilter.GaussianBlur(r * 0.6))

canvas = Image.new('RGB', (W, H), (4, 4, 6))
# the far body: a slightly lifted dark grey below the long horizon
far = Image.new('RGB', (W, H), (8, 8, 10))
noise = Image.effect_noise((W, H), 18).convert('RGB'); far = ImageChops.add(far, ImageEnhance.Brightness(noise).enhance(0.035))
canvas = Image.composite(far, canvas, disc(hcx, hcy, hr))

# the planet: the photograph rotated so its lit limb faces the flare, over a dark textured disc
photo = Image.open(src).convert('RGB')
k = pr / 1817; photo = photo.resize((round(photo.width * k), round(photo.height * k)), Image.LANCZOS)
qcx, qcy = 1000 * k, 2017 * k
pad = round(max(qcy, photo.height - qcy, qcx, photo.width - qcx)) + 10
big = Image.new('RGB', (pad * 2, pad * 2), 'black'); big.paste(photo, (round(pad - qcx), round(pad - qcy)))
big = big.rotate(-38, resample=Image.BICUBIC, center=(pad, pad))
lay = Image.new('RGB', (W, H), 'black'); lay.paste(big, (round(pcx - pad), round(pcy - pad)))
body = Image.new('RGB', (W, H), (6, 7, 9)); body = ImageChops.add(body, ImageEnhance.Brightness(noise).enhance(0.04))
body = ImageChops.lighter(body, ImageEnhance.Brightness(ImageEnhance.Color(lay).enhance(0.5)).enhance(0.9))
# shade the planet from the lit limb toward the dark side
shade = Image.new('L', (W, H), 0); ImageDraw.Draw(shade).ellipse((pcx - pr * 1.5 - 260, pcy - pr * 0.5, pcx + pr * 0.5 - 260, pcy + pr * 1.5), fill=210)
body = Image.composite(Image.new('RGB', (W, H), (5, 5, 7)), body, shade.filter(ImageFilter.GaussianBlur(220)))
canvas = Image.composite(body, canvas, disc(pcx, pcy, pr))

light = Image.new('RGB', (W, H), 'black')
add = lambda L: ImageChops.add(light, L)
# haze above the flare and a wide warm bloom
for x, y, r, c in [(fx + 120, fy - 140, 240, (40, 13, 3)), (fx + 330, fy - 230, 190, (30, 10, 2)), (fx - 60, fy + 20, 160, (70, 26, 5)), (fx, fy, 60, (230, 120, 35))]:
    light = add(glow(x, y, r, c))
# planet limb: broad glow, bright core, then a few thin parallel arcs
a_f = math.degrees(math.atan2(fy - pcy, fx - pcx))
for r_, w_, c_, b_, a0, a1 in [(pr + 4, 30, (130, 46, 6), 22, a_f - 85, a_f + 28), (pr + 1, 7, (255, 120, 25), 4, a_f - 80, a_f + 22), (pr - 1, 2, (255, 200, 120), 0.8, a_f - 70, a_f + 16), (pr + 1, 3, (140, 50, 10), 2, a_f + 22, a_f + 48),
                               (pr + 30, 2, (200, 80, 20), 1.2, a_f - 75, a_f + 10), (pr + 70, 1, (160, 60, 15), 1.5, a_f - 70, a_f + 2), (pr - 45, 1, (140, 50, 12), 1.5, a_f - 10, a_f + 45), (pr - 140, 1, (110, 38, 10), 2, a_f + 5, a_f + 55)]:
    light = add(arc(pcx, pcy, r_, a0, a1, w_, c_, b_))
# the long horizon, brightest at the flare and fading to the right
a_h = math.degrees(math.atan2(fy - hcy, fx - hcx))
for r_, w_, c_, b_, span in [(hr + 2, 26, (140, 50, 8), 18, 22), (hr, 4, (255, 130, 35), 2.5, 22), (hr - 1, 1, (255, 205, 130), 0.6, 9), (hr + 40, 1, (150, 55, 15), 1.2, 18)]:
    light = add(arc(hcx, hcy, r_, a_h, a_h + span, w_, c_, b_))
# orbital ring and a long crossing trail
light = add(arc(ocx, ocy, orr, 150, 400, 1, (150, 58, 18), 0.7))
L = Image.new('RGB', (W, H), 'black'); ImageDraw.Draw(L).line((fx + 80, fy + 60, W * 0.86, -20), fill=(120, 45, 14), width=1); light = add(L.filter(ImageFilter.GaussianBlur(0.6)))
# a four-point glint at the flare
L = Image.new('RGB', (W, H), 'black'); d = ImageDraw.Draw(L)
d.line((fx - 160, fy + 8, fx + 160, fy - 8), fill=(255, 150, 60), width=2); d.line((fx - 4, fy - 70, fx + 4, fy + 70), fill=(255, 150, 60), width=1)
light = add(L.filter(ImageFilter.GaussianBlur(3))); light = add(glow(fx, fy, 9, (255, 235, 200)))
# dust
L = Image.new('RGB', (W, H), 'black'); d = ImageDraw.Draw(L)
for _ in range(260):
    x, y = random.uniform(0, W), random.uniform(0, H * 0.75); b = random.random()
    if math.hypot(x - pcx, y - pcy) < pr: continue
    c = (int(120 + 135 * b), int(50 + 60 * b), int(10 + 20 * b)) if random.random() < 0.6 else (int(60 + 80 * b),) * 3
    rr = 0.6 + 1.3 * b ** 3; d.ellipse((x - rr, y - rr, x + rr, y + rr), fill=c)
light = add(L.filter(ImageFilter.GaussianBlur(0.4)))
canvas = ImageChops.add(canvas, light)
canvas.save(out, 'WEBP', quality=80, method=6)
if len(sys.argv) > 3: canvas.resize((W // 2, H // 2)).save(sys.argv[3])
print(out, canvas.size)
