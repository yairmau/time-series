/* Equally spaced observations; missing values are null. No browser dependencies. */
(function (root) {
  "use strict";
  const finite = Number.isFinite;
  function quantile(sorted, p) {
    if (!sorted.length) return null;
    const x = (sorted.length - 1) * p, i = Math.floor(x);
    return sorted[i] + (x - i) * (sorted[Math.min(i + 1, sorted.length - 1)] - sorted[i]);
  }
  function summarize(values, method, k) {
    const xs = values.filter(finite).sort((a, b) => a - b), n = xs.length;
    if (n < 3) return { count: n, center: null, scale: null, low: null, high: null };
    const median = quantile(xs, 0.5);
    let center, scale, low, high;
    if (method === "z") {
      center = xs.reduce((a, b) => a + b, 0) / n;
      scale = Math.sqrt(xs.reduce((s, v) => s + (v - center) ** 2, 0) / (n - 1));
      low = center - k * scale; high = center + k * scale;
    } else if (method === "iqr") {
      center = median;
      const q1 = quantile(xs, 0.25), q3 = quantile(xs, 0.75);
      scale = q3 - q1; low = q1 - k * scale; high = q3 + k * scale;
    } else if (method === "mad") {
      center = median;
      scale = 1.4826 * quantile(xs.map(v => Math.abs(v - median)).sort((a, b) => a - b), 0.5);
      low = median - k * scale; high = median + k * scale;
    } else throw new Error("Unknown detection method");
    return { count: n, center, scale, low, high };
  }
  function plateauMask(values, minimum) {
    const mask = values.map(() => false);
    for (let start = 0; start < values.length;) {
      let end = start + 1;
      if (finite(values[start])) {
        while (end < values.length && values[end] === values[start]) end++;
        if (end - start >= minimum) mask.fill(true, start, end);
      }
      start = end;
    }
    return mask;
  }
  function detect(values, options) {
    const { size = 31, k = 3, method = "mad", scope = "rolling", alignment = "center", full = false, plateau = false, run = 10 } = options;
    if (!Number.isInteger(size) || size < 3 || size % 2 !== 1) throw new Error("Window must be odd and at least 3");
    if (!finite(k) || k < 0) throw new Error("Threshold must be nonnegative");
    const globalStats = scope === "global" ? summarize(values, method, k) : null;
    const stats = values.map((_, i) => {
      const start = scope === "global" ? 0 : alignment === "center" ? i - (size - 1) / 2 : i - size + 1;
      const end = scope === "global" ? values.length - 1 : start + size - 1;
      let s = globalStats || summarize(values.slice(Math.max(0, start), Math.min(values.length, end + 1)), method, k);
      if (full && scope !== "global" && s.count < size) s = { ...s, center: null, scale: null, low: null, high: null };
      return { ...s, start, end };
    });
    const envelope = values.map((v, i) => finite(v) && finite(stats[i].low) && (v < stats[i].low || v > stats[i].high));
    const stuck = plateau ? plateauMask(values, run) : values.map(() => false);
    const flagged = envelope.map((v, i) => v || stuck[i]);
    return { stats, envelope, stuck, flagged, cleaned: values.map((v, i) => flagged[i] || !finite(v) ? null : v) };
  }
  function gaps(values) {
    const result = [];
    for (let i = 0; i < values.length; i++) {
      if (finite(values[i])) continue;
      const start = i;
      while (i + 1 < values.length && !finite(values[i + 1])) i++;
      result.push({ start, end: i, length: i - start + 1 });
    }
    return result;
  }
  // Natural cubic spline: solve the tridiagonal system for second derivatives.
  function spline(values) {
    const points = values.flatMap((v, i) => finite(v) ? [{ x: i, y: v }] : []), n = points.length;
    if (n < 2) return null;
    const second = Array(n).fill(0), upper = Array(n).fill(0), rhs = Array(n).fill(0);
    for (let i = 1; i < n - 1; i++) {
      const h0 = points[i].x - points[i - 1].x, h1 = points[i + 1].x - points[i].x;
      const diagonal = 2 * (h0 + h1) - h0 * upper[i - 1];
      upper[i] = h1 / diagonal;
      rhs[i] = (6 * ((points[i + 1].y - points[i].y) / h1 - (points[i].y - points[i - 1].y) / h0) - h0 * rhs[i - 1]) / diagonal;
    }
    for (let i = n - 2; i > 0; i--) second[i] = rhs[i] - upper[i] * second[i + 1];
    return x => {
      if (x < points[0].x || x > points[n - 1].x) return null;
      let a = 0, b = n - 1;
      while (b - a > 1) { const mid = (a + b) >> 1; if (points[mid].x <= x) a = mid; else b = mid; }
      const h = points[b].x - points[a].x, u = (points[b].x - x) / h, v = (x - points[a].x) / h;
      return u * points[a].y + v * points[b].y + ((u ** 3 - u) * second[a] + (v ** 3 - v) * second[b]) * h * h / 6;
    };
  }
  function fill(values, method, maxGap = Infinity) {
    if (!["none", "forward", "backward", "linear", "cubic"].includes(method)) throw new Error("Unknown fill method");
    const result = values.map(v => finite(v) ? v : null);
    const interpolate = method === "cubic" ? spline(values) : null;
    for (const gap of gaps(values)) {
      if (gap.length > maxGap || method === "none") continue;
      const a = gap.start - 1, b = gap.end + 1, left = values[a], right = values[b];
      for (let i = gap.start; i <= gap.end; i++) {
        if (method === "forward" && finite(left)) result[i] = left;
        if (method === "backward" && finite(right)) result[i] = right;
        if (method === "linear" && finite(left) && finite(right)) result[i] = left + (right - left) * (i - a) / (b - a);
        if (method === "cubic" && interpolate) result[i] = interpolate(i);
      }
    }
    return result;
  }
  function score(input, result, truth) {
    let missing = 0, filled = 0, evaluated = 0, squared = 0;
    input.forEach((v, i) => {
      if (finite(v)) return;
      missing++;
      if (!finite(result[i])) return;
      filled++;
      if (truth && finite(truth[i])) { evaluated++; squared += (result[i] - truth[i]) ** 2; }
    });
    return { missing, filled, evaluated, rmse: evaluated ? Math.sqrt(squared / evaluated) : null };
  }
  function synthetic(kind, amplitude = 8, length = 9) {
    const clean = Array.from({ length: 241 }, (_, i) => 12 + 2 * Math.sin(2 * Math.PI * i / 80) + 0.012 * i + 0.3 * Math.sin(1.7 * i) + 0.18 * Math.cos(2.9 * i));
    if (kind === "step") for (let i = 120; i < clean.length; i++) clean[i] += amplitude;
    const values = clean.slice(), faults = values.map(() => false);
    if (kind !== "step") {
      const start = 120 - Math.floor(length / 2), end = kind === "spike" ? 121 : start + length;
      for (let i = kind === "spike" ? 120 : start; i < end; i++) {
        values[i] = kind === "stuck" ? clean[start] + amplitude : clean[i] + amplitude;
        faults[i] = values[i] !== clean[i];
      }
    }
    return { values, truth: clean, faults, minutes: 1, unit: "signal units", synthetic: true };
  }
  root.OutlierLab = { quantile, summarize, plateauMask, detect, gaps, spline, fill, score, synthetic };
})(globalThis);
