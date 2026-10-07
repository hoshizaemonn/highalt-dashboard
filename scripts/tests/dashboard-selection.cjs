const fs=require('fs'),vm=require('vm'),assert=require('assert/strict'),ts=require(process.cwd()+'/node_modules/typescript');
function load(path){const m={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{module:m,exports:m.exports,Intl,Date,require:(p)=>load('src/lib/'+p.replace('./','')+'.ts')});return m.exports}
const {currentDashboardPeriod:c,restoreDashboardSelection:r}=load('src/lib/dashboard-selection.ts');
for(const [iso,y,p] of [['2026-09-30T14:59:59Z',2026,'9'],['2026-09-30T15:00:00Z',2027,'10'],['2026-12-31T15:00:00Z',2027,'1'],['2027-09-30T15:00:00Z',2028,'10']]){assert.equal(c(new Date(iso)).year,y);assert.equal(c(new Date(iso)).period,p)}
const raw=JSON.stringify({userId:1,year:2026,period:'9',store:'巣鴨'});
assert.equal(r(raw,1,null).store,'巣鴨');assert.equal(r(raw,2,null),null);assert.equal(r(raw,1,['船橋']).store,'船橋');assert.equal(r('broken',1,null),null);assert.equal(r(raw.replace('"9"','"13"'),1,null),null);
console.log('PASS: JST fiscal boundary, new year, next fiscal year, saved selection, user isolation, store permissions, corrupt values');
