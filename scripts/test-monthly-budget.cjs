const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('node:assert/strict');
const ts=require('typescript');const root=path.resolve(__dirname,'..');
const cache={};
function load(file){
 file=path.resolve(file);if(cache[file])return cache[file];
 const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
 const mod={exports:{}};const req=n=>n.startsWith('@/')?load(path.join(root,'src',n.slice(2)+'.ts')):n.startsWith('.')?load(path.resolve(path.dirname(file),n+'.ts')):require(n);
 vm.runInNewContext(code,{exports:mod.exports,module:mod,require:req,console});return cache[file]=mod.exports;
}
const {monthlyBudgetTotals:totals,budgetComparison:compare}=load(path.join(root,'src/lib/monthly-budget.ts'));
const data={'月会費収入':3000000,'サービス収入':100000,'正社員・契約社員給与':800000,'通勤手当':10000,'賃借料':400000,'広告宣伝費':100000,'体験者数':30,'新規入会数':10,'休会数':12,'退会率':4,'客単価':15000,'有効在籍数':200,'会費売上':3000000};
const t=totals(data);assert.equal(t.revenue,3100000);assert.equal(t.labor,810000);assert.equal(t.expense,500000);assert.equal(t.profit,1790000);
assert.equal(totals({退会率:4,休会数:10}).expense,null);assert.equal(totals({月会費収入:0}).revenue,0);assert.equal(totals({}).profit,null);
assert.equal(totals({会費売上:100,物販売上:50}).revenue,150);
assert.equal(compare(0,100).ratio,null);assert.equal(compare(-100,100).ratio,null);assert.equal(compare(200,100).ratio,50);assert.equal(compare(null,100).difference,null);
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const Component=load(path.join(root,'src/app/(dashboard)/dashboard/components/MonthlyBudgetSection.tsx')).default;
const props={budget:data,revenue:2900000,labor:810000,expense:530000,profit:1560000,expenseByCategory:{賃借料:400000,広告宣伝費:130000},member:null,year:2026,month:9};
const html=renderToStaticMarkup(React.createElement(Component,props));assert(html.includes('3,100,000円'));assert(html.includes('2,900,000円'));assert(html.includes('93.5%'));assert(html.includes('30人'));assert(!html.includes('正社員・契約社員給与'));
const empty=renderToStaticMarkup(React.createElement(Component,{...props,budget:{},month:10,year:2025}));assert(empty.includes('2025年10月'));assert(empty.includes('未登録'));assert(empty.includes('未設定'));
if(process.env.BUDGET_FIXTURE){const rows=JSON.parse(fs.readFileSync(process.env.BUDGET_FIXTURE,'utf8'));assert.equal(rows.length,84);for(const r of rows){const v=totals(r.budget);for(const k of ['revenue','labor','expense','profit']) assert(Number.isFinite(v[k]),`${r.store_name} ${r.year}/${r.month} ${k}`);}console.log('PASS: FY9 all 7 stores × 12 months contain financial budget totals.');}
console.log('PASS: monetary/KPI separation, no double-counting, missing vs zero, negative budget ratios, rendered amount/ratio, salary details excluded.');
module.exports={load,Component,props,React,renderToStaticMarkup};
