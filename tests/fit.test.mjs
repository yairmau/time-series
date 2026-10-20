// Run with `node tests/fit.test.mjs` or `deno run tests/fit.test.mjs`.
import "../smoothing/fit-lab/engine.js";

const { fit, evaluate, measure, powerCoefficients } = globalThis.Fitting;
function near(actual, expected, label, tolerance = 1e-9) {
  if (!Number.isFinite(actual) || Math.abs(actual - expected) > tolerance * Math.max(1, Math.abs(expected))) {
    throw new Error(`${label}: got ${actual}, expected ${expected}`);
  }
}
function rejects(run, label) {
  let threw = false;
  try { run(); } catch { threw = true; }
  if (!threw) throw new Error(`${label}: expected an error`);
}

const t = [0, 1, 2, 3, 4];
const y = [1, 2, 1, 4, 2];
const constant = fit(t, y, 0);
constant.predictions.forEach(v => near(v, 2, "best constant is the mean"));
near(constant.sse, 6, "constant SSE by hand");
const straight = fit(t, y, 1);
const [intercept, slope] = powerCoefficients(straight);
near(intercept, 1.2, "line intercept by hand");
near(slope, 0.4, "line slope by hand");
near(straight.sse, 4.4, "line SSE by hand");
near(straight.residuals.reduce((sum, e) => sum + e, 0), 0, "intercept optimality");
near(straight.residuals.reduce((sum, e, i) => sum + e * t[i], 0), 0, "slope optimality");
for (const da of [-0.5, 0, 0.5]) {
  for (const db of [-0.2, 0, 0.2]) {
    const candidate = { center: 0, scale: 1, coefficients: [intercept + da, slope + db] };
    if (measure(t, y, candidate).sse < straight.sse - 1e-10) throw new Error("Line is not a minimum");
  }
}

const exact = t.map(x => 3 - 2 * x + 0.7 * x * x);
const quadratic = fit(t, exact, 2);
powerCoefficients(quadratic).forEach((v, i) => near(v, [3, -2, 0.7][i], "exact quadratic"));
near(quadratic.sse, 0, "noiseless quadratic SSE");
near(evaluate(quadratic, 5.5), 3 - 2 * 5.5 + 0.7 * 5.5 ** 2, "evaluation beyond data");
near(fit(t, y, t.length - 1).sse, 0, "interpolating polynomial");

for (const n of [5, 7, 12, 30]) {
  const times = Array.from({ length: n }, (_, i) => 10 * i / (n - 1));
  const values = times.map((x, i) => 1 + 0.09 * (x - 5) ** 2 + 0.4 * Math.sin(9 * i));
  let previous = Infinity;
  for (let degree = 0; degree <= Math.min(6, n - 1); degree++) {
    const result = fit(times, values, degree);
    if (result.sse > previous + 1e-9) throw new Error("Higher degree raised the minimum SSE");
    previous = result.sse;
    const powers = powerCoefficients(result);
    for (let x = -2; x <= 12; x += 0.25) {
      near(powers.reduce((sum, a, j) => sum + a * x ** j, 0), evaluate(result, x), "display coefficient conversion", 1e-7);
    }
    // Shifting the time origin must not change fitted values.
    const shifted = fit(times.map(x => x + 1e8), values, degree);
    result.predictions.forEach((v, i) => near(shifted.predictions[i], v, "large time offset", 1e-7));
  }
}

near(fit([7, 7, 7], [1, 3, 5], 0).predictions[0], 3, "constant at repeated times");
rejects(() => fit([1, 1, 1], [1, 2, 3], 1), "rank deficient times");
rejects(() => fit([], [], 0), "empty observations");
rejects(() => fit([0, 1], [2], 0), "mismatched arrays");
rejects(() => fit([0, 1], [2, NaN], 0), "nonfinite observations");
for (const degree of [-1, 1.5, t.length]) rejects(() => fit(t, y, degree), `invalid degree ${degree}`);
console.log("Fit tests passed: known solutions, minimization, degree, interpolation, scaling, and invalid input.");
