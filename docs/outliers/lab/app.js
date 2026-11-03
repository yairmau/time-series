(() => {
  "use strict";
  const $ = id => document.getElementById(id), E = OutlierLab, finite = Number.isFinite;
  const colors = { raw: "#8798a4", limit: "#087f79", flag: "#bc482b", truth: "#7662a6", grid: "#e2e9ec", pin: "#b07b22" };
  const methodNames = { fixed: "Fixed thresholds", z: "Z-score", iqr: "IQR", mad: "MAD / Hampel" };
  const fillNames = { none: "Leave gaps", forward: "Forward fill", backward: "Backward fill", linear: "Linear interpolation", cubic: "Natural cubic spline" };
  const syntheticNames = { spike: "One spike + changing baseline", cluster: "A cluster of bad readings", stuck: "A stuck sensor", step: "A genuine level shift" };
  const fmt = (x, n = 2) => finite(x) ? Number(x.toFixed(n)).toString() : "—";
  let mode = "detect", dataset, detected, pinned = null, transfer = null, gapData, gapInput, gapResult, gapRuns = [], scheduled = false, detectionKey = "";
  const count = values => values.filter(Boolean).length;
  function duration(minutes) {
    return minutes < 60 ? `${fmt(minutes)} min` : minutes < 1440 ? `${fmt(minutes / 60)} h` : `${fmt(minutes / 1440)} days`;
  }
  function dateAt(data, i) {
    if (!data.start) return `Sample ${i}`;
    const start = data.start.length === 10 ? data.start + "T00:00:00" : data.start;
    return new Date(Date.parse(start + "Z") + i * data.minutes * 60000).toISOString().replace(".000Z", "");
  }
  function labelAt(data, i, short = false) {
    if (!data.start) return `Sample ${i}`;
    const time = dateAt(data, i);
    return short ? time.slice(5, 10) : time.slice(5, 10) + " " + time.slice(11, 16);
  }
  function options() {
    const limit = side => !$("use-" + side).checked ? null : $(side + "-limit").value.trim() === "" ? NaN : Number($(side + "-limit").value);
    return { enabled: $("detection-enabled").checked, size: +$("size").value, k: +$("threshold").value, method: $("method").value, scope: $("scope").value,
      alignment: $("alignment").value, full: $("full").checked, plateau: $("plateau").checked, run: +$("run").value,
      lower: limit("lower"), upper: limit("upper") };
  }
  function description(o) {
    if (!o.enabled) return "Detection off";
    if (o.method === "fixed") return `Fixed thresholds · ${[finite(o.lower) ? `below ${fmt(o.lower)}` : "", finite(o.upper) ? `above ${fmt(o.upper)}` : ""].filter(Boolean).join(" or ")}${o.plateau ? ` · runs ≥ ${o.run}` : ""}`;
    return `${methodNames[o.method]} · k=${o.k} · ${o.scope === "global" ? "whole record" : `${o.size} samples, ${o.alignment}`}${o.plateau ? ` · runs ≥ ${o.run}` : ""}`;
  }
  function syncLimitSliders() {
    const values = dataset.values.filter(finite), lo = Math.min(...values), hi = Math.max(...values), pad = Math.max(1, (hi - lo) * 0.2);
    const limits = ["lower", "upper"].map(side => Number($(side + "-limit").value)).filter(finite);
    for (const side of ["lower", "upper"]) {
      const slider = $(side + "-slider"), field = $(side + "-limit");
      slider.min = Math.min(lo - pad, ...limits); slider.max = Math.max(hi + pad, ...limits); slider.step = "any";
      if (field.value.trim() !== "" && finite(Number(field.value))) slider.value = field.value;
    }
  }
  function chooseData(resetLimits = true) {
    const key = $("dataset").value;
    dataset = OutlierData.challenges[key] || { ...E.synthetic(key, +$("amplitude").value, +$("event-length").value), label: syntheticNames[key] };
    detectionKey = ""; pinned = null;
    $("position").max = dataset.values.length - 1;
    $("position").value = dataset.synthetic ? 120 : Math.floor(dataset.values.length / 2);
    $("truth").checked = false;
    if (resetLimits) {
      const values = dataset.values.filter(finite).sort((a, b) => a - b);
      $("lower-limit").value = Number(E.quantile(values, 0.05).toPrecision(6));
      $("upper-limit").value = Number(E.quantile(values, 0.95).toPrecision(6));
    }
    syncLimitSliders();
  }
  function node(tag, attrs = {}, text) {
    const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
    Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, value));
    if (text !== undefined) el.textContent = text;
    return el;
  }
  function line(svg, x1, y1, x2, y2, attrs = {}) { svg.append(node("line", { x1, y1, x2, y2, ...attrs })); }
  function text(svg, x, y, content, attrs = {}) { svg.append(node("text", { x, y, ...attrs }, content)); }
  function path(svg, values, plot, color, attrs = {}) {
    let d = "", connected = false;
    for (let i = plot.from; i <= plot.to; i++) {
      if (!finite(values[i])) { connected = false; continue; }
      d += `${connected ? "L" : "M"}${plot.x(i).toFixed(2)},${plot.y(values[i]).toFixed(2)} `; connected = true;
    }
    svg.append(node("path", { d, fill: "none", stroke: color, "stroke-width": 1.8, "stroke-linejoin": "round", ...attrs }));
  }
  function chart(id, data, arrays, from, to, height) {
    const svg = $(id); svg.replaceChildren();
    const width = Math.max(280, Math.min(1000, svg.clientWidth)), left = 58, right = width - 15, top = 29, bottom = height - 40;
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    let low = Infinity, high = -Infinity;
    for (const values of arrays) for (let i = from; i <= to; i++) if (finite(values[i])) { low = Math.min(low, values[i]); high = Math.max(high, values[i]); }
    if (!finite(low)) { low = -1; high = 1; }
    const padding = Math.max(0.15, (high - low) * 0.1); low -= padding; high += padding;
    const x = i => left + (i - from) / Math.max(1, to - from) * (right - left), y = v => top + (high - v) / (high - low) * (bottom - top);
    text(svg, left, 16, data.unit, { "font-weight": 600 });
    for (let j = 0; j <= 4; j++) {
      const v = low + (high - low) * j / 4;
      line(svg, left, y(v), right, y(v), { stroke: colors.grid });
      text(svg, left - 8, y(v) + 4, fmt(v, 1), { "text-anchor": "end" });
    }
    const ticks = width < 500 ? 2 : 4;
    for (let j = 0; j <= ticks; j++) {
      const i = Math.round(from + (to - from) * j / ticks);
      text(svg, x(i), height - 14, labelAt(data, i, data.minutes * (to - from) > 2880), { "text-anchor": j === 0 ? "start" : j === ticks ? "end" : "middle" });
    }
    return { svg, width, x, y, from, to, top, bottom, left, right };
  }
  function shade(plot, start, end, fill = colors.limit, opacity = 0.1) {
    const a = Math.max(plot.from, start - 0.5), b = Math.min(plot.to, end + 0.5);
    if (b < a) return;
    plot.svg.append(node("rect", { x: plot.x(a), y: plot.top, width: Math.max(2, plot.x(b) - plot.x(a)), height: plot.bottom - plot.top, fill, opacity }));
  }
  function band(plot, low, high) {
    let segment = [];
    function flush() {
      if (segment.length) {
        const d = segment.map((i, j) => `${j ? "L" : "M"}${plot.x(i)},${plot.y(high[i])}`).join(" ") + " " + segment.slice().reverse().map(i => `L${plot.x(i)},${plot.y(low[i])}`).join(" ") + " Z";
        plot.svg.append(node("path", { d, fill: colors.limit, opacity: 0.08 }));
      }
      segment = [];
    }
    for (let i = plot.from; i <= plot.to; i++) { if (finite(low[i]) && finite(high[i])) segment.push(i); else flush(); }
    flush(); path(plot.svg, low, plot, colors.limit, { "stroke-width": 1.2 }); path(plot.svg, high, plot, colors.limit, { "stroke-width": 1.2 });
  }
  function markers(plot, values, flags, dots = false) {
    for (let i = plot.from; i <= plot.to; i++) {
      if (!finite(values[i])) continue;
      const x = plot.x(i), y = plot.y(values[i]);
      if (dots) plot.svg.append(node("circle", { cx: x, cy: y, r: 2.3, fill: colors.raw }));
      if (flags && flags[i]) {
        line(plot.svg, x - 3, y - 3, x + 3, y + 3, { stroke: colors.flag, "stroke-width": 2 });
        line(plot.svg, x - 3, y + 3, x + 3, y - 3, { stroke: colors.flag, "stroke-width": 2 });
      }
    }
  }
  function readouts(id, entries) {
    const el = $(id); el.replaceChildren();
    for (const [label, value] of entries) {
      const div = document.createElement("div"), span = document.createElement("span"), strong = document.createElement("strong");
      span.textContent = label; strong.textContent = value; div.append(span, strong); el.append(div);
    }
  }
  function renderDetection() {
    const o = options(), key = JSON.stringify(o, (_, value) => typeof value === "number" && !finite(value) ? String(value) : value);
    if (key !== detectionKey) { detected = E.detect(dataset.values, o); detectionKey = key; }
    const active = o.enabled && !detected.error, fixed = o.method === "fixed", showEnvelope = active && $("show-envelope").checked;
    const pos = +$("position").value, s = detected.stats[pos], reveal = active && $("truth").checked && dataset.synthetic;
    const low = detected.stats.map(x => x.low), high = detected.stats.map(x => x.high);
    const global = fixed || o.scope === "global";
    $("fixed-controls").hidden = !fixed; $("reference-controls").hidden = fixed; $("multiplier-control").hidden = fixed;
    $("fixed-error").hidden = !detected.error; $("fixed-error").textContent = detected.error || "";
    for (const side of ["lower", "upper"]) {
      $(side + "-limit").disabled = $(side + "-slider").disabled = !$("use-" + side).checked;
      $(side + "-limit").setAttribute("aria-invalid", !!detected.error && $("use-" + side).checked ? "true" : "false");
    }
    $("show-envelope").disabled = !active; $("truth").disabled = !active;
    $("limits-legend").hidden = !showEnvelope; $("flags-legend").hidden = !active;
    $("detection-metrics").hidden = !active; $("inspector").hidden = !active; $("pin-note").hidden = !active;
    $("pin").disabled = $("transfer").disabled = !active;
    $("detect-chart").style.cursor = active ? "crosshair" : "default";
    $("detect-chart").setAttribute("aria-label", active ? "Observations, flagged points and optional detection limits. Select a sample to inspect." : "Raw observations. Detection is off.");
    $("synthetic-controls").hidden = !dataset.synthetic; $("length-control").hidden = !["cluster", "stuck"].includes($("dataset").value);
    $("truth-control").hidden = !dataset.synthetic; $("truth-legend").hidden = !reveal;
    $("amplitude-value").textContent = `${$("amplitude").value} units`; $("length-value").textContent = `${$("event-length").value} samples`;
    $("size-value").textContent = `${o.size} samples`; $("threshold-value").textContent = o.k.toFixed(1); $("run-value").textContent = `${o.run} samples`;
    for (const id of ["size", "alignment", "full"]) $(id).disabled = global;
    $("run").disabled = !o.plateau;
    $("span-note").textContent = global ? `Reference uses all ${dataset.values.length} samples in this record.` : `Spacing: ${duration(dataset.minutes)}. First-to-last window span: ${duration((o.size - 1) * dataset.minutes)}.`;
    $("formula").textContent = fixed ? "Flag observations outside your fixed limits, in the data's units. No window or multiplier is used." : o.method === "z" ? "Limits = mean ± k × sample SD (n − 1)." : o.method === "iqr" ? "Lower = Q1 − k × IQR; upper = Q3 + k × IQR." : "Limits = median ± k × 1.4826 × MAD.";
    $("data-note").textContent = dataset.synthetic ? ($("dataset").value === "step" ? "Synthetic example: this level shift is genuine. It is not an injected sensor fault." : "Synthetic example with a known changing signal and injected sensor faults. Reveal the reference after predicting.") : `Unchanged excerpt, rows ${dataset.offset + 1}–${dataset.offset + dataset.values.length} of ${dataset.source}. No supplied fault labels.`;
    $("data-source").hidden = !dataset.source; if (dataset.source) $("data-source").href = "../" + dataset.source;
    $("detect-title").textContent = dataset.label; $("rule-badge").textContent = !o.enabled ? "Detection off" : detected.error ? "Check thresholds" : fixed ? "Fixed thresholds" : global ? "Whole record" : o.alignment === "center" ? "Centered window" : "Trailing window";
    $("detect-chart-note").textContent = !o.enabled ? "Start with the observations. Turn on Show detection to reveal what the rule flags. Your settings are kept when you switch it off again." : detected.error ? detected.error : fixed ? "Click the graph or use the inspector. The same thresholds apply at every time; values equal to a limit are kept." : "Click the graph or move the inspector slider. Show envelope controls the limits and window shading. These are detection limits, not a confidence interval.";
    const arrays = [dataset.values]; if (showEnvelope) arrays.push(low, high); if (reveal) arrays.push(dataset.truth); if (showEnvelope && pinned) arrays.push(pinned.low, pinned.high);
    const p = chart("detect-chart", dataset, arrays, 0, dataset.values.length - 1, 350);
    if (showEnvelope) { if (!global) shade(p, s.start, s.end); band(p, low, high); }
    if (showEnvelope && pinned) { path(p.svg, pinned.low, p, colors.pin, { "stroke-dasharray": "5 4" }); path(p.svg, pinned.high, p, colors.pin, { "stroke-dasharray": "5 4" }); }
    path(p.svg, dataset.values, p, colors.raw, { "stroke-width": 1.5 });
    if (reveal) path(p.svg, dataset.truth, p, colors.truth, { "stroke-dasharray": "5 4" });
    markers(p, dataset.values, active ? detected.flagged : null, dataset.values.length < 300);
    if (active) {
      line(p.svg, p.x(pos), p.top, p.x(pos), p.bottom, { stroke: "#243746", "stroke-dasharray": "3 4", opacity: 0.6 });
      if (finite(dataset.values[pos])) p.svg.append(node("circle", { cx: p.x(pos), cy: p.y(dataset.values[pos]), r: 5, fill: "none", stroke: "#243746", "stroke-width": 2 }));
    }
    const metrics = [["Flagged / observed", `${count(detected.flagged)} / ${dataset.values.filter(finite).length}`]];
    if (reveal) {
      metrics.push(["Injected faults missed", count(dataset.faults.map((v, i) => v && !detected.flagged[i]))], ["Uncorrupted points flagged", count(detected.flagged.map((v, i) => v && !dataset.faults[i]))]);
    } else metrics.push([fixed ? "Threshold flags" : "Envelope flags", count(detected.envelope)], ["Repeated-run flags", count(detected.stuck)]);
    readouts("detection-metrics", metrics);
    $("pin-legend").hidden = !showEnvelope || !pinned; $("clear-pin").disabled = !active || !pinned;
    $("pin-note").textContent = pinned ? `Pinned: ${pinned.description} · ${pinned.count} flagged. Changing the data clears the comparison.` : "Pin one rule, then change the window, multiplier or method. Counts above apply to the whole displayed record; the two rules may flag the same point.";
    if (!active) {
      $("window-chart").replaceChildren(); $("window-metrics").replaceChildren(); $("calculation").textContent = "";
      $("challenge").textContent = detected.error ? "Set valid limits, then inspect which points they flag." : "Look at the raw series first. Which points look suspicious, and why? Choose a rule, predict its choices, then turn on Show detection.";
      pythonDetection(o); return;
    }
    $("inspector-title").textContent = fixed ? "Inspect a sample" : "Inside one window";
    $("position-value").textContent = labelAt(dataset, pos);
    const a = global ? 0 : Math.max(0, s.start), b = global ? dataset.values.length - 1 : Math.min(dataset.values.length - 1, s.end);
    const localLow = dataset.values.map(() => s.low), localHigh = dataset.values.map(() => s.high);
    const w = chart("window-chart", dataset, showEnvelope ? [dataset.values, localLow, localHigh] : [dataset.values], a, b, 235);
    if (showEnvelope) band(w, localLow, localHigh);
    path(w.svg, dataset.values, w, colors.raw); markers(w, dataset.values, null, true);
    if (showEnvelope && finite(s.center)) line(w.svg, w.left, w.y(s.center), w.right, w.y(s.center), { stroke: colors.limit, "stroke-dasharray": "4 4" });
    if (finite(dataset.values[pos])) w.svg.append(node("circle", { cx: w.x(pos), cy: w.y(dataset.values[pos]), r: 5, fill: detected.flagged[pos] ? colors.flag : "#243746", stroke: "white", "stroke-width": 1.5 }));
    readouts("window-metrics", fixed ? [["Observed value", fmt(dataset.values[pos])], ["Lower limit", finite(s.low) ? fmt(s.low) : "Off"], ["Upper limit", finite(s.high) ? fmt(s.high) : "Off"]] : [["Available in reference", s.count], [o.method === "z" ? "Mean / sample SD" : o.method === "iqr" ? "Median / IQR" : "Median / scaled MAD", `${fmt(s.center)} / ${fmt(s.scale)}`], ["Detection limits", `${fmt(s.low)} … ${fmt(s.high)}`]]);
    $("calculation").textContent = !finite(dataset.values[pos]) ? "This sample is already missing. It is not counted as an outlier." : `Observed value: ${fmt(dataset.values[pos])}. ${detected.flagged[pos] ? `FLAGGED by ${[detected.envelope[pos] ? fixed ? "the fixed thresholds" : "the envelope" : "", detected.stuck[pos] ? "the repeated-run rule" : ""].filter(Boolean).join(" and ")}.` : finite(s.low) || finite(s.high) ? "Inside or on the enabled limits; not flagged." : "No envelope decision: too few observations or an incomplete required window."}`;
    $("window-note").textContent = (fixed ? "The limits are numbers you choose; the data and window do not change them." : (s.scale === 0 ? "Spread is zero: the limits collapse. Any value outside them is flagged. " : "") + (global ? "The entire displayed record supplies the reference. " : o.alignment === "center" ? "Centered windows use future samples. " : "The envelope uses only the current and earlier samples. ") + "The tested value contributes to its own limits.") + (o.plateau ? " Repeated-run detection examines the whole run, including future samples." : "");
    $("challenge").textContent = fixed ? "Choose a threshold before revealing the detections. Can one fixed limit catch the bad readings while keeping a changing baseline? Try an upper limit only, then compare with a rolling rule." : $("dataset").value === "step" ? "This change is real by construction. Which points does your detector flag? Why would deleting them be a mistake? What extra information would distinguish a real change from a sensor recalibration?" : $("dataset").value === "stuck" || $("dataset").value === "challenge1D" ? "Move inside the plateau. Why can a flat stretch look normal to the envelope? Turn on repeated-value detection. Would exactly repeated readings always mean the sensor is broken?" : $("dataset").value === "cluster" ? "Make the window shorter than the bad event, then longer than it. Can the corrupted readings become their own normal? What happens when the window also spans a large change in the real signal?" : "Pin the SD limits, then switch to MAD. Can making the spike taller also widen its own limits? Try whole-record detection. Name a normal point you would worry about deleting.";
    pythonDetection(o);
  }
  function makeGapData() {
    const key = $("gap-data").value, t = OutlierData.temperature;
    if (key === "transfer" && transfer) { gapData = transfer; gapInput = transfer.values.slice(); }
    else {
      gapData = { ...t, truth: t.original, label: "Temperature · July–August 2019" };
      gapInput = (key === "custom" ? t.original : t[key]).slice();
      if (key === "custom") {
        const length = +$("gap-length").value;
        $("gap-position").max = t.original.length - length;
        const start = Math.min(+$("gap-position").value, t.original.length - length);
        $("gap-position").value = start; gapInput.fill(null, start, start + length);
      }
    }
    gapRuns = E.gaps(gapInput);
    const selected = Math.min(+$("gap-inspect").value || 0, Math.max(0, gapRuns.length - 1));
    $("gap-inspect").replaceChildren();
    gapRuns.forEach((g, i) => { const opt = document.createElement("option"); opt.value = i; opt.textContent = `${i + 1} · ${labelAt(gapData, g.start)} · ${g.length} missing`; $("gap-inspect").append(opt); });
    if (!gapRuns.length) { const opt = document.createElement("option"); opt.textContent = "No gaps in this record"; opt.value = 0; $("gap-inspect").append(opt); }
    $("gap-inspect").value = selected;
  }
  function renderGaps() {
    makeGapData();
    const method = $("fill-method").value, maxGap = +$("max-gap").value, reveal = $("gap-truth").checked && !!gapData.truth;
    const gap = gapRuns[+$("gap-inspect").value], key = $("gap-data").value;
    gapResult = E.fill(gapInput, method, maxGap);
    $("custom-gap-controls").hidden = key !== "custom";
    $("gap-length-value").textContent = `${$("gap-length").value} (${duration(+$("gap-length").value * gapData.minutes)})`;
    $("gap-position-value").textContent = labelAt(gapData, +$("gap-position").value);
    $("max-gap-value").textContent = `${maxGap} samples`;
    $("gap-truth-control").hidden = !gapData.truth; $("gap-truth-legend").hidden = !reveal;
    $("gap-data-note").textContent = key === "transfer" ? `Snapshot: ${transfer.description}. Reference values are ${transfer.truth ? "known only because this is a synthetic example" : "unknown for these challenge observations"}.` : "The same data_missing.csv used in the lesson. Gaps are held out from an available temperature record sampled every 2 hours.";
    $("fill-method-note").textContent = { none: "Leaving a gap is a valid decision.", forward: "Repeat the last available value. A leading gap stays empty.", backward: "Use the next available value. Needs future data; a trailing gap stays empty.", linear: "Connect the available neighbors with a straight line. Uses future data; no extrapolation.", cubic: "A smooth natural cubic spline through all available points. Uses future data and can overshoot. No extrapolation." }[method];
    $("gap-inspect").disabled = !gap; $("gap-view").disabled = !gap;
    let from = 0, to = gapInput.length - 1;
    if (gap && $("gap-view").value === "focus") { const pad = Math.max(18, Math.min(60, gap.length)); from = Math.max(0, gap.start - pad); to = Math.min(to, gap.end + pad); }
    const arrays = [gapInput, gapResult]; if (reveal) arrays.push(gapData.truth);
    const p = chart("gap-chart", gapData, arrays, from, to, 380);
    for (const g of gapRuns) shade(p, g.start, g.end, colors.flag, 0.06);
    if (reveal) path(p.svg, gapData.truth, p, colors.truth, { "stroke-dasharray": "5 4", "stroke-width": 2 });
    path(p.svg, gapInput, p, colors.raw, { "stroke-width": 2 }); markers(p, gapInput, null, to - from < 180);
    // Draw only imputed segments and their immediate known endpoints, keeping gaps visible.
    for (const g of gapRuns) {
      if (g.end < from || g.start > to || !finite(gapResult[g.start])) continue;
      const section = { ...p, from: Math.max(from, g.start - 1), to: Math.min(to, g.end + 1) };
      path(p.svg, gapResult, section, colors.flag, { "stroke-dasharray": "6 4", "stroke-width": 2.6 });
      for (let i = Math.max(g.start, from); i <= Math.min(g.end, to); i++) p.svg.append(node("circle", { cx: p.x(i), cy: p.y(gapResult[i]), r: 2.2, fill: colors.flag }));
    }
    const score = E.score(gapInput, gapResult, gapData.truth);
    readouts("gap-metrics", [["Missing samples", score.missing], ["Filled / still missing", `${score.filled} / ${score.missing - score.filled}`], ["RMSE on filled samples", reveal ? `${fmt(score.rmse)}${score.evaluated ? " " + gapData.unit : ""}` : gapData.truth ? "Reveal to evaluate" : "Unknown reference"]]);
    $("gap-summary").textContent = gap ? `${gap.length} consecutive missing samples; spacing ${duration(gapData.minutes)}. ${gap.start > 0 && gap.end < gapInput.length - 1 ? `Known neighbors are ${duration((gap.length + 1) * gapData.minutes)} apart.` : "This gap touches the record boundary."}` : "Try the temperature data or flag some points in stage 1.";
    $("gap-title").textContent = `${gapData.label} · ${fillNames[method]}`;
    $("gap-note").textContent = gap && gap.length > maxGap ? "The selected gap exceeds your maximum run length. It stays entirely missing, regardless of method." : method === "cubic" ? "A smooth curve can still be a poor estimate. Reveal the original: does the spline overshoot, or miss the daily temperature cycle?" : method === "none" ? "No values have been invented. What analysis could you still do with these gaps?" : "The dashed segments are estimates, not observations. Check how much of a cycle is hidden before trusting the connection.";
    $("comparison").replaceChildren();
    for (const [name, label] of Object.entries(fillNames)) {
      const result = name === method ? gapResult : E.fill(gapInput, name, maxGap), s = E.score(gapInput, result, gapData.truth);
      const row = document.createElement("tr"); if (name === method) row.className = "selected";
      [label, `${s.filled} / ${s.missing}`, reveal ? (s.evaluated ? fmt(s.rmse, 3) : "—") : gapData.truth ? "Hidden" : "Unknown"].forEach(value => { const td = document.createElement("td"); td.textContent = value; row.append(td); });
      $("comparison").append(row);
    }
    $("score-note").textContent = !gapData.truth ? "No ground truth is supplied for these observations, so an error score would be misleading." : !reveal ? "Reveal the held-out original to compare errors after making a prediction." : `RMSE is in ${gapData.unit}, on filled samples only. Unfilled points are excluded; fewer filled points can make a method look better. Compare coverage as well as error.`;
    $("challenge").textContent = "Start with a short gap and predict the best method. Make it long enough to hide a daily peak, then reveal the original. Does a smoother curve mean a more accurate estimate? Where would you choose to leave a gap instead?";
    pythonGaps(method, maxGap);
  }
  function pythonDetection(o) {
    let code = 'import numpy as np\nimport pandas as pd\n\ndf = pd.read_csv("outliers-detection.csv")\ns = df["input"]  # raw observations; keep unchanged\n';
    if (!o.enabled || detected.error) code += `\n# ${detected.error || "Detection is off: no points are flagged or removed."}\nflagged = pd.Series(False, index=s.index)\n`;
    else if (o.method === "fixed") {
      const rules = [finite(o.lower) ? `(s < ${o.lower})` : "", finite(o.upper) ? `(s > ${o.upper})` : ""].filter(Boolean);
      code += `\n# Fixed limits, in the same units as the observations.\nflagged = ${rules.join(" | ")}\n`;
    } else {
      code += `window, k = ${o.size}, ${o.k}\n\ndef limits(a):\n    a = a[np.isfinite(a)]\n    if len(a) < 3:\n        return np.nan, np.nan\n`;
      code += o.method === "z" ? "    center, spread = np.mean(a), np.std(a, ddof=1)\n    return center - k*spread, center + k*spread\n" : o.method === "iqr" ? "    q1, q3 = np.quantile(a, [0.25, 0.75])\n    return q1 - k*(q3-q1), q3 + k*(q3-q1)\n" : "    center = np.median(a)\n    spread = 1.4826 * np.median(np.abs(a - center))\n    return center - k*spread, center + k*spread\n";
      if (o.scope === "global") code += "\nlow, high = limits(s.to_numpy())\n";
      else code += `\nr = s.rolling(window, center=${o.alignment === "center" ? "True" : "False"}, min_periods=${o.full ? "window" : "3"})\nlow = r.apply(lambda a: limits(a)[0], raw=True)\nhigh = r.apply(lambda a: limits(a)[1], raw=True)\n`;
      code += "flagged = (s < low) | (s > high)\n";
    }
    if (o.enabled && !detected.error && o.plateau) code += `groups = s.ne(s.shift()).cumsum()\nrun_length = s.groupby(groups).transform("size")\nflagged |= s.notna() & (run_length >= ${o.run})\n`;
    code += "df['recomputed_flagged'] = flagged\ndf['recomputed_cleaned'] = s.mask(flagged)\nprint(df[['input', 'recomputed_flagged', 'recomputed_cleaned']])\n";
    $("python-code").textContent = code;
  }
  function pythonGaps(method, maxGap) {
    let code = "import numpy as np\nimport pandas as pd\n\ndf = pd.read_csv('outliers-gaps.csv')\ns = df['input']  # missing already; reference is NOT used\n";
    code += { none: "estimate = s.copy()\n", forward: "estimate = s.ffill()\n", backward: "estimate = s.bfill()\n", linear: "estimate = s.interpolate(method='linear', limit_area='inside')\n", cubic: "from scipy.interpolate import CubicSpline\nx = np.arange(len(s))\nknown = s.notna().to_numpy()\nestimate = s.copy()\nif known.sum() >= 2:\n    curve = CubicSpline(x[known], s[known], bc_type='natural', extrapolate=False)\n    estimate.loc[~known] = curve(x[~known])\n" }[method];
    code += `\nmissing = s.isna()\ngroups = missing.ne(missing.shift()).cumsum()\nrun_length = missing.groupby(groups).transform('size')\nestimate.loc[missing & (run_length > ${maxGap})] = np.nan\ndf['recomputed_estimate'] = estimate\ndf['recomputed_imputed'] = missing & estimate.notna()\n# Evaluate only where the input was missing and truth is known.\nvalid = missing & estimate.notna() & df['reference'].notna()\nif valid.any():\n    print('RMSE:', np.sqrt(((estimate[valid] - df.loc[valid, 'reference'])**2).mean()))\n`;
    $("python-code").textContent = code;
  }
  function render() {
    scheduled = false;
    $("detect-stage").hidden = mode !== "detect"; $("fill-stage").hidden = mode !== "fill";
    $("detect-mode").setAttribute("aria-pressed", mode === "detect"); $("fill-mode").setAttribute("aria-pressed", mode === "fill");
    if (mode === "detect") renderDetection(); else renderGaps();
  }
  function schedule() { if (!scheduled) { scheduled = true; requestAnimationFrame(render); } }
  function reset() {
    mode = "detect"; pinned = null; transfer = null; $("transfer-option").disabled = true;
    for (const [id, value] of Object.entries({ dataset: "spike", method: "mad", scope: "rolling", size: 31, alignment: "center", threshold: 3, run: 10, amplitude: 8, "event-length": 9, "gap-data": "mis_1", "fill-method": "linear", "gap-length": 12, "gap-position": 180, "max-gap": 201, "gap-view": "focus" })) $(id).value = value;
    for (const id of ["full", "plateau", "truth", "gap-truth", "detection-enabled"]) $(id).checked = false;
    for (const id of ["show-envelope", "use-lower", "use-upper"]) $(id).checked = true;
    $("gap-inspect").replaceChildren(); chooseData(); schedule();
  }
  Object.entries(OutlierData.challenges).forEach(([key, data]) => { const opt = document.createElement("option"); opt.value = key; opt.textContent = data.label; $("course-datasets").append(opt); });
  $("dataset").addEventListener("change", () => { chooseData(); schedule(); });
  for (const id of ["amplitude", "event-length"]) $(id).addEventListener("input", () => {
    const position = $("position").value, reveal = $("truth").checked;
    chooseData(false); $("position").value = position; $("truth").checked = reveal; schedule();
  });
  for (const id of ["method", "scope", "size", "alignment", "full", "threshold", "plateau", "run", "truth", "position", "gap-data", "gap-length", "gap-position", "fill-method", "max-gap", "gap-view", "gap-inspect", "gap-truth", "detection-enabled", "show-envelope", "use-lower", "use-upper"]) $(id).addEventListener("input", schedule);
  for (const side of ["lower", "upper"]) {
    $(side + "-slider").addEventListener("input", () => { $(side + "-limit").value = Number(Number($(side + "-slider").value).toPrecision(6)); schedule(); });
    $(side + "-limit").addEventListener("input", () => { syncLimitSliders(); schedule(); });
  }
  $("method").addEventListener("change", () => { $("threshold").value = $("method").value === "iqr" ? 1.5 : 3; schedule(); });
  $("gap-data").addEventListener("change", () => { $("gap-inspect").value = 0; $("gap-truth").checked = false; schedule(); });
  $("detect-mode").addEventListener("click", () => { mode = "detect"; schedule(); });
  $("fill-mode").addEventListener("click", () => { mode = "fill"; schedule(); });
  $("reset").addEventListener("click", reset);
  $("pin").addEventListener("click", () => { renderDetection(); if (!options().enabled || detected.error) return; pinned = { low: detected.stats.map(s => s.low), high: detected.stats.map(s => s.high), count: count(detected.flagged), description: description(options()) }; schedule(); });
  $("clear-pin").addEventListener("click", () => { pinned = null; schedule(); });
  $("transfer").addEventListener("click", () => {
    renderDetection(); if (!options().enabled || detected.error) return;
    transfer = { ...dataset, values: detected.cleaned.slice(), raw: dataset.values.slice(), flags: detected.flagged.slice(), description: description(options()) };
    $("transfer-option").disabled = false; $("gap-data").value = "transfer"; $("gap-inspect").replaceChildren(); $("gap-truth").checked = false; mode = "fill"; schedule();
  });
  $("detect-chart").addEventListener("click", event => {
    if (!options().enabled || detected.error) return;
    const svg = $("detect-chart"), rect = svg.getBoundingClientRect(), width = svg.viewBox.baseVal.width;
    const x = (event.clientX - rect.left) / rect.width * width;
    $("position").value = Math.round(Math.max(0, Math.min(1, (x - 58) / (width - 73))) * (dataset.values.length - 1)); schedule();
  });
  document.querySelectorAll("[data-preset]").forEach(button => button.addEventListener("click", () => {
    reset(); const key = button.dataset.preset;
    if (key === "gap") { mode = "fill"; $("gap-data").value = "custom"; $("gap-length").value = 24; }
    else {
      $("dataset").value = key; if (key === "spike") { $("method").value = "z"; $("size").value = 9; }
      if (key === "cluster") { $("event-length").value = 15; $("size").value = 11; }
      if (key === "stuck") { $("event-length").value = 41; $("size").value = 21; }
      chooseData();
    }
    schedule();
  }));
  $("export").addEventListener("click", () => {
    render();
    const detection = mode === "detect", data = detection ? dataset : gapData, input = detection ? dataset.values : gapInput;
    const rows = [["time", "input", "raw", "flagged", "was_missing", "cleaned", "estimate", "imputed", "lower", "upper", "reference"]];
    input.forEach((v, i) => rows.push([dateAt(data, i), v, detection ? v : data.raw ? data.raw[i] : v, detection ? +detected.flagged[i] : data.flags ? +data.flags[i] : 0, +!finite(v), detection ? detected.cleaned[i] : v, detection ? null : gapResult[i], detection ? 0 : +(!finite(v) && finite(gapResult[i])), detection ? detected.stats[i].low : null, detection ? detected.stats[i].high : null, data.truth ? data.truth[i] : null]));
    const csv = rows.map(row => row.map(v => v === null || v === undefined ? "" : v).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = detection ? "outliers-detection.csv" : "outliers-gaps.csv"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  window.addEventListener("resize", schedule);
  new ResizeObserver(() => {
    if (window.parent !== window) window.parent.postMessage({ type: "outliers-lab-height", height: Math.ceil(document.querySelector("main").getBoundingClientRect().height) + 4 }, window.location.origin);
  }).observe(document.querySelector("main"));
  if (window.location.hash === "#gaps") { reset(); mode = "fill"; } else reset();
})();
