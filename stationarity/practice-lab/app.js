(() => {
  "use strict";
  const $ = id => document.getElementById(id), E = StationarityLab, D = StationarityData;
  const synthetic = E.examples(), NS = "http://www.w3.org/2000/svg";
  const colors = { raw: "#718392", mean: "#087f79", variance: "#b96819", grid: "#e2e9ec", shade: "#dfefed" };
  const modes = ["windows", "fit", "difference"];
  const hashMode = () => modes.includes(location.hash.slice(1)) ? location.hash.slice(1) : "windows";
  let mode = hashMode(), seed = 49, differenceSeed = 49, currentWindow, fitData, differenceData, pending = false;
  let cachedADF = { key: "", result: null }, cachedFit = { key: "", result: null }, cachedDifference = { key: "", result: null };
  const num = (v, digits = 3) => Number.isFinite(v) ? v.toFixed(digits) : "—";
  const ptext = p => p < 0.0001 ? "< 0.0001" : p.toFixed(4);
  function node(tag, attributes = {}, text) {
    const el = document.createElementNS(NS, tag);
    for (const [key, value] of Object.entries(attributes)) el.setAttribute(key, value);
    if (text !== undefined) el.textContent = text;
    return el;
  }
  function dataset() {
    const key = $("dataset").value;
    return D[key] || { values: synthetic[key], label: $("dataset").selectedOptions[0].textContent, unit: "value" };
  }
  function timeLabel(data, i) {
    if (!data.start) return String(i);
    // UTC arithmetic preserves the source's standard-time clock without browser DST shifts.
    const s = new Date(Date.parse(data.start + "Z") + i * data.minutes * 60000).toISOString();
    return data.minutes === 60 ? s.slice(5, 10) + " " + s.slice(11, 16) : s.slice(0, 10);
  }
  function chart(id, lines, n, { label = String, unit = "", shade = null, zero = false } = {}) {
    const svg = $(id), width = Math.max(360, Math.min(900, svg.clientWidth)), height = +svg.getAttribute("viewBox").split(" ")[3];
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.replaceChildren();
    const finite = lines.flatMap(l => l.values.filter(Number.isFinite));
    if (!finite.length) return;
    const left = 55, right = width - 15, top = 24, bottom = height - 38;
    let lo = Math.min(...finite), hi = Math.max(...finite);
    if (zero) lo = Math.min(0, lo);
    const pad = Math.max((hi - lo) * 0.09, 0.1); lo -= pad; hi += pad;
    if (zero) lo = 0;
    const x = i => left + i / Math.max(1, n - 1) * (right - left);
    const y = v => bottom - (v - lo) / (hi - lo) * (bottom - top);
    if (shade) svg.append(node("rect", { x: x(shade[0]), y: top, width: Math.max(1, x(shade[1]) - x(shade[0])), height: bottom - top, fill: colors.shade }));
    for (let i = 0; i <= 3; i++) {
      const value = lo + (hi - lo) * i / 3, yy = y(value);
      svg.append(node("line", { x1: left, y1: yy, x2: right, y2: yy, stroke: colors.grid }));
      svg.append(node("text", { x: left - 8, y: yy + 4, "text-anchor": "end" }, value.toFixed(1)));
    }
    svg.append(node("text", { x: left, y: 13 }, unit));
    const ticks = width < 600 ? 2 : 3;
    for (let i = 0; i <= ticks; i++) {
      const at = Math.round((n - 1) * i / ticks);
      svg.append(node("text", { x: x(at), y: height - 12, "text-anchor": i === 0 ? "start" : i === ticks ? "end" : "middle" }, label(at)));
    }
    for (const line of lines) {
      let path = "", connected = false;
      line.values.forEach((v, i) => {
        if (!Number.isFinite(v)) { connected = false; return; }
        path += `${connected ? "L" : "M"}${x(i).toFixed(2)},${y(v).toFixed(2)} `;
        connected = true;
      });
      svg.append(node("path", { d: path, fill: "none", stroke: line.color, "stroke-width": line.color === colors.raw ? 1.2 : 2.1, ...(line.dashed ? { "stroke-dasharray": "5 4" } : {}) }));
    }
    if (shade) svg.append(node("line", { x1: x(shade[0]), x2: x(shade[0]), y1: top, y2: bottom, stroke: colors.mean, "stroke-dasharray": "4 4" }));
  }
  function resetWindow() {
    const data = dataset(), real = !!data.start;
    $("length").max = data.values.length;
    $("length").value = real ? data.values.length : 500;
    $("start").value = 0;
    $("rolling").value = $("dataset").value === "hourly" ? 25 : real ? 31 : 101;
    cachedADF.key = "";
  }
  function renderWindow() {
    const data = dataset(), n = +$("length").value;
    $("start").max = data.values.length - n;
    $("start").value = Math.min(+$("start").value, +$("start").max);
    $("start").disabled = +$("start").max === 0;
    const start = +$("start").value, xs = data.values.slice(start, start + n);
    $("rolling").max = Math.min(365, n % 2 ? n : n - 1);
    $("rolling").value = Math.min(+$("rolling").value, +$("rolling").max);
    const width = +$("rolling").value;
    $("length-value").textContent = `${n} ${data.minutes === 1440 ? "days" : data.minutes === 60 ? "hours" : "samples"}`;
    $("start-value").textContent = timeLabel(data, start);
    $("rolling-value").textContent = `${width} ${data.minutes === 1440 ? "days" : data.minutes === 60 ? "hours" : "samples"}`;
    $("overview-title").textContent = data.label;
    $("window-title").textContent = `${timeLabel(data, start)} → ${timeLabel(data, start + n - 1)}`;
    $("source-note").textContent = "Shading marks the selected window.";
    const r = E.rolling(xs, width);
    chart("overview", [{ values: data.values, color: colors.raw }], data.values.length, { label: i => timeLabel(data, i), unit: data.unit, shade: [start, start + n - 1] });
    chart("window-chart", [{ values: xs, color: colors.raw }, { values: r.means, color: colors.mean }], n, { label: i => timeLabel(data, start + i), unit: data.unit });
    chart("variance-chart", [{ values: r.variances, color: colors.variance }], n, { label: i => timeLabel(data, start + i), unit: data.unit === "°C" ? "°C²" : "value²", zero: true });
    const key = `${$("dataset").value}:${start}:${n}`;
    if (cachedADF.key !== key) cachedADF = { key, result: E.adf(xs) };
    const adf = cachedADF.result;
    $("sample-count").textContent = n;
    $("adf-stat").textContent = num(adf.statistic);
    $("adf-p").textContent = adf.error ? "—" : ptext(adf.pvalue);
    $("adf-lags").textContent = adf.error ? "—" : `${adf.lag} / ${adf.maxlag}`;
    $("adf-result").textContent = adf.error || (adf.pvalue < 0.05 ? "p < 0.05: evidence against a unit root." : "p ≥ 0.05: not enough evidence to reject a unit root.");
    $("adf-warning").textContent = (n < 50 ? "Very short record: the test has little power. " : "") + (data.start ? "A small p-value does not remove the seasonal or daily cycle." : $("dataset").value === "variance" ? "The variance changes even if ADF rejects a unit root." : "This result alone does not establish stationarity.");
    currentWindow = { data, xs, start };
    $("window-python").textContent = `import pandas as pd\nimport matplotlib.pyplot as plt\nfrom statsmodels.tsa.stattools import adfuller\n\ns = pd.read_csv("stationarity-window.csv", index_col="time")["value"]\nr = s.rolling(${width}, center=True)\nfig, ax = plt.subplots(2, 1, sharex=True)\nax[0].plot(s.to_numpy(), color="0.65")\nax[0].plot(r.mean().to_numpy(), color="teal")\nax[1].plot(r.var().to_numpy())\nresult = adfuller(s, regression="c", maxlag=min(12, len(s)//2 - 2), autolag="AIC")\npvalue = result.pvalue if hasattr(result, "pvalue") else result[1]\nprint("p-value:", pvalue)\nprint("Reject unit root" if pvalue < 0.05 else "Do not reject unit root")\nplt.show()`;
  }
  function renderFit() {
    const data = D.hourly, n = +$("fit-days").value * 24, steps = +$("horizon").value;
    $("fit-start").max = data.values.length - n;
    $("fit-start").value = Math.min(+$("fit-start").value, +$("fit-start").max);
    const start = +$("fit-start").value, end = start + n;
    const train = data.values.slice(start, end), key = `${start}:${n}`;
    $("fit-days-value").textContent = `${n / 24} days`;
    $("fit-start-value").textContent = timeLabel(data, start);
    $("horizon-value").textContent = `${steps} hours (${num(steps / 24, 1)} days)`;
    chart("fit-overview", [{ values: data.values, color: colors.raw }], data.values.length,
      { label: i => timeLabel(data, i), unit: "°C", shade: [start, end - 1] });
    if (cachedFit.key !== key) cachedFit = { key, result: E.selectAR(train) };
    const selected = cachedFit.result;
    $("fit-error").hidden = !selected.error;
    $("fit-card").hidden = !!selected.error;
    $("fit-results").hidden = !!selected.error;
    $("export-fit").disabled = !!selected.error;
    if (selected.error) { $("fit-error").textContent = selected.error; fitData = null; return; }
    const shocks = E.innovations(steps, selected.sigma, seed);
    const simulation = E.rollout(train, selected.fit.coefficients, shocks);
    const average = E.forecast(train, selected.fit.coefficients, steps);
    const actual = data.values.slice(end, end + steps);
    fitData = { start, train, shocks, simulation, average, actual, selected };
    const history = Math.min(72, n), total = history + steps;
    const pad = Array(history - 1).fill(null), join = [train[n - 1]];
    const lines = [
      { values: train.slice(-history).concat(Array(steps).fill(null)), color: colors.raw },
      { values: pad.concat(join, simulation), color: colors.variance }
    ];
    if ($("show-mean").checked) lines.push({ values: pad.concat(join, average), color: colors.mean, dashed: true });
    if ($("show-actual").checked) lines.push({ values: pad.concat(join, actual, Array(steps - actual.length).fill(null)), color: "#38434c", dashed: true });
    $("mean-legend").hidden = !$("show-mean").checked;
    $("actual-legend").hidden = !$("show-actual").checked;
    $("selected-order").textContent = `AR(${selected.p})`;
    $("noise-sd").textContent = `${num(selected.sigma, 2)} °C`;
    $("fit-title").textContent = `Fit ${timeLabel(data, start).slice(0, 5)}–${timeLabel(data, end - 1).slice(0, 5)}, then continue`;
    chart("fit-chart", lines, total, { label: i => timeLabel(data, end - history + i), unit: "°C", shade: [history - 1, total - 1] });
    $("fit-note").textContent = "Last 3 training days shown. After the dashed line, the simulation uses its own values plus new noise. Actual future observations never enter the fit or continuation.";
    $("fit-warning").hidden = selected.stable && (!$("show-actual").checked || actual.length === steps);
    $("fit-warning").textContent = (!selected.stable ? "This fitted model is unstable; its continuation can grow. " : "") +
      ($("show-actual").checked && actual.length < steps ? `Actual observations are available for ${actual.length} of the ${steps} future hours.` : "");
    $("selection-note").textContent = `Fitted live for this window. BIC selected AR(${selected.p}) from orders 1–${selected.maxOrder}, balancing fit against model size. All candidates use the same training targets. New noise is Gaussian, with SD estimated from the fit residuals.`;
    const rows = (id, data) => {
      const body = $(id); body.replaceChildren();
      for (const values of data) { const tr = document.createElement("tr"); for (const value of values) { const td = document.createElement("td"); td.textContent = value; tr.append(td); } body.append(tr); }
    };
    rows("coefficient-table", selected.fit.coefficients.map((v, i) => [i ? `φ${i}` : "Intercept", num(v, 4)]));
    rows("order-table", selected.candidates.map(c => [`AR(${c.p})${c.p === selected.p ? " · selected" : ""}`, num(c.bic - selected.bic, 2)]));
    $("fit-python").textContent = `import numpy as np
import pandas as pd
from statsmodels.tsa.ar_model import AutoReg

frame = pd.read_csv("temperature-ar.csv")
x = frame.loc[frame["role"] == "train", "temperature"].to_numpy()
noise = frame.loc[frame["role"] == "future", "innovation"].to_numpy()
max_order = min(24, len(x) // 5)
models = [AutoReg(x, lags=p, hold_back=max_order, trend="c").fit()
          for p in range(1, max_order + 1)]
fit = min(models, key=lambda model: model.bic)
p = len(fit.params) - 1
print("Selected AR order:", p)

# Feed generated values back into the model. Do not use future temperatures.
values = list(x)
for shock in noise:
    next_value = fit.params[0] + sum(fit.params[j+1] * values[-j-1] for j in range(p))
    values.append(next_value + shock)
simulation = np.array(values[len(x):])
average = fit.predict(start=len(x), end=len(x) + len(noise) - 1)
print("First 5 simulated values:", simulation[:5])`;
  }
  function renderDifference() {
    const data = D.daily, n = +$("difference-days").value, steps = +$("difference-horizon").value;
    const d = +$("difference-order").value;
    $("difference-start").max = data.values.length - n;
    $("difference-start").value = Math.min(+$("difference-start").value, +$("difference-start").max);
    const start = +$("difference-start").value, end = start + n;
    const train = data.values.slice(start, end), transformed = E.difference(train, d);
    $("difference-days-value").textContent = `${n} days`;
    $("difference-start-value").textContent = timeLabel(data, start);
    $("difference-horizon-value").textContent = `${steps} days`;
    chart("difference-overview", [{ values: data.values, color: colors.raw }], data.values.length,
      { label: i => timeLabel(data, i), unit: "°C", shade: [start, end - 1] });
    $("difference-input-title").textContent = ["Model input: temperature", "Model input: daily changes", "Model input: changes of daily changes"][d];
    chart("difference-input", [{ values: transformed, color: colors.raw }, { values: E.rolling(transformed, 15).means, color: colors.mean }], transformed.length,
      { label: i => timeLabel(data, start + d + i), unit: "°C" });
    const key = `${start}:${n}:${d}`;
    if (cachedDifference.key !== key) cachedDifference = { key, result: { selected: E.selectAR(transformed), adf: E.adf(transformed) } };
    const { selected, adf } = cachedDifference.result;
    $("difference-adf").textContent = adf.error || `ADF p-value ${ptext(adf.pvalue)} · ${adf.pvalue < 0.05 ? "Evidence against a unit root; also check the plot." : "Not enough evidence to reject a unit root."}`;
    $("difference-error").hidden = !selected.error;
    $("difference-card").hidden = !!selected.error;
    $("export-difference").disabled = !!selected.error;
    if (selected.error) { $("difference-error").textContent = selected.error; differenceData = null; return; }
    const shocks = E.innovations(steps, selected.sigma, differenceSeed);
    const simulation = E.restore(train, E.rollout(transformed, selected.fit.coefficients, shocks), d);
    const average = E.restore(train, E.forecast(transformed, selected.fit.coefficients, steps), d);
    const actual = data.values.slice(end, end + steps);
    differenceData = { start, train, d, shocks, simulation, average, actual, selected };
    const history = Math.min(60, n), pad = Array(history - 1).fill(null), join = [train[n - 1]];
    const lines = [
      { values: train.slice(-history).concat(Array(steps).fill(null)), color: colors.raw },
      { values: pad.concat(join, simulation), color: colors.variance }
    ];
    if ($("difference-mean").checked) lines.push({ values: pad.concat(join, average), color: colors.mean, dashed: true });
    if ($("difference-actual").checked) lines.push({ values: pad.concat(join, actual, Array(steps - actual.length).fill(null)), color: "#38434c", dashed: true });
    $("difference-mean-legend").hidden = !$("difference-mean").checked;
    $("difference-actual-legend").hidden = !$("difference-actual").checked;
    chart("difference-chart", lines, history + steps,
      { label: i => timeLabel(data, end - history + i), unit: "°C", shade: [history - 1, history + steps - 1] });
    $("difference-selected").textContent = `AR(${selected.p})`;
    $("difference-count").textContent = d;
    const reconstruction = ["Generate each new temperature from previous temperatures.", "Generate each new change, then add it to the previous temperature.", "Generate a change of the daily change. Add it to the previous daily change, then add that change to the previous temperature."][d];
    $("difference-note").textContent = `${reconstruction} After the cutoff, the model uses its own generated values. BIC selects the AR order live from 1–${selected.maxOrder}.`;
    $("difference-warning").textContent = (!selected.stable ? "The fitted AR model is unstable; its continuation can grow. " : "") +
      (d ? "Adding changes back can accumulate errors, especially with two differences. " : "") +
      ($("difference-actual").checked && actual.length < steps ? `Actual observations are available for ${actual.length} of the ${steps} future days.` : "");
    $("difference-warning").hidden = !$("difference-warning").textContent;
    $("difference-score").hidden = !$("difference-actual").checked || !actual.length;
    $("difference-score").textContent = `Average forecast RMSE: ${num(E.rmse(average, actual), 2)} °C over ${actual.length} observed future days. Smaller is better for this window.`;
    $("difference-python").textContent = `import numpy as np
import pandas as pd
from statsmodels.tsa.ar_model import AutoReg

frame = pd.read_csv("temperature-differences.csv")
x = frame.loc[frame["role"] == "train", "temperature"].to_numpy()
noise = frame.loc[frame["role"] == "future", "innovation"].to_numpy()
d = int(frame["differences"].iloc[0])
y = np.diff(x, n=d)
max_order = min(24, len(y) // 5)
models = [AutoReg(y, lags=p, hold_back=max_order, trend="c").fit()
          for p in range(1, max_order + 1)]
fit = min(models, key=lambda model: model.bic)
p = len(fit.params) - 1
print("Differences:", d, "Selected AR order:", p)

values = list(y)
for shock in noise:
    next_value = fit.params[0] + sum(fit.params[j+1] * values[-j-1] for j in range(p))
    values.append(next_value + shock)

def to_temperature(future):
    if d == 2:
        future = np.cumsum(future) + (x[-1] - x[-2])
    if d >= 1:
        future = np.cumsum(future) + x[-1]
    return np.asarray(future)

simulation = to_temperature(values[len(y):])
average = to_temperature(fit.predict(len(y), len(y) + len(noise) - 1))
print("First 5 simulated temperatures:", simulation[:5])`;
  }
  function height() {
    positionControls();
    if (window.parent !== window) window.parent.postMessage({ type: "stationarity-practice-height", height: Math.ceil(document.querySelector("main").getBoundingClientRect().height) + 4 }, window.location.origin);
  }
  // The chapter scrolls outside this auto-height iframe. Project its viewport into
  // the iframe so sticky controls follow the reader in both embedded and full-tab views.
  let host = window, frame = null, positionPending = false;
  try {
    if (window.frameElement && window.parent.location.origin === window.location.origin) {
      host = window.parent; frame = window.frameElement;
    }
  } catch (_) { /* Cross-origin embeds retain ordinary in-frame sticky behavior. */ }
  function positionControls() {
    const root = document.documentElement, viewport = host.innerHeight;
    const header = host.document.getElementById("quarto-header")?.getBoundingClientRect();
    const inset = header && header.top <= 0 && header.bottom > 0 ? header.bottom + 8 : 12;
    const top = frame ? Math.max(12, inset - frame.getBoundingClientRect().top) : inset;
    root.style.setProperty("--controls-top", `${top}px`);
    root.style.setProperty("--host-height", `${viewport}px`);
  }
  function schedulePosition() {
    if (positionPending) return;
    positionPending = true;
    requestAnimationFrame(() => { positionPending = false; positionControls(); });
  }
  host.addEventListener("scroll", schedulePosition, { passive: true });
  host.addEventListener("resize", schedulePosition);
  function render() { pending = false; ({ windows: renderWindow, fit: renderFit, difference: renderDifference })[mode](); height(); }
  function schedule() { if (!pending) { pending = true; requestAnimationFrame(render); } }
  function setMode(next) {
    mode = next;
    for (const name of modes) { $(name + "-stage").hidden = name !== mode; $(name + "-mode").setAttribute("aria-pressed", name === mode); }
    schedule();
  }
  function download(filename, rows) {
    const url = URL.createObjectURL(new Blob([rows.join("\n") + "\n"], { type: "text/csv" }));
    const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  for (const id of ["length", "start", "rolling", "fit-days", "fit-start", "horizon", "show-mean", "show-actual", "difference-order", "difference-days", "difference-start", "difference-horizon", "difference-mean", "difference-actual"]) $(id).addEventListener("input", schedule);
  $("dataset").addEventListener("change", () => { resetWindow(); schedule(); });
  for (const name of modes) $(name + "-mode").addEventListener("click", () => setMode(name));
  window.addEventListener("hashchange", () => setMode(hashMode()));
  document.querySelectorAll("[data-preset]").forEach(button => button.addEventListener("click", () => {
    const presets = { years: ["daily", 0, 1096, 31], halfyear: ["daily", 366, 181, 31], week: ["hourly", 0, 168, 25], day: ["hourly", 0, 24, 5] };
    const [key, start, length, rolling] = presets[button.dataset.preset];
    $("dataset").value = key; resetWindow(); $("length").value = length; $("start").max = dataset().values.length - length;
    $("start").value = start; $("rolling").max = Math.min(365, length % 2 ? length : length - 1); $("rolling").value = rolling; schedule();
  }));
  document.querySelectorAll("[data-fit-days]").forEach(button => button.addEventListener("click", () => {
    $("fit-days").value = button.dataset.fitDays; schedule();
  }));
  $("new-noise").addEventListener("click", () => { seed++; schedule(); });
  document.querySelectorAll("[data-difference-year]").forEach(button => button.addEventListener("click", () => {
    const [start, n] = { 2020: [0, 182], 2021: [366, 181], 2022: [731, 181] }[button.dataset.differenceYear];
    $("difference-days").value = n; $("difference-start").max = D.daily.values.length - n;
    $("difference-start").value = start; schedule();
  }));
  $("difference-noise").addEventListener("click", () => { differenceSeed++; schedule(); });
  $("export-window").addEventListener("click", () => {
    renderWindow();
    const { data, xs, start } = currentWindow;
    const timestamp = i => data.start ? new Date(Date.parse(data.start + "Z") + (start + i) * data.minutes * 60000).toISOString().slice(0, 19) : String(start + i);
    download("stationarity-window.csv", ["time,value", ...xs.map((v, i) => `${timestamp(i)},${v}`)]);
  });
  $("export-fit").addEventListener("click", () => {
    renderFit();
    if (!fitData) return;
    const { start, train, shocks, simulation, average, actual } = fitData;
    const time = i => new Date(Date.parse(D.hourly.start + "Z") + (start + i) * 3600000).toISOString().slice(0, 19);
    download("temperature-ar.csv", ["time,temperature,role,innovation,simulation,average",
      ...train.map((v, i) => `${time(i)},${v},train,,,`),
      ...shocks.map((v, i) => `${time(train.length + i)},${$("show-actual").checked ? actual[i] ?? "" : ""},future,${v},${simulation[i]},${average[i]}`)]);
  });
  $("export-difference").addEventListener("click", () => {
    renderDifference();
    if (!differenceData) return;
    const { start, train, d, shocks, simulation, average, actual } = differenceData;
    const time = i => timeLabel(D.daily, start + i);
    download("temperature-differences.csv", ["time,temperature,role,innovation,simulation,average,differences",
      ...train.map((v, i) => `${time(i)},${v},train,,,,${d}`),
      ...shocks.map((v, i) => `${time(train.length + i)},${$("difference-actual").checked ? actual[i] ?? "" : ""},future,${v},${simulation[i]},${average[i]},${d}`)]);
  });
  new ResizeObserver(height).observe(document.querySelector("main"));
  window.addEventListener("resize", schedule);
  resetWindow(); setMode(mode);
})();
