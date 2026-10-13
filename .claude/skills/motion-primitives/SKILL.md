---
name: motion-primitives
description: Add or adapt animated UI components from Motion Primitives (ibelick/motion-primitives, MIT), such as text effects, animated numbers, morphing dialogs, accordions, in-view reveals, infinite sliders and docks. Use when the user asks for an animation, a transition, a "motion primitive", an animated counter, a text effect, or wants a component from motion-primitives.com.
---

# Motion Primitives

[Motion Primitives](https://motion-primitives.com) ([source](https://github.com/ibelick/motion-primitives), MIT)
is a set of React components built on the `motion` package (formerly Framer Motion) and Tailwind CSS. Components
are copied into the project as source, shadcn style, rather than imported from a package.

This skill is written for this repository; there is no official Motion Primitives skill.

## Catalogue

| Component | What it does | Extra dependency |
|---|---|---|
| accordion | Collapsible sections with animated height | |
| animated-background | A highlight that slides between hovered or active items | |
| animated-group | Staggered entrance for a group of children | |
| animated-number | Springs between number values | |
| border-trail | A light that travels around an element's border | |
| carousel | Slides through items | |
| cursor | Custom animated cursor | |
| dialog | Modal with enter and exit animation | |
| disclosure | Show and hide with animation | |
| dock | macOS-style dock with magnification | |
| glow-effect | Glow that follows the pointer | |
| image-comparison | Before and after slider | |
| in-view | Animates children when they enter the viewport | |
| infinite-slider | Endless marquee | react-use-measure |
| magnetic | Element pulled toward the pointer | |
| morphing-dialog | Dialog that grows out of its trigger | |
| morphing-popover | Popover that grows out of its trigger | |
| progressive-blur | Layered blur toward an edge | |
| scroll-progress | Bar showing scroll position | |
| sliding-number | Digits slide when a number changes | react-use-measure |
| spinning-text | Text rotating on a circle | |
| spotlight | Light that follows the pointer | |
| text-effect | Per-word or per-character entrance presets | |
| text-loop, text-morph, text-roll, text-scramble, text-shimmer, text-shimmer-wave | Text transitions | |
| tilt | 3D tilt toward the pointer | |
| toolbar-dynamic, toolbar-expandable | Toolbars that resize as they open | react-use-measure (expandable) |
| transition-panel | Animated switch between panels | |

Every component also needs `motion`.

## Adding one, in a project that already uses React, Tailwind and `motion`

```bash
npx motion-primitives@latest list
npx motion-primitives@latest add <component>
```

The CLI fetches the source from the project's GitHub registry and writes it into the components folder. Read the
file it writes before using it.

## In this repository (core/web): port, do not install

The ops app is React 19 and Vite with no Tailwind, no `motion`, a hand-written CSS design system
(`core/web/src/design/`), and a 150 to 250 ms motion budget with `prefers-reduced-motion` support set in
`tokens.css` (`--t-fast`, `--t-base`, `--t-slow`, `--ease`, `--ease-enter`). Installing `motion` adds tens of
kB gzip for the full `motion` component (less with `LazyMotion`), which the UI pass would count as meaningful
bundle growth. (The design files and tokens come from the UI pass, awtm-forge/outbound#1.)

So, by default:

1. Read the component's source on GitHub (`components/core/<name>.tsx`) to see what it animates.
2. Rebuild the effect with CSS transitions or the Web Animations API, using the motion tokens and existing class
   names. Most of the catalogue (accordion, disclosure, dialog, in-view, animated-group, text-shimmer,
   scroll-progress, border-trail) needs no library.
3. Respect reduced motion: keep the content and drop the travel.
4. Motion explains a change (something opened, arrived, moved). Pointer-following effects (cursor, magnetic,
   spotlight, glow-effect, tilt) do not belong in this work tool.

Add `motion` only when the user asks for it, or when an effect cannot reasonably be done without it (spring
physics on `animated-number` or shared-layout morphing in `morphing-dialog`). If you do, report the bundle size
before and after.

## Licence

Motion Primitives is MIT licensed (copyright 2024 ibelick). Keep its licence header or a credit when copying a
component's source into this repository.
