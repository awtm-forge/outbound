---
name: haikei
description: Make Haikei-style SVG backgrounds and shapes (layered waves, blobs, blob scenes, stacked peaks, steps, circle scatter, low-poly grids, blurry gradients) for web pages, either by hand-writing small SVGs in code or by exporting from haikei.app. Use when the user mentions Haikei, asks for an SVG background, wave divider, blob, layered section transition, or a decorative background shape.
---

# Haikei-style SVG backgrounds

[Haikei](https://haikei.app) is a free web app that generates SVG backgrounds: layered waves, blobs, blob scenes,
stacked peaks, steps, circle scatter, low-poly grids and blurry gradients. It has no public API and no official
agent skill; this skill is written for this repository.

Two ways to get a shape:

1. **The user exports from haikei.app.** Ask for the SVG file (or its markup), then clean it as below.
2. **Write it yourself.** The shapes are simple paths; generate them in a few lines of code with the recipes
   below, so the result is themable and tiny.

## Recipes

Use a fixed `viewBox` and `preserveAspectRatio="none"` for full-width dividers, so the shape stretches to any width.

**Layered waves** (section divider), three layers from back to front:

```js
// n points across, smooth with quadratic curves through midpoints
function wave(w, h, y, amp, n, seed) {
  const pts = Array.from({ length: n + 1 }, (_, i) => [ (w / n) * i, y + Math.sin(i * 1.7 + seed) * amp ]);
  let d = `M0 ${h} L0 ${pts[0][1]}`;
  for (let i = 0; i < n; i++) { const [x1, y1] = pts[i]; const [x2, y2] = pts[i + 1]; d += ` Q${x1} ${y1} ${(x1 + x2) / 2} ${(y1 + y2) / 2}`; }
  return d + ` L${w} ${pts[n][1]} L${w} ${h} Z`;
}
// <svg viewBox="0 0 1440 160" preserveAspectRatio="none">
//   <path d={wave(1440,160, 60,18,6,0.0)} fill="var(--surface-raised)"/>
//   <path d={wave(1440,160, 90,14,6,1.3)} fill="var(--surface)"/>
//   <path d={wave(1440,160,120,10,6,2.6)} fill="var(--ground)"/></svg>
```

**Blob**: points on a circle with a varied radius, joined with cubic curves. Six to eight points, radius varying
by 15 to 30 percent. Seed the variation so the blob is the same on every render.

**Stacked peaks or steps**: the wave recipe with straight `L` segments instead of curves (peaks), or with
horizontal then vertical moves (steps).

**Circle scatter**: a seeded random list of circles with a minimum distance between centres; three sizes at most.

## Cleaning an exported SVG

- Remove `width` and `height`, keep `viewBox`, so CSS sizes it.
- Replace hard-coded fills with `currentColor` or CSS custom properties, so it follows the theme.
- Drop editor metadata, `id`s that are not referenced and unused `<defs>`.
- Round coordinates to one decimal place; exports are usually far larger than they need to be.
- Decorative backgrounds get `aria-hidden="true"` and `focusable="false"`, and carry no text.

## In this repository (core/web)

The ops app is a work tool with a restrained, flat design system (`core/web/src/design/`, from the UI pass in
awtm-forge/outbound#1): surfaces are separated by
tone steps and hairlines, not decoration. Use these shapes only where a page has room for one quiet moment
(the sign-in screen, an empty state, the "Nothing here" page), never behind tables, forms or text people read.
Fill with theme tokens (`--ground`, `--surface`, `--surface-raised`, `--accent-soft`) so both themes work, keep each
SVG under 2 kB inline, and keep text contrast at WCAG AA over whatever sits beneath it. Do not animate them.
