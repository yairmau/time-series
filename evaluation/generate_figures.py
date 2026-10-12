"""
Generates the figures used in mini-exam-example.html.
Run with the 'olympus' conda env (has pandas/numpy/matplotlib/statsmodels):
    /Users/yairmau/miniforge3/envs/olympus/bin/python3 evaluation/generate_figures.py

All source data is real course data already used elsewhere in the repo,
except for item 4, where a single synthetic sensor fault is deliberately
injected into a real background series (disclosed in the answer key).
"""
import os
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
from statsmodels.graphics.tsaplots import plot_acf
from statsmodels.tsa.seasonal import STL

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
FIGDIR = os.path.join(HERE, "figures")
os.makedirs(FIGDIR, exist_ok=True)

plt.rcParams.update({
    "figure.dpi": 130,
    "font.size": 11,
    "axes.spines.top": False,
    "axes.spines.right": False,
})


def savefig(name):
    path = os.path.join(FIGDIR, name)
    plt.tight_layout()
    plt.savefig(path)
    plt.close()
    print("wrote", path)


# ---------------------------------------------------------------
# Item 1 — smoothing can destroy real signal, not just noise
# ---------------------------------------------------------------
jer = pd.read_csv(os.path.join(ROOT, "stationarity", "jerusalem_temperature.csv"),
                   encoding="utf-8-sig")
jer = jer.rename(columns={"Temperature (°C)": "T"})
jer["dt"] = pd.to_datetime(jer["Date & Time (Summer)"], format="%d/%m/%Y %H:%M")
jer = jer.set_index("dt").sort_index()

fig, ax = plt.subplots(figsize=(8, 3.2))
ax.plot(jer.index, jer["T"], lw=1, color="#c0392b")
ax.set_ylabel("Temperature (°C)")
ax.set_title("Panel A — raw 10-minute air temperature, Jerusalem, June 2023")
ax.set_xlabel("date")
savefig("item1_panelA_raw.png")

window = 24 * 6 * 3  # 3-day centered moving average, at 10-min resolution
jer_smooth = jer["T"].rolling(window, center=True, min_periods=1).mean()

fig, ax = plt.subplots(figsize=(8, 3.2))
ax.plot(jer_smooth.index, jer_smooth, lw=2, color="#2c3e50")
ax.set_ylabel("Temperature (°C)")
ax.set_title("Panel B — same data, 3-day centered moving average")
ax.set_xlabel("date")
savefig("item1_panelB_smoothed.png")

fig, ax = plt.subplots(figsize=(8, 3.2))
ax.plot(jer.index, jer["T"], lw=0.8, color="#c0392b", alpha=0.5, label="raw")
ax.plot(jer_smooth.index, jer_smooth, lw=2.2, color="#2c3e50", label="3-day moving average")
ax.set_ylabel("Temperature (°C)")
ax.legend(loc="upper right")
ax.set_title("Panel B (overlay for reference) — raw vs. 3-day smoothed")
ax.set_xlabel("date")
savefig("item1_overlay.png")


# ---------------------------------------------------------------
# Item 2 — aliasing: sampling at ~the wrong interval invents a
# slow multi-day cycle out of a real ~24h cycle
# ---------------------------------------------------------------
dend = pd.read_csv(os.path.join(ROOT, "forecasting", "dendrometer_sample.csv"),
                    parse_dates=["time"]).set_index("time").sort_index()
start = pd.Timestamp("2016-10-01 00:15:00")
end = start + pd.Timedelta(days=40)
d = dend.loc[start:end, "dend"]

fig, ax = plt.subplots(figsize=(8, 3.2))
ax.plot(d.index, d.values, lw=1, color="#16a085")
ax.set_ylabel("stem radius (mm)")
ax.set_title("Panel A — dendrometer, native 30-minute sampling, 40 days")
ax.set_xlabel("date")
savefig("item2_panelA_native.png")

# simulate a logger misconfigured to sample every 22h instead of every 24h
alias_times = pd.date_range(start, end, freq="22h")
d_alias = dend["dend"].reindex(alias_times, method="nearest", tolerance=pd.Timedelta("20min")).dropna()

fig, ax = plt.subplots(figsize=(8, 3.2))
ax.plot(d_alias.index, d_alias.values, "o-", lw=1.3, color="#8e44ad", markersize=4)
ax.set_ylabel("stem radius (mm)")
ax.set_title("Panel B — same sensor, logger sampling every 22 hours")
ax.set_xlabel("date")
savefig("item2_panelB_aliased.png")


# ---------------------------------------------------------------
# Item 3 — a strong trend inflates the ACF; it doesn't mean
# what a "textbook AR(1)" ACF would mean
# ---------------------------------------------------------------
co2 = pd.read_csv(os.path.join(ROOT, "seasonality", "co2_weekly_mlo.csv"), comment="#")
co2["date"] = pd.to_datetime(co2[["year", "month", "day"]])
co2 = co2[co2["average"] > 0].set_index("date").sort_index()
co2_series = co2["average"]

fig, ax = plt.subplots(figsize=(8, 3.2))
ax.plot(co2_series.index, co2_series.values, lw=1.3, color="#2980b9")
ax.set_ylabel("CO$_2$ (ppm)")
ax.set_title("Panel A — weekly CO$_2$, Mauna Loa, full record")
ax.set_xlabel("date")
savefig("item3_panelA_co2.png")

fig, ax = plt.subplots(figsize=(6.5, 3.5))
plot_acf(co2_series.values, lags=104, ax=ax, title="")
ax.set_title("ACF of the raw weekly CO$_2$ series (lags in weeks)")
savefig("item3_panelB_acf_raw.png")

stl = STL(co2_series.asfreq("W").interpolate(), period=52, robust=True).fit()
resid = stl.resid.dropna()

fig, ax = plt.subplots(figsize=(6.5, 3.5))
plot_acf(resid.values, lags=104, ax=ax, title="")
ax.set_title("ACF of the STL residual (trend + season removed)")
savefig("item3_panelC_acf_residual.png")


# ---------------------------------------------------------------
# Item 4 — is this point a real reading or a sensor fault?
# real background series (Shani station, Jan 2022), one
# synthetic fault injected transparently (see answer key)
# ---------------------------------------------------------------
shani = pd.read_csv(os.path.join(ROOT, "smoothing", "shani_2022_january.csv"), parse_dates=["date"])
shani = shani.set_index("date").sort_index()
td = shani["TD"].iloc[:24 * 6 * 3].copy()  # first 3 days, 10-min resolution

fault_time = td.index[24 * 6 + 30]  # somewhere on day 2
true_value = td.loc[fault_time]
td_fault = td.copy()
td_fault.loc[fault_time] = true_value / 10  # decimal-place sensor/transmission fault

fig, ax = plt.subplots(figsize=(8, 3.2))
ax.plot(td_fault.index, td_fault.values, "o-", lw=1, markersize=3, color="#d35400")
ax.set_ylabel("air temperature (°C)")
ax.set_title("Panel A — weather station, 3 days, 10-minute resolution")
ax.set_xlabel("date")
savefig("item4_panelA_fault.png")

fig, ax = plt.subplots(figsize=(8, 3.2))
zoom = td_fault.loc[fault_time - pd.Timedelta("6h"): fault_time + pd.Timedelta("6h")]
ax.plot(zoom.index, zoom.values, "o-", lw=1.3, markersize=5, color="#d35400")
ax.set_ylabel("air temperature (°C)")
ax.set_title("Panel B — zoomed in on the flagged point")
ax.set_xlabel("date")
savefig("item4_panelB_zoom.png")

print("done. fault_time =", fault_time, "true_value =", true_value, "shown_value =", true_value / 10)
