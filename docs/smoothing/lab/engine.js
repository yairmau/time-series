/* Equal-interval, odd-length rolling windows. No padding or invented observations. */
(function (root) {
  "use strict";
  function weights(size, kernel = "boxcar", sigma = size / 6) {
    if (!Number.isInteger(size) || size < 1 || size % 2 !== 1) {
      throw new Error("Use a positive odd number of observations.");
    }
    if (!["boxcar", "triang", "gaussian"].includes(kernel)) throw new Error("Unknown kernel.");
    if (!(sigma > 0)) throw new Error("Gaussian width must be positive.");
    const half = (size - 1) / 2;
    const raw = Array.from({ length: size }, (_, j) => {
      if (kernel === "triang") return 1 - Math.abs(j - half) / (half + 1);
      if (kernel === "gaussian") return Math.exp(-0.5 * ((j - half) / sigma) ** 2);
      return 1;
    });
    const total = raw.reduce((a, b) => a + b, 0);
    return raw.map(w => w / total);
  }

  function at(values, index, options) {
    const { size, centered = true, statistic = "mean", threshold = 0 } = options;
    const kernel = statistic === "mean" ? (options.kernel || "boxcar") : "boxcar";
    const allWeights = options.weights || weights(size, kernel, options.sigma);
    const start = centered ? index - (size - 1) / 2 : index - size + 1;
    const entries = [];
    for (let j = 0; j < size; j++) {
      const k = start + j;
      if (k >= 0 && k < values.length && Number.isFinite(values[k])) {
        entries.push({ index: k, value: values[k], weight: allWeights[j] });
      }
    }
    const complete = entries.length === size;
    const valid = entries.length > 0 && (complete || options.partial === true);
    const totalWeight = entries.reduce((sum, x) => sum + x.weight, 0);
    for (const entry of entries) entry.weight /= totalWeight;
    let value = null, min = null, max = null;
    if (valid) {
      const xs = entries.map(x => x.value);
      min = Math.min(...xs);
      max = Math.max(...xs);
      if (statistic === "mean") value = entries.reduce((s, x) => s + x.weight * x.value, 0);
      else if (statistic === "median") {
        xs.sort((a, b) => a - b);
        const mid = Math.floor(xs.length / 2);
        value = xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
      } else if (statistic === "min") value = min;
      else if (statistic === "max") value = max;
      else if (statistic === "fraction") value = 100 * xs.filter(x => x < threshold).length / xs.length;
      else throw new Error("Unknown statistic.");
    }
    return { value, min, max, entries, complete, start, end: start + size - 1 };
  }

  function smooth(values, options) {
    const { size, centered = true, statistic = "mean", threshold = 0 } = options;
    if (!["mean", "median", "min", "max", "fraction"].includes(statistic)) throw new Error("Unknown statistic.");
    const kernel = statistic !== "mean" ? "boxcar" : (options.kernel || "boxcar");
    const ws = weights(size, kernel, options.sigma);
    // Maintain the sorted window as one observation leaves and one enters.
    // This avoids sorting thousands of overlapping windows when a slider moves.
    const sorted = [];
    const lowerBound = value => {
      let a = 0, b = sorted.length;
      while (a < b) {
        const m = (a + b) >> 1;
        if (sorted[m] < value) a = m + 1; else b = m;
      }
      return a;
    };
    let sum = 0;
    function insert(value) {
      if (!Number.isFinite(value)) return;
      sorted.splice(lowerBound(value), 0, value);
      sum += value;
    }
    function remove(value) {
      if (!Number.isFinite(value)) return;
      sorted.splice(lowerBound(value), 1);
      sum -= value;
    }
    const left = centered ? (size - 1) / 2 : size - 1;
    for (let j = -left; j < size - left; j++) insert(values[j]);
    const result = [], low = [], high = [];
    for (let i = 0; i < values.length; i++) {
      if (i > 0) {
        remove(values[i - left - 1]);
        insert(values[i - left + size - 1]);
      }
      const count = sorted.length;
      if (!count || (count < size && options.partial !== true)) {
        result.push(null); low.push(null); high.push(null);
        continue;
      }
      low.push(sorted[0]); high.push(sorted[count - 1]);
      if (statistic === "min") result.push(sorted[0]);
      else if (statistic === "max") result.push(sorted[count - 1]);
      else if (statistic === "median") {
        const m = Math.floor(count / 2);
        result.push(count % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2);
      } else if (statistic === "fraction") result.push(100 * lowerBound(threshold) / count);
      else if (kernel === "boxcar") result.push(sum / count);
      else {
        let numerator = 0, denominator = 0;
        for (let j = 0; j < size; j++) {
          const value = values[i - left + j];
          if (Number.isFinite(value)) {
            numerator += value * ws[j];
            denominator += ws[j];
          }
        }
        result.push(numerator / denominator);
      }
    }
    return { result, low, high };
  }
  root.Smoothing = { weights, at, smooth };
})(globalThis);
