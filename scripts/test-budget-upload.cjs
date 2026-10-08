// Run: node scripts/test-budget-upload.cjs (database calls are mocked; no network).
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
let writes = 0, records = [], deleteWhere;
const tx = {
  budgetData: { deleteMany: async ({where}) => { writes++; deleteWhere = where; }, createMany: async ({data}) => { records = data; } },
  uploadLog: { create: async () => { writes++; } },
};
const mocks = {
  '@/lib/prisma': { prisma: { $transaction: async fn => fn(tx) } },
  '@/lib/auth': { getSession: async () => ({userId: 1}), requireStoreUploadAccess: async () => ({}) },
  '@/lib/log': { logError: () => {} },
  'next/server': { NextResponse: { json: (body, options) => ({body, status: options?.status || 200}) } },
};
function load(name) {
  if (mocks[name]) return mocks[name];
  const file = path.join(root, name.replace('@/', 'src/') + '.ts');
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const mod = {exports: {}};
  vm.runInNewContext(code, {exports: mod.exports, module: mod, require: load, TextDecoder, console, Buffer});
  return mod.exports;
}
const {POST} = load('@/app/api/upload/budget/route');
async function upload(csv, filename = '東日本橋_2027年9月期予算 - 予算書.csv') {
  writes = 0; records = [];
  const file = new File([csv], filename, {type: 'text/csv'});
  return POST({formData: async () => new Map([['file', file]])});
}
(async () => {
  let res = await upload('方針,スケジュール\n営業活動,10月');
  assert.equal(res.status, 400); assert.equal(writes, 0);
  const months = [10,11,12,1,2,3,4,5,6,7,8,9].map(m => `${m}月`).join(',');
  res = await upload(`項目,${months}\n月会費収入,${Array(12).fill(100).join(',')}`);
  assert.equal(res.status, 200); assert.equal(records.length, 12);
  assert.equal(records[0].year, 2026); assert.equal(records[0].month, 10);
  assert.equal(records[11].year, 2027); assert.equal(records[11].month, 9);
  assert.equal(records[0].amount, 100000);
  assert.equal(deleteWhere.storeName, '東日本橋');
  assert.equal(JSON.stringify(deleteWhere.OR), JSON.stringify([
    {year: 2026, month: {gte: 10, lte: 12}}, {year: 2027, month: {gte: 1, lte: 9}},
  ]));
  res = await upload(`項目,${months}\n月会費収入,${Array(12).fill(0).join(',')}`);
  assert.equal(res.status, 200); assert.equal(records.length, 12);
  assert(records.every(r => r.amount === 0));
  res = await upload(`,,${months},合計,注記\n,月会費収入,${Array(12).fill(100).join(',')},1200,\n,賞  与,${Array(12).fill(0).join(',')},0,\n,◆純売上高,${Array(12).fill(100).join(',')},1200,`);
  assert.equal(res.status, 200); assert.equal(records.length, 24);
  assert.equal(records.filter(r => r.category === '賞与').length, 12);
  assert.equal(records.reduce((sum, r) => sum + r.amount, 0), 1200000);
  const fourColHeader = [10,11,12,1,2,3,4,5,6,7,8,9].map(m => `${m}月,,,`).join(',');
  res = await upload(`項目,${fourColHeader}\n月会費収入,${Array(12).fill('12.5,999,999,999').join(',')}`);
  assert.equal(res.status, 200); assert.equal(records.length, 12);
  assert(records.every(r => r.amount === 12500));
  res = await upload(`,,2025年,,,2026年\n,,${months}\n,月会費収入,${Array(12).fill(100).join(',')}`);
  assert.equal(res.status, 400); assert.equal(writes, 0);
  assert.match(res.body.error, /月見出し/);
  res = await upload(`,,2026年,,,2027年\n,,${months}\n,月会費収入,${Array(12).fill(100).join(',')}`);
  assert.equal(res.status, 200); assert.equal(records.length, 12);
  // Optional private source validation. Never commit a client's financial CSV.
  if (process.env.BUDGET_CSV_TEST_PATH) {
    const csv = fs.readFileSync(process.env.BUDGET_CSV_TEST_PATH, 'utf8');
    const filename = path.basename(process.env.BUDGET_CSV_TEST_PATH);
    res = await upload(csv, filename);
    assert.equal(res.status, 400); assert.equal(writes, 0);
    assert.match(res.body.error, /月見出し/);
    // In-memory scenario only; does not modify the source or choose its intended fiscal year.
    // Replace each original year in one pass (avoid cascading replacements).
    const scenario = csv.replace(/202[56]年/g, year => year === '2025年' ? '2026年' : '2027年');
    res = await upload(scenario, filename);
    assert.equal(res.status, 200);
    assert.equal(records.length, 240);
    const sourceRows = load('@/lib/csv-utils').parseCSV(csv);
    const sourceFee = sourceRows.find(row => row[1] === '月会費収入')[2];
    assert.equal(records.find(r => r.category === '月会費収入' && r.month === 10).amount, Number(sourceFee.replace(/,/g, '').trim()) * 1000);
    assert.equal(records.find(r => r.category === '賞与' && r.month === 10).amount, 0);
    assert(records.every(r => r.storeName === '下北沢'));
    console.log('PASS: supplied CSV rejected safely for conflicting years; aligned in-memory scenario reads 240 records.');
  }
  console.log('PASS: leading blank column, spaced category, zero budgets, decimals, four-column layout, fiscal-year validation and scoped writes.');
})().catch(e => { console.error(e); process.exitCode = 1; });
