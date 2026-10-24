'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const html = read('index.html');
const source = html.slice(html.indexOf('    function openReconModal()'), html.indexOf('    async function quickPayBill('));
const repair = read('supabase/migrations/20261024021911_repair_transactions_updated_at.sql');
const full = read('supabase_migration_v2.sql');
const upgrade = read('supabase_schema_upgrade.sql');
const userA = '11111111-1111-1111-1111-111111111111';
const userB = '22222222-2222-2222-2222-222222222222';
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log('PASS: '+name); }
function rpcDefinition(sql) {
  const start = sql.indexOf('CREATE OR REPLACE FUNCTION public.execute_wallet_reconciliation(');
  assert(start >= 0);
  return sql.slice(start, sql.indexOf('$$;', start) + 3);
}
async function database() {
  const pg = new PGlite();
  await pg.exec(`
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), email TEXT);
    CREATE ROLE anon; CREATE ROLE authenticated;
    CREATE FUNCTION auth.uid() RETURNS UUID AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$ LANGUAGE sql STABLE;
    CREATE FUNCTION auth.role() RETURNS TEXT AS $$
      SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), 'anon');
    $$ LANGUAGE sql STABLE;
  `);
  await pg.exec(full);
  await pg.query('INSERT INTO auth.users(id) VALUES ($1), ($2)', [userA, userB]);
  await pg.query("SELECT set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claim.role', 'authenticated', false)", [userA]);
  return pg;
}
async function wallet(pg) {
  return (await pg.query("INSERT INTO wallets(user_id,name,balance) VALUES ($1,'Test wallet',1000) RETURNING id", [userA])).rows[0].id;
}
async function state(pg, id) {
  return {
    balance: Number((await pg.query('SELECT balance FROM wallets WHERE id=$1', [id])).rows[0].balance),
    ledger: (await pg.query('SELECT id, date::text, amount, details, type, wallet_id FROM transactions WHERE wallet_id=$1 ORDER BY id', [id])).rows
  };
}
async function reconcile(pg, id, expected, actual) {
  return (await pg.query("SELECT execute_wallet_reconciliation($1,$2,$3,'Test reconciliation','2026-10-24') AS result", [id, expected, actual])).rows[0].result;
}
function browser(rpc = () => ({data:{status:'OK', success:true, wallet_id:1, new_balance:850}})) {
  const elements = {
    btnSubmitRecon: {disabled:false}, reconAccountSelect:{value:'1'},
    reconSystemBalance:{dataset:{value:'1000'}}, reconActualInput:{value:'850'},
    reconDateInput:{value:'2026-10-24'}, reconReasonInput:{value:'Test reconciliation'}
  };
  const calls = [], alerts = [], toasts = [], storage = new Map();
  let closed=0, cached=0, refreshed=0;
  const ctx=vm.createContext({
    document:{getElementById:id=>elements[id]}, appData:{wallets:[{id:1,name:'Test wallet',balance:1000}]},
    currentSessionGeneration:1, currentUser:{id:userA}, window:{FinancialCore:require('../js/financial-core.js')},
    alert:m=>alerts.push(m), showToast:m=>toasts.push(m), closeAllDrawers:()=>closed++,
    saveWalletsToLocal:()=>cached++, loadAllData:async()=>refreshed++,
    renderDashboard(){}, renderTransactions(){}, getTodayDateStr:()=> '2026-10-24',
    localStorage:{setItem:(k,v)=>storage.set(k,v)},
    db:{rpc:async(name,args)=>{calls.push({name,args});return rpc(args);}},
    console:{warn(){},error(){}}
  });
  ctx.isMutationSessionValid=(token,id)=>token===ctx.currentSessionGeneration && id===ctx.currentUser?.id;
  vm.runInContext(source,ctx);
  return {ctx,elements,calls,alerts,toasts,storage,save:()=>ctx.handleReconSubmit({preventDefault(){}}),
    get closed(){return closed;},get cached(){return cached;},get refreshed(){return refreshed;}};
}
function assertUnconfirmed(t) {
  assert.equal(t.ctx.appData.wallets[0].balance,1000);
  assert.equal(t.cached,0); assert.equal(t.toasts.length,0); assert.equal(t.closed,0); assert.equal(t.storage.size,0);
  assert.equal(t.elements.reconActualInput.value,'850');
}
(async()=>{
  const pg=await database();
  try {
    await test('legacy missing updated_at reproduces 42703 and atomically rolls back wallet changes',async()=>{
      await pg.exec(rpcDefinition(upgrade));
      await pg.exec('ALTER TABLE transactions DROP COLUMN updated_at');
      const id=await wallet(pg);
      const before=await state(pg,id);
      await assert.rejects(reconcile(pg,id,1000,850),error=>error.code==='42703' && /updated_at/.test(error.message));
      assert.deepEqual(await state(pg,id),before);
    });
    await test('narrow repair is repeatable and preserves balances, ledger data and existing timestamps',async()=>{
      const id=await wallet(pg);
      const tx=(await pg.query("INSERT INTO transactions(user_id,date,type,category,amount,details,wallet_id) VALUES ($1,'2026-10-01','รายจ่าย','อาหาร',20,'Historical entry',$2) RETURNING id",[userA,id])).rows[0].id;
      const before=await state(pg,id);
      await pg.exec(repair);
      assert.deepEqual(await state(pg,id),before);
      assert.equal((await pg.query('SELECT updated_at FROM transactions WHERE id=$1',[tx])).rows[0].updated_at,null);
      await pg.query("UPDATE transactions SET updated_at='2026-10-01T00:00:00Z' WHERE id=$1",[tx]);
      const stamp=(await pg.query('SELECT updated_at::text AS value FROM transactions WHERE id=$1',[tx])).rows[0].value;
      await pg.exec(repair);
      assert.deepEqual(await state(pg,id),before);
      assert.equal((await pg.query('SELECT updated_at::text AS value FROM transactions WHERE id=$1',[tx])).rows[0].value,stamp);
    });
  } finally {await pg.close();}
    for (const [name,sql] of [['upgrade',upgrade],['full migration',full]]) {
      const pg=await database();
      try {
      await test(name+' repairs an existing table and reconciles with one audit entry, including zero',async()=>{
        await pg.exec('ALTER TABLE transactions DROP COLUMN updated_at');
        await pg.exec(sql);
        const id=await wallet(pg);
        const result=await reconcile(pg,id,1000,850);
        assert.equal(Number(result.new_balance),850);
        let actual=await state(pg,id);
        assert.equal(actual.balance,850); assert.equal(actual.ledger.length,1);
        assert.equal(Number(actual.ledger[0].amount),150); assert.equal(actual.ledger[0].date,'2026-10-24');
        assert.equal(actual.ledger[0].type,'ปรับยอดเงิน'); assert.match(actual.ledger[0].details,/Test reconciliation/);
        assert.notEqual((await pg.query('SELECT updated_at FROM transactions WHERE id=$1',[actual.ledger[0].id])).rows[0].updated_at,null);
        await reconcile(pg,id,850,850);
        assert.deepEqual(await state(pg,id),actual);
        await reconcile(pg,id,850,0);
        actual=await state(pg,id); assert.equal(actual.balance,0); assert.equal(actual.ledger.length,2);
        const before=await state(pg,id);
        if(name==='upgrade') assert.equal((await reconcile(pg,id,1000,500)).status,'STALE_BALANCE');
        else await assert.rejects(reconcile(pg,id,1000,500),/STALE_BALANCE/);
        assert.deepEqual(await state(pg,id),before);
        await pg.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[userB]);
        await assert.rejects(reconcile(pg,id,0,500),/Forbidden/);
        assert.deepEqual(await state(pg,id),before);
        await pg.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[userA]);
      });
      } finally {await pg.close();}
    }
  await test('blank and invalid input never becomes a zero-balance mutation',async()=>{
    for(const input of ['', '  ', 'NaN', 'Infinity', '10oops']) {
      const t=browser(); t.elements.reconActualInput.value=input; await t.save();
      assert.equal(t.calls.length,0); assert.equal(t.elements.btnSubmitRecon.disabled,false);
      assert.equal(t.ctx.appData.wallets[0].balance,1000); assert.equal(t.closed,0);
    }
  });
  await test('missing column and both stale RPC contracts keep the form open without false success',async()=>{
    for(const response of [
      {error:{code:'42703',message:'column "updated_at" of relation "transactions" does not exist'}},
      {error:{message:'STALE_BALANCE: current balance changed'}},
      {data:{success:false,status:'STALE_BALANCE',current_balance:900}}
    ]) {
      const t=browser(()=>response); await t.save(); assertUnconfirmed(t);
      assert.equal(t.alerts.length,1); assert.equal(t.refreshed,1); assert.equal(t.elements.btnSubmitRecon.disabled,false);
    }
  });
  await test('malformed or mismatched server results cannot corrupt the local wallet balance',async()=>{
    for(const data of [null,{}, {status:'OK',wallet_id:1}, {status:'OK',wallet_id:1,new_balance:null},
      {status:'OK',wallet_id:2,new_balance:850}, {status:'OK',wallet_id:1,new_balance:999},
      {status:'OK',wallet_id:1,new_balance:850,success:false}]) {
      const t=browser(()=>({data})); await t.save(); assertUnconfirmed(t); assert.equal(t.alerts.length,1);
    }
  });
  await test('both deployed success contracts and an explicitly entered zero are accepted',async()=>{
    for(const status of ['OK','ADJUSTED','NO_OP']) {
      const t=browser(()=>({data:{status,wallet_id:1,new_balance:'0'}}));
      t.elements.reconActualInput.value='0'; await t.save();
      assert.equal(t.calls[0].args.p_actual_balance,0); assert.equal(t.calls[0].args.p_expected_balance,1000);
      assert.equal(t.calls[0].args.p_date,'2026-10-24'); assert.equal(t.ctx.appData.wallets[0].balance,0);
      assert.equal(t.cached,1); assert.equal(t.closed,1); assert.equal(t.toasts.length,1);
    }
  });
  await test('double submit sends one RPC and session changes discard its result',async()=>{
    let resolve; const t=browser(()=>new Promise(r=>resolve=r));
    const pending=t.save(); await t.save(); assert.equal(t.calls.length,1);
    t.ctx.currentSessionGeneration++; t.ctx.currentUser={id:userB};
    resolve({data:{status:'OK',wallet_id:1,new_balance:850}}); await pending;
    assertUnconfirmed(t); assert.equal(t.alerts.length,0); assert.equal(t.elements.btnSubmitRecon.disabled,true);
  });
  console.log(`Reconciliation regression: ${passed}/${passed} passed`);
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
