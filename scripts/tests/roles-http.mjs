// Run only against the isolated local pl_roles fixture; never accepts a remote URL/DB.
import assert from 'node:assert/strict';import {createHmac} from 'node:crypto';import fs from 'node:fs';import pg from 'pg';
const base='http://127.0.0.1:3108',secret='pl-local-roles-test-only';
const db=new pg.Client({connectionString:'postgresql://hoshizaki@127.0.0.1:55437/pl_roles'});await db.connect();
const users=(await db.query("select id,username,role,store_name from users where username like 'test-%'")).rows;
assert.equal(users.length,5);let assertions=0;
function cookie(u,patch={}) {const p=JSON.stringify({userId:u.id,role:u.role,rawRole:u.role,storeName:u.store_name,expiresAt:Date.now()+3600000,...patch});return 'highalt_session='+encodeURIComponent(p+'.'+createHmac('sha256',secret).update(p).digest('base64url'));}
async function req(path,c,method='GET',body){const r=await fetch(base+path,{method,headers:{cookie:c,origin:base,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,redirect:'manual'});const text=await r.text();let data;try{data=JSON.parse(text);}catch{}return {status:r.status,data,text,location:r.headers.get('location')};}
const manager=users.find(u=>u.role==='manager'),admin=users.find(u=>u.role==='admin'),store=users.find(u=>u.username==='test-store'),multi=users.find(u=>u.username==='test-multi'),empty=users.find(u=>u.username==='test-unassigned');
const oldCookie=cookie(manager,{role:'admin',rawRole:'manager'});
assert.equal((await req('/api/auth/session',oldCookie)).data.role,'manager');assertions++;
// Enumerate every protected mutation; attempts carry an empty JSON object and must stop before DB work.
const files=fs.readdirSync('src/app/api',{recursive:true}).filter(x=>x.endsWith('route.ts'));
const mutations=[];for(const file of files){const path='/api/'+file.replace(/\/route.ts$/,'');if(path.startsWith('/api/auth/'))continue;const code=fs.readFileSync('src/app/api/'+file,'utf8');for(const m of code.matchAll(/export async function (POST|PUT|PATCH|DELETE)\(/g))mutations.push([path,m[1]]);}
for(const user of [manager,store,multi,empty]){
 const c=user===manager?oldCookie:cookie(user);
 for(const [path,method] of mutations){assert.equal((await req(path,c,method,{})).status,403,`${user.username} ${method} ${path}`);assertions++;}
 for(const path of ['/upload','/settings','/promotion']){const v=await req(path,c);assert.equal(v.status,307);assert.equal(new URL(v.location,base).href,base+'/dashboard');assertions++;}
 for(const path of ['/api/settings/users','/api/settings/manual-payroll','/api/upload/hacomono']){assert.equal((await req(path,c)).status,403);assertions++;}
}
for(const [u,count] of [[admin,9],[manager,9],[store,3],[multi,6],[empty,0]]){
 const c=cookie(u),d=await req('/api/dashboard?year=2026&month=9&store=全体',c);
 assert.equal(d.status,200,d.text.slice(0,200));assert.equal(d.data.member?.plan_subscribers??0,count,u.username);assertions++;
}
assert.equal((await req('/api/dashboard?year=2026&month=9&store=船橋',cookie(store))).data.member.plan_subscribers,3);assertions++;
const comparison=await req('/api/dashboard/store-compare?year=2026',cookie(multi));assert.equal(comparison.status,200);assert.ok(comparison.data.stores.every(s=>['巣鴨','船橋'].includes(s.store)));assertions++;
const breakdown=await req('/api/dashboard/plan-breakdown?year=2026&month=9&store=全体',cookie(manager));assert.equal(breakdown.data.total,9);assert.equal(breakdown.data.plans.length,3);assertions++;
const past=await req('/api/dashboard?year=2026&month=8&store=巣鴨',cookie(manager));assert.equal(past.data.member.plan_subscribers,20);assert.equal(past.data.member.plan_filter_complete,false);assertions++;
const annual=await req('/api/dashboard/annual?fiscalYear=2026&store=全体',cookie(manager));assert.equal(annual.status,200);assert.equal(annual.data.monthly_data.find(m=>m.month===9).ma_plan_subscribers,9);assertions++;
assert.equal((await req('/api/settings/users',cookie(admin))).status,200);assertions++;
assert.equal((await req('/api/budget/unit-price?store=巣鴨&fiscalYear=2026',cookie(manager))).status,200);assertions++;
const metadata=await req('/api/settings/stores',cookie(store));assert.deepEqual(metadata.data.stores,['巣鴨']);assertions++;
assert.equal((await req('/api/auth/session',cookie(manager,{expiresAt:1}))).status,401);assertions++;
assert.equal((await req('/api/auth/session',oldCookie+'x')).status,401);assertions++;
// Existing cookie must lose all-store access immediately after a DB role change.
try{await db.query('update users set role=$1,store_name=$2 where id=$3',['store_manager','巣鴨',manager.id]);const v=await req('/api/auth/session',oldCookie);assert.equal(v.data.role,'store_manager');assert.equal(v.data.storeName,'巣鴨');assertions++;}finally{await db.query('update users set role=$1,store_name=null where id=$2',['manager',manager.id]);await db.end();}
console.log(JSON.stringify({result:'PASS',assertions,mutationEndpoints:mutations.length,roles:5,fixture:'local synthetic only'}));
