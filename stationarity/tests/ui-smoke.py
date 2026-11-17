"""Real Chrome smoke test, including mobile layout and CSV/Python handoff.

Requires websocket-client and an installed Chrome (CHROME_BIN can override path).
Uses an isolated temporary browser profile; serves the repository on localhost only.
Run: python stationarity/tests/ui-smoke.py
Screenshots and exported Python examples are placed in /tmp/stationarity-practice-qa.
"""
import base64
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import subprocess
import tempfile
import threading
import time
from urllib.request import urlopen

import websocket

ROOT = Path(__file__).resolve().parents[2]
OUT = Path('/private/tmp/stationarity-practice-qa')
OUT.mkdir(exist_ok=True)
CHROME = os.environ.get('CHROME_BIN', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')

class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietHandler, directory=str(ROOT)))
threading.Thread(target=server.serve_forever, daemon=True).start()
base = f'http://127.0.0.1:{server.server_port}'
with tempfile.TemporaryDirectory(prefix='stationarity-chrome-') as profile:
    process = subprocess.Popen([CHROME, '--headless=new', '--no-first-run', '--no-default-browser-check',
                                '--remote-debugging-port=0', '--remote-allow-origins=*',
                                f'--user-data-dir={profile}', 'about:blank'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        port_file = Path(profile) / 'DevToolsActivePort'
        for _ in range(100):
            if port_file.exists():
                break
            time.sleep(0.1)
        port = int(port_file.read_text().splitlines()[0])
        pages = json.load(urlopen(f'http://127.0.0.1:{port}/json'))
        ws = websocket.create_connection(pages[0]['webSocketDebuggerUrl'], timeout=30)
        sequence = 0
        errors = []
        def call(method, params=None):
            global sequence
            sequence += 1
            ws.send(json.dumps({'id': sequence, 'method': method, 'params': params or {}}))
            while True:
                response = json.loads(ws.recv())
                if response.get('method') == 'Runtime.exceptionThrown':
                    errors.append(response['params'])
                if response.get('id') == sequence:
                    assert 'error' not in response, response
                    return response.get('result', {})
        def evaluate(expression):
            result = call('Runtime.evaluate', {'expression': expression, 'awaitPromise': True, 'returnByValue': True})
            assert 'exceptionDetails' not in result, result
            return result['result'].get('value')
        def navigate(path):
            call('Page.navigate', {'url': base + path})
            for _ in range(100):
                if evaluate('document.readyState') == 'complete':
                    break
                time.sleep(0.1)
            evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
        def screenshot(name):
            result = call('Page.captureScreenshot', {'captureBeyondViewport': not name.startswith('chapter')})
            (OUT / name).write_bytes(base64.b64decode(result['data']))
        call('Runtime.enable')
        call('Page.enable')
        call('Emulation.setDeviceMetricsOverride', {'width': 1200, 'height': 1100, 'deviceScaleFactor': 1, 'mobile': False})
        navigate('/stationarity/practice-lab/index.html')
        report = evaluate('''(async () => {
          const $ = id => document.getElementById(id);
          const assert = (v, s) => { if (!v) throw Error(s); };
          const tick = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          const input = async (id, value) => { $(id).value = value; $(id).dispatchEvent(new Event('input')); await tick(); };
          const preset = async key => { document.querySelector(`[data-preset="${key}"]`).click(); await tick(); };
          const badPaths = () => [...document.querySelectorAll('svg path')].some(p => /NaN|Infinity|undefined/.test(p.getAttribute('d')));
          assert($('sample-count').textContent === '1096', 'Default duration');
          assert(Math.abs(Number($('adf-p').textContent) - 0.0412) < 0.0001, 'Default ADF');
          const initialP = $('adf-p').textContent;
          await input('rolling', 101);
          assert($('adf-p').textContent === initialP, 'Rolling width changed ADF');
          for (const [key, count] of [['halfyear',181],['week',168],['day',24],['years',1096]]) {
            await preset(key); assert(+$('sample-count').textContent === count, `Preset ${key}`);
            assert(!badPaths(), `Invalid path in ${key}`);
          }
          await preset('day');
          assert($('adf-warning').textContent.includes('Very short'), 'Short sample warning');
          for (const key of ['noise','ar','walk','trend','variance','daily','hourly']) {
            $('dataset').value = key; $('dataset').dispatchEvent(new Event('change')); await tick();
            await input('length', 20); await input('start', $('start').max);
            await input('rolling', 19); assert(!badPaths(), `Boundary values for ${key}`);
          }
          await preset('halfyear');
          const originalURL = URL.createObjectURL;
          URL.createObjectURL = blob => { window.lastDownload = blob; return originalURL(blob); };
          HTMLAnchorElement.prototype.click = function () {};
          $('export-window').click();
          const windowCSV = await lastDownload.text(), windowPython = $('window-python').textContent;
          assert(windowCSV.trim().split('\\n').length === 182, 'Window CSV row count');
          $('fit-mode').click(); await tick();
          assert($('selected-order').textContent === 'AR(24)', 'Two-week automatic order');
          assert(!document.getElementById('order') && !document.getElementById('count'), 'Old manual synthetic controls remain');
          document.querySelector('[data-fit-days="7"]').click(); await tick();
          assert($('selected-order').textContent === 'AR(2)', 'One-week automatic order');
          document.querySelector('[data-fit-days="21"]').click(); await tick();
          await input('fit-start', $('fit-start').max); await input('horizon', 168);
          $('show-actual').checked = true; $('show-actual').dispatchEvent(new Event('input')); await tick();
          assert($('fit-warning').textContent.includes('0 of the 168'), 'Missing future observations not explained');
          assert(!badPaths(), 'Invalid temperature rollout at record end');
          await input('fit-days', 14); await input('fit-start', 0); await input('horizon', 72);
          $('show-actual').checked = false; $('show-actual').dispatchEvent(new Event('input')); await tick();
          const coeffs = $('coefficient-table').textContent;
          $('export-fit').click();
          const initialCSV = await lastDownload.text();
          const futureRows = csv => csv.trim().split('\\n').slice(1).map(row => row.split(',')).filter(row => row[2] === 'future');
          const initialFuture = futureRows(initialCSV);
          assert(initialFuture.length === 72 && initialFuture.every(row => row[1] === ''), 'Hidden future leaked into export');
          $('show-actual').checked = true; $('show-actual').dispatchEvent(new Event('input')); await tick();
          $('export-fit').click();
          const revealedFuture = futureRows(await lastDownload.text());
          assert(revealedFuture.every((row, i) => row[1] !== '' && row[4] === initialFuture[i][4]), 'Revealing future changed the simulation');
          assert($('coefficient-table').textContent === coeffs, 'Future observations changed the fit');
          $('show-mean').checked = true; $('show-mean').dispatchEvent(new Event('input')); await tick();
          assert(!$('mean-legend').hidden, 'Average forecast not shown');
          $('new-noise').click(); await tick(); $('export-fit').click();
          const fitCSV = await lastDownload.text(), newFuture = futureRows(fitCSV);
          assert(newFuture.some((row, i) => row[4] !== initialFuture[i][4]), 'New simulated future unchanged');
          assert(newFuture.every((row, i) => row[5] === initialFuture[i][5]), 'New noise changed the average forecast');
          assert($('coefficient-table').textContent === coeffs, 'New noise changed coefficients');
          assert(!badPaths(), 'Invalid temperature chart');
          return { windowCSV, windowPython, fitCSV, fitPython: $('fit-python').textContent,
                   selectedOrder: $('selected-order').textContent, coefficients: coeffs };

        })()''')
        screenshot('fit-desktop.png')
        for name, key in [('stationarity-window.csv','windowCSV'),('window.py','windowPython'),('temperature-ar.csv','fitCSV'),('fit.py','fitPython')]:
            (OUT / name).write_text(report[key])
        print('PASS: stationarity controls, automatic temperature orders, window boundaries, autonomous continuation, reveal isolation and CSV exports.')
        navigate('/stationarity/practice-lab/index.html#difference')
        difference_report = evaluate('''(async () => {
          const $ = id => document.getElementById(id);
          const assert = (v, s) => { if (!v) throw Error(s); };
          const tick = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          const input = async (id, value) => { $(id).value = value; $(id).dispatchEvent(new Event('input')); await tick(); };
          const toggle = async (id, value) => { $(id).checked = value; $(id).dispatchEvent(new Event('input')); await tick(); };
          const badPaths = () => [...document.querySelectorAll('#difference-stage svg path')].some(p => /NaN|Infinity|undefined/.test(p.getAttribute('d')));
          assert(!$('difference-stage').hidden, 'Direct differencing link failed');
          const originalURL = URL.createObjectURL;
          URL.createObjectURL = blob => { window.lastDownload = blob; return originalURL(blob); };
          HTMLAnchorElement.prototype.click = function () {};
          const future = csv => csv.trim().split('\\n').slice(1).map(row => row.split(',')).filter(row => row[2] === 'future');
          const cases = [];
          for (const d of [0, 1, 2]) {
            await input('difference-order', d);
            await toggle('difference-actual', false);
            $('export-difference').click();
            const csv = await lastDownload.text(), rows = future(csv);
            assert(rows.length === 30 && rows.every(r => r[1] === '' && +r[6] === d), 'Differences export alignment or hidden future');
            cases.push({ d, csv, python: $('difference-python').textContent });
            const selected = $('difference-selected').textContent;
            await toggle('difference-actual', true);
            $('export-difference').click();
            const revealed = future(await lastDownload.text());
            assert(revealed.every((r, i) => r[1] !== '' && r[4] === rows[i][4]), 'Actual future changed differenced rollout');
            assert($('difference-selected').textContent === selected, 'Actual future changed selected order');
            assert(!$('difference-score').hidden, 'Actual future score missing');
            assert(!badPaths(), 'Invalid reconstructed path');
          }
          const original = future(cases[2].csv);
          $('difference-noise').click(); await tick(); $('export-difference').click();
          const fresh = future(await lastDownload.text());
          assert(fresh.some((r, i) => r[4] !== original[i][4]), 'Differenced simulation seed unchanged');
          assert(fresh.every((r, i) => r[5] === original[i][5]), 'Noise changed reconstructed mean');
          for (const year of ['2021', '2022', '2020']) {
            document.querySelector(`[data-difference-year="${year}"]`).click(); await tick();
            assert($('difference-start-value').textContent === `${year}-01-01`, 'Year preset alignment');
          }
          await input('difference-days', 60);
          await input('difference-start', $('difference-start').max);
          await input('difference-horizon', 90);
          assert($('difference-warning').textContent.includes('0 of the 90'), 'Missing daily future warning');
          assert($('difference-score').hidden && !badPaths(), 'End-of-record reconstruction');
          document.querySelector('[data-difference-year="2020"]').click(); await tick();
          await input('difference-order', 1); await input('difference-horizon', 30);
          await toggle('difference-mean', true);
          assert(!$('difference-mean-legend').hidden, 'Reconstructed mean missing');
          return cases;
        })()''')
        for case in difference_report:
            folder = OUT / f"difference-{case['d']}"
            folder.mkdir(exist_ok=True)
            (folder/'temperature-differences.csv').write_text(case['csv'])
            (folder/'reproduce.py').write_text(case['python'])
        screenshot('differences-desktop.png')
        print('PASS: 0/1/2 differences, reconstruction, year presets, future isolation and reproducible exports.')
        navigate('/stationarity/practice-lab/index.html#windows')
        screenshot('windows-desktop.png')
        call('Emulation.setDeviceMetricsOverride', {'width': 390, 'height': 844, 'deviceScaleFactor': 1, 'mobile': True})
        evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
        assert evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Mobile horizontal overflow'
        screenshot('windows-mobile.png')
        navigate('/stationarity/practice-lab/index.html#fit')
        assert evaluate('!document.getElementById("fit-stage").hidden'), 'Direct #fit entry failed'
        navigate('/stationarity/practice-lab/index.html#difference')
        assert evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Differencing mobile overflow'
        screenshot('differences-mobile.png')
        if (ROOT/'docs/stationarity/practice_ARIMA.html').exists():
            call('Emulation.setDeviceMetricsOverride', {'width': 1300, 'height': 1000, 'deviceScaleFactor': 1, 'mobile': False})
            navigate('/docs/stationarity/practice_ARIMA.html')
            result = evaluate('''(async () => {
              const frames = [...document.querySelectorAll('iframe[id^="stationarity-"]')];
              for (const f of frames) f.loading = 'eager';
              await new Promise(r => setTimeout(r, 1500));
              return frames.map(f => ({id:f.id, height:f.getBoundingClientRect().height,
                content: !!f.contentDocument?.getElementById('sample-count'),
                innerHeight: f.contentDocument?.querySelector('main')?.getBoundingClientRect().height}));
            })()''')
            assert len(result) == 3 and all(f['content'] and f['height'] >= f['innerHeight'] for f in result), result
            async_scroll_check = '''(async () => {
              const frame = document.getElementById('stationarity-window-lab');
              const doc = frame.contentDocument;
              const plot = doc.getElementById('variance-chart');
              const input = doc.getElementById('rolling');
              const before = doc.querySelector('#window-chart path:last-child').getAttribute('d');
              const plotY = scrollY + frame.getBoundingClientRect().top + plot.getBoundingClientRect().top;
              window.scrollTo({top: plotY - innerHeight * 0.55, behavior: 'instant'});
              await new Promise(r => setTimeout(r, 250));
              const offset = frame.getBoundingClientRect().top;
              const controlRect = input.getBoundingClientRect();
              const plotRect = plot.getBoundingClientRect();
              const controlsVisible = offset + controlRect.top >= 0 && offset + controlRect.bottom <= innerHeight;
              const plotVisible = offset + plotRect.top >= 0 && offset + plotRect.bottom <= innerHeight;
              input.value = input.value === '51' ? '31' : '51';
              input.dispatchEvent(new frame.contentWindow.Event('input'));
              await new Promise(r => setTimeout(r, 100));
              return {controlsVisible, plotVisible,
                updated: before !== doc.querySelector('#window-chart path:last-child').getAttribute('d'),
                controlsTop: offset + controlRect.top, plotTop: offset + plotRect.top,
                controlPanelHeight: doc.querySelector('.controls').getBoundingClientRect().height,
                frameTop: offset, stickyTop: doc.documentElement.style.getPropertyValue('--controls-top'),
                viewportHeight: innerHeight, scrollBehavior: getComputedStyle(document.documentElement).scrollBehavior};
            })()'''
            scroll_result = evaluate(async_scroll_check)
            assert scroll_result['controlsVisible'] and scroll_result['plotVisible'] and scroll_result['updated'], scroll_result
            screenshot('chapter-sticky-desktop.png')
            call('Emulation.setDeviceMetricsOverride', {'width': 390, 'height': 844, 'deviceScaleFactor': 1, 'mobile': True})
            evaluate('new Promise(resolve => setTimeout(resolve, 250))')
            scroll_result = evaluate(async_scroll_check)
            screenshot('chapter-sticky-mobile.png')
            assert scroll_result['controlsVisible'] and scroll_result['plotVisible'] and scroll_result['updated'], scroll_result
            print('PASS: parent-page scrolling keeps the rolling slider and lower plot visible on desktop and mobile; the slider updates the plot.')
            difference_scroll_check = '''(async () => {
              const frame = document.getElementById('stationarity-difference-lab');
              frame.scrollIntoView({behavior: 'instant', block: 'start'});
              await new Promise(r => setTimeout(r, 500));
              const doc = frame.contentDocument, plot = doc.getElementById('difference-chart');
              const select = doc.getElementById('difference-order');
              const plotY = scrollY + frame.getBoundingClientRect().top + plot.getBoundingClientRect().top;
              window.scrollTo({top: plotY - innerHeight * 0.55, behavior: 'instant'});
              await new Promise(r => setTimeout(r, 250));
              const offset = frame.getBoundingClientRect().top, rect = select.getBoundingClientRect();
              if (!doc.querySelector('#difference-chart path')) return {
                error: 'Chart was not drawn', hash: frame.contentWindow.location.hash,
                hidden: doc.getElementById('difference-stage').hidden,
                frameTop: offset, frameHeight: frame.getBoundingClientRect().height,
                text: doc.body.innerText, scripts: [...doc.scripts].map(s => s.src)};
              const before = doc.querySelector('#difference-chart path:last-of-type').getAttribute('d');
              select.value = select.value === '1' ? '2' : '1';
              select.dispatchEvent(new frame.contentWindow.Event('input'));
              await new Promise(r => setTimeout(r, 200));
              return {visible: offset + rect.top >= 0 && offset + rect.bottom <= innerHeight,
                updated: before !== doc.querySelector('#difference-chart path:last-of-type').getAttribute('d')};
            })()'''
            diff_scroll = evaluate(difference_scroll_check)
            assert diff_scroll.get('visible') and diff_scroll.get('updated'), diff_scroll
            screenshot('chapter-difference-mobile.png')
            call('Emulation.setDeviceMetricsOverride', {'width': 1300, 'height': 1000, 'deviceScaleFactor': 1, 'mobile': False})
            evaluate('new Promise(resolve => setTimeout(resolve, 250))')
            diff_scroll = evaluate(difference_scroll_check)
            assert diff_scroll.get('visible') and diff_scroll.get('updated'), diff_scroll
            screenshot('chapter-difference-desktop.png')
            print('PASS: differencing selector stays visible beside the reconstructed rollout on desktop and mobile.')
            download = evaluate('''(async () => {
              const a = [...document.querySelectorAll('a')].find(a => a.textContent === 'download this notebook');
              const notebook = await fetch(a.href).then(r => r.json());
              return {url:a.getAttribute('href'), format:notebook.nbformat, cells:notebook.cells.length};
            })()''')
            assert download['url'].endswith('.ipynb') and download['format'] == 4 and download['cells'] == len(json.loads((ROOT/'stationarity/practice_ARIMA.ipynb').read_text())['cells']), download
            screenshot('chapter-desktop.png')
            print('PASS: all three rendered chapter embeds load and resize without clipping.')
            print('PASS: student notebook download returns a notebook, not rendered HTML.')
            optional = evaluate('''(async () => {
              const a = [...document.querySelectorAll('a')].find(a => a.textContent.startsWith('Optional: how the test'));
              const response = await fetch(a.href);
              return {status: response.status, html: await response.text()};
            })()''')
            assert optional['status'] == 200 and 'Where does the p-value come from?' in optional['html'], 'Optional explanation link broken'
        assert not errors, errors
        print('PASS: mobile layout, direct links and no uncaught browser errors.')
        print('Screenshots and Python/CSV exports:', OUT)
        print('Browser selected model:', report['selectedOrder'])
        ws.close()
    finally:
        process.terminate()
        process.wait(timeout=15)
        server.shutdown()
