(() => {
  "use strict";
  const $=id=>document.getElementById(id), E=SeasonalityLab, D=SeasonalityData;
  const modes=['acf','temperature','dendro','rings'];
  const pages={acf:'ta-finding-periods',temperature:'ta-temperature',dendro:'ta-dendrometers',rings:'ta-tree-rings'};
  const C={raw:'#718392',trend:'#087f79',seasonal:'#8061a2',residual:'#b96819',grid:'#e2e9ec',shade:'#dfefed'};
  const names={T:'Trend',S:'Seasonal component',R:'Residual','S+R':'Seasonal + residual','T+R':'Trend + residual'};
  let mode=modes.includes(location.hash.slice(1))?location.hash.slice(1):'acf',pending=false,pinned=null;
  let acfState,tempState,dendroState,ringState,ringCache={key:'',fits:null};
  const fmt=(x,n=2)=>Number.isFinite(x)?Number(x.toFixed(n)).toString():'—';
  const stamp=(data,i)=>new Date(Date.parse(data.start.replace(' ','T')+'Z')+i*data.minutes*60000).toISOString().slice(0,19);
  const date=(data,i)=>data.minutes===60?stamp(data,i).slice(5,10)+' '+stamp(data,i).slice(11,16):stamp(data,i).slice(0,10);
  function svgNode(tag,attrs={},text){const n=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const[k,v]of Object.entries(attrs))n.setAttribute(k,v);if(text!==undefined)n.textContent=text;return n;}
  function sampled(values){
    if(values.length<=1500)return values.map((v,i)=>[i,v]);
    const out=[],width=Math.ceil(values.length/750);
    for(let a=0;a<values.length;a+=width){let lo=null,hi=null;
      for(let i=a;i<Math.min(a+width,values.length);i++){const v=values[i];if(!Number.isFinite(v))continue;if(lo===null||v<values[lo])lo=i;if(hi===null||v>values[hi])hi=i;}
      if(lo===null){out.push([a,null]);continue;}for(const i of [...new Set([lo,hi])].sort((a,b)=>a-b))out.push([i,values[i]]);
    }return out;
  }
  function chart(id,lines,n,{label=String,unit='',shade=null,marks=[],horizontal=null,fixed=null}={}){
    const svg=$(id),w=Math.max(340,Math.min(940,svg.clientWidth)),h=+svg.getAttribute('viewBox').split(' ')[3];
    svg.setAttribute('viewBox',`0 0 ${w} ${h}`);svg.replaceChildren();
    const all=lines.flatMap(l=>l.values.filter(Number.isFinite));if(!all.length){svg.append(svgNode('text',{x:50,y:50},'No observations in this window.'));return;}
    let lo=Math.min(...all),hi=Math.max(...all);if(horizontal!==null){lo=Math.min(lo,horizontal);hi=Math.max(hi,horizontal);}
    const pad=Math.max((hi-lo)*.1,.0001);lo-=pad;hi+=pad;if(fixed)[lo,hi]=fixed;
    const left=58,right=w-15,top=24,bottom=h-38,x=i=>left+i/Math.max(1,n-1)*(right-left),y=v=>bottom-(v-lo)/(hi-lo)*(bottom-top);
    if(shade)svg.append(svgNode('rect',{x:x(shade[0]),y:top,width:Math.max(1,x(shade[1])-x(shade[0])),height:bottom-top,fill:C.shade}));
    svg.append(svgNode('text',{x:left,y:13},unit));
    for(let j=0;j<4;j++){const v=lo+(hi-lo)*j/3;svg.append(svgNode('line',{x1:left,x2:right,y1:y(v),y2:y(v),stroke:C.grid}));svg.append(svgNode('text',{x:left-8,y:y(v)+4,'text-anchor':'end'},fmt(v,(hi-lo)<.1?3:(hi-lo)<2?2:1)));}
    const ticks=w<550?2:3;for(let j=0;j<=ticks;j++){const i=Math.round((n-1)*j/ticks);svg.append(svgNode('text',{x:x(i),y:h-12,'text-anchor':j===0?'start':j===ticks?'end':'middle'},label(i)));}
    if(horizontal!==null)svg.append(svgNode('line',{x1:left,x2:right,y1:y(horizontal),y2:y(horizontal),stroke:C.raw,'stroke-dasharray':'4 4'}));
    for(const mark of marks)if(mark>=0&&mark<n)svg.append(svgNode('line',{x1:x(mark),x2:x(mark),y1:top,y2:bottom,stroke:C.trend,'stroke-dasharray':'4 5',opacity:.65}));
    for(const l of lines){let p='',connected=false;for(const[i,v]of sampled(l.values)){if(!Number.isFinite(v)){connected=false;continue;}p+=`${connected?'L':'M'}${x(i).toFixed(2)},${y(v).toFixed(2)} `;connected=true;}
      svg.append(svgNode('path',{d:p,fill:'none',stroke:l.color||C.raw,'stroke-width':l.width||1.8,opacity:l.opacity??1,...(l.dashed?{'stroke-dasharray':'5 4'}:{})}));}
  }
  function rows(id,data){const body=$(id);body.replaceChildren();for(const values of data){const tr=document.createElement('tr');for(const v of values){const td=document.createElement('td');td.textContent=v;tr.append(td);}body.append(tr);}}
  function download(name,head,rows){const b=new Blob([[head,...rows].map(r=>r.join(',')).join('\n')+'\n'],{type:'text/csv'}),u=URL.createObjectURL(b),a=document.createElement('a');a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);}
  const number=id=>+$(id).value;
  function renderACF(){
    const kind=$('acf-data').value;
    $('signal-controls').hidden=kind!=='synthetic';
    const signal=kind==='hourly'?{values:D.hourly.values}:E.synthetic({period:number('period'),amplitude:number('amplitude'),second:number('second'),slope:number('slope'),noise:number('noise'),ar:kind==='ar'});
    const data=kind==='hourly'?D.hourly:null;
    for(const[id,unit]of [['period','hours'],['amplitude',''],['second',''],['slope',''],['noise','']])$(id+'-value').textContent=`${$(id).value} ${unit}`;
    $('acf-length').max=signal.values.length;const n=number('acf-length');$('acf-start').max=signal.values.length-n;const start=number('acf-start');
    $('acf-length-value').textContent=n+' hours';$('acf-start-value').textContent=data?date(data,start):'Hour '+start;
    const observed=signal.values.slice(start,start+n),input=$('acf-detrend').checked?E.linearDetrend(observed):observed;
    const correlations=E.acf(input,Math.min(336,Math.floor(n/3)));$('lag').max=Math.max(1,correlations.length-1);const lag=number('lag');
    $('lag-value').textContent=lag+' hours';$('acf-title').textContent={synthetic:'Observed = trend + seasonal cycles + noise',hourly:'July temperature · hourly',ar:'An oscillating AR(2), without a fixed seasonal component'}[kind];
    chart('acf-series',[{values:observed,color:C.raw}],n,{label:i=>data?date(data,start+i):String(start+i),unit:data?'°C':'value'});
    $('acf-series-note').textContent='The ACF uses this selected window'+($('acf-detrend').checked?', after removing a fitted straight-line trend.':', without detrending.');
    $('acf-parts-card').hidden=kind!=='synthetic'||!$('signal-parts').checked;
    if(!$('acf-parts-card').hidden)chart('acf-parts',[['trend',C.trend],['seasonal',C.seasonal],['residual',C.residual]].map(([k,color])=>({values:signal[k].slice(start,start+n),color})),n,{label:i=>String(start+i),unit:'value'});
    chart('acf-chart',[{values:correlations,color:C.trend}],correlations.length,{unit:'correlation',fixed:[-1.05,1.05],horizontal:0,marks:Array.from({length:Math.floor((correlations.length-1)/lag)},(_,i)=>(i+1)*lag)});
    $('lag-correlation').textContent=fmt(correlations[lag],3);
    const peaks=E.peaks(correlations);$('acf-peaks').textContent=peaks.length?peaks.slice(0,5).join(', ')+' h':'None above 0.15';
    $('acf-note').textContent=kind==='ar'?'This process can have a wavy ACF even though no fixed daily cycle was added. Compare this with the temperature record.':`Dashed guides: ${lag}, ${2*lag}, ${3*lag}… hours. Move the lag until the guides line up with repeated positive peaks.`;
    if(!correlations.length)$('acf-note').textContent='A constant series has no defined ACF. Add some variation.';
    acfState={data,start,observed,input};
  }
  function tempCompute(){const data=D.temperature,model=data.models[$('temp-smoothing').value],parts=E.components(data.values,model);return{data,model,parts,events:E.spells(parts.R,number('temp-threshold'),number('temp-duration'))};}
  function renderTemperature(){
    const {data,model,parts,events}=tempCompute(),n=number('temp-length');$('temp-start').max=data.values.length-n;const start=number('temp-start'),end=start+n,key=$('temp-component').value;
    $('temp-length-value').textContent=n+' days';$('temp-start-value').textContent=date(data,start);$('temp-threshold-value').textContent='± '+number('temp-threshold')+' °C';$('temp-duration-value').textContent=number('temp-duration')+' days';
    const label=i=>date(data,start+i),baseline=E.combine(parts,'T+S');
    chart('temp-overview',[{values:data.values}],data.values.length,{label:i=>date(data,i),unit:'°C',shade:[start,end-1]});
    chart('temp-observed',[{values:data.values.slice(start,end)},{values:baseline.slice(start,end),color:C.trend}],n,{label,unit:'°C'});
    $('temp-component-title').textContent=names[key]+' · '+key;
    const selected=E.combine(parts,key),lines=[{values:selected.slice(start,end),color:key==='T'?C.trend:key==='S'?C.seasonal:C.residual}];
    if(key==='R')for(const sign of [-1,1])lines.push({values:Array(n).fill(sign*number('temp-threshold')),color:C.raw,dashed:true});
    chart('temp-component-chart',lines,n,{label,unit:'°C',horizontal:key.includes('T')?null:0});
    $('temp-question').textContent={R:'What is unusually warm or cold for this fitted trend and time of year?','S+R':'What remains after removing the slow trend? The annual cycle is still here.','T+R':'What remains after removing the annual cycle? The slow trend is still here.',T:'How does the slow baseline change?',S:'What annual pattern does this model expect?'}[key];
    const visible=events.filter(e=>e.end>=start&&e.start<end);
    $('temp-events-note').textContent=`${visible.length} candidate spells overlap this view. Dates below use the full event, even if it crosses the view boundary.`;
    rows('temp-events',visible.slice(0,10).map(e=>[e.sign>0?'Warm':'Cold',date(data,e.start)+' → '+date(data,e.end),e.end-e.start+1,fmt(e.peak)+' °C']));
    tempState={data,model,parts,start,end};
  }
  function monthlyProfiles(values){const out=[];for(let year=2018;year<=2019;year++)for(let month=0;month<12;month++){
    const origin=Date.UTC(2018,0,1),start=(Date.UTC(year,month,1)-origin)/3600000,end=(Date.UTC(year,month+1,1)-origin)/3600000;
    out.push({label:`${year}-${String(month+1).padStart(2,'0')}`,start,end,values:E.profile(values,24,start,end)});
  }return out;}
  function heatmap(profiles,start,end){
    const svg=$('dendro-heatmap'),w=Math.max(340,Math.min(940,svg.clientWidth)),h=530,left=73,right=w-15,top=37,cellW=(right-left)/24,cellH=17;
    svg.setAttribute('viewBox',`0 0 ${w} ${h}`);svg.replaceChildren();const max=Math.max(...profiles.flatMap(p=>p.values.map(v=>Math.abs(v))))||1;
    const color=v=>{const u=Math.min(1,Math.abs(v)/max),base=v>=0?[185,104,25]:[37,113,161];return `rgb(${base.map(x=>Math.round(247+(x-247)*u)).join(',')})`;};
    svg.append(svgNode('text',{x:left,y:15},'Seasonal diameter deviation · µm'));
    for(let hour=0;hour<24;hour+=4)svg.append(svgNode('text',{x:left+(hour+.5)*cellW,y:30,'text-anchor':'middle'},hour));
    profiles.forEach((p,row)=>{svg.append(svgNode('text',{x:left-8,y:top+row*cellH+12,'text-anchor':'end'},p.label));p.values.forEach((v,hour)=>{
      const cell=svgNode('rect',{x:left+hour*cellW,y:top+row*cellH,width:cellW+.2,height:cellH,fill:color(v),class:'heat-cell',tabindex:hour===0?'0':'-1',role:'button','aria-label':`Explore ${p.label}`});
      cell.append(svgNode('title',{},`${p.label}, ${hour}:00 · ${fmt(v*1000,1)} µm`));
      const select=()=>{$('dendro-start').value=p.start/24;schedule();};cell.addEventListener('click',select);cell.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();select();}});svg.append(cell);
    });if(p.start<end&&p.end>start)svg.append(svgNode('rect',{x:left,y:top+row*cellH,width:right-left,height:cellH,fill:'none',stroke:C.trend,'stroke-width':1.5,'pointer-events':'none'}));});
    const defs=svgNode('defs'),gradient=svgNode('linearGradient',{id:'dendro-color-scale','color-interpolation':'sRGB'});
    for(const [offset,value] of [['0%',-max],['50%',0],['100%',max]])gradient.append(svgNode('stop',{offset,'stop-color':color(value)}));
    defs.append(gradient);svg.append(defs);
    svg.append(svgNode('rect',{class:'heat-colorbar',x:left,y:463,width:right-left,height:14,fill:'url(#dendro-color-scale)',stroke:C.grid}));
    for(const fraction of (w<550?[-1,0,1]:[-1,-.5,0,.5,1])){
      const x=left+(fraction+1)/2*(right-left),value=fraction*max*1000;
      svg.append(svgNode('line',{x1:x,x2:x,y1:477,y2:482,stroke:C.raw}));
      svg.append(svgNode('text',{class:'heat-colorbar-tick',x,y:497,'text-anchor':fraction===-1?'start':fraction===1?'end':'middle'},(value>0?'+':'')+fmt(value,1)));
    }
    svg.append(svgNode('text',{x:(left+right)/2,y:520,'text-anchor':'middle'},'Seasonal deviation (µm)'));
    svg.setAttribute('aria-label',`Monthly seasonal profiles by hour. Color scale: ${fmt(-max*1000,1)} to +${fmt(max*1000,1)} micrometres; blue is negative, white is zero, orange is positive.`);
  }
  function renderDendro(){
    const data=D.dendro,key=$('dendro-model').value,model=data.models[key],parts=E.components(data.values,model),days=number('dendro-length');
    $('dendro-start').max=data.values.length/24-days;const start=number('dendro-start')*24,end=start+days*24,n=end-start,component=$('dendro-component').value;
    $('dendro-length-value').textContent=days+' days';$('dendro-start-value').textContent=stamp(data,start).slice(0,10);
    const label=i=>date(data,start+i);
    chart('dendro-overview',[{values:data.values}],data.values.length,{label:i=>stamp(data,i).slice(0,10),unit:'mm from initial reading',shade:[start,end-1]});
    chart('dendro-observed',[{values:data.values.slice(start,end)},{values:parts.T.slice(start,end),color:C.trend}],n,{label,unit:'mm'});
    $('dendro-component-title').textContent=names[component]+' · '+component;
    const scale=component.includes('T')?1:1000;
    chart('dendro-component-chart',[{values:E.combine(parts,component).slice(start,end).map(v=>v===null?null:v*scale),color:component==='T'?C.trend:component==='R'?C.residual:C.seasonal}],n,{label,unit:scale===1?'mm':'µm',horizontal:scale===1?null:0});
    const profile=E.profile(parts.S,24,start,end).map(v=>v*1000),summary=E.phaseSummary(profile),lines=[{values:profile,color:C.seasonal}];
    if(pinned)lines.push({values:pinned.values,color:C.raw,dashed:true});
    chart('dendro-profile',lines,24,{label:i=>i+':00',unit:'seasonal deviation · µm',horizontal:0});
    $('dendro-max').textContent=summary?summary.max+':00':'—';$('dendro-min').textContent=summary?summary.min+':00':'—';$('dendro-amplitude').textContent=summary?fmt(summary.amplitude,1)+' µm':'—';
    $('pinned-legend').hidden=!pinned;$('clear-profile').disabled=!pinned;$('pinned-note').textContent=pinned?'Kept: '+pinned.label:'Keep this profile, then choose another month to compare.';
    heatmap(monthlyProfiles(parts.S),start,end);
    dendroState={data,model,parts,start,end,profile,label:stamp(data,start).slice(0,10)+' → '+stamp(data,end-1).slice(0,10)+' · '+$('dendro-model').selectedOptions[0].textContent};
  }
  function getRings(){const width=number('ring-width');if(ringCache.key!==String(width))ringCache={key:String(width),fits:D.rings.series.map(s=>E.ringIndices(s.values,width))};return ringCache.fits;}
  function ringSpaghetti(id,series,fits,{start,end,first,year,focus,indices=false,chronology}){
    const svg=$(id),w=Math.max(280,svg.clientWidth),rowHeight=(series.length===1?220:62)*number('ring-height');
    const amplitude=rowHeight*24/62*number('ring-gain'),overhang=Math.max(0,amplitude-rowHeight/2);
    const top=60+overhang,bottom=54+overhang,left=78,right=w-16;
    const h=top+(series.length+1)*rowHeight+bottom,n=end-start;
    const rows=series.map((s,i)=>{
      const values=(indices?fits[i].index:s.values).slice(start,end);
      return {id:s.id,values,center:indices?1:E.mean(values),trend:fits[i].trend.slice(start,end)};
    });
    // One scale per panel, never one scale per tree. Centering is display-only.
    const peak=Math.max(.001,...rows.flatMap(r=>r.values.filter(Number.isFinite).map(v=>Math.abs(v-r.center))));
    const scale=amplitude/peak;
    const x=i=>left+i/Math.max(1,n-1)*(right-left),base=i=>top+(i+.5)*rowHeight;
    svg.setAttribute('viewBox',`0 0 ${w} ${h}`);svg.replaceChildren();
    svg.dataset.scale=scale;svg.dataset.reference=indices?'1':'window mean';
    const magnitude=10**Math.floor(Math.log10(18/scale));
    const unit=[1,2,5].map(v=>v*magnitude).filter(v=>v*scale<=18).at(-1);
    const bar=unit*scale;
    svg.append(svgNode('path',{d:`M${left},${36-bar}h6 M${left+3},${36-bar}V36 M${left},36h6`,stroke:C.raw,fill:'none'}));
    svg.append(svgNode('text',{x:left+13,y:30},`${Number(unit.toPrecision(2))} ${indices?'index units':'mm'}`));
    const ticks=w<360?2:3;
    for(let j=0;j<=ticks;j++){
      const i=Math.round((n-1)*j/ticks);
      svg.append(svgNode('line',{x1:x(i),x2:x(i),y1:top,y2:h-bottom,stroke:C.grid}));
      svg.append(svgNode('text',{x:x(i),y:h-12,'text-anchor':j===0?'start':j===ticks?'end':'middle'},first+i));
    }
    svg.append(svgNode('rect',{x:0,y:base(focus)-rowHeight/2,width:w,height:rowHeight,fill:C.shade,opacity:.65}));
    svg.append(svgNode('line',{class:'ring-year-guide',x1:x(year-first),x2:x(year-first),y1:top,y2:h-bottom,stroke:C.residual,'stroke-dasharray':'4 4'}));
    rows.forEach((row,i)=>{
      const y=v=>base(i)-(v-row.center)*scale;
      svg.append(svgNode('line',{class:'ring-row-baseline','data-tree':row.id,x1:left,x2:right,y1:base(i),y2:base(i),stroke:C.raw,opacity:.35}));
      const label=svgNode('text',{class:'ring-row-label','data-tree':row.id,x:4,y:base(i)-3,fill:i===focus?C.seasonal:C.raw},row.id);
      label.style.fontWeight=i===focus?'700':'500';svg.append(label);
      svg.append(svgNode('text',{class:'ring-row-reference',x:4,y:base(i)+12},indices?'1':`${fmt(row.center,2)} mm`));
      function line(values,trend=false){
        let d='',connected=false;
        values.forEach((v,j)=>{if(!Number.isFinite(v)){connected=false;return;}d+=`${connected?'L':'M'}${x(j).toFixed(2)},${y(v).toFixed(2)} `;connected=true;});
        const path=svgNode('path',{class:trend?'ring-trend-line':'ring-series-line','data-tree':row.id,d,fill:'none',stroke:trend?C.trend:i===focus?C.seasonal:C.raw,'stroke-width':trend?1.5:i===focus?1.8:1.2,...(trend?{'stroke-dasharray':'4 3'}:{})});
        path.append(svgNode('title',{},row.id+(trend?' · fitted trend':indices?' · width / trend':' · ring width')));svg.append(path);
      }
      line(row.values);
      if(!indices&&$('ring-trend').checked)line(row.trend,true);
      const selected=row.values[year-first];
      if(Number.isFinite(selected))svg.append(svgNode('circle',{class:'ring-year-point',cx:x(year-first),cy:y(selected),r:2.4,fill:C.residual}));
    });
    const baseline=base(series.length);
    if(indices){
      const y=v=>baseline-(v-1)*scale;
      svg.append(svgNode('rect',{x:0,y:baseline-rowHeight/2,width:w,height:rowHeight,fill:C.shade}));
      svg.append(svgNode('line',{class:'ring-chronology-baseline',x1:left,x2:right,y1:baseline,y2:baseline,stroke:C.trend,opacity:.4}));
      svg.append(svgNode('line',{x1:x(year-first),x2:x(year-first),y1:baseline-rowHeight/2,y2:baseline+rowHeight/2,stroke:C.residual,'stroke-dasharray':'4 4'}));
      svg.append(svgNode('text',{x:4,y:baseline-4,'font-weight':700},'Chronology'));
      svg.append(svgNode('text',{class:'ring-row-reference',x:4,y:baseline+11},'robust mean'));
      let d='',connected=false;
      chronology.values.slice(start,end).forEach((v,i)=>{if(!Number.isFinite(v)){connected=false;return;}d+=`${connected?'L':'M'}${x(i).toFixed(2)},${y(v).toFixed(2)} `;connected=true;});
      svg.append(svgNode('path',{class:'ring-chronology-line',d,fill:'none',stroke:C.trend,'stroke-width':2.5}));
      const value=chronology.values[start+year-first];
      if(Number.isFinite(value))svg.append(svgNode('circle',{class:'ring-chronology-point',cx:x(year-first),cy:y(value),r:3.5,fill:C.residual}));
    }else{
      svg.append(svgNode('text',{x:left,y:baseline-4},series.length===1?'One tree →':'Across trees →'));
      svg.append(svgNode('text',{x:left,y:baseline+13},series.length===1?'Chronology = detrended series':'Robust mean at each year'));
    }
  }
  function renderRings(){
    const data=D.rings,count=number('ring-count'),allFits=getRings(),length=number('ring-length'),last=data.years.at(-1);
    if(!$('ring-focus').options.length)data.series.forEach((s,i)=>{const opt=document.createElement('option');opt.value=i;opt.textContent=s.id;$('ring-focus').append(opt);});
    const selected=number('ring-focus'),shown=Array.from({length:count},(_,i)=>i);
    // Keep the chosen tree visible when reducing the count, including to one.
    if(!shown.includes(selected))shown[count-1]=selected;
    const series=shown.map(i=>data.series[i]),fits=shown.map(i=>allFits[i]),focus=shown.indexOf(selected);
    $('ring-start').max=last-length+1;const first=number('ring-start'),start=first-data.years[0],end=start+length;
    $('ring-year').min=first;$('ring-year').max=first+length-1;const year=number('ring-year'),at=year-data.years[0];
    $('ring-focus-label').textContent=count===1?'Tree to show':'Highlight one tree';
    $('ring-count-value').textContent=count;$('ring-width-value').textContent=number('ring-width')+' years';$('ring-length-value').textContent=length+' years';$('ring-start-value').textContent=first;$('ring-year-value').textContent=year;
    $('ring-gain-value').textContent=fmt(number('ring-gain'))+'×';
    $('ring-height-value').textContent=fmt(number('ring-height'))+'×';
    $('ring-event').textContent=count===1?'Find a narrow year':'Find a shared narrow year';
    $('ring-chronology-note').textContent=count===1?'With one tree, the chronology equals that tree’s detrended series.':'The bold bottom row is the chronology: a robust mean across the displayed trees at each year. Unusually high or low individual indices receive less weight.';
    const chronology=E.ringChronology(fits.map(f=>f.index));
    const view={start,end,first,year,focus,chronology};
    ringSpaghetti('ring-raw',series,fits,view);
    ringSpaghetti('ring-index',series,fits,{...view,indices:true});
    const valid=fits.map(f=>f.index[at]).filter(Number.isFinite);$('ring-selected-year').textContent=year;$('ring-shared').textContent=valid.filter(v=>v<.7).length+' / '+valid.length;
    $('ring-chronology-value').textContent=fmt(chronology.values[at],3);
    $('ring-depth').textContent=chronology.depth[at]+(chronology.depth[at]===1?' tree':' trees');
    rows('ring-table',series.map((s,i)=>[s.id,fmt(s.values[at],3),fmt(fits[i].trend[at],3),fmt(fits[i].index[at],3)]));
    ringState={data,series,fits,start,end,chronology};
  }
  function exportComponents(state,prefix){const{data,parts,start,end}=state;download(prefix+'-components.csv',['time','observed','trend','seasonal','residual'],Array.from({length:end-start},(_,j)=>{const i=start+j;return[stamp(data,i),data.values[i],parts.T[i],parts.S[i],parts.R[i]];}));}
  // Follow the parent viewport when this lab lives in an auto-height chapter iframe.
  let host=window,frame=null,positionPending=false;
  try{if(window.frameElement&&parent.location.origin===location.origin){host=parent;frame=window.frameElement;}}catch(_){}
  function position(){
    // Reserve the mobile header's height even during its slide-in transition.
    const headers=[...host.document.querySelectorAll('#quarto-header, .quarto-secondary-nav')];
    const inset=Math.max(12,...headers.filter(el=>el.offsetHeight>0).map(el=>el.offsetHeight+8));
    document.documentElement.style.setProperty('--controls-top',`${frame?Math.max(12,inset-frame.getBoundingClientRect().top):inset}px`);
    document.documentElement.style.setProperty('--host-height',`${host.innerHeight-inset}px`);
  }
  function height(){position();if(parent!==window)parent.postMessage({type:'seasonality-ta-height',height:Math.ceil(document.querySelector('main').getBoundingClientRect().height)+4},location.origin);}
  function schedulePosition(){if(positionPending)return;positionPending=true;requestAnimationFrame(()=>{positionPending=false;position();});}
  host.addEventListener('scroll',schedulePosition,{passive:true});host.addEventListener('resize',schedulePosition);
  function render(){pending=false;({acf:renderACF,temperature:renderTemperature,dendro:renderDendro,rings:renderRings})[mode]();height();}
  function schedule(){if(!pending){pending=true;requestAnimationFrame(render);}}
  function setMode(next){mode=next;for(const name of modes){$(name+'-stage').hidden=name!==mode;$(name+'-mode').setAttribute('aria-pressed',name===mode);}$('lesson-link').href='../'+pages[mode]+'.html';schedule();}
  modes.forEach(name=>$(name+'-mode').addEventListener('click',()=>{history.replaceState(null,'','#'+name);setMode(name);}));
  window.addEventListener('hashchange',()=>setMode(modes.includes(location.hash.slice(1))?location.hash.slice(1):'acf'));
  document.querySelectorAll('input,select').forEach(el=>el.addEventListener('input',schedule));
  $('acf-data').addEventListener('change',()=>{$('acf-start').value=0;$('acf-length').value=$('acf-data').value==='hourly'?336:720;schedule();});
  document.querySelectorAll('[data-temperature-preset]').forEach(b=>b.addEventListener('click',()=>{
    if(b.dataset.temperaturePreset==='whole'){$('temp-length').value=1096;$('temp-start').value=0;}else{
      const sign=b.dataset.temperaturePreset==='warm'?1:-1,events=tempCompute().events.filter(e=>e.sign===sign).sort((a,b)=>Math.abs(b.peak)-Math.abs(a.peak));
      if(events.length){$('temp-length').value=90;$('temp-start').max=D.temperature.values.length-90;$('temp-start').value=Math.max(0,Math.min(D.temperature.values.length-90,events[0].start-25));$('temp-component').value='R';}
    }schedule();
  }));
  document.querySelectorAll('[data-dendro-preset]').forEach(b=>b.addEventListener('click',()=>{$('dendro-start').value=b.dataset.dendroPreset;schedule();}));
  $('pin-profile').addEventListener('click',()=>{renderDendro();pinned={values:[...dendroState.profile],label:dendroState.label};schedule();});
  $('clear-profile').addEventListener('click',()=>{pinned=null;schedule();});
  $('ring-event').addEventListener('click',()=>{renderRings();const s=ringState,best=E.commonYear(s.fits.map(f=>f.index),s.start,s.end);if(best)$('ring-year').value=s.data.years[best.i];schedule();});
  $('acf-export').addEventListener('click',()=>{renderACF();const s=acfState;download('acf-window.csv',['time','observed','acf_input'],s.observed.map((v,i)=>[s.data?stamp(s.data,s.start+i):s.start+i,v,s.input[i]]));});
  $('temp-export').addEventListener('click',()=>{renderTemperature();exportComponents(tempState,'temperature');});
  $('dendro-export').addEventListener('click',()=>{renderDendro();exportComponents(dendroState,'dendrometer');});
  $('ring-export').addEventListener('click',()=>{renderRings();const s=ringState;download('ring-width-indices.csv',['year',...s.series.map(x=>x.id),'chronology','sample_depth'],s.data.years.slice(s.start,s.end).map((y,j)=>[y,...s.fits.map(f=>f.index[s.start+j]??''),s.chronology.values[s.start+j]??'',s.chronology.depth[s.start+j]]));});
  new ResizeObserver(height).observe(document.querySelector('main'));window.addEventListener('resize',schedule);setMode(mode);
})();
