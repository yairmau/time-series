"""Real Chrome smoke test, including mobile layout and CSV exports.

Requires websocket-client and an installed Chrome (CHROME_BIN can override path).
Uses an isolated temporary browser profile; serves the repository on localhost only.
Run: python seasonality/tests/ui-smoke.py
Screenshots and exported CSVs are placed in /tmp/seasonality-ta-qa.
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
OUT = Path('/private/tmp/seasonality-ta-qa')
OUT.mkdir(exist_ok=True)
CHROME = os.environ.get('CHROME_BIN', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')

class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietHandler, directory=str(ROOT)))
threading.Thread(target=server.serve_forever, daemon=True).start()
base = f'http://127.0.0.1:{server.server_port}'
with tempfile.TemporaryDirectory(prefix='seasonality-chrome-') as profile:
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
        call('Emulation.setDeviceMetricsOverride', {'width': 1200, 'height': 1000, 'deviceScaleFactor': 1, 'mobile': False})
        navigate('/seasonality/ta-lab/index.html')
        report=evaluate("""(async()=>{
          const $=id=>document.getElementById(id), E=SeasonalityLab;
          const assert=(x,m)=>{if(!x)throw Error(m);};
          const tick=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
          const input=async(id,v)=>{$(id).value=v;$(id).dispatchEvent(new Event('input'));await tick();};
          const mode=async name=>{$(name+'-mode').click();await tick();};
          const bad=()=>[...document.querySelectorAll('svg path')].some(p=>/NaN|Infinity|undefined/.test(p.getAttribute('d')));
          assert($('acf-peaks').textContent.includes('24'),'Default seasonal ACF period');
          await input('noise',0);await input('slope',0);await input('period',48);
          assert($('acf-peaks').textContent.startsWith('48'),'Period slider did not change ACF');
          $('signal-parts').checked=true;$('signal-parts').dispatchEvent(new Event('input'));await tick();
          assert(!$('acf-parts-card').hidden,'Generating components missing');
          for(const kind of ['hourly','ar','synthetic']){$('acf-data').value=kind;$('acf-data').dispatchEvent(new Event('change'));await tick();assert(!bad(),'Bad ACF series '+kind);}
          await input('amplitude',0);await input('noise',0);await input('slope',0);await input('second',0);
          assert($('acf-note').textContent.includes('constant'),'Constant-series handling');
          await input('amplitude',3);await input('noise',0.8);
          await mode('temperature');
          for(const key of ['T','S','R','S+R','T+R']){await input('temp-component',key);assert(!bad(),'Bad component '+key);}
          for(const kind of ['warm','cold']){document.querySelector(`[data-temperature-preset="${kind}"]`).click();await tick();assert($('temp-events').children.length>0,'Temperature spell preset '+kind);}
          await input('temp-smoothing',15);await input('temp-threshold',8);await input('temp-duration',10);assert(!bad(),'Temperature boundary');
          await mode('dendro');
          const p=$('dendro-profile').querySelector('path').getAttribute('d');
          $('pin-profile').click();await tick();
          document.querySelector('[data-dendro-preset="0"]').click();await tick();
          assert($('dendro-profile').querySelectorAll('path').length===2,'Pinned profile missing');
          assert($('pinned-note').textContent.includes('2018-06'),'Pinned date changed');
          assert($('dendro-profile').querySelector('path').getAttribute('d')!==p,'Seasonal window had no effect');
          await input('dendro-model','fixed');
          const fixed=SeasonalityData.dendro.models.fixed.seasonal;
          const winter=E.profile(fixed,24,0,31*24),summer=E.profile(fixed,24,151*24,181*24);
          assert(winter.every((v,i)=>Math.abs(v-summer[i])<1e-6),'Fixed seasonal profile changed by month');
          for(const model of ['7','31','91']){await input('dendro-model',model);assert(!bad(),'Bad STL setting');}
          await input('dendro-length',90);await input('dendro-start',$('dendro-start').max);assert(!bad(),'Dendro end boundary');
          $('clear-profile').click();await tick();assert($('dendro-profile').querySelectorAll('path').length===1,'Clear profile failed');
          await mode('rings');
          for(const width of [21,301,101]){await input('ring-width',width);assert(!bad(),'Bad ring trend');}
          await input('ring-count',3);
          const threeTreeChronology=$('ring-index').querySelector('.ring-chronology-line').getAttribute('d');
          await input('ring-count',12);assert($('ring-focus').options.length===12,'Tree count');
          assert($('ring-index').querySelector('.ring-chronology-line').getAttribute('d')!==threeTreeChronology,'Chronology did not update with tree selection');
          assert($('ring-depth').textContent==='12 trees','Chronology sample depth');
          const left=$('ring-raw'),right=$('ring-index');
          const labels=svg=>[...svg.querySelectorAll('.ring-row-label')].map(e=>[e.dataset.tree,e.getAttribute('y')]);
          assert(JSON.stringify(labels(left))===JSON.stringify(labels(right)),'Spaghetti tree rows do not align');
          assert(left.querySelectorAll('.ring-series-line').length===12&&right.querySelectorAll('.ring-series-line').length===12,'Missing stacked tree series');
          const l=left.getBoundingClientRect(),r=right.getBoundingClientRect();
          assert(Math.abs(l.top-r.top)<1&&r.left>=l.right,'Before/after panels are not side by side');
          const rawPath=left.querySelector('.ring-series-line').getAttribute('d'),indexPath=right.querySelector('.ring-series-line').getAttribute('d');
          await input('ring-width',21);
          assert(left.querySelector('.ring-series-line').getAttribute('d')===rawPath,'Trend setting changed the raw data display');
          assert(right.querySelector('.ring-series-line').getAttribute('d')!==indexPath,'Trend setting did not change the detrended plot');
          await input('ring-width',101);
          const scale=+left.dataset.scale;await input('ring-gain',2);
          assert(Math.abs(+left.dataset.scale-2*scale)<1e-9,'Display magnification');
          await input('ring-gain',1);
          $('ring-event').click();await tick();assert(!/^0 \/ /.test($('ring-shared').textContent),'Shared narrow year not found');
          const marks=svg=>[...svg.querySelectorAll('.ring-year-point')];
          assert(marks(left).length===12&&marks(right).length===12,'Shared year is not marked on every tree');
          const baselines=[...right.querySelectorAll('.ring-row-baseline')];
          const narrow=marks(right).filter((e,i)=>+e.getAttribute('cy')>+baselines[i].getAttribute('y1')+.3*(+right.dataset.scale)).length;
          assert(narrow===parseInt($('ring-shared').textContent),'Plot markers disagree with narrow-ring count');
          const chronPoint=right.querySelector('.ring-chronology-point'),chronBase=right.querySelector('.ring-chronology-baseline');
          const chronValue=1+(+chronBase.getAttribute('y1')-Number(chronPoint.getAttribute('cy')))/Number(right.dataset.scale);
          assert(Math.abs(chronValue-Number($('ring-chronology-value').textContent))<.00051,'Chronology plot and readout disagree');
          const year=$('ring-selected-year').textContent;
          const original=URL.createObjectURL;URL.createObjectURL=b=>{window.lastDownload=b;return original(b);};HTMLAnchorElement.prototype.click=function(){};
          $('ring-export').click();const ringCSV=await lastDownload.text();
          const csvRows=ringCSV.trim().split('\\n').map(row=>row.split(','));
          assert(csvRows[0].slice(-2).join(',')==='chronology,sample_depth','Chronology export columns');
          const selectedCSV=csvRows.slice(1).find(row=>row[0]===year);
          assert(Math.abs(+selectedCSV.at(-2)-chronValue)<1e-9&&+selectedCSV.at(-1)===12,'Exported chronology or sample depth differs from plot');
          await input('ring-focus',9);await input('ring-count',1);
          assert(left.querySelectorAll('.ring-series-line').length===1&&left.querySelector('.ring-series-line').dataset.tree==='CAM101','Single-tree selection was not retained');
          assert(right.querySelector('.ring-series-line').dataset.tree==='CAM101'&&$('ring-depth').textContent==='1 tree','Single-tree index or sample depth');
          assert($('ring-table').children.length===1&&$('ring-table').children[0].lastChild.textContent===$('ring-chronology-value').textContent,'Single-tree chronology must equal its index');
          $('ring-export').click();const singleCSV=await lastDownload.text();
          const singleRows=singleCSV.trim().split('\\n').map(row=>row.split(','));
          assert(singleRows[0].join(',')==='year,CAM101,chronology,sample_depth','Export selected the wrong tree');
          assert(singleRows.slice(1).every(row=>row[1]===row[2]&&row[3]==='1'),'Single-tree chronology export');
          await input('ring-height',0.75);const smallHeight=left.viewBox.baseVal.height;
          await input('ring-height',2);assert(left.viewBox.baseVal.height>smallHeight*1.8,'Plot height did not enlarge the single-tree view');
          $('ring-export').click();assert(await lastDownload.text()===singleCSV,'Plot height changed exported values');
          await input('ring-count',2);assert(left.querySelector('[data-tree="CAM101"].ring-series-line'),'Selected tree disappeared when adding another tree');
          await input('ring-count',12);await input('ring-focus',0);await input('ring-height',1);
          await mode('temperature');$('temp-export').click();const temperatureCSV=await lastDownload.text();
          await mode('dendro');await input('dendro-length',14);await input('dendro-start',151);await input('dendro-model','31');
          $('dendro-export').click();const dendroCSV=await lastDownload.text();
          return {year,ringCSV,temperatureCSV,dendroCSV};
        })()""")
        for filename,key in [('rings.csv','ringCSV'),('temperature.csv','temperatureCSV'),('dendro.csv','dendroCSV')]:
            (OUT/filename).write_text(report[key])
        screenshot('dendro-desktop.png')
        for mode in ['acf','temperature','rings']:
            navigate('/seasonality/ta-lab/index.html#'+mode)
            screenshot(mode+'-desktop.png')
        evaluate("""(async()=>{
          for(const [id,value] of [['ring-count',1],['ring-focus',9],['ring-height',1.25]]){
            const el=document.getElementById(id);el.value=value;el.dispatchEvent(new Event('input'));
          }
          await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
        })()""")
        screenshot('single-tree-desktop.png')
        print('PASS: period controls, component combinations, warm/cold presets, evolving/fixed daily profiles, pinned comparison, ring trends and exports.')
        call('Emulation.setDeviceMetricsOverride', {'width': 390, 'height': 844, 'deviceScaleFactor': 1, 'mobile': True})
        for mode in ['acf','temperature','dendro','rings']:
            navigate('/seasonality/ta-lab/index.html#'+mode)
            assert evaluate('document.documentElement.scrollWidth<=innerWidth'), 'Mobile overflow: '+mode
            screenshot(mode+'-mobile.png')
        print('PASS: all four modes fit mobile viewports.')
        # Exercise the actual book embed: controls follow the outer page scroll.
        call('Emulation.setDeviceMetricsOverride', {'width': 1300, 'height': 1000, 'deviceScaleFactor': 1, 'mobile': False})
        navigate('/docs/seasonality/ta-dendrometers.html')
        evaluate("document.querySelector('iframe').loading='eager'")
        for _ in range(100):
            if evaluate("!!document.querySelector('iframe').contentWindow.SeasonalityLab"):
                break
            time.sleep(0.1)
        embed = evaluate("""(async()=>{
          const f=document.querySelector('iframe'), d=f.contentDocument, w=f.contentWindow;
          await new Promise(r=>setTimeout(r,300));
          const h=d.documentElement.scrollHeight;
          if(Math.abs(f.clientHeight-h)>10)throw Error('Iframe height does not fit contents: '+f.clientHeight+' / '+h);
          const profile=d.getElementById('dendro-profile');
          window.scrollTo(0,scrollY+f.getBoundingClientRect().top+profile.getBoundingClientRect().top-200);
          await new Promise(r=>setTimeout(r,200));
          const controls=d.querySelector('#dendro-stage .controls'), top=f.getBoundingClientRect().top+controls.getBoundingClientRect().top;
          if(top<0||top>180)throw Error('Embedded controls scrolled out of view: '+top);
          const before=profile.querySelector('path').getAttribute('d');
          const start=d.getElementById('dendro-start');start.value=0;start.dispatchEvent(new w.Event('input'));
          await new Promise(r=>setTimeout(r,100));
          if(before===profile.querySelector('path').getAttribute('d'))throw Error('Embedded window control does not update profile');
          return {height:h,controlsTop:top};
        })()""")
        screenshot('chapter-dendro-desktop.png')
        call('Emulation.setDeviceMetricsOverride', {'width': 390, 'height': 844, 'deviceScaleFactor': 1, 'mobile': True})
        evaluate('new Promise(r=>setTimeout(r,300))')
        assert evaluate('document.documentElement.scrollWidth<=innerWidth'), 'Chapter mobile overflow'
        evaluate("""(async()=>{
          const f=document.querySelector('iframe'),d=f.contentDocument;
          window.scrollTo(0,scrollY+f.getBoundingClientRect().top+d.getElementById('dendro-profile').getBoundingClientRect().top-350);
          await new Promise(r=>setTimeout(r,200));
          const c=d.querySelector('#dendro-stage .controls'),top=f.getBoundingClientRect().top+c.getBoundingClientRect().top;
          const header=document.getElementById('quarto-header');
          if(top<header.offsetHeight||top>180)throw Error('Mobile controls overlap the header or are out of view: '+top);
          if(c.clientHeight>320)throw Error('Mobile controls cover the plot');
        })()""")
        screenshot('chapter-dendro-mobile.png')
        print('PASS: rendered chapter auto-height and sticky controls on desktop and mobile.',embed)
        assert not errors,errors
        ws.close()
    finally:
        process.terminate()
        process.wait(timeout=15)
        server.shutdown()
