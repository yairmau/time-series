import "../lab/engine.js";
const E = globalThis.OutlierLab;
function assert(condition, message = "Assertion failed") { if (!condition) throw new Error(message); }
function near(a, b, epsilon = 1e-10) { assert(Math.abs(a - b) <= epsilon, `${a} != ${b}`); }
function equal(a, b) { assert(JSON.stringify(a) === JSON.stringify(b), `${JSON.stringify(a)} != ${JSON.stringify(b)}`); }

Deno.test("fixed thresholds support either side, keep equality and ignore missing values", () => {
  const values = [-2, 0, 2, 4, null, NaN];
  equal(E.detect(values, { method: "fixed", lower: 0, upper: 2 }).flagged, [true, false, false, true, false, false]);
  equal(E.detect(values, { method: "fixed", lower: 0 }).flagged, [true, false, false, false, false, false]);
  equal(E.detect(values, { method: "fixed", upper: 2 }).flagged, [false, false, false, true, false, false]);
  equal(E.detect([2, 3], { method: "fixed", lower: 2, upper: 2 }).cleaned, [2, null]);
  const a = E.detect(values, { method: "fixed", lower: 0, upper: 2, size: 5 });
  const b = E.detect(values, { method: "fixed", lower: 0, upper: 2, size: 201, scope: "global", full: true, k: 6 });
  equal(a, b);
});
Deno.test("invalid fixed thresholds give no decisions or removals", () => {
  for (const limits of [{}, { lower: 4, upper: 2 }, { lower: NaN, upper: 2 }, { upper: Infinity }]) {
    const result = E.detect([1, 2, 9], { method: "fixed", plateau: true, ...limits });
    assert(result.error); assert(result.flagged.every(v => !v)); equal(result.cleaned, [1, 2, 9]);
  }
});
Deno.test("disabled detection removes neither outliers nor plateaus and has no limits", () => {
  const values = [1, 1, 1, 1, 9, null];
  for (const method of ["fixed", "z", "iqr", "mad"]) {
    const result = E.detect(values, { enabled: false, method, lower: 0, upper: 2, plateau: true, run: 3 });
    equal(result.cleaned, values); assert(result.flagged.every(v => !v)); assert(result.stuck.every(v => !v));
    assert(result.stats.every(s => s.low === null && s.high === null));
  }
});

Deno.test("sample SD and linearly interpolated quartile fences match hand calculations", () => {
  const z = E.summarize([1, 2, 3, 4, 5], "z", 2);
  near(z.center, 3); near(z.scale, Math.sqrt(2.5)); near(z.low, 3 - 2 * Math.sqrt(2.5));
  const iqr = E.summarize([0, 1, 2, 3], "iqr", 1.5);
  near(iqr.low, -1.5); near(iqr.high, 4.5);
  const mad = E.summarize([1, 2, 3, 4, 100], "mad", 3);
  near(mad.center, 3); near(mad.scale, 1.4826);
});
Deno.test("a spike can mask itself with SD; MAD is calculated around the same window median", () => {
  const values = [0, 0, 0, 10, 0, 0, 0];
  assert(!E.detect(values, { size: 7, k: 3, method: "z" }).flagged[3]);
  assert(E.detect(values, { size: 7, k: 3, method: "mad" }).flagged[3]);
  const x = [0, 2, 100, 5, 6, 7, 8];
  const d = E.detect(x, { size: 5, k: 3, method: "mad" });
  near(d.stats[3].center, 6); near(d.stats[3].scale, 1.4826); // [2,100,5,6,7]
});
Deno.test("window boundaries, missing samples, equality and zero spread are explicit", () => {
  const values = [2, 2, null, 2, 8, 2, 2];
  const full = E.detect(values, { size: 5, full: true });
  assert(full.stats[0].low === null && full.stats[3].low === null);
  const partial = E.detect(values, { size: 5 });
  assert(partial.stats[0].low === null); // only two available
  assert(!partial.flagged[2]); assert(partial.flagged[4]);
  const flat = E.detect([4, 4, 4, 4, 4], { size: 5 });
  assert(flat.flagged.every(v => !v)); near(flat.stats[2].scale, 0);
});
Deno.test("trailing envelope never uses future observations and does not mutate input", () => {
  const a = [1, 2, 3, 4, 5, 6, 7], before = a.slice();
  const b = a.slice(); b[5] = 1000;
  const options = { size: 5, alignment: "trailing", method: "z" };
  equal(E.detect(a, options).stats.slice(0, 5), E.detect(b, options).stats.slice(0, 5));
  equal(a, before);
});
Deno.test("repeated runs use exact equality, stop at missing values, and combine with envelope flags", () => {
  equal(E.plateauMask([1, 1, 1, null, 1, 1, 1.01, 2, 2, 2], 3), [true, true, true, false, false, false, false, true, true, true]);
  const d = E.detect([1, 1, 1, 1, 1], { size: 5, plateau: true, run: 4 });
  assert(d.flagged.every(Boolean)); assert(d.envelope.every(v => !v));
});
Deno.test("wider threshold never adds envelope flags with fixed windows", () => {
  const values = E.synthetic("cluster", 8, 15).values;
  for (const method of ["z", "iqr", "mad"]) {
    const narrow = E.detect(values, { size: 31, method, k: 1 });
    const wide = E.detect(values, { size: 31, method, k: 5 });
    assert(wide.flagged.every((flag, i) => !flag || narrow.flagged[i]));
  }
});
Deno.test("interpolation respects observations, boundaries and whole-run length limits", () => {
  const input = [null, 0, null, null, 3, null], before = input.slice();
  equal(E.fill(input, "linear"), [null, 0, 1, 2, 3, null]);
  equal(E.fill(input, "forward"), [null, 0, 0, 0, 3, 3]);
  equal(E.fill(input, "backward"), [0, 0, 3, 3, 3, null]);
  equal(E.fill(input, "linear", 1), input);
  equal(E.fill(input, "none"), input); equal(input, before);
  equal(E.fill([null, null], "cubic"), [null, null]);
  equal(E.fill([null, 4, null], "linear"), [null, 4, null]);
});
Deno.test("natural cubic spline matches an analytic solution and linear data", () => {
  const result = E.fill([0, null, 1, null, 0], "cubic");
  near(result[1], 0.6875); near(result[3], 0.6875);
  equal(E.fill([null, 0, null, null, 3, null], "cubic"), [null, 0, 1, 2, 3, null]);
  equal(E.fill([0, null, null, 3], "cubic", 1), [0, null, null, 3]);
});
Deno.test("error metrics use only missing points with estimates and held-out truth", () => {
  equal(E.score([100, null, null], [100, 4, null], [999, 2, 10]), { missing: 2, filled: 1, evaluated: 1, rmse: 2 });
  assert(E.score([1, null], [1, 2], null).rmse === null);
  assert(E.score([1, 2], [1, 2], [1, 2]).rmse === null);
});
Deno.test("synthetic truth distinguishes genuine shifts and zero-height spikes from faults", () => {
  assert(E.synthetic("step").faults.every(v => !v));
  assert(E.synthetic("spike", 0).faults.every(v => !v));
  assert(E.synthetic("cluster", 8, 15).faults.filter(Boolean).length === 15);
});
