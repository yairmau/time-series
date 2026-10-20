/* Browser-only UI. Data and arithmetic are separate so the calculations can be checked. */
(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const NS = "http://www.w3.org/2000/svg";
  const colors = { raw: "#95a4ae", result: "#087f79", pinned: "#c65335", grid: "#e2e9ec" };
  const names = { mean: "Weighted mean", median: "Median", min: "Minimum", max: "Maximum", fraction: "Percentage below threshold" };
  const kernels = { boxcar: "rectangular", triang: "triangular", gaussian: "Gaussian" };
  const synthetic = {
    spike: { label: "Single spike", unit: "signal units", minutes: 1, values: Array.from({ length: 97 }, (_, i) => i === 48 ? 1 : 0) },
    step: { label: "Sudden step", unit: "signal units", minutes: 1, values: Array.from({ length: 97 }, (_, i) => i >= 48 ? 1 : 0) },
    cycle: { label: "Daily cycle + noise", unit: "°C", minutes: 60, values: Array.from({ length: 169 }, (_, i) => 5 + 0.01 * i + 3 * Math.sin(2 * Math.PI * i / 24) + 0.8 * Math.sin(1.7 * i)) }
  };
  let dataset, computed, pinned = null, timer = null, scheduled = false, lastOptions = null;
  let visible = { start: 0, end: 863 };

  const fmt = (x, digits = 2) => Number.isFinite(x) ? x.toFixed(digits) : "—";
  const duration = minutes => minutes < 60 ? `${fmt(minutes, 0)} min` : minutes < 1440 ? `${Number((minutes / 60).toFixed(1))} h` : `${Number((minutes / 1440).toFixed(1))} days`;
  function dateLabel(i, short = false) {
    if (!dataset.start) return dataset === synthetic.cycle ? `Hour ${i}` : `Sample ${i}`;
    const d = new Date(Date.parse(dataset.start) + i * dataset.minutes * 60000);
    return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "2-digit", month: "short", ...(short ? {} : { hour: "2-digit", minute: "2-digit" }) }).format(d);
  }
  function options() {
    const size = +$("size").value;
    return {
      size,
      kernel: $("kernel").value,
      sigma: Math.max(0.1, (size - 1) / 2 * +$("sigma").value / 100),
      centered: document.querySelector('input[name="alignment"]:checked').value === "center",
      partial: $("edges").value === "partial",
      statistic: $("statistic").value,
      threshold: +$("threshold").value
    };
  }
  const description = o => `${o.size} observations · ${o.statistic === "mean" ? kernels[o.kernel] + " mean" : names[o.statistic].toLowerCase()} · ${o.centered ? "centered" : "trailing"}${o.kernel === "gaussian" && o.statistic === "mean" ? " · σ=" + fmt(o.sigma) : ""} · ${o.partial ? "available observations" : "full windows"}`;
  function node(tag, attrs = {}, text) {
    const el = document.createElementNS(NS, tag);
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
    if (text !== undefined) el.textContent = text;
    return el;
  }
  function line(svg, x1, y1, x2, y2, attrs = {}) { svg.append(node("line", { x1, y1, x2, y2, ...attrs })); }
  function text(svg, x, y, content, attrs = {}) { svg.append(node("text", { x, y, ...attrs }, content)); }
  function range(arrays, from, to, percent = false) {
    if (percent) return [-5, 105];
    let lo = Infinity, hi = -Infinity;
    for (const values of arrays) for (let i = from; i <= to; i++) if (Number.isFinite(values[i])) { lo = Math.min(lo, values[i]); hi = Math.max(hi, values[i]); }
    if (!Number.isFinite(lo)) return [-1, 1];
    const pad = Math.max((hi - lo) * 0.12, 0.15);
    return [lo - pad, hi + pad];
  }
  function path(svg, values, x, y, color, from, to, extra = {}) {
    let d = "", connected = false;
    for (let i = from; i <= to; i++) {
      if (!Number.isFinite(values[i])) { connected = false; continue; }
      d += `${connected ? "L" : "M"}${x(i).toFixed(2)},${y(values[i]).toFixed(2)} `;
      connected = true;
    }
    svg.append(node("path", { d, fill: "none", stroke: color, "stroke-width": 2.3, "stroke-linejoin": "round", ...extra }));
  }
  function chart(svg, series, unit, height = 350, percent = false, drawWindow = false) {
    svg.replaceChildren();
    const width = Math.max(360, Math.min(900, svg.clientWidth));
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    const right = width - 22, plotWidth = right - 64;
    const { start, end } = visible;
    const [lo, hi] = range(series.map(s => s.values), start, end, percent);
    const x = i => 64 + (i - start) / Math.max(1, end - start) * plotWidth;
    const y = v => 32 + (hi - v) / (hi - lo) * (height - 80);
    text(svg, 64, 17, unit, { "font-weight": 600 });
    for (let j = 0; j <= 4; j++) {
      const v = lo + (hi - lo) * j / 4;
      line(svg, 64, y(v), right, y(v), { stroke: colors.grid });
      text(svg, 54, y(v) + 4, fmt(v, percent ? 0 : 1), { "text-anchor": "end" });
    }
    const ticks = width < 550 ? 2 : 4;
    for (let j = 0; j <= ticks; j++) {
      const i = Math.round(start + (end - start) * j / ticks);
      text(svg, x(i), height - 20, dateLabel(i, end - start > 1000 || width < 550), { "text-anchor": j === 0 ? "start" : j === ticks ? "end" : "middle" });
    }
    if (lo <= 0 && hi >= 0) line(svg, 64, y(0), right, y(0), { stroke: "#a6b6bd", "stroke-dasharray": "4 4" });
    if (drawWindow) {
      const o = options(), pos = +$("position").value;
      const a = o.centered ? pos - (o.size - 1) / 2 : pos - o.size + 1;
      const b = a + o.size - 1;
      const left = Math.max(start, a), right = Math.min(end, b);
      if (right >= left) svg.append(node("rect", { x: x(left), y: 29, width: Math.max(2, x(right) - x(left)), height: height - 76, fill: "#087f79", opacity: 0.09 }));
      if ($("band").checked && !percent) {
        let segment = [];
        const flush = () => {
          if (!segment.length) return;
          const upper = segment.map(i => `${x(i)},${y(computed.high[i])}`);
          const lower = [...segment].reverse().map(i => `${x(i)},${y(computed.low[i])}`);
          svg.append(node("polygon", { points: [...upper, ...lower].join(" "), fill: "#a9d4cd", opacity: 0.4 }));
          segment = [];
        };
        for (let i = start; i <= end; i++) { if (computed.low[i] === null) flush(); else segment.push(i); }
        flush();
      }
    }
    for (const s of series) if (!s.extentOnly) path(svg, s.values, x, y, s.color, start, end, s.attrs);
    if (drawWindow) {
      const pos = +$("position").value, result = computed.result[pos];
      line(svg, x(pos), 29, x(pos), height - 47, { stroke: "#526c78", "stroke-dasharray": "4 4" });
      if (Number.isFinite(result)) svg.append(node("circle", { cx: x(pos), cy: y(result), r: 5, fill: colors.result, stroke: "white", "stroke-width": 2 }));
    }
    return { x, y };
  }
  function stop() {
    clearInterval(timer); timer = null;
    $("play").textContent = "▶ Slide the window";
    $("play").setAttribute("aria-pressed", "false");
  }
  function chooseData() {
    stop();
    const key = $("dataset").value;
    dataset = window.SMOOTHING_DATA[key] || synthetic[key];
    pinned = null;
    $("size").max = key === "reykjavik" ? 1441 : key === "yatir" ? 145 : key === "cycle" ? 97 : 65;
    $("size").value = key === "reykjavik" ? 169 : key === "yatir" ? 31 : 11;
    const views = key === "yatir" ? [[432, "3 days"], [144, "1 day"], [864, "Full record · 6 days"]]
      : key === "reykjavik" ? [[336, "14 days"], [72, "3 days"], [2160, "90 days"], [8736, "Full record · 1990"]]
      : [[dataset.values.length, "Full signal"]];
    $("view").replaceChildren(...views.map(([value, label]) => new Option(label, value)));
    $("pan").value = key === "yatir" ? 33 : 0;
    $("position").min = 0;
    $("position").max = dataset.values.length - 1;
    $("position").value = key === "reykjavik" ? 180 : Math.floor(dataset.values.length / 2);
    $("data-note").textContent = key === "yatir" ? "1–6 Jan 2022 · one observation every 10 minutes. Same record as the sliding-window lesson."
      : key === "reykjavik" ? "1 Jan–30 Dec 1990 · hourly observations. The supplied file contains 364 days."
      : key === "cycle" ? "Hourly synthetic signal: a 24-hour cycle, slow trend, and deterministic noise."
      : "97 synthetic observations. Sample numbers are positions, not clock times.";
    setView();
  }
  function setView() {
    const length = Math.min(+$("view").value, dataset.values.length);
    visible.start = Math.round((dataset.values.length - length) * +$("pan").value / 100);
    visible.end = visible.start + length - 1;
    $("pan").disabled = length === dataset.values.length;
    $("position").min = visible.start;
    $("position").max = visible.end;
    const p = +$("position").value;
    if (p < visible.start || p > visible.end) $("position").value = Math.floor((visible.start + visible.end) / 2);
  }
  function drawInspector(o) {
    const pos = +$("position").value, point = Smoothing.at(dataset.values, pos, o);
    $("position-value").textContent = dateLabel(pos);
    $("count-value").textContent = `${point.entries.length} / ${o.size}`;
    $("result-label").textContent = names[o.statistic];
    $("result-value").textContent = point.value === null ? "No full window" : `${fmt(point.value)} ${o.statistic === "fraction" ? "%" : dataset.unit}`;
    const future = point.entries.filter(e => e.index > pos).length;
    $("future-value").textContent = future ? `Yes · ${future}` : "No";
    const svg = $("window-chart");
    svg.replaceChildren();
    const width = Math.max(360, Math.min(900, svg.clientWidth));
    svg.setAttribute("viewBox", `0 0 ${width} 245`);
    const right = width - 22, plotWidth = right - 64;
    const start = point.start, span = Math.max(1, o.size - 1);
    const x = i => 64 + (o.size === 1 ? plotWidth / 2 : (i - start) / span * plotWidth);
    const values = point.entries.map(e => e.value);
    const low = Math.min(...values), high = Math.max(...values), pad = Math.max(0.2, (high - low) * 0.15);
    const y = v => 28 + (high + pad - v) / (high - low + 2 * pad) * 90;
    const maxWeight = Math.max(...point.entries.map(e => e.weight), 1 / o.size);
    const wy = w => 210 - w / maxWeight * 55;
    text(svg, 64, 15, `Observations (${dataset.unit})`, { "font-weight": 600 });
    text(svg, 64, 146, "Normalized weights (sum = 1)", { "font-weight": 600 });
    text(svg, 54, y(low) + 4, fmt(low, 1), { "text-anchor": "end" });
    text(svg, 54, y(high) + 4, fmt(high, 1), { "text-anchor": "end" });
    line(svg, 64, 122, right, 122, { stroke: colors.grid });
    line(svg, 64, 210, right, 210, { stroke: colors.grid });
    line(svg, x(pos), 20, x(pos), 214, { stroke: "#c65335", "stroke-dasharray": "4 4" });
    let d = "";
    point.entries.forEach((e, i) => {
      d += `${i ? "L" : "M"}${x(e.index)},${y(e.value)} `;
      if (point.entries.length <= 80) svg.append(node("circle", { cx: x(e.index), cy: y(e.value), r: 3, fill: colors.raw }));
      line(svg, x(e.index), 210, x(e.index), wy(e.weight), { stroke: colors.result, "stroke-width": Math.max(1, Math.min(9, plotWidth * 0.6 / o.size)) });
    });
    svg.append(node("path", { d, fill: "none", stroke: colors.raw, "stroke-width": 1.8 }));
    if (point.value !== null && o.statistic !== "fraction") line(svg, 64, y(point.value), right, y(point.value), { stroke: colors.result, "stroke-width": 2 });
    text(svg, 64, 236, `${start - pos} ${width < 550 ? "samples" : "samples from output"}`, { "text-anchor": "start" });
    text(svg, right, 236, `${point.end - pos >= 0 ? "+" : ""}${point.end - pos} ${width < 550 ? "samples" : "samples from output"}`, { "text-anchor": "end" });
    if (point.value === null) $("calculation").textContent = "This window is incomplete, so no result is drawn. Move inward or explicitly choose “Use available observations”.";
    else if (o.statistic === "fraction") {
      const count = point.entries.filter(e => e.value < o.threshold).length;
      $("calculation").textContent = `${count} of ${point.entries.length} observations are strictly below ${o.threshold} ${dataset.unit}: 100 × ${count} / ${point.entries.length} = ${fmt(point.value)}%. Each observation gets one vote.`;
    } else if (o.statistic === "mean") {
      const expression = point.entries.length <= 7 ? point.entries.map(e => `${fmt(e.weight, 3)} × ${fmt(e.value)}`).join(" + ") + ` = ${fmt(point.value)} ${dataset.unit}. ` : "";
      $("calculation").textContent = expression + "Multiply each observation by its normalized weight, then add. The orange dashed line marks where this result is plotted.";
    } else $("calculation").textContent = `${names[o.statistic]} of the ${point.entries.length} observations in this window = ${fmt(point.value)} ${dataset.unit}. Each observation has equal weight; the kernel selector applies only to the mean.`;
    $("edge-note").textContent = !point.complete ? `${o.partial ? "Available weights are renormalized. This result uses a smaller window." : "The bars show normalized weights of available observations, but a result is withheld."} No values are padded or extrapolated.` : o.centered ? "A centered window can use observations after the output time. It describes the past once those observations are available." : "A trailing window uses only observations at or before the output time. Its symmetric kernel still gives the largest weights near the middle of that past window.";
  }
  function python(o) {
    let code = "import numpy as np\nimport pandas as pd\nimport matplotlib.pyplot as plt\n\n";
    const key = $("dataset").value;
    if (dataset.source) {
      code += `url = "https://raw.githubusercontent.com/yairmau/time-series/main/${dataset.source}"\ndf = pd.read_csv(url, parse_dates=["${dataset.timeColumn}"], index_col="${dataset.timeColumn}")\nsignal = df["${dataset.column}"]${dataset.shift ? " - 273.15" : ""}\n`;
    } else if (key === "cycle") {
      code += "i = np.arange(169)\nsignal = pd.Series(5 + 0.01*i + 3*np.sin(2*np.pi*i/24) + 0.8*np.sin(1.7*i))\n";
    } else {
      code += "i = np.arange(97)\nsignal = pd.Series(" + (key === "spike" ? "(i == 48)" : "(i >= 48)") + ".astype(float))\n";
    }
    code += `\nwindow = ${o.size}  # observations, including both endpoints\ncenter = ${o.centered ? "True" : "False"}\nmin_periods = ${o.partial ? "1" : "window"}\n`;
    if (o.statistic === "mean") {
      code += `j = np.arange(window) - (window - 1) / 2\nweights = ${o.kernel === "boxcar" ? "np.ones(window)" : o.kernel === "triang" ? "1 - np.abs(j) / ((window + 1) / 2)" : `np.exp(-0.5 * (j / ${o.sigma})**2)`}\nweights = weights / weights.sum()\n`;
      // Explicit padding keeps kernel alignment at incomplete edges identical to the browser.
      code += `left = (window - 1)//2 if center else window - 1\nright = window - 1 - left\npadded = np.pad(signal.to_numpy(), (left, right), constant_values=np.nan)\nresult = []\nfor i in range(len(signal)):\n    values = padded[i:i + window]\n    valid = np.isfinite(values)\n    if valid.sum() < min_periods:\n        result.append(np.nan)\n    else:\n        result.append(np.sum(values[valid] * weights[valid]) / weights[valid].sum())\nresult = pd.Series(result, index=signal.index)\n`;
    } else if (o.statistic === "fraction") {
      code += `indicator = (signal < ${o.threshold}).astype(float).where(signal.notna())\nresult = 100 * indicator.rolling(window, center=center, min_periods=min_periods).mean()\n`;
    } else code += `result = signal.rolling(window, center=center, min_periods=min_periods).${o.statistic}()\n`;
    code += o.statistic === "fraction" ? '\nresult.plot(ylabel="Observations below threshold (%)")\n' : '\nax = signal.plot(alpha=0.4, label="Original")\nresult.plot(ax=ax, label="Rolling result")\nax.legend()\n';
    code += "plt.show()";
    $("python-code").textContent = code;
  }
  function render() {
    scheduled = false;
    const o = options(), percent = o.statistic === "fraction";
    if (!lastOptions || JSON.stringify(o) !== JSON.stringify(lastOptions)) {
      computed = Smoothing.smooth(dataset.values, o);
      lastOptions = o;
    }
    if (pinned && pinned.percent !== percent) pinned = null;
    $("size-value").textContent = `${o.size} observations`;
    $("span-note").textContent = dataset.start || dataset === synthetic.cycle ? `Spacing: ${duration(dataset.minutes)}. First-to-last span: ${duration((o.size - 1) * dataset.minutes)}.` : `First-to-last span: ${o.size - 1} sample intervals.`;
    $("kernel").disabled = o.statistic !== "mean";
    $("kernel-note").textContent = o.statistic !== "mean" ? "This statistic treats observations equally. Kernel weights apply to the mean." : o.kernel === "boxcar" ? "Every observation contributes equally." : "Observations near the middle of the window receive more weight.";
    $("sigma-control").hidden = o.kernel !== "gaussian" || o.statistic !== "mean";
    $("sigma-value").textContent = `σ = ${fmt(o.sigma)} samples`;
    $("threshold-control").hidden = !percent;
    $("threshold-value").textContent = `${o.threshold} ${dataset.unit}`;
    $("alignment-badge").textContent = o.size === 1 ? "Current observation only" : o.centered ? "Centered · past + future" : "Trailing · past only";
    $("chart-title").textContent = `${dataset.label} · ${names[o.statistic].toLowerCase()}`;
    $("result-legend").textContent = names[o.statistic];
    for (const id of ["raw", "band", "residual"]) $(id).disabled = percent;
    $("display-note").textContent = percent ? "The main graph uses percent. Original observations are shown in the window inspector below." : "The min–max band describes the data in the window; it is not a confidence interval.";
    $("raw-legend").hidden = percent || !$("raw").checked;
    $("band-legend").hidden = percent || !$("band").checked;
    $("pin-legend").hidden = !pinned;
    $("clear-pin").disabled = !pinned;
    $("pin-note").textContent = pinned ? "Pinned: " + pinned.description : "Pin a result, then change the window, kernel, or alignment to compare.";
    const series = [];
    if ($("raw").checked && !percent) series.push({ values: dataset.values, color: colors.raw, attrs: { "stroke-width": 1.3 } });
    if ($("band").checked && !percent) series.push({ values: computed.low, extentOnly: true }, { values: computed.high, extentOnly: true });
    if (pinned) series.push({ values: pinned.values, color: colors.pinned, attrs: { "stroke-dasharray": "7 4" } });
    series.push({ values: computed.result, color: colors.result });
    chart($("main-chart"), series, percent ? "% of observations below threshold" : dataset.unit, 350, percent, true);
    $("residual-card").hidden = percent || !$("residual").checked;
    if (!$("residual-card").hidden) {
      const residual = dataset.values.map((v, i) => computed.result[i] === null ? null : v - computed.result[i]);
      chart($("residual-chart"), [{ values: residual, color: colors.pinned }], dataset.unit, 190);
    }
    drawInspector(o);
    $("challenge").textContent = $("dataset").value === "spike" ? "Predict the height and width of the smoothed spike when you double the window. How does its shape relate to the kernel? Pin one result, then test your prediction."
      : $("dataset").value === "step" ? "With a centered window, why can the result start rising before the step occurs? Switch to a trailing window. Could either curve tell you the exact time of the change?"
      : percent ? "Find a window with a positive mean but some observations below zero. Which statistic would you use to describe freezing exposure? What would missing observations change?"
      : "Choose a feature you care about: a daily cycle, a brief cold spell, or a longer trend. Which window preserves it? Point to one feature the smoother removes, and explain whether that loss is acceptable.";
    python(o);
  }
  function schedule(recompute = false) {
    if (recompute) lastOptions = null;
    if (!scheduled) { scheduled = true; requestAnimationFrame(render); }
  }
  function reset() {
    stop();
    $("dataset").value = "yatir"; $("statistic").value = "mean"; $("kernel").value = "boxcar";
    $("sigma").value = 35; $("threshold").value = 0; $("edges").value = "full";
    document.querySelector('input[name="alignment"][value="center"]').checked = true;
    $("raw").checked = true; $("band").checked = false; $("residual").checked = false;
    chooseData(); schedule(true);
  }
  $("dataset").addEventListener("change", () => { chooseData(); schedule(true); });
  for (const id of ["size", "statistic", "kernel", "sigma", "threshold", "edges", "raw", "band", "residual", "position"]) $(id).addEventListener("input", () => schedule());
  document.querySelectorAll('input[name="alignment"]').forEach(el => el.addEventListener("change", () => schedule()));
  for (const id of ["view", "pan"]) $(id).addEventListener("input", () => { setView(); schedule(); });
  $("main-chart").addEventListener("click", event => {
    const box = $("main-chart").getBoundingClientRect();
    const width = $("main-chart").viewBox.baseVal.width;
    const x = (event.clientX - box.left) / box.width * width;
    $("position").value = Math.round(visible.start + Math.max(0, Math.min(1, (x - 64) / (width - 86))) * (visible.end - visible.start));
    schedule();
  });
  $("pin").addEventListener("click", () => {
    // Render first if a slider update is still waiting for its animation frame.
    render();
    pinned = { values: computed.result.slice(), description: description(options()), percent: options().statistic === "fraction" };
    schedule();
  });
  $("clear-pin").addEventListener("click", () => { pinned = null; schedule(); });
  $("reset").addEventListener("click", reset);
  $("play").addEventListener("click", () => {
    if (timer) return stop();
    $("play").textContent = "Ⅱ Pause";
    $("play").setAttribute("aria-pressed", "true");
    timer = setInterval(() => {
      const next = +$("position").value + Math.max(1, Math.round((visible.end - visible.start) / 120));
      $("position").value = next > visible.end ? visible.start : next;
      schedule();
    }, 140);
  });
  document.addEventListener("visibilitychange", () => { if (document.hidden) stop(); });
  window.addEventListener("resize", () => schedule());
  document.querySelectorAll("[data-preset]").forEach(button => button.addEventListener("click", () => {
    reset();
    const preset = button.dataset.preset;
    if (preset !== "weather") {
      $("dataset").value = preset === "freezing" ? "reykjavik" : preset;
      chooseData();
      if (preset === "freezing") { $("statistic").value = "fraction"; $("size").value = 121; }
    }
    schedule(true);
  }));
  $("export").addEventListener("click", () => {
    render();
    const label = options().statistic === "fraction" ? "percentage_below_threshold" : "rolling_" + options().statistic;
    const rows = [`time,original,${label},window_min,window_max`];
    dataset.values.forEach((v, i) => {
      const t = dataset.start ? new Date(Date.parse(dataset.start) + i * dataset.minutes * 60000).toISOString().replace("Z", "") : i;
      rows.push([t, v, computed.result[i], computed.low[i], computed.high[i]].map(x => x === null ? "" : x).join(","));
    });
    const url = URL.createObjectURL(new Blob([rows.join("\n")], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url; a.download = `smoothing-${$("dataset").value}-${options().statistic}-${options().size}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  new ResizeObserver(() => {
    if (window.parent !== window) window.parent.postMessage({
      type: "smoothing-lab-height",
      height: Math.ceil(document.querySelector("main").getBoundingClientRect().height) + 4
    }, window.location.origin);
  }).observe(document.querySelector("main"));
  reset();
})();
