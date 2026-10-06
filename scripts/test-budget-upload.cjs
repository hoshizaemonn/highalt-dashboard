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
async function upload(csv) {
  writes = 0; records = [];
  const file = new File([csv], '東日本橋_2027年9月期予算 - 予算書.csv', {type: 'text/csv'});
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
  console.log('PASS: unsupported sheet writes nothing; FY2027 maps Oct2026–Sep2027; zero budgets accepted.');
})().catch(e => { console.error(e); process.exitCode = 1; });
