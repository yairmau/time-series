(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const NS = "http://www.w3.org/2000/svg";
  const state = { t: [], y: [], selected: 5, seed: 42, edited: false, drag: null, focusPoint: false };
  const color = { fit: "#087f79", point: "#40576a", error: "#c65335", truth: "#788999", grid: "#e2e9ec" };
  let model, optimal, geometry, pending = false;
  const fixed = (v, n = 2) => Math.abs(v) < 0.5 * 10 ** -n ? (0).toFixed(n) : v.toFixed(n);
  const score = v => v < 1e-9 ? "≈ 0" : fixed(v, 3);
  function truth(t) {
    if ($("pattern").value === "line") return 1 + 0.35 * t;
    if ($("pattern").value === "wave") return 3 + 1.5 * Math.sin((t - 1) * Math.PI / 5);
    return 1 + 0.09 * (t - 5) ** 2;
  }
  function random(seed) {
    return () => {
      seed += 0x6D2B79F5;
      let value = Math.imul(seed ^ seed >>> 15, 1 | seed);
      value ^= value + Math.imul(value ^ value >>> 7, 61 | value);
      return ((value ^ value >>> 14) >>> 0) / 4294967296;
    };
  }
  function generate() {
    const n = +$("count").value, noise = +$("noise").value, rng = random(state.seed);
    state.t = Array.from({ length: n }, (_, i) => 10 * i / (n - 1));
    state.y = state.t.map(t => {
      const normal = Math.sqrt(-2 * Math.log(Math.max(1e-12, rng()))) * Math.cos(2 * Math.PI * rng());
      return truth(t) + noise * normal;
    });
    state.edited = false;
    state.selected = Math.min(state.selected, n - 1);
    $("degree").max = Math.min(6, n - 1);
    state.minValue = Math.min(-4, Math.floor(Math.min(...state.y) - 2));
    state.maxValue = Math.max(12, Math.ceil(Math.max(...state.y) + 2));
  }
  function svgNode(tag, attrs = {}, text) {
    const el = document.createElementNS(NS, tag);
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
    if (text !== undefined) el.textContent = text;
    return el;
  }
  const text = (svg, x, y, s, attrs = {}) => svg.append(svgNode("text", { x, y, ...attrs }, s));
  const line = (svg, x1, y1, x2, y2, attrs = {}) => svg.append(svgNode("line", { x1, y1, x2, y2, ...attrs }));
  function curve(svg, fn, g, stroke, dashed = false) {
    let d = "";
    for (let i = 0; i <= 400; i++) {
      const t = g.xmin + (g.xmax - g.xmin) * i / 400;
      d += `${i ? "L" : "M"}${g.x(t).toFixed(2)},${g.y(fn(t)).toFixed(2)} `;
    }
    svg.append(svgNode("path", { d, fill: "none", stroke, "stroke-width": dashed ? 1.7 : 2.7, ...(dashed ? { "stroke-dasharray": "6 5" } : {}) }));
  }
  function drawFit() {
    const svg = $("fit-chart"), width = Math.max(360, Math.min(900, svg.clientWidth));
    svg.replaceChildren();
    svg.setAttribute("viewBox", `0 0 ${width} 380`);
    const left = 52, right = width - 20, top = 30, bottom = 326;
    const extrapolate = $("extrapolate").checked;
    const xmin = extrapolate ? -2 : -0.3, xmax = extrapolate ? 12 : 10.3;
    const extents = state.y.slice();
    const extentModel = $("manual").checked ? optimal : model;
    for (let i = 0; i <= 100; i++) extents.push(Fitting.evaluate(extentModel, i / 10));
    let ymin = Math.min(...extents), ymax = Math.max(...extents);
    const padding = Math.max(0.65, (ymax - ymin) * 0.18);
    ymin -= padding; ymax += padding;
    if (state.drag) [ymin, ymax] = state.drag.domain;
    const g = {
      xmin, xmax, ymin, ymax, left, right, top, bottom,
      x: t => left + (t - xmin) / (xmax - xmin) * (right - left),
      y: value => bottom - (value - ymin) / (ymax - ymin) * (bottom - top),
      inverseY: pixel => ymin + (bottom - pixel) / (bottom - top) * (ymax - ymin)
    };
    geometry = g;
    const defs = svgNode("defs"), clip = svgNode("clipPath", { id: "fit-clip" });
    clip.append(svgNode("rect", { x: left, y: top, width: right - left, height: bottom - top }));
    defs.append(clip); svg.append(defs);
    if (extrapolate) {
      svg.append(svgNode("rect", { x: left, y: top, width: g.x(0) - left, height: bottom - top, fill: "#f5e9d9" }));
      svg.append(svgNode("rect", { x: g.x(10), y: top, width: right - g.x(10), height: bottom - top, fill: "#f5e9d9" }));
    }
    text(svg, left, 17, "Value y", { "font-weight": 600 });
    for (let j = 0; j <= 4; j++) {
      const value = ymin + (ymax - ymin) * j / 4;
      line(svg, left, g.y(value), right, g.y(value), { stroke: color.grid });
      text(svg, left - 9, g.y(value) + 4, fixed(value, 1), { "text-anchor": "end" });
    }
    const ticks = width < 500 ? [0, 5, 10] : [0, 2, 4, 6, 8, 10];
    for (const t of ticks) text(svg, g.x(t), 347, String(t), { "text-anchor": "middle" });
    text(svg, (left + right) / 2, 371, "Time t", { "text-anchor": "middle" });
    const curves = svgNode("g", { "clip-path": "url(#fit-clip)" });
    if ($("truth").checked) curve(curves, truth, g, color.truth, true);
    if ($("residuals").checked) state.t.forEach((t, i) => {
      line(curves, g.x(t), g.y(state.y[i]), g.x(t), g.y(model.predictions[i]), {
        stroke: color.error, "stroke-width": i === state.selected ? 3.5 : 1.6, opacity: i === state.selected ? 1 : 0.7
      });
      line(curves, g.x(t) - 3, g.y(model.predictions[i]), g.x(t) + 3, g.y(model.predictions[i]), { stroke: color.error });
    });
    curve(curves, t => Fitting.evaluate(model, t), g, color.fit);
    state.t.forEach((t, i) => {
      const dot = svgNode("circle", {
        cx: g.x(t), cy: g.y(state.y[i]), r: i === state.selected ? 7 : 5.5,
        fill: i === state.selected ? color.error : color.point, stroke: "white", "stroke-width": 1.7,
        "data-point": i, tabindex: 0, role: "button",
        "aria-label": `Point ${i + 1}, time ${fixed(t)}, value ${fixed(state.y[i])}. Up and down change its value; left and right select another point.`
      });
      dot.append(svgNode("title", {}, `Point ${i + 1}: t=${fixed(t)}, y=${fixed(state.y[i])}`));
      curves.append(dot);
    });
    svg.append(curves);
  }
  function equation() {
    const coefficients = Fitting.powerCoefficients(model), terms = [], powers = ["", "t", "t²", "t³", "t⁴", "t⁵", "t⁶"];
    coefficients.forEach((value, i) => {
      if (Math.abs(value) < 1e-9) return;
      const number = Number(Math.abs(value).toPrecision(3)).toString();
      const sign = terms.length ? (value < 0 ? " − " : " + ") : (value < 0 ? "−" : "");
      terms.push(sign + number + powers[i]);
    });
    return "ŷ(t) = " + (terms.join("") || "0");
  }
  function python() {
    let code = `import numpy as np\nimport matplotlib.pyplot as plt\nfrom numpy.polynomial import Polynomial\n\nt = np.array(${JSON.stringify(state.t)})\ny = np.array(${JSON.stringify(state.y)})\n`;
    code += $("manual").checked ? `\n# Your current line: coefficients are in increasing powers of t.\nmodel = Polynomial([${+$("intercept").value}, ${+$("slope").value}])\n`
      : `\ndegree = ${+$("degree").value}\nmodel = Polynomial.fit(t, y, deg=degree)\n`;
    code += `predicted = model(t)\nresiduals = y - predicted\nS = np.sum(residuals**2)\nprint(f"Sum of squared residuals: {S:.6f}")\n\nfine_t = np.linspace(${$("extrapolate").checked ? "-2, 12" : "t.min(), t.max()"}, 400)\nfig, ax = plt.subplots()\nax.scatter(t, y, label="Observations")\nax.plot(fine_t, model(fine_t), label="${$("manual").checked ? "Your line" : "Least-squares fit"}")\n`;
    if ($("residuals").checked) code += 'ax.vlines(t, predicted, y, color="tab:red", alpha=0.5, label="Residuals")\n';
    code += 'ax.set(xlabel="Time t", ylabel="Value y")\nax.legend()\nplt.show()';
    $("python-code").textContent = code;
  }
  function render() {
    pending = false;
    const degree = +$("degree").value, manual = $("manual").checked;
    optimal = Fitting.fit(state.t, state.y, degree);
    if (manual) {
      const lineModel = { coefficients: [+$("intercept").value, +$("slope").value], center: 0, scale: 1, degree: 1 };
      model = { ...lineModel, ...Fitting.measure(state.t, state.y, lineModel) };
    } else model = optimal;
    $("degree-value").textContent = degree;
    $("degree-note").textContent = manual ? "A straight line has two adjustable coefficients."
      : `${["A constant", "A straight line", "A quadratic curve"][degree] || `A degree-${degree} polynomial`} · ${degree + 1} coefficients.`;
    $("degree").disabled = manual;
    $("count-value").textContent = state.t.length;
    $("noise-value").textContent = fixed(+$("noise").value);
    $("manual-controls").hidden = !manual;
    $("intercept-value").textContent = fixed(+$("intercept").value);
    $("slope-value").textContent = fixed(+$("slope").value);
    $("chart-title").textContent = manual ? "Can you lower the error?" : `Polynomial fit · degree ${degree}`;
    $("mode-badge").textContent = manual ? "Your line" : "Least squares";
    $("curve-key").textContent = manual ? "Your line" : "Fitted curve";
    $("sse-label").textContent = manual ? "Your line’s S" : "Sum of squared residuals S";
    $("sse-value").textContent = score(model.sse);
    $("second-label").textContent = manual ? "Least-squares line’s S" : "Coefficients to fit";
    $("second-value").textContent = manual ? score(optimal.sse) : degree + 1;
    $("observations-value").textContent = state.t.length;
    $("fit-equation").textContent = equation();
    $("residual-key").hidden = !$("residuals").checked;
    $("truth-key").hidden = !$("truth").checked;
    $("extrapolation-note").hidden = !$("extrapolate").checked;
    $("prompt").textContent = manual ? "Try to lower S by changing the intercept and slope. Which direction should you move the line? Then compare with “Find the least-squares line”."
      : degree === 0 ? "Where should a horizontal line sit to minimize the squared residuals? Compare its height with the mean of the observed values."
      : degree === state.t.length - 1 ? "This polynomial can pass through every observed point. Reveal the generating curve and look between the points. Does a nearly zero S guarantee a useful model?"
      : state.edited ? "You moved a point. Which other parts of the curve changed? Why can one large residual affect a fit to the whole dataset?"
      : "Keep the points fixed and increase the degree. Does S go down? Reveal the generating curve: does the smaller error always mean you recovered that curve more faithfully?";
    const focusedPoint = $("fit-chart").contains(document.activeElement) ? document.activeElement.dataset.point : undefined;
    const restoreFocusTo = state.focusPoint ? state.selected : focusedPoint;
    drawFit(); python();
    if (restoreFocusTo !== undefined) {
      $("fit-chart").querySelector(`[data-point="${restoreFocusTo}"]`)?.focus({ preventScroll: true });
      state.focusPoint = false;
    }
  }
  function schedule() { if (!pending) { pending = true; requestAnimationFrame(render); } }
  function changePoint(value) {
    state.y[state.selected] = Math.max(state.minValue, Math.min(state.maxValue, value));
    state.edited = true; schedule();
  }
  function reset() {
    state.seed = 42; state.selected = 5; state.drag = null;
    $("pattern").value = "curve"; $("degree").value = 2; $("count").value = 12; $("noise").value = 0.45;
    $("manual").checked = false; $("intercept").value = 2; $("slope").value = 0;
    $("residuals").checked = true; $("truth").checked = false; $("extrapolate").checked = false;
    generate(); schedule();
  }
  for (const id of ["pattern", "count", "noise"]) $(id).addEventListener("input", () => { generate(); schedule(); });
  for (const id of ["degree", "intercept", "slope", "residuals", "truth", "extrapolate"]) $(id).addEventListener("input", schedule);
  $("manual").addEventListener("change", () => { if ($("manual").checked) $("degree").value = 1; schedule(); });
  $("best-fit").addEventListener("click", () => { $("manual").checked = false; schedule(); });
  $("new-noise").addEventListener("click", () => { state.seed++; generate(); schedule(); });
  $("reset").addEventListener("click", reset);
  const svg = $("fit-chart");
  svg.addEventListener("pointerdown", event => {
    const index = event.target.closest("[data-point]")?.dataset.point;
    if (index === undefined) return;
    event.preventDefault();
    state.selected = +index;
    state.drag = { index: +index, domain: [geometry.ymin, geometry.ymax], pointerId: event.pointerId };
    svg.setPointerCapture(event.pointerId); schedule();
  });
  svg.addEventListener("pointermove", event => {
    if (!state.drag) return;
    const point = svg.createSVGPoint();
    point.x = event.clientX; point.y = event.clientY;
    const local = point.matrixTransform(svg.getScreenCTM().inverse());
    changePoint(geometry.inverseY(local.y));
  });
  function endDrag(event) {
    if (!state.drag) return;
    if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
    state.drag = null; schedule();
  }
  svg.addEventListener("pointerup", endDrag);
  svg.addEventListener("pointercancel", endDrag);
  svg.addEventListener("keydown", event => {
    const index = event.target.closest("[data-point]")?.dataset.point;
    if (index === undefined || !["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault(); state.selected = +index;
    if (event.key === "ArrowUp" || event.key === "ArrowDown") changePoint(state.y[state.selected] + (event.key === "ArrowUp" ? 1 : -1) * (event.shiftKey ? 1 : 0.1));
    else state.selected = Math.max(0, Math.min(state.t.length - 1, state.selected + (event.key === "ArrowRight" ? 1 : -1)));
    state.focusPoint = true; schedule();
  });
  window.addEventListener("resize", schedule);
  new ResizeObserver(() => {
    if (window.parent !== window) window.parent.postMessage({
      type: "fit-lab-height",
      height: Math.ceil(document.querySelector("main").getBoundingClientRect().height) + 4
    }, window.location.origin);
  }).observe(document.querySelector("main"));
  reset();
})();
