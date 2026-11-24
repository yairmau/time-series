# Seasonality TA data and methods

Build with `python seasonality/build-ta-data.py`. Browser calculations live in
`seasonality/ta-lab/engine.js`. `provenance.json` records source checksums;
`data.js` stores each decomposition's settings.

## Temperature

IMS Jerusalem Centre. The daily 2020–2022 and hourly July 2022 series are copies of
the stationarity practice data; see its README for source files and completeness
rules. There is no interpolation. Classical additive decomposition uses period 365,
a centered 365-day moving-mean trend, and linear end extrapolation (`extrapolate_trend="freq"`).
The average annual seasonal pattern is smoothed with a circular moving mean of 15,
31, or 61 days, then repeated. This explicit extra smoothing prevents the three-year
average from treating too much short weather variation as an annual pattern.
The residual is computed from the original observations minus trend and smoothed seasonality.
The annual period is a 365-sample approximation, including across February 2020.
Zooming does not change these full-record fits. Warm/cold runs are an illustrative
residual-threshold rule, not a climatological heatwave classification.

## Dendrometer

Erez Feuer, Yakir Preisler, Eyal Rotenberg, Dan Yakir and Yair Mau (2025).
[Tree Growth, Contraction and Recovery: Disentangling Soil and Atmospheric Drought Effects](https://doi.org/10.1111/pce.15604).
[Zenodo release v1.0.1](https://doi.org/10.5281/zenodo.15382092), Git commit `8da3bac`.
The archived ZIP and unmodified `sample_dbh.csv` are in `source/`.

The release's example initializes the input as `metric="circumference", units="mm"`.
We therefore subtract its initial reading and divide by pi, obtaining diameter
variation in mm, then average pairs of half-hourly measurements into hourly bins.
All 35,040 half-hourly observations in 2018–2019 are present. No gaps are filled.
The author could not confirm the clock convention: it is kept exactly as supplied,
without timezone conversion. Daylight-saving effects must be checked before
interpreting a seasonal shift in peak hours.

Saved fits use both years. Classical additive decomposition has period 24 and
`extrapolate_trend="freq"`. Robust STL has period 24, trend span 49 hourly samples,
and seasonal spans 7, 31, or 91 daily cycles. Trend and seasonal arrays are stored;
the residual is computed as observed minus both, preserving the additive identity.
Daily/monthly profiles average the fitted seasonal component; they are not independent
growth measurements. This exercise does not implement the paper's physiological
classification or zero-growth model.

The release README labels the project **CC BY-NC-SA 4.0**; its Zenodo metadata says
CC BY 4.0. These educational data derivatives are attributed and offered under
[CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/), following the
bundled README. No original analysis code is executed or incorporated.

## Tree rings

D. A. Graybill and V. C. LaMarche, **Campito Mountain**, California,
*Pinus longaeva*, International Tree-Ring Data Bank **CA533**.
[NOAA data and metadata](https://www.ncei.noaa.gov/pub/data/paleo/treering/measurements/northamerica/usa/ca533-noaa.rwl).
[Original Tucson file](https://www.ncei.noaa.gov/pub/data/paleo/treering/measurements/northamerica/usa/ca533.rwl).
Downloaded 2026-11-24. Both source files are retained.

The Tucson end marker is 999, identifying 0.01-mm units; values are divided by 100.
We select the first core (`...1`) from each of the first 12 tree IDs, CAM01–CAM12.
Do not treat multiple cores from one tree as independent trees. Missing values
retain their year; zero-width rings stay zero. The supplied dates are not re-crossdated.

The browser fits each full available record with a centered, equally weighted rolling
mean, with an odd window in years. At the ends and around gaps, it averages the
available observations; a missing measurement keeps a missing trend and index. Indices are raw width divided by positive trend. This is a
transparent teaching smoother, not a prescribed dendrochronology standardization.
The common-year button finds the year with most indices below 0.7 within the current
view, requiring at least 75% of the selected trees; ties use the smaller mean index.
The chronology is a year-by-year Tukey biweight robust mean (C = 9) across the
currently displayed trees. We use the median and unscaled median absolute deviation
(MAD); weights are `(1 - u**2)**2` for `abs(u) < 1`, zero otherwise, where
`u = (index - median) / (9 * MAD)`. With MAD = 0 the median is returned. Missing
indices are omitted, and years with no indices have no chronology value. The CSV
includes `chronology` and `sample_depth` (the number of available tree indices).
This is a standard chronology without prewhitening or variance stabilization;
it retains the supplied calendar dates and makes no causal climate attribution.
See [dplPy's chronology documentation](https://opendendro.github.io/dplPy/reference/chronology/#chron).

The before/after spaghetti plots use the same tree order and calendar window.
The viewer supports 1–12 trees, retaining the selected tree when the count decreases.
A single tree is automatically enlarged; plot height and curve magnification affect
only display geometry. With one tree, the chronology equals its detrended index.
The chronology is an extra bottom row in the after panel, on the same index scale.
For display, raw series are centered on their window means and index series on 1.
All trees share one vertical scale within each panel; the curve-magnification control
changes display magnification only. Offsets and centering do not enter the fits,
year readouts or exported indices. Raw row labels retain the mean width in mm.

## Rebuilding pages

Use Quarto 1.6.41, matching the book's current render. A navigation change requires
`quarto render --no-execute` to rebuild every page's sidebar from stored notebook
outputs. Render `basics/numpy-pandas-matplotlib.qmd --use-freezer` afterward to
retain that executable QMD's cached figure.
Render the linked optional stationarity note afterward with
`quarto render stationarity/dickey-fuller.qmd --profile notes`.
The Python examples on the four TA pages use the full downloadable CSVs; widget
exports contain the currently selected window and its displayed results.
