import assert from 'node:assert/strict';import {createHmac} from 'node:crypto';import pg from 'pg';
const base='http://127.0.0.1:3108',secret='pl-local-roles-test-only';
const db=new pg.Client({connectionString:'postgresql://hoshizaki@127.0.0.1:55437/pl_roles'});await db.connect();
const users=(await db.query("select id,username,role,store_name from users where username like 'test-%'")).rows;
function cookie(u){const p=JSON.stringify({userId:u.id,role:u.role,storeName:u.store_name,expiresAt:Date.now()+3600000});return 'highalt_session='+encodeURIComponent(p+'.'+createHmac('sha256',secret).update(p).digest('base64url'));}
async function put(name,updates){const u=users.find(u=>u.username===name);const r=await fetch(base+'/api/dashboard/expenses',{method:'PUT',headers:{cookie:cookie(u),origin:base,'Content-Type':'application/json'},body:JSON.stringify({updates})});return r.status;}
const ids=[];let n=0;
try{
 for(const store of ['巣鴨','船橋']){const r=await db.query('insert into expense_data(year,month,day,store_name,amount,deposit,breakdown,is_revenue,description) values(2026,10,1,$1,100,0,\'\',0,\'expense-role-fixture\') returning id',[store]);ids.push(r.rows[0].id)}
 const [own,other]=ids;
 assert.equal(await put('test-store',[{id:own,amount:200,breakdown:'10月 備品内訳',category:'消耗品費'}]),200);n++;
 assert.equal(await put('test-store',[{id:other,amount:999}]),403);n++;
 assert.equal(await put('test-store',[{id:own,amount:777},{id:other,amount:999}]),403);n++;
 assert.equal((await db.query('select amount from expense_data where id=$1',[own])).rows[0].amount,200);n++;
 assert.equal(await put('test-manager',[{id:other,amount:300,breakdown:'マネージャー入力'}]),200);n++;
 assert.equal(await put('test-multi',[{id:other,amount:400}]),200);n++;
 assert.equal(await put('test-unassigned',[{id:own,amount:999}]),403);n++;
 assert.equal(await put('test-store',[{id:own,splitRatios:{巣鴨:50,船橋:50}}]),403);n++;
 assert.equal((await db.query("select count(*)::int n from expense_rules where keyword='expense-role-fixture'")).rows[0].n,0);n++;
 console.log('PASS expense role checks',n);
} finally{await db.query('delete from expense_data where id=ANY($1::int[])',[ids]);await db.end()}
