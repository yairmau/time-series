"""Build the seasonality TA datasets and saved decompositions.

Run from any directory: python seasonality/build-ta-data.py
Source files are archived locally; this script needs no network.
"""
from pathlib import Path
import hashlib
import io
import json
import zipfile
import numpy as np
import pandas as pd
from statsmodels.tsa.seasonal import STL, seasonal_decompose

HERE = Path(__file__).resolve().parent
OUT = HERE / 'ta-data'
SOURCE = OUT / 'source'
LAB = HERE / 'ta-lab'

def numbers(values):
    return [round(float(v), 7) if np.isfinite(v) else None for v in values]

def components(fit, **settings):
    return dict(trend=numbers(fit.trend), seasonal=numbers(fit.seasonal), settings=settings)

def main():
    OUT.mkdir(exist_ok=True)
    # Same daily/hourly station and preprocessing as stationarity practice.
    daily = pd.read_csv(HERE.parent/'stationarity/practice-data/jerusalem_daily_2020_2022.csv', parse_dates=['time']).set_index('time').temperature
    hourly = pd.read_csv(HERE.parent/'stationarity/practice-data/jerusalem_hourly_july_2022.csv', parse_dates=['time']).set_index('time').temperature
    daily.to_csv(OUT/'jerusalem_daily.csv', float_format='%.7f')
    hourly.to_csv(OUT/'jerusalem_hourly.csv', float_format='%.7f')
    temperature = dict(start=str(daily.index[0]), minutes=1440, values=numbers(daily), models={})
    fit = seasonal_decompose(daily, period=365, extrapolate_trend='freq')
    cycle = np.asarray(fit.seasonal[:365])
    for span in [15, 31, 61]:
        # Circular averaging joins the end of one annual cycle to the next.
        smooth = np.mean([np.roll(cycle, k) for k in range(-span//2+1, span//2+1)], axis=0)
        temperature['models'][str(span)] = dict(trend=numbers(fit.trend),
            seasonal=numbers(np.resize(smooth, len(daily))),
            settings=dict(method='smoothed_classical', period=365, seasonal_smoothing=span, extrapolate_trend='freq'))
    # The release example identifies the input metric as circumference, in mm.
    with zipfile.ZipFile(SOURCE/'zenodo-dendro-v1.0.1.zip') as z:
        csv = next(f for f in z.namelist() if f.endswith('/sample_dbh.csv'))
        original = z.read(csv)
        (SOURCE/'sample_dbh.csv').write_bytes(original)
        raw = pd.read_csv(io.BytesIO(original), parse_dates=['time']).set_index('time').dbh
    assert raw.index.equals(pd.date_range('2018-01-01', '2019-12-31 23:30', freq='30min'))
    assert raw.notna().all()
    diameter = ((raw - raw.iloc[0]) / np.pi).resample('1h').mean().round(7)
    diameter.name = 'diameter_mm'
    diameter.to_csv(OUT/'yatir_hourly.csv', float_format='%.7f')
    dendro = dict(start=str(diameter.index[0]), minutes=60, values=numbers(diameter), models={})
    fixed = seasonal_decompose(diameter, period=24, model='additive', extrapolate_trend='freq')
    dendro['models']['fixed'] = components(fixed, method='seasonal_decompose', period=24, extrapolate_trend='freq')
    for seasonal in [7, 31, 91]:
        print('Dendrometer STL seasonal span:', seasonal, flush=True)
        fit = STL(diameter, period=24, seasonal=seasonal, trend=49, robust=True).fit()
        dendro['models'][str(seasonal)] = components(fit, period=24, seasonal=seasonal, trend=49, robust=True)
    # NOAA's original Tucson file uses the 999 marker: raw widths are 0.01 mm.
    tucson = (SOURCE/'ca533.rwl').read_text()
    assert '-9999' not in tucson and ' 999' in tucson
    raw_rings = pd.read_csv(SOURCE/'ca533-noaa.rwl', sep='\t', comment='#').set_index('age_CE')
    # One core per tree (CAM01, CAM02, ...); retain the full supplied series for fitting.
    columns = [c for c in raw_rings.columns if c.endswith('1_raw')][:12]
    rings = raw_rings[columns].rename(columns=lambda c:c.removesuffix('_raw')) / 100
    rings = rings.loc[rings.notna().any(axis=1)]
    assert (rings.stack() >= 0).all()
    rings.to_csv(OUT/'campito_ring_widths.csv', index_label='year', float_format='%.3f')
    ring_data = dict(years=rings.index.tolist(), series=[dict(id=c, values=numbers(rings[c])) for c in rings])
    data = dict(temperature=temperature, hourly=dict(start=str(hourly.index[0]), minutes=60, values=numbers(hourly)), dendro=dendro, rings=ring_data)
    (LAB/'data.js').write_text('globalThis.SeasonalityData = '+json.dumps(data, separators=(',', ':'), allow_nan=False)+';\n')
    manifest = dict(zenodo='https://doi.org/10.5281/zenodo.15382092', paper='https://doi.org/10.1111/pce.15604',
        ring_source='https://www.ncei.noaa.gov/pub/data/paleo/treering/measurements/northamerica/usa/ca533-noaa.rwl',
        retrieved='2026-11-24', dendro_clock='Supplied naive clock; timezone/DST not confirmed by author',
        rows=dict(temperature=len(daily), dendro_native=len(raw), dendro_hourly=len(diameter), rings=len(rings)),
        source_sha256={f.name:hashlib.sha256(f.read_bytes()).hexdigest() for f in SOURCE.iterdir() if f.is_file()})
    (OUT/'provenance.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print('Built',manifest['rows'], 'ring cores:', columns, flush=True)

if __name__ == '__main__': main()
