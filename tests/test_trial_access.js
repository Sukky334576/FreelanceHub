'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const root=path.resolve(__dirname,'..');
const migration=fs.readFileSync(path.join(root,'supabase/migrations/20261024034124_trial_access_approval.sql'),'utf8');
const bootstrap=fs.readFileSync(path.join(root,'supabase/admin/bootstrap_trial_owner.sql'),'utf8');
const helperHardening=fs.readFileSync(path.join(root,'supabase/migrations/20261024040756_harden_legacy_auth_helpers.sql'),'utf8');
const admin='11111111-1111-1111-1111-111111111111', other='22222222-2222-2222-2222-222222222222', applicant='33333333-3333-3333-3333-333333333333';
let count=0;
async function test(name,fn){await fn();console.log('PASS: '+name);count++;}
(async()=>{
 const pg=new PGlite();
 const as=async uid=>{await pg.exec('RESET ROLE');await pg.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[uid||'']);await pg.exec('SET ROLE authenticated');};
 const owner=async()=>pg.exec('RESET ROLE');
 const rpc=async(name,args=[])=>{const params=args.map((_,i)=>'$'+(i+1)).join(',');return(await pg.query(`SELECT public.${name}(${params}) AS result`,args)).rows[0].result;};
 try{
  await pg.exec(`CREATE SCHEMA auth; CREATE ROLE anon; CREATE ROLE authenticated;
    CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb DEFAULT '{}');
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claim.role',true),''),'authenticated') $$;
    GRANT USAGE ON SCHEMA auth TO authenticated,anon; GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated,anon;`);
  await pg.exec(fs.readFileSync(path.join(root,'supabase_migration_v2.sql'),'utf8'));
  await pg.exec(fs.readFileSync(path.join(root,'supabase_schema_upgrade.sql'),'utf8'));
  await pg.query("INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,'owner@example.test',now()),($2,'existing@example.test',now())",[admin,other]);
  await pg.query("INSERT INTO wallets(name,user_id,balance) VALUES('Owner', $1, 1234),('Legacy unowned',NULL,42)",[admin]);
  await pg.exec(`CREATE FUNCTION public.handle_claim_legacy_data() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN UPDATE public.wallets SET user_id=NEW.id WHERE user_id IS NULL; RETURN NEW; END $$;
    CREATE TRIGGER on_auth_user_created_claim_data AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_claim_legacy_data();`);
  await test('migration preserves existing access and financial balances',async()=>{
    await pg.exec(migration);assert.equal((await pg.query("SELECT count(*)::int n FROM private.app_access WHERE status='approved'")).rows[0].n,2);
    assert.equal(Number((await pg.query("SELECT balance FROM wallets WHERE user_id=$1",[admin])).rows[0].balance),1234);
  });
  await test('retired signup helper cannot be called by API roles; wallet resolver keeps owner isolation with a fixed search path',async()=>{
    // Reproduce the deployed legacy helper config, then exercise the actual upgrade.
    await pg.exec('ALTER FUNCTION public.resolve_transaction_wallet_id(text,uuid) RESET search_path');
    await pg.exec(helperHardening);await pg.exec(helperHardening);
    for(const role of ['anon','authenticated'])assert.equal((await pg.query("SELECT has_function_privilege($1,'public.handle_claim_legacy_data()','EXECUTE') allowed",[role])).rows[0].allowed,false);
    assert.deepEqual((await pg.query("SELECT proconfig FROM pg_proc WHERE oid='public.resolve_transaction_wallet_id(text,uuid)'::regprocedure")).rows[0].proconfig,['search_path=""']);
    const walletId=Number((await pg.query("SELECT id FROM wallets WHERE name='Owner' AND user_id=$1",[admin])).rows[0].id);
    await as(admin);assert.equal(Number(await rpc('resolve_transaction_wallet_id',['[Owner]',admin])),walletId);
    await as(other);assert.equal(await rpc('resolve_transaction_wallet_id',['[Owner]',admin]),null);
    await owner();
  });
  await test('owner bootstrap requires an explicit verified account, is idempotent and does not choose the first signup',async()=>{
    await assert.rejects(pg.exec(bootstrap),/Confirm the app owner email/);
    const ownerSetup=bootstrap.replace("owner_email text := 'REPLACE_WITH_CONFIRMED_OWNER_EMAIL'", "owner_email text := 'owner@example.test'");
    await pg.exec(ownerSetup);await pg.exec(ownerSetup);
    assert.equal((await pg.query('SELECT count(*)::int n FROM private.app_access WHERE is_admin')).rows[0].n,1);
    assert.equal((await pg.query('SELECT user_id FROM private.app_access WHERE is_admin')).rows[0].user_id,admin);
    assert.equal((await pg.query('SELECT count(*)::int n FROM private.app_access_audit')).rows[0].n,1);
  });
  await test('signup creates pending request and ignores forged admin/approval metadata; legacy rows are not claimed',async()=>{
    await pg.query("INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES($1,'applicant@example.test',$2)",[applicant,{display_name:'New user',is_admin:true,status:'approved'}]);
    const a=(await pg.query('SELECT * FROM private.app_access WHERE user_id=$1',[applicant])).rows[0];
    assert.equal(a.status,'pending');assert.equal(a.is_admin,false);assert.equal(a.display_name,'New user');
    assert.equal((await pg.query("SELECT user_id FROM wallets WHERE name='Legacy unowned'")).rows[0].user_id,null);
    for(const table of ['wallets','transactions','jobs','bills','user_profiles'])assert.equal((await pg.query(`SELECT count(*)::int n FROM ${table} WHERE ${table==='user_profiles'?'id':'user_id'}=$1`,[applicant])).rows[0].n,0);
  });
  await test('pending request remains pending after migration rerun',async()=>{
    await pg.exec(migration);await as(applicant);const a=await rpc('get_my_app_access');assert.equal(a.status,'pending');assert.equal(a.allowed,false);
  });
  await test('pending user cannot read or write even their own financial rows via RLS',async()=>{
    await owner();await pg.query("INSERT INTO wallets(name,user_id,balance) VALUES('Pending own', $1,500)",[applicant]);
    await as(applicant);assert.equal((await pg.query('SELECT * FROM wallets')).rows.length,0);
    await assert.rejects(pg.query("INSERT INTO wallets(name,user_id,balance) VALUES('Bypass',$1,1)",[applicant]),e=>e.code==='42501');
  });
  await test('all 13 financial RPCs reject pending users before accessing data',async()=>{
    await owner();const functions=(await pg.query("SELECT p.proname,oidvectortypes(p.proargtypes) args FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prosrc LIKE '%PERFORM private.require_app_access();%' ORDER BY p.proname")).rows;
    assert.equal(functions.length,13);await as(applicant);
    for(const f of functions){const args=f.args.split(', ').map(t=>'NULL::'+t).join(',');await assert.rejects(pg.query(`SELECT public.${f.proname}(${args})`),/ACCESS_NOT_APPROVED/,f.proname);}
  });
  await test('ordinary users cannot list applicants, self-approve or edit private role data',async()=>{
    await as(applicant);await assert.rejects(rpc('list_trial_requests'),/ACCESS_NOT_APPROVED/);
    await assert.rejects(rpc('review_trial_request',[applicant,'approved',new Date().toISOString(),null]),/ACCESS_NOT_APPROVED/);
    await as(other);await assert.rejects(rpc('list_trial_requests'),/ADMIN_REQUIRED/);
    await assert.rejects(pg.query('UPDATE private.app_access SET is_admin=true WHERE user_id=$1',[other]),e=>e.code==='42501');
  });
  let request;
  await test('admin sees requests, approves once and records review audit',async()=>{
    await as(admin);const list=await rpc('list_trial_requests');assert.equal(list.total,1);request=list.items[0];assert.equal(request.email,'applicant@example.test');
    const result=await rpc('review_trial_request',[applicant,'approved',request.updated_at,7]);assert.equal(result.status,'approved');assert(result.expires_at);
    await assert.rejects(rpc('review_trial_request',[applicant,'rejected',request.updated_at,null]),/STALE_REVIEW/);
    await owner();assert.equal((await pg.query('SELECT count(*)::int n FROM private.app_access_audit WHERE target_id=$1',[applicant])).rows[0].n,1);
  });
  await test('approved users only see their own rows; admin role does not grant financial data access to other users',async()=>{
    await as(applicant);assert.equal((await rpc('get_my_app_access')).allowed,true);
    assert.deepEqual((await pg.query('SELECT name FROM wallets')).rows.map(x=>x.name),['Pending own']);
    await as(admin);assert.deepEqual((await pg.query('SELECT name FROM wallets')).rows.map(x=>x.name),['Owner']);
  });
  await test('admin cannot revoke self or another admin through applicant actions',async()=>{
    await as(admin);const a=(await rpc('list_trial_requests',['all',0])).items.find(x=>x.user_id===admin);
    await assert.rejects(rpc('review_trial_request',[admin,'suspended',a.updated_at,null]),/ADMIN_ACCOUNT_PROTECTED/);
  });
  await test('expired access is denied immediately without refreshing JWT',async()=>{
    await owner();await pg.query("UPDATE private.app_access SET expires_at=now()-interval '1 minute' WHERE user_id=$1",[applicant]);
    await as(applicant);assert.equal((await rpc('get_my_app_access')).allowed,false);
    assert.equal((await pg.query('SELECT * FROM wallets')).rows.length,0);
    await assert.rejects(rpc('adjust_wallet_balance',[1,10]),/ACCESS_NOT_APPROVED/);
  });
  await test('rejection and suspension deny access without deleting financial history',async()=>{
    for(const status of ['rejected','suspended']){
      await as(admin);const a=(await rpc('list_trial_requests',['all',0])).items.find(x=>x.user_id===applicant);
      await rpc('review_trial_request',[applicant,status,a.updated_at,null]);
      await as(applicant);assert.equal((await rpc('get_my_app_access')).allowed,false);
    }
    await owner();assert.equal(Number((await pg.query('SELECT balance FROM wallets WHERE user_id=$1',[applicant])).rows[0].balance),500);
  });
  await test('security catalog has all table gates and no public execution grants on private approval helpers',async()=>{
    await owner();
    assert.equal((await pg.query("SELECT count(*)::int n FROM pg_policies WHERE schemaname='public' AND policyname='trial_access_required' AND permissive='RESTRICTIVE'")).rows[0].n,13);
    const grants=(await pg.query("SELECT has_function_privilege('anon','private.review_trial_request(uuid,text,timestamptz,integer)','EXECUTE') allowed")).rows[0];
    assert.equal(grants.allowed,false);
    assert.equal((await pg.query("SELECT count(*)::int n FROM pg_proc p JOIN pg_namespace n ON p.pronamespace=n.oid WHERE n.nspname='public' AND p.proname IN ('get_my_app_access','list_trial_requests','review_trial_request') AND p.prosecdef")).rows[0].n,0);
  });
  await test('upgrade preserves access gates; obsolete baseline and legacy owner setup fail before changing data',async()=>{
    await owner();
    await assert.rejects(pg.exec(fs.readFileSync(path.join(root,'supabase_migration_v2.sql'),'utf8')),/Baseline reset is disabled/);
    for(const filename of ['supabase_schema_upgrade.sql']){
      await pg.exec(fs.readFileSync(path.join(root,filename),'utf8'));
      assert.equal((await pg.query("SELECT count(*)::int n FROM pg_policies WHERE schemaname='public' AND policyname='trial_access_required' AND permissive='RESTRICTIVE'")).rows[0].n,13);
      const functions=(await pg.query("SELECT p.proname,oidvectortypes(p.proargtypes) args FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prosrc LIKE '%PERFORM private.require_app_access();%'")).rows;
      assert.equal(functions.length,13);
      await as(applicant);
      assert.equal((await pg.query('SELECT * FROM wallets')).rows.length,0);
      for(const f of functions)await assert.rejects(pg.query(`SELECT public.${f.proname}(${f.args.split(', ').map(t=>'NULL::'+t).join(',')})`),/ACCESS_NOT_APPROVED/);
      await owner();
    }
    await assert.rejects(pg.exec(fs.readFileSync(path.join(root,'setup_natthawit_account.sql'),'utf8')),/Legacy owner setup is disabled/);
    assert.equal(Number((await pg.query('SELECT balance FROM wallets WHERE user_id=$1',[applicant])).rows[0].balance),500);
    assert.equal((await pg.query("SELECT count(*)::int n FROM pg_trigger WHERE tgname='on_auth_user_created_claim_data'")).rows[0].n,0);
  });
  await test('anonymous callers cannot invoke approval endpoints',async()=>{
    await pg.exec('SET ROLE anon');for(const name of ['get_my_app_access','list_trial_requests'])await assert.rejects(rpc(name),e=>e.code==='42501');
  });
  console.log(`Trial access regression: ${count}/${count} passed`);
 }finally{await pg.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
