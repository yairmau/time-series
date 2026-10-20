/* Ordinary least squares in a scaled Chebyshev basis, using Householder QR.
   This spans the same degree-p polynomials while remaining usable at degree 29. */
(function (root) {
  "use strict";
  function evaluate(model, t) {
    const z = (t - model.center) / model.scale;
    if (model.basis === "chebyshev") {
      // Clenshaw recurrence avoids expanding large high-degree coefficients.
      let next = 0, afterNext = 0;
      for (let j = model.coefficients.length - 1; j >= 1; j--) {
        const current = model.coefficients[j] + 2 * z * next - afterNext;
        afterNext = next; next = current;
      }
      return model.coefficients[0] + z * next - afterNext;
    }
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
      if (n > 1) row.push(z);
      for (let j = 2; j < n; j++) row.push(2 * z * row[j - 1] - row[j - 2]);
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
    const model = { coefficients, center, scale, degree, basis: "chebyshev" };
    return { ...model, ...measure(t, y, model) };
  }
  function powerCoefficients(model) {
    let coefficients = model.coefficients;
    if (model.basis === "chebyshev") {
      coefficients = Array(model.coefficients.length).fill(0);
      let previous = [], current = [1];
      for (let k = 0; k < model.coefficients.length; k++) {
        current.forEach((value, j) => { coefficients[j] += model.coefficients[k] * value; });
        const next = Array(current.length + 1).fill(0);
        current.forEach((value, j) => { next[j + 1] += (k === 0 ? 1 : 2) * value; });
        previous.forEach((value, j) => { next[j] -= value; });
        previous = current; current = next;
      }
    }
    const result = Array(coefficients.length).fill(0);
    for (let k = 0; k < coefficients.length; k++) {
      let choose = 1;
      for (let j = 0; j <= k; j++) {
        result[j] += coefficients[k] * choose * (-model.center) ** (k - j) / model.scale ** k;
        choose = choose * (k - j) / (j + 1);
      }
    }
    return result;
  }
  root.Fitting = { fit, evaluate, measure, powerCoefficients };
})(globalThis);
