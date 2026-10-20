/* Small ordinary least-squares solver. Scale time, then use Householder QR. */
(function (root) {
  "use strict";
  function evaluate(model, t) {
    const z = (t - model.center) / model.scale;
    let value = 0;
    for (let j = model.coefficients.length - 1; j >= 0; j--) value = value * z + model.coefficients[j];
    return value;
  }
  function measure(t, y, model) {
    const predictions = t.map(x => evaluate(model, x));
    const residuals = y.map((value, i) => value - predictions[i]);
    return { predictions, residuals, sse: residuals.reduce((sum, e) => sum + e * e, 0) };
  }
  function fit(t, y, degree) {
    if (t.length !== y.length || t.length === 0 ||
        !t.every(Number.isFinite) || !y.every(Number.isFinite)) {
      throw new Error("Provide matching arrays of finite observations.");
    }
    if (!Number.isInteger(degree) || degree < 0 || degree >= t.length) {
      throw new Error("Degree must be a nonnegative integer smaller than the number of observations.");
    }
    const center = (Math.min(...t) + Math.max(...t)) / 2;
    const scale = (Math.max(...t) - Math.min(...t)) / 2 || 1;
    const n = degree + 1, m = t.length;
    const a = t.map(x => {
      const row = [1], z = (x - center) / scale;
      for (let j = 1; j < n; j++) row.push(row[j - 1] * z);
      return row;
    });
    const b = y.slice();
    for (let k = 0; k < n; k++) {
      const v = Array.from({ length: m - k }, (_, i) => a[k + i][k]);
      const norm = Math.hypot(...v);
      if (norm < 1e-12) throw new Error("These time coordinates cannot determine this polynomial.");
      v[0] += v[0] >= 0 ? norm : -norm;
      const vnorm = Math.hypot(...v);
      for (let i = 0; i < v.length; i++) v[i] /= vnorm;
      for (let j = k; j < n; j++) {
        let dot = 0;
        for (let i = 0; i < v.length; i++) dot += v[i] * a[k + i][j];
        for (let i = 0; i < v.length; i++) a[k + i][j] -= 2 * v[i] * dot;
      }
      let dot = 0;
      for (let i = 0; i < v.length; i++) dot += v[i] * b[k + i];
      for (let i = 0; i < v.length; i++) b[k + i] -= 2 * v[i] * dot;
    }
    const coefficients = Array(n).fill(0);
    for (let i = n - 1; i >= 0; i--) {
      let value = b[i];
      for (let j = i + 1; j < n; j++) value -= a[i][j] * coefficients[j];
      coefficients[i] = value / a[i][i];
    }
    const model = { coefficients, center, scale, degree };
    return { ...model, ...measure(t, y, model) };
  }
  function powerCoefficients(model) {
    const result = Array(model.coefficients.length).fill(0);
    for (let k = 0; k < model.coefficients.length; k++) {
      let choose = 1;
      for (let j = 0; j <= k; j++) {
        result[j] += model.coefficients[k] * choose * (-model.center) ** (k - j) / model.scale ** k;
        choose = choose * (k - j) / (j + 1);
      }
    }
    return result;
  }
  root.Fitting = { fit, evaluate, measure, powerCoefficients };
})(globalThis);
