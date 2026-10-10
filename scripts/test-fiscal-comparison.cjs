const fs=require('fs'),vm=require('vm'),ts=require('typescript'),assert=require('node:assert/strict');
function load(file,mocks){const module={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module,exports:module.exports,require:n=>{if(n in mocks)return mocks[n];throw Error(n)},console});return module.exports;}
const salary=(year,amount)=>({year,month:10,storeName:'テスト',baseSalary:amount,positionAllowance:0,overtimePay:0,commuteTaxable:0,commuteNontax:0,healthInsuranceCo:0,careInsuranceCo:0,pensionCo:0,childContributionCo:0,pensionFundCo:0,employmentInsuranceCo:0,workersCompCo:0,generalContributionCo:0,ratio:100});
const prisma={plActual:{findMany:async()=>[2024,2025,2026].map(year=>({year,month:10,category:'人件費',storeName:'テスト',amount:year===2025?100:50}))},payrollData:{findMany:async()=>[salary(2025,999),salary(2026,120),salary(2027,150)]},expenseData:{findMany:async()=>[]}};
const {loadComparisonSource}=load('src/lib/pl-comparison-source.ts',{'@/lib/prisma':{prisma},'@/lib/manual-expense-split':{expenseRowSharesByCategory:()=>({})}});
(async()=>{
 const ten=await loadComparisonSource(2027,[{y:2026,m:10}],'テスト');assert.equal(ten.amount('人件費',2026,10),120);assert.equal(ten.amount('人件費',2025,10),100);assert.equal(ten.coverage('人件費',2025,10),1);
 const nine=await loadComparisonSource(2026,[{y:2025,m:10}],'テスト');assert.equal(nine.amount('人件費',2025,10),100);assert.equal(nine.amount('人件費',2024,10),50);
 const eleven=await loadComparisonSource(2028,[{y:2027,m:10}],'テスト');assert.equal(eleven.amount('人件費',2027,10),150);assert.equal(eleven.amount('人件費',2026,10),120);
 let currentCoverage=0,prevCoverage=1,prevAmount=100;
 const source={expectedStores:1,sourceLabel:'test',amount:(c,y,m)=>m===10?(y===2025?prevAmount:120):0,coverage:(c,y,m)=>m===10?(y===2025?prevCoverage:currentCoverage):0};
 const {GET}=load('src/app/api/dashboard/pl-comparison/route.ts',{'@/lib/log':{logError:()=>{}},'next/server':{NextResponse:{json:x=>x}},'@/lib/auth':{requireSession:async()=>({session:{}}),getEffectiveStoreFilter:()=> 'テスト'},'@/lib/constants':{HQ_STORE:'本部'},'@/lib/hidden-stores':{getHiddenStores:async()=>[]},'@/lib/pl-csv':{PL_CATEGORIES:['人件費']},'@/lib/pl-comparison-source':{loadComparisonSource:async()=>source}});
 const req={nextUrl:new URL('https://test.local/?fiscalYear=2027')};
 let r=await GET(req);assert.equal(r.hasData,true);assert.equal(r.categories[0].monthly[0].prev,100);assert.equal(r.categories[0].monthly[0].yoy,null);assert.equal(r.categories[0].totalPeriodLabel,null);
 currentCoverage=1;r=await GET(req);assert.equal(r.categories[0].monthly[0].yoy,1.2);assert.equal(r.categories[0].prevTotal,100);
 prevCoverage=0;r=await GET(req);assert.equal(r.categories[0].monthly[0].yoy,null);assert.equal(r.categories[0].totalPeriodLabel,null);
 currentCoverage=0;r=await GET(req);assert.equal(r.hasData,false);
 currentCoverage=1;prevCoverage=1;prevAmount=0;r=await GET(req);assert.equal(r.hasData,true);assert.equal(r.categories[0].monthly[0].prevStatus,'complete');assert.equal(r.categories[0].monthly[0].yoy,null);
 source.expectedStores=2;r=await GET(req);assert.equal(r.categories[0].monthly[0].status,'partial');assert.equal(r.categories[0].totalPeriodLabel,null);
 console.log('PASS: FY9/10/11 sources, previous-only visibility, missing/zero/partial coverage and matched-period totals.');
})().catch(e=>{console.error(e);process.exitCode=1});
