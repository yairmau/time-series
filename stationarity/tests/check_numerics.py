"""Compare browser ADF/AR math with statsmodels, rather than self-derived fixtures.

python stationarity/tests/check_numerics.py [path/to/node-or-deno]
Requires numpy and statsmodels. No browser or network needed.
"""
import json
from pathlib import Path
import shutil
import subprocess
import sys

import numpy as np
from statsmodels.tsa.ar_model import AutoReg
from statsmodels.tsa.stattools import adfuller

runtime = sys.argv[1] if len(sys.argv) > 1 else (shutil.which("node") or shutil.which("deno"))
if not runtime:
    raise SystemExit("Pass a Node or Deno executable path.")
runner = Path(__file__).with_name("engine.test.js")
command = [runtime] + (["run"] if "deno" in Path(runtime).name else []) + [str(runner)]
cases = json.loads(subprocess.check_output(command, text=True))
for case in cases["adf"]:
    values = case["values"]
    expected = adfuller(values, regression="c", maxlag=min(12, len(values) // 2 - 2), autolag="AIC")
    if hasattr(expected, "statistic"):
        statistic, pvalue, lag, nobs = expected.statistic, expected.pvalue, expected.lags, expected.nobs
    else:
        statistic, pvalue, lag, nobs = expected[:4]
    actual = case["actual"]
    assert "error" not in actual, (case["name"], actual)
    np.testing.assert_allclose(actual["statistic"], statistic, atol=1e-8, err_msg=case["name"])
    np.testing.assert_allclose(actual["pvalue"], pvalue, atol=1e-7, err_msg=case["name"])
    assert (actual["lag"], actual["nobs"]) == (lag, nobs), case["name"]
    print(f"ADF {case['name']:12s}: p={pvalue:.6g}, lag={lag}; matches statsmodels")
for case in cases["fits"]:
    values = case["values"]
    fit = AutoReg(values, lags=case["p"], trend="c").fit()
    for key, expected in [("coefficients", fit.params), ("fitted", fit.fittedvalues), ("residuals", fit.resid)]:
        np.testing.assert_allclose(case["actual"][key], expected, atol=1e-9)
    np.testing.assert_allclose(case["forecast"], fit.predict(len(values), len(values) + 19), atol=1e-9)
    evaluation = case["evaluation"]
    split = int(0.8 * len(values))
    train_fit = AutoReg(values[:split], lags=case["p"], trend="c").fit()
    one_step = [train_fit.params[0] + sum(train_fit.params[j+1] * values[t-j-1] for j in range(case["p"]))
                for t in range(split, len(values))]
    np.testing.assert_allclose(evaluation["oneStep"], one_step, atol=1e-9)
    np.testing.assert_allclose(evaluation["recursive"], train_fit.predict(split, len(values)-1), atol=1e-9)
    np.testing.assert_allclose(evaluation["oneStepRMSE"], np.sqrt(np.mean((np.array(values[split:])-one_step)**2)), atol=1e-9)
for case in cases["selections"]:
    values = np.array(case["values"])
    max_order = min(24, len(values) // 5)
    models = [AutoReg(values, lags=p, hold_back=max_order, trend="c").fit()
              for p in range(1, max_order + 1)]
    fit = min(models, key=lambda model: model.bic)
    selection = case["selection"]
    assert selection["p"] == len(fit.params) - 1
    np.testing.assert_allclose([c["bic"] for c in selection["candidates"]], [f.bic for f in models], atol=1e-7)
    np.testing.assert_allclose(selection["fit"]["coefficients"], fit.params, atol=1e-7)
    np.testing.assert_allclose(selection["sigma"], np.sqrt(fit.sigma2), atol=1e-9)
    assert selection["stable"] == bool(np.all(np.abs(fit.roots) > 1))
    history = list(values)
    for shock in case["shocks"]:
        history.append(fit.params[0] + sum(v * history[-j-1] for j, v in enumerate(fit.params[1:])) + shock)
    np.testing.assert_allclose(case["rollout"], history[len(values):], atol=1e-6)
    np.testing.assert_allclose(case["average"], fit.predict(len(values), len(values)+71), atol=1e-6)
    print(f"Temperature window {case['start']} + {len(values)} hours: AR({selection['p']}); BIC, noise scale, stability and rollout match statsmodels")
for case in cases["differences"]:
    x, d = np.array(case["values"]), case["d"]
    y = np.diff(x, n=d)
    np.testing.assert_allclose(case["transformed"], y)
    max_order = min(24, len(y) // 5)
    models = [AutoReg(y, lags=p, hold_back=max_order, trend="c").fit()
              for p in range(1, max_order + 1)]
    fit = min(models, key=lambda model: model.bic)
    assert case["selection"]["p"] == len(fit.params) - 1
    np.testing.assert_allclose([c["bic"] for c in case["selection"]["candidates"]], [f.bic for f in models], atol=1e-7)
    history = list(y)
    for shock in case["shocks"]:
        history.append(fit.params[0] + sum(v * history[-j-1] for j, v in enumerate(fit.params[1:])) + shock)
    for key, future in [("rollout", np.array(history[len(y):])), ("average", fit.predict(len(y), len(y)+29))]:
        if d == 2:
            future = np.cumsum(future) + (x[-1] - x[-2])
        if d >= 1:
            future = np.cumsum(future) + x[-1]
        np.testing.assert_allclose(case[key], future, atol=1e-6)
print(f"PASS: {len(cases['adf'])} ADF cases, AR fits/forecasts, 4 hourly fits and 9 hourly fits with differencing and reconstruction.")
