"""Independent checks against statsmodels, NumPy and the source measurement scale."""
from pathlib import Path
import json,subprocess,sys
import numpy as np
import pandas as pd
from statsmodels.tsa.stattools import acf
from statsmodels.tsa.seasonal import STL, seasonal_decompose
from astropy.stats import biweight_location
ROOT=Path(__file__).resolve().parents[2]
runtime=sys.argv[1] if len(sys.argv)>1 else '/Applications/quarto/bin/tools/aarch64/deno'
result=json.loads(subprocess.check_output([runtime,'run',str(Path(__file__).with_name('ta-engine.test.js'))],text=True))
for case in result['acfCases']:
 np.testing.assert_allclose(case['acf'],acf(case['values'],nlags=case['maxlag'],adjusted=False,fft=False),atol=1e-10)
for case in result['ringCases']:
 x=np.array(case['values'],dtype=float);w=case['width']
 trend=pd.Series(x).rolling(w,center=True,min_periods=1).mean().to_numpy();trend[~np.isfinite(x)]=np.nan
 np.testing.assert_allclose(np.array(case['trend'],dtype=float),trend,atol=1e-9,equal_nan=True)
 np.testing.assert_allclose(np.array(case['index'],dtype=float),x/trend,atol=1e-9,equal_nan=True)
for case in result['robustCases']:
 x=np.array(case['values'],dtype=float);x=x[np.isfinite(x)]
 expected=float(biweight_location(x,c=9)) if len(x) else None
 if expected is None: assert case['mean'] is None
 else: np.testing.assert_allclose(case['mean'],expected,atol=1e-12)
for case in result['chronologyCases']:
 indices=np.array(case['indices'],dtype=float)
 expected=[float(biweight_location(column[np.isfinite(column)],c=9)) if np.isfinite(column).any() else np.nan for column in indices.T]
 np.testing.assert_allclose(np.array(case['values'],dtype=float),expected,atol=1e-12,equal_nan=True)
 np.testing.assert_array_equal(case['depth'],np.isfinite(indices).sum(axis=0))
raw=(ROOT/'seasonality/ta-lab/data.js').read_text();data=json.loads(raw.removeprefix('globalThis.SeasonalityData = ').strip().removesuffix(';'))
for key in ['temperature','dendro']:
 x=np.array(data[key]['values'])
 for name,model in data[key]['models'].items():
  settings=dict(model['settings']);method=settings.pop('method',None)
  if method == 'smoothed_classical':
   span=settings.pop('seasonal_smoothing')
   fit=seasonal_decompose(x,**settings)
   cycle=np.tile(fit.seasonal[:365],3)
   smooth=np.convolve(cycle,np.ones(span)/span,'same')[365:730]
   expected_seasonal=np.resize(smooth,len(x))
   np.testing.assert_allclose(expected_seasonal[365:730],expected_seasonal[:365],atol=1e-12)
  else:
   fit=seasonal_decompose(x,**settings) if method else STL(x,**settings).fit()
   expected_seasonal=fit.seasonal
  np.testing.assert_allclose(model['trend'],fit.trend,atol=1e-6)
  np.testing.assert_allclose(model['seasonal'],expected_seasonal,atol=1e-6)
source=pd.read_csv(ROOT/'seasonality/ta-data/source/sample_dbh.csv',index_col='time',parse_dates=True).dbh
assert source.index.to_series().diff().dropna().eq(pd.Timedelta(minutes=30)).all()
assert source.resample('1h').count().eq(2).all()
assert data['dendro']['minutes']==60 and all(m['settings']['period']==24 for m in data['dendro']['models'].values())
expected=((source-source.iloc[0])/np.pi).resample('1h').mean()
np.testing.assert_allclose(data['dendro']['values'],expected,atol=1e-7)
assert len(expected)==17520 and len(set(s['id'][:5] for s in data['rings']['series']))==12
print('PASS: ACF matches statsmodels; rolling trends match pandas; robust chronologies match Astropy; all 7 saved decompositions match independent references; 30-minute source, hourly means, period 24 and distinct trees verified.')
