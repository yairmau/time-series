// Node or Deno. Emits comparison cases for check_numerics.py after local assertions.
import "../practice-lab/engine.js";
import "../practice-lab/data.js";
const E = globalThis.StationarityLab, D = globalThis.StationarityData;
function assert(value, message) { if (!value) throw new Error(message); }
function close(a, b, tolerance = 1e-10) { assert(Math.abs(a - b) < tolerance, `${a} != ${b}`); }
const r = E.rolling([1, 2, 3, 4, 5], 3);
assert(JSON.stringify(r.means) === "[null,2,3,4,null]", "Rolling alignment");
close(r.variances[2], 1);
assert(E.rolling([1, null, 3, 4, 5], 3).means[1] === null, "Missing value was compressed");
assert(E.adf(Array(100).fill(1)).error, "Constant series accepted");
assert(E.adf([1, 2, 3]).error, "Too-short series accepted");
assert(E.adf([...Array(30).fill(1), null]).error, "Missing values accepted");
assert(E.fitAR([1, 2, 3], 2) === null, "Underdetermined AR accepted");
assert(E.leastSquares([[1, 1], [1, 1], [1, 1]], [1, 2, 3]) === null, "Singular matrix accepted");
assert(E.stableAR2([0.7, -0.2]) && !E.stableAR2([1, 0]) && !E.stableAR2([-1, 0]), "AR(2) stability boundaries");
assert(JSON.stringify(E.simulate([0.7, -0.2], 100)) === JSON.stringify(E.simulate([0.7, -0.2], 100)), "Seed is not reproducible");
const examples = E.examples();
assert(E.adf(examples.ar).pvalue < 0.05, "Stable AR example does not reject a unit root");
assert(E.adf(examples.variance).pvalue < 0.05, "Changing variance counterexample should reject a unit root");
const adf = Object.entries({ ...examples, negative: E.simulate([-0.8], 250), persistent: E.simulate([0.98], 500),
  daily: D.daily.values, halfyear: D.daily.values.slice(366, 547), hourly: D.hourly.values,
  day: D.hourly.values.slice(0, 24), week: D.hourly.values.slice(0, 168),
  short20: examples.ar.slice(0, 20), short45: examples.ar.slice(110, 155)
}).map(([name, values]) => ({ name, values, actual: E.adf(values) }));
const fits = [1, 2, 5].map(p => {
  const values = E.simulate([0.7, -0.2], 800), fit = E.fitAR(values, p);
  const evaluation = E.evaluateAR(values, p);
  const changedFuture = values.map((v, i) => i < evaluation.split ? v : v + 100);
  assert(JSON.stringify(evaluation.fit.coefficients) === JSON.stringify(E.evaluateAR(changedFuture, p).fit.coefficients), "Held-out data leaked into coefficient estimation");
  return { p, values, actual: fit, forecast: E.forecast(values, fit.coefficients, 20), evaluation };
});
const selections = [[0, 336], [0, 168], [72, 72], [240, 504]].map(([start, length]) => {
  const values = D.hourly.values.slice(start, start + length), selection = E.selectAR(values);
  assert(!selection.error, "Temperature selection failed");
  const shocks = E.innovations(72, selection.sigma, 49);
  const rollout = E.rollout(values, selection.fit.coefficients, shocks);
  const average = E.forecast(values, selection.fit.coefficients, 72);
  const zeros = E.rollout(values, selection.fit.coefficients, Array(72).fill(0));
  zeros.forEach((v, i) => close(v, average[i], 1e-8));
  assert(JSON.stringify(shocks) === JSON.stringify(E.innovations(72, selection.sigma, 49)), "Future noise seed changed");
  return { start, values, selection, shocks, rollout, average };
});
assert(selections[0].selection.p === 24 && selections[1].selection.p === 2, "Expected teaching windows changed");
assert(E.selectAR(Array(72).fill(1)).error, "Constant training data accepted");
assert(E.selectAR(Array(20).fill(1)).error, "Short training window accepted");
assert(E.selectAR([...Array(80).fill(1), null]).error, "Missing training values accepted");
assert(E.stableAR([0.7, -0.2]) && !E.stableAR([1]) && !E.stableAR([1.1]), "General AR stability check");
const simple = E.rollout([10], [1, 0.5], [2, 3]);
close(simple[0], 8); close(simple[1], 8); // Second step uses the generated 8.
// Round-trip a known future at every order, including the training/future boundary.
const known = [2, 5, 9, 16, 26, 39];
for (const d of [0, 1, 2]) {
  const rebuilt = E.restore(known.slice(0, 3), E.difference(known, d).slice(3 - d), d);
  rebuilt.forEach((v, i) => close(v, known[i + 3]));
}
const differences = [0, 1, 2].flatMap(d => [[0, 336], [0, 168], [672, 72]].map(([start, n]) => {
  const values = D.hourly.values.slice(start, start + n), transformed = E.difference(values, d);
  const selection = E.selectAR(transformed);
  assert(!selection.error, "Differenced temperature selection failed");
  const shocks = E.innovations(30, selection.sigma, 49);
  const rollout = E.restore(values, E.rollout(transformed, selection.fit.coefficients, shocks), d);
  const average = E.restore(values, E.forecast(transformed, selection.fit.coefficients, 30), d);
  return { d, values, transformed, selection, shocks, rollout, average };
}));
console.log(JSON.stringify({ adf, fits, selections, differences }));
