/* Pure computation. ADF: constant, no trend; AIC over 0..min(12, floor(n/2)-2).
   MacKinnon (1994) response-surface coefficients for regression='c', N=1,
   as tabulated in statsmodels.tsa.adfvalues (BSD-3-Clause; see NOTICE.txt).
   Numerical equivalence is checked against statsmodels in tests/. */
(function (root) {
  "use strict";
  const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
  const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
  function random(seed) {
    return () => {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function simulate(phi, n, seed = 49, burn = 300) {
    const rng = random(seed), p = phi.length, y = Array(n + burn + p).fill(0);
    for (let t = p; t < y.length; t++) {
      const noise = Math.sqrt(-2 * Math.log(Math.max(rng(), 1e-12))) * Math.cos(2 * Math.PI * rng());
      y[t] = phi.reduce((s, v, j) => s + v * y[t - j - 1], noise);
    }
    return y.slice(burn + p);
  }
  function examples() {
    const noise = simulate([], 1000);
    let sum = 0;
    return {
      noise, ar: simulate([0.8], 1000), walk: noise.map(v => sum += v),
      trend: noise.map((v, i) => v + i * 0.01),
      variance: noise.map((v, i) => v * (0.3 + 3 * i / 999))
    };
  }
  function rolling(values, size) {
    const means = Array(values.length).fill(null), variances = [...means];
    const half = Math.floor(size / 2);
    for (let start = 0; start + size <= values.length; start++) {
      const xs = values.slice(start, start + size);
      if (!xs.every(Number.isFinite)) continue;
      const m = mean(xs), i = start + half;
      means[i] = m;
      variances[i] = xs.reduce((s, v) => s + (v - m) ** 2, 0) / (size - 1);
    }
    return { means, variances };
  }
  // Reorthogonalized QR avoids forming the ill-conditioned X'X matrix.
  function leastSquares(rows, y) {
    const n = rows.length, k = rows[0]?.length;
    if (!k || n <= k || !y.every(Number.isFinite) || rows.some(r => !r.every(Number.isFinite))) return null;
    const q = [], r = Array.from({ length: k }, () => Array(k).fill(0));
    for (let j = 0; j < k; j++) {
      const v = rows.map(row => row[j]), originalNorm = Math.sqrt(dot(v, v));
      for (let pass = 0; pass < 2; pass++) for (let i = 0; i < j; i++) {
        const s = dot(q[i], v); r[i][j] += s;
        for (let t = 0; t < n; t++) v[t] -= s * q[i][t];
      }
      r[j][j] = Math.sqrt(dot(v, v));
      if (r[j][j] <= 1e-11 * Math.max(1, originalNorm)) return null;
      q[j] = v.map(x => x / r[j][j]);
    }
    const solve = b => {
      const x = Array(k).fill(0);
      for (let i = k - 1; i >= 0; i--) {
        x[i] = b[i];
        for (let j = i + 1; j < k; j++) x[i] -= r[i][j] * x[j];
        x[i] /= r[i][i];
      }
      return x;
    };
    const coefficients = solve(q.map(col => dot(col, y)));
    const fitted = rows.map(row => dot(row, coefficients));
    const residuals = y.map((v, i) => v - fitted[i]), ssr = dot(residuals, residuals);
    const inverseColumns = Array.from({ length: k }, (_, i) => solve(Array.from({ length: k }, (_, j) => +(i === j))));
    const se = coefficients.map((_, i) => Math.sqrt(ssr / (n - k) * inverseColumns.reduce((s, col) => s + col[i] ** 2, 0)));
    return { coefficients, fitted, residuals, ssr, se, n, k };
  }
  function normalCDF(x) {
    const z = Math.abs(x), t = 1 / (1 + 0.2316419 * z);
    const tail = Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI) * t *
      (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
    return x >= 0 ? 1 - tail : tail;
  }
  function adfPValue(t) {
    if (t > 2.74) return 1;
    if (t < -18.83) return 0;
    const c = t <= -1.61 ? [2.1659, 1.4412, 0.038269] : [1.7339, 0.93202, -0.12745, -0.010368];
    return normalCDF(c.reduceRight((s, v) => s * t + v, 0));
  }
  function adf(values) {
    const n = values.length;
    if (n < 20) return { error: "Use at least 20 observations; short windows still give weak evidence." };
    if (!values.every(Number.isFinite)) return { error: "This window contains gaps. Choose a complete, equally spaced window." };
    if (Math.max(...values) - Math.min(...values) < 1e-12) return { error: "ADF is undefined for a constant series." };
    const delta = values.slice(1).map((v, i) => v - values[i]);
    const maxlag = Math.min(12, Math.floor(n / 2) - 2);
    function regression(lag, start) {
      const rows = [], y = [];
      for (let t = start; t < delta.length; t++) {
        rows.push([1, values[t], ...Array.from({ length: lag }, (_, j) => delta[t - j - 1])]);
        y.push(delta[t]);
      }
      return leastSquares(rows, y);
    }
    let selected = 0, best = Infinity;
    for (let lag = 0; lag <= maxlag; lag++) {
      const fit = regression(lag, maxlag);
      if (!fit || fit.ssr <= 1e-20) continue;
      const aic = fit.n * Math.log(fit.ssr / fit.n) + 2 * fit.k;
      if (aic < best) { selected = lag; best = aic; }
    }
    const fit = regression(selected, selected);
    if (!Number.isFinite(best) || !fit || fit.se[1] <= 1e-12) return { error: "ADF cannot be estimated reliably for this window." };
    const statistic = fit.coefficients[1] / fit.se[1];
    return { statistic, pvalue: adfPValue(statistic), lag: selected, nobs: fit.n, maxlag };
  }
  function fitAR(values, p, holdBack = p) {
    if (!Number.isInteger(p) || p < 1 || !Number.isInteger(holdBack) || holdBack < p || values.length - holdBack <= p + 1) return null;
    return leastSquares(values.slice(holdBack).map((_, i) => [1, ...Array.from({ length: p }, (_, j) => values[i + holdBack - j - 1])]), values.slice(holdBack));
  }
  function forecast(values, coefficients, steps) {
    const series = [...values];
    for (let t = 0; t < steps; t++) series.push(coefficients.slice(1).reduce((s, phi, j) => s + phi * series[series.length - j - 1], coefficients[0]));
    return series.slice(values.length);
  }
  function stableAR2(phi) {
    return Math.abs(phi[1]) < 1 && phi[0] + phi[1] < 1 - 1e-10 && phi[1] - phi[0] < 1 - 1e-10;
  }
  // Step down through the AR reflection coefficients; equivalent to all
  // characteristic roots lying outside the unit circle, without a root solver.
  function stableAR(phi) {
    let a = [...phi];
    while (a.length) {
      const k = a[a.length - 1];
      if (!Number.isFinite(k) || Math.abs(k) >= 1 - 1e-10) return false;
      a = a.slice(0, -1).map((v, i) => (v + k * a[a.length - 2 - i]) / (1 - k * k));
    }
    return true;
  }
  function selectAR(values) {
    if (values.length < 48 || !values.every(Number.isFinite)) return { error: "Choose at least 48 complete observations." };
    const maxOrder = Math.min(24, Math.floor(values.length / 5)), candidates = [];
    for (let p = 1; p <= maxOrder; p++) {
      // Every candidate sees the same target observations; otherwise BIC is not comparable.
      const fit = fitAR(values, p, maxOrder);
      if (!fit || fit.ssr <= 1e-18) continue;
      const bic = fit.n * (Math.log(2 * Math.PI) + 1 + Math.log(fit.ssr / fit.n)) + (p + 2) * Math.log(fit.n);
      candidates.push({ p, bic, fit });
    }
    if (!candidates.length) return { error: "The selected window cannot support an AR fit." };
    const best = candidates.reduce((a, b) => a.bic < b.bic ? a : b);
    return { ...best, maxOrder, candidates: candidates.map(({ p, bic }) => ({ p, bic })),
      sigma: Math.sqrt(best.fit.ssr / best.fit.n), stable: stableAR(best.fit.coefficients.slice(1)) };
  }
  function innovations(steps, sigma, seed) {
    const rng = random(seed);
    return Array.from({ length: steps }, () => sigma * Math.sqrt(-2 * Math.log(Math.max(rng(), 1e-12))) * Math.cos(2 * Math.PI * rng()));
  }
  function rollout(values, coefficients, shocks) {
    const series = [...values];
    for (const shock of shocks) {
      const next = coefficients.slice(1).reduce((s, phi, j) => s + phi * series[series.length - j - 1], coefficients[0]) + shock;
      series.push(next);
    }
    return series.slice(values.length);
  }
  function difference(values, order = 1) {
    if (!Number.isInteger(order) || order < 0 || order > 2) throw new RangeError("Use 0, 1, or 2 differences.");
    let result = [...values];
    for (let d = 0; d < order; d++) result = result.slice(1).map((v, i) => v - result[i]);
    return result;
  }
  // Reconstruct only from the end of the training window and generated changes.
  // For d=2, first update the last change, then update the last temperature.
  function restore(values, continuation, order) {
    if (!Number.isInteger(order) || order < 0 || order > 2) throw new RangeError("Use 0, 1, or 2 differences.");
    if (order === 0) return [...continuation];
    if (values.length < order) throw new RangeError("Not enough history to undo differencing.");
    const state = Array.from({ length: order }, (_, d) => difference(values, d).at(-1));
    return continuation.map(value => {
      let next = value;
      for (let d = order - 1; d >= 0; d--) { state[d] += next; next = state[d]; }
      return next;
    });
  }
  function rmse(predicted, observed) {
    if (!observed.length || predicted.length < observed.length) return NaN;
    return Math.sqrt(mean(observed.map((v, i) => (v - predicted[i]) ** 2)));
  }
  function evaluateAR(values, p) {
    const split = Math.floor(0.8 * values.length), fit = fitAR(values.slice(0, split), p);
    if (!fit) return null;
    const test = values.slice(split);
    const oneStep = test.map((_, i) => fit.coefficients.slice(1).reduce((s, c, j) => s + c * values[split + i - j - 1], fit.coefficients[0]));
    const recursive = forecast(values.slice(0, split), fit.coefficients, test.length);
    const rmse = ys => Math.sqrt(ys.reduce((sum, v, i) => sum + (v - test[i]) ** 2, 0) / ys.length);
    return { split, fit, oneStep, recursive, oneStepRMSE: rmse(oneStep), recursiveRMSE: rmse(recursive),
      baselineRMSE: rmse(values.slice(split - 1, values.length - 1)) };
  }
  root.StationarityLab = { mean, simulate, examples, rolling, leastSquares, adf, fitAR, forecast, stableAR2, evaluateAR,
    stableAR, selectAR, innovations, rollout, difference, restore, rmse };
})(globalThis);
