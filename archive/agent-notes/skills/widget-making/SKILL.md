---
name: widget-making
description: Conventions for building interactive HTML/JS widgets and labs for this Quarto time-series course site — when to use an inline embed vs. a standalone lab page, file layout, styling, accessibility, determinism, and testing patterns already used across the repo. Read before adding any slider, chart, or interactive demo to a .qmd page.
---

# Widget making for this site

This repo already has two distinct, working patterns for interactive content. Pick one — don't
invent a third unless neither fits.

## Pattern A: inline demo (single concept, one file)

Use this when the widget illustrates one equation or idea right next to the prose that introduces
it — e.g. [stationarity/autocorrelation.qmd](../../../../stationarity/autocorrelation.qmd)'s "try
it yourself" autocorrelation slider.

- Lives entirely inside the `.qmd` file, in one ` ```{=html} ` fenced block: markup, a `<style>`
  block, and a `<script>` IIFE, in that order, appended where the demo belongs in the text.
- No external JS/CSS files, no build step. Keep it self-contained so the chapter stays a single
  file to read and edit.
- Scope every id/class with a short unique prefix (e.g. `acf-lab`, `acf-tab-btn`) so it can't
  collide with Quarto's own styles or another widget on the same page.
- Draw with `<canvas>` (2D context) or inline SVG — whichever is natural for the data. For canvas,
  scale by `window.devicePixelRatio` in a `setupCanvas()` helper so lines stay crisp on retina
  displays; recompute on `window.addEventListener("resize", draw)`.
- **Respect the site's theme.** This content renders inside the book's own page, which follows
  the reader's light/dark preference. Define colors directly (no site-wide CSS variables to hook
  into) and add a parallel ruleset:
  ```css
  .acf-lab { background: #fafbfc; }
  @media (prefers-color-scheme: dark) { .acf-lab { background: #1e2228; } }
  ```
  Do this for every color that touches a background or text, not just the container.
- Favor deterministic synthetic data over `Math.random()` so the demo looks the same on every
  reload and every render (see "Determinism" below).
- If the widget has multiple selectable examples, use a `role="tablist"` of buttons toggling
  `aria-selected`, not a `<select>` — it reads better as a quick A/B comparison and matches the
  existing autocorrelation widget.
- A slider must always show its live numeric value next to its label (a `<span>`/`<output>`
  updated on the `input` event, not `change`), and switching the underlying example should reset
  the slider to a sensible default (e.g. zero shift) rather than leaving it wherever it was.

## Pattern B: standalone lab (multi-mode exploration)

Use this for anything bigger: multiple datasets, several interacting controls, a
predict/observe/explain workflow, or CSV export. Two examples to read end-to-end before building
a third: `outliers/lab/` and `smoothing/lab/` (and `smoothing/fit-lab/`).

### File layout

```
<topic>/lab/
  index.html    # markup + <nav> of modes/presets, no business logic
  styles.css    # CSS custom properties + component styles
  engine.js     # pure computation, zero DOM/browser globals, exports a namespace
  app.js        # DOM wiring: reads controls, calls engine, renders SVG, handles resize/postMessage
  data.js       # static datasets as plain JS (often generated, see below)
<topic>/tests/
  engine.test.js  # run with `node <topic>/tests/engine.test.js` (or deno) — no test framework
  ui-smoke.js     # optional browser-driven smoke test
<topic>/build-lab-data.py   # optional: regenerates data.js from the course's real CSVs
```

- `<topic>/lab.qmd` (or similarly named) is a *thin* wrapper page, not the lab itself:
  ```yaml
  ---
  title: "<topic> lab"
  page-layout: full
  format:
    html:
      toc: false
  ---
  ```
  followed by one or two sentences of instructions, a
  `[Open the lab in a full browser tab](lab/index.html){target="_blank" rel="noopener"}` link,
  then the iframe embed (see below).

### The iframe + postMessage resize contract

Copy this pattern exactly; only the id and message `type` string need to change per lab:

```html
<iframe id="<topic>-lab" src="lab/index.html" title="..." loading="lazy"
  style="width:100%;height:1500px;border:1px solid #dce4e8;border-radius:12px;"></iframe>
<script>
window.addEventListener("message", function (event) {
  const frame = document.getElementById("<topic>-lab");
  if (event.source === frame.contentWindow && event.origin === window.location.origin &&
      event.data && event.data.type === "<topic>-lab-height" && Number.isFinite(event.data.height)) {
    frame.style.height = Math.max(500, Math.min(5000, event.data.height)) + "px";
  }
});
</script>
```

Inside `app.js`, the lab reports its own height so the iframe never scrolls internally:

```js
new ResizeObserver(() => {
  if (window.parent !== window) {
    window.parent.postMessage(
      { type: "<topic>-lab-height", height: Math.ceil(document.querySelector("main").getBoundingClientRect().height) + 4 },
      window.location.origin
    );
  }
}).observe(document.querySelector("main"));
window.addEventListener("resize", /* same postMessage call */);
```

Always include the "open in full tab" link above the iframe (the lab is a real, useful page on
its own, and it's the fallback for anyone who can't use the embed) and a `<noscript>` fallback
pointing to a static/Python alternative of the same exercise.

### `engine.js`: pure, dependency-free, testable

Write all computation with no reference to `window`, `document`, or DOM APIs — just functions
over plain arrays/numbers. Export via an IIFE attaching a namespace to `globalThis`, which works
unchanged both as a `<script>` tag and as a Node import in tests:

```js
(function (root) {
  "use strict";
  function summarize(values, method, k) { /* ... */ }
  function detect(values, options) { /* ... */ }
  root.OutlierLab = { summarize, detect /* ... */ };
})(globalThis);
```

A test then does:

```js
import "../lab/engine.js";
const { summarize, detect } = globalThis.OutlierLab;
```

and runs with plain `node path/to/engine.test.js` — no test framework, no build step. Write these
tests whenever `engine.js` has more than a couple of branches; `app.js` is harder to unit-test and
is covered (if at all) by a lighter `ui-smoke.js`.

### `app.js`: all DOM, no math

Reads control values, calls into the engine namespace, and renders. Charts in these labs are
inline SVG with a fixed `viewBox` (e.g. `viewBox="0 0 900 350"`) scaled by CSS `width:100%`, not
canvas — this makes hit-testing/labels/axes easier to build with plain DOM/SVG calls and keeps
`app.js` free of pixel-ratio bookkeeping.

### `data.js`: generated, not hand-written, when it's real data

When a lab uses real course data, write a small `build-lab-data.py` that reads the course CSVs
and writes `data.js` as bundled JSON assigned to a global (see `outliers/build-lab-data.py`).
Re-run it and commit the regenerated `data.js` when the source CSVs change — don't edit `data.js`
by hand.

### Styling conventions

- Define a `:root { --ink: ...; --muted: ...; --accent: ...; --line: ...; --surface: ...; --bg: ...; }`
  custom-property palette at the top of `styles.css` and build every component off those
  variables, not literal colors.
- These lab pages pin `color-scheme: light` and do **not** follow the reader's dark-mode
  preference — they're opened as their own page/tab, not inline in the themed book, so a fixed
  light theme is the existing convention. (This is the opposite of Pattern A, which must follow
  dark mode — don't mix the two up.)
- Sliders get a value `<output>` tied to their `<label for=...>`; checkboxes/toggles get
  `aria-pressed`/`aria-selected` where relevant; every interactive control has a visible
  `:focus-visible` outline.
- A `.readouts` grid (`<span>` small caption + `<strong>` tabular-nums value) is the established
  way to surface computed numbers (counts, RMSE, thresholds) next to a chart.
- Cache-bust `styles.css`/`engine.js`/`app.js` references in `index.html` with a `?v=<date>-<slug>`
  query string whenever you change them, since the built site is statically hosted and aggressively
  cached by GitHub Pages — see the `?v=20261103-thresholds` suffixes in `outliers/lab/index.html`.

## Determinism

Any "random" synthetic series must be reproducible across reloads and across re-renders of the
page (readers compare notes; CI/diffs should be stable). Never call `Math.random()` directly.
Use a tiny seeded PRNG and a Box–Muller transform for Gaussian noise — this exact pair is already
used in `stationarity/autocorrelation.qmd` and is small enough to paste inline for Pattern A, or
drop into `engine.js` for Pattern B:

```js
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gaussian(rng) {
  const u1 = Math.max(rng(), 1e-9), u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}
```

Give each distinct synthetic series its own fixed seed so switching between examples doesn't
reshuffle ones you aren't looking at.

## Deciding which pattern to use

| | Pattern A (inline) | Pattern B (lab) |
|---|---|---|
| Scope | one equation/idea | a workflow, multiple datasets/modes |
| Files | 1 (the `.qmd` itself) | 5+ (`index.html`, `styles.css`, `engine.js`, `app.js`, `data.js`) |
| Theming | must follow reader's dark/light mode | fixed light theme, own page |
| Charting | canvas or inline SVG | inline SVG with `viewBox` |
| Tests | none needed, logic is small | `engine.js` unit tests expected once logic has branches |
| Entry point | appears directly in the chapter text | thin `page-layout: full` `.qmd` + iframe embed |

When in doubt, start with Pattern A. Only graduate to Pattern B once the widget genuinely needs
multiple datasets, modes, or enough logic to be worth unit-testing on its own.
