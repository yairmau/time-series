import '../ta-lab/engine.js';
import '../ta-lab/data.js';
const E=globalThis.SeasonalityLab,D=globalThis.SeasonalityData;
function assert(x,m){if(!x)throw Error(m);}
function close(x,y,t=1e-9){assert(Math.abs(x-y)<t,`${x} != ${y}`);}
const signal=E.synthetic({n:720,period:24,noise:0,slope:0});
const autocorrelation=E.acf(signal.values,96);
assert(E.peaks(autocorrelation)[0]===24,'The first synthetic seasonal ACF peak should be at 24');
assert(E.acf(Array(100).fill(1),24).length===0,'Constant ACF is undefined');
const line=E.linearDetrend([3,5,7,9]);line.forEach(v=>close(v,0));
assert(JSON.stringify(E.spells([0,4,5,4,-5,-5,-6,0,4],3,3))===JSON.stringify([{start:1,end:3,sign:1,peak:5},{start:4,end:6,sign:-1,peak:-6}]),'Spell boundaries or sign changes');
const periodic=Array.from({length:240},(_,i)=>Math.cos(2*Math.PI*(i-5)/24));
const profile=E.profile(periodic,24,24,192),summary=E.phaseSummary(profile);
assert(summary.max===5&&summary.min===17,'Daily phase alignment');
close(summary.amplitude,2);
const raw=[null,2,4,0,5,null,7,8,6,2],index=E.ringIndices(raw,5);
assert(index.index[0]===null&&index.index[5]===null,'Missing years were not retained');close(index.index[3],0);
const doubled=E.ringIndices(raw.map(v=>v===null?null:v*2),5);
index.index.forEach((v,i)=>{if(v!==null)close(v,doubled.index[i]);});
const simple=E.rollingTrend([1,2,9,4,5],3);
[1.5,4,5,6,4.5].forEach((v,i)=>close(simple[i],v));
assert(E.rollingTrend([1,null,3],3)[1]===null,'Rolling mean filled a missing year');
assert(E.biweightMean([])===null,'Empty robust mean');
close(E.biweightMean([0]),0);close(E.biweightMean([1,1,1,100]),1);
const outliers=[.9,1,1.1,20];
assert(Math.abs(E.biweightMean(outliers)-1)<.02,'Robust mean is dominated by an outlier');
close(E.biweightMean(outliers.map(v=>v*2+3)),E.biweightMean(outliers)*2+3);
const coverage=E.ringChronology([[null,0,1],[null,2,null],[null,null,3]]);
assert(JSON.stringify(coverage)===JSON.stringify({values:[null,1,2],depth:[0,2,2]}),'Chronology year alignment, zero or missing treatment');
const acfCases=[{values:signal.values,maxlag:96}, {values:E.linearDetrend(D.hourly.values.slice(0,336)),maxlag:112}, {values:E.synthetic({ar:true}).values,maxlag:240}].map(c=>({...c,acf:E.acf(c.values,c.maxlag)}));
const ringCases=[21,101,301].flatMap(width=>D.rings.series.slice(0,3).map(s=>({width,values:s.values,...E.ringIndices(s.values,width)})));
const robustCases=[[],[0],[1,1,1,100],outliers,[null,.8,.9,1,1.2,30],[.7,.75,1.2,1.3,1.7,1.8]].map(values=>({values,mean:E.biweightMean(values)}));
const chronologyCases=[3,8,12].map(count=>{
 const indices=D.rings.series.slice(0,count).map(s=>E.ringIndices(s.values,101).index);
 return {indices,...E.ringChronology(indices)};
});
for(const data of [D.temperature,D.dendro])for(const model of Object.values(data.models)){
 const parts=E.components(data.values,model);E.combine(parts,'T+S+R').forEach((v,i)=>close(v,data.values[i]));
}
console.log(JSON.stringify({acfCases,ringCases,robustCases,chronologyCases}));
