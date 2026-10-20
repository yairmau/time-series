// Run with `node tests/smoothing.test.mjs` or `deno run tests/smoothing.test.mjs`.
import "../smoothing/lab/engine.js";

const { weights, at, smooth } = globalThis.Smoothing;
function equal(actual, expected, label) {
  if (actual.length !== expected.length) throw new Error(`${label}: length`);
  actual.forEach((x, i) => {
    if ((x === null) !== (expected[i] === null) ||
        (x !== null && Math.abs(x - expected[i]) > 1e-10)) {
      throw new Error(`${label}[${i}]: got ${x}, expected ${expected[i]}`);
    }
  });
}
const values = [-2, -1, 2, 5, 6, -3, 4];
equal(smooth(values, { size: 3 }).result,
  [null, -1 / 3, 2, 13 / 3, 8 / 3, 7 / 3, null], "centered mean by hand");
equal(smooth(values, { size: 3, centered: false }).result,
  [null, null, -1 / 3, 2, 13 / 3, 8 / 3, 7 / 3], "trailing labels");
equal(weights(3, "triang"), [0.25, 0.5, 0.25], "triangular weights");
equal(smooth(values, { size: 3, kernel: "triang" }).result,
  [null, -0.5, 2, 4.5, 3.5, 1, null], "weighted mean by hand");
equal(smooth(values, { size: 3, statistic: "median" }).result,
  [null, -1, 2, 5, 5, 4, null], "median");
equal(smooth([-2, -1, 2, 5, 6], { size: 5, statistic: "fraction" }).result,
  [null, null, 40, null, null], "freezing exposure differs from mean");
equal(smooth([0, -1, 2], { size: 3, statistic: "fraction" }).result,
  [null, 100 / 3, null], "threshold is strict");
equal(smooth([2, null, 4], { size: 3 }).result,
  [null, null, null], "missing values withhold full windows");
equal(smooth([2, null, 4], { size: 3, partial: true }).result,
  [2, 3, 4], "available values renormalized");
equal(smooth([2, null, -4], { size: 3, partial: true, statistic: "fraction" }).result,
  [0, 50, 100], "missing values excluded from denominator");
equal(smooth(values, { size: 1 }).result, values, "one-observation identity");
for (const kernel of ["boxcar", "triang", "gaussian"]) {
  const n = 7;
  const impulse = Array(41).fill(0);
  impulse[20] = 1;
  equal(smooth(impulse, { size: n, kernel, sigma: 1.5 }).result.slice(17, 24),
    weights(n, kernel, 1.5), `impulse response: ${kernel}`);
  equal(smooth(Array(15).fill(8), { size: n, kernel, partial: true }).result,
    Array(15).fill(8), `constant preserved at partial edges: ${kernel}`);
}
const step = Array.from({ length: 41 }, (_, i) => i >= 20 ? 1 : 0);
if (smooth(step, { size: 7 }).result[17] <= 0 ||
    smooth(step, { size: 7, centered: false }).result[19] !== 0) {
  throw new Error("Centered look-ahead and trailing causality");
}
const trailing = at(values, 4, { size: 3, centered: false });
if (trailing.entries.some(e => e.index > 4)) throw new Error("Trailing window uses future");
for (const badSize of [0, -1, 2, 2.5]) {
  let threw = false;
  try { weights(badSize); } catch { threw = true; }
  if (!threw) throw new Error(`Invalid size ${badSize} accepted`);
}
console.log("Smoothing tests passed: hand calculations, timing, kernels, missing data, and edges.");
