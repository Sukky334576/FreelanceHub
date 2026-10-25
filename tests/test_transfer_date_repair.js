'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const core = require('../js/financial-core.js');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const repair = read('supabase/migrations/20261025022848_repair_transfer_date_column.sql');
const oldRpc = read('tests/fixtures/transfer-rpc-before-date-repair.sql');
const signature = 'public.execute_wallet_transfer(bigint,bigint,numeric,numeric,date,text)';
const userA = '11111111-1111-1111-1111-111111111111';
const userB = '22222222-2222-2222-2222-222222222222';
const pending = '33333333-3333-3333-3333-333333333333';
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log('PASS: ' + name); }

async function database(upgrade = true) {
  const pg = new PGlite();
  await pg.exec(`
    CREATE SCHEMA auth; CREATE ROLE anon; CREATE ROLE authenticated;
    CREATE TABLE auth.users(id uuid PRIMARY KEY, email text, email_confirmed_at timestamptz,
      raw_user_meta_data jsonb DEFAULT '{}');
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
      SELECT coalesce(nullif(current_setting('request.jwt.claim.role',true),''),'anon') $$;
    GRANT USAGE ON SCHEMA auth TO authenticated,anon;
    GRANT EXECUTE ON FUNCTION auth.uid(),auth.role() TO authenticated,anon;
  `);
  await pg.exec(read('supabase_migration_v2.sql'));
  if (upgrade) await pg.exec(read('supabase_schema_upgrade.sql'));
  await pg.query('INSERT INTO auth.users(id,email_confirmed_at) VALUES ($1,now()),($2,now())', [userA,userB]);
  // The approval migration requires the complete upgraded schema/RPC set.
  if (upgrade) await pg.exec(read('supabase/migrations/20261024034124_trial_access_approval.sql'));
  await pg.query('INSERT INTO auth.users(id,email_confirmed_at) VALUES ($1,now())', [pending]);
  return pg;
}
async function as(pg, user, role = 'authenticated') {
  await pg.exec('RESET ROLE');
  await pg.query("SELECT set_config('request.jwt.claim.sub',$1,false), set_config('request.jwt.claim.role',$2,false)", [user || '', role]);
  await pg.exec('SET ROLE ' + role);
}
async function pair(pg) {
  await pg.exec('RESET ROLE');
  const rows = (await pg.query(`INSERT INTO wallets(user_id,name,balance)
    VALUES ($1,'กสิกร',1000),($1,'เงินสด',0),($2,'Other user',42) RETURNING id`, [userA,userB])).rows;
  return rows.map(row => Number(row.id));
}
async function state(pg) {
  await pg.exec('RESET ROLE');
  return {
    wallets: (await pg.query('SELECT id,user_id,balance FROM wallets ORDER BY id')).rows,
    transfers: (await pg.query('SELECT *,transfer_date::text AS transfer_date FROM transfers ORDER BY id')).rows,
    transactions: (await pg.query('SELECT *,date::text AS date FROM transactions ORDER BY id')).rows
  };
}
async function metadata(pg) {
  await pg.exec('RESET ROLE');
  return (await pg.query(`SELECT pg_get_functiondef(oid) definition,proowner,proacl,prosecdef,proconfig,
    has_function_privilege('anon',oid,'EXECUTE') anon_execute,
    has_function_privilege('authenticated',oid,'EXECUTE') authenticated_execute
    FROM pg_proc WHERE oid=$1::regprocedure`, [signature])).rows[0];
}
async function transfer(pg, from, to, fee = 0, amount = 400) {
  return (await pg.query("SELECT public.execute_wallet_transfer($1,$2,$3,$4,'2026-10-20','ถอนเป็นเงินสด') result", [from,to,amount,fee])).rows[0].result;
}
async function verifyTransfer(pg, from, to, fee = 0) {
  await as(pg,userA);
  const result = await transfer(pg,from,to,fee);
  assert.equal(Number(result.from_balance),1000-400-fee);
  assert.equal(Number(result.to_balance),400);
  const s = await state(pg);
  const master = s.transfers.find(row => Number(row.id) === Number(result.transfer_id));
  assert.equal(master.transfer_date,'2026-10-20');
  assert.equal(master.notes,'ถอนเป็นเงินสด');
  assert.equal(Number(master.amount),400);
  const legs = s.transactions.filter(row => Number(row.transfer_id) === Number(result.transfer_id));
  assert.equal(legs.length,fee > 0 ? 3 : 2);
  assert(legs.every(row => row.date === '2026-10-20' && row.user_id === userA));
  assert.deepEqual(legs.filter(row => row.type === 'โอนเงิน').map(row => Number(row.wallet_id)).sort((a,b)=>a-b),[from,to].sort((a,b)=>a-b));
  assert.equal(legs.filter(core.isOperatingIncome).length,0);
  assert.equal(legs.filter(core.isOperatingExpense).reduce((sum,row)=>sum+Number(row.amount),0),fee);
  return result;
}

(async () => {
  const pg = await database();
  try {
    await test('deployed RPC reproduces missing transfers.date and rolls back both wallets and ledger', async () => {
      await pg.exec(oldRpc);
      const [from,to] = await pair(pg);
      const before = await state(pg);
      await as(pg,userA);
      await assert.rejects(transfer(pg,from,to), error => error.code === '42703' && /date/.test(error.message));
      assert.deepEqual(await state(pg),before);
    });
    await test('targeted repair changes only the INSERT column, preserves data and privileges, and is repeatable', async () => {
      const before = await state(pg), meta = await metadata(pg);
      await pg.exec(repair);
      const after = await metadata(pg);
      assert.equal(after.definition,meta.definition.replace(
        'user_id, from_wallet_id, to_wallet_id, amount, fee, date, notes, created_at',
        'user_id, from_wallet_id, to_wallet_id, amount, fee, transfer_date, notes, created_at'));
      const {definition: _before, ...oldSettings} = meta;
      const {definition: _after, ...newSettings} = after;
      assert.deepEqual(newSettings,oldSettings);
      assert.equal(after.anon_execute,false); assert.equal(after.authenticated_execute,true);
      assert.match(after.definition,/PERFORM private.require_app_access\(\)/);
      assert.deepEqual(await state(pg),before);
      await pg.exec(repair);
      assert.deepEqual(await metadata(pg),after);
      assert.deepEqual(await state(pg),before);
    });
    await test('bank-to-cash transfer of 400 saves the chosen date and two neutral ledger legs', async () => {
      const [from,to] = await pair(pg);
      await verifyTransfer(pg,from,to);
      const before = await state(pg);
      await pg.exec(repair);
      assert.deepEqual(await state(pg),before);
    });
    await test('fee transfer and cancellation conserve balances and remove only their linked entries', async () => {
      const [from,to] = await pair(pg);
      const before = await state(pg);
      const result = await verifyTransfer(pg,from,to,2.5);
      await as(pg,userA);
      await pg.query('SELECT public.cancel_wallet_transfer($1)',[result.transfer_id]);
      assert.deepEqual(await state(pg),before);
    });
    await test('ledger insert failure rolls back transfer master and both wallet updates', async () => {
      const [from,to] = await pair(pg);
      const before = await state(pg);
      await pg.exec(`CREATE FUNCTION public.reject_test_transfer_leg() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'TEST_LEDGER_FAILURE'; END $$;
        CREATE TRIGGER reject_test_transfer_leg BEFORE INSERT ON transactions
        FOR EACH ROW EXECUTE FUNCTION public.reject_test_transfer_leg();`);
      try {
        await as(pg,userA);
        await assert.rejects(transfer(pg,from,to),/TEST_LEDGER_FAILURE/);
        assert.deepEqual(await state(pg),before);
      } finally {
        await pg.exec('RESET ROLE; DROP TRIGGER reject_test_transfer_leg ON transactions; DROP FUNCTION public.reject_test_transfer_leg();');
      }
    });
    await test('repair retains owner checks, approval checks and anonymous denial without changing balances', async () => {
      const [from,to,other] = await pair(pg), before = await state(pg);
      await as(pg,userA);
      await assert.rejects(transfer(pg,from,other),/Forbidden/);
      await assert.rejects(transfer(pg,other,to),/Forbidden/);
      await assert.rejects(transfer(pg,from,from),/same wallet/);
      await assert.rejects(transfer(pg,from,to,-1),/negative/);
      await as(pg,pending);
      await assert.rejects(transfer(pg,from,to),/ACCESS_NOT_APPROVED/);
      await as(pg,null,'anon');
      await assert.rejects(transfer(pg,from,to),error=>error.code === '42501');
      assert.deepEqual(await state(pg),before);
    });
    await test('upgrade rerun keeps repaired date behavior and approval enforcement', async () => {
      await pg.exec(read('supabase_schema_upgrade.sql'));
      const [from,to] = await pair(pg);
      await verifyTransfer(pg,from,to);
      await as(pg,pending);
      await assert.rejects(transfer(pg,from,to),/ACCESS_NOT_APPROVED/);
    });
  } finally { await pg.close(); }

  const fresh = await database(false);
  try {
    await test('fresh-install RPC works on the same transfer_date schema and repair is a no-op', async () => {
      const meta = await metadata(fresh);
      await fresh.exec(repair);
      assert.deepEqual(await metadata(fresh),meta);
      const [from,to] = await pair(fresh);
      await verifyTransfer(fresh,from,to,2.5);
    });
    await test('repair refuses an unexpected schema instead of creating a second date column', async () => {
      await fresh.exec('ALTER TABLE transfers RENAME COLUMN transfer_date TO unexpected_date');
      await assert.rejects(fresh.exec(repair),/expected transfers.transfer_date DATE is missing/);
      await fresh.exec('ROLLBACK');
      assert.equal((await fresh.query("SELECT count(*)::int n FROM information_schema.columns WHERE table_schema='public' AND table_name='transfers' AND column_name='date'")).rows[0].n,0);
    });
  } finally { await fresh.close(); }
  console.log(`Transfer date regression: ${passed}/${passed} passed`);
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
