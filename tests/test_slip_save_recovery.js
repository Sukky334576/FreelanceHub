'use strict';
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const html = fs.readFileSync(require('node:path').join(__dirname, '../index.html'), 'utf8');
const source = html.slice(html.indexOf('    function renderSlipDrafts()'), html.indexOf('    // Export functions to window for tests and inline handlers'));
function draft(id, selected = true) {
  return {id, requestId:'request-'+id, selected, amount:25, date:'2026-10-24', walletId:1, category:'อาหาร', caption:'อาหารกลางวัน', bankSource:'MAKE', fileName:id+'.jpg'};
}
function setup(drafts, rpc) {
  const elements = {}, calls = [], notices = [], closed = [];
  const ctx = vm.createContext({slipDrafts:drafts, isSavingSlips:false, isScanningSlips:false, slipDraftFilter:'all',
    appData:{categories:[],wallets:[]}, currentSessionGeneration:1, currentUser:{id:'A'},
    document:{getElementById:id=>elements[id] ||= {style:{},setAttribute(){},classList:{toggle(){},remove(){}}}},
    escapeHtml:v=>String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
    confirm:()=>true, alert:m=>notices.push(m), showToast:m=>notices.push(m), setSyncStatus:()=>{},
    closeSlipScannerModal:()=>closed.push(true), loadAllData:async()=>{},
    db:{rpc:async(name,args)=>{calls.push({...args});return rpc(args,calls.length);}}, console
  });
  ctx.isMutationSessionValid = (gen,user)=>gen===ctx.currentSessionGeneration && user===ctx.currentUser?.id;
  vm.runInContext(source,ctx);
  return {ctx,elements,calls,closed,notices, save:()=>vm.runInContext('confirmAndSaveSlipDrafts()',ctx)};
}
async function test(name, fn) { await fn(); console.log('PASS: '+name); }
(async()=>{
  await test('mixed batch keeps failed and unselected drafts; retry uses the same request ID',async()=>{
    const t=setup([draft('ok'),draft('retry'),draft('later',false)],(args,n)=>n===2?{error:{message:'Network error'}}:{data:{success:true}});
    await t.save();
    assert.deepEqual(Array.from(t.ctx.slipDrafts,d=>d.id),['retry','later']);
    assert.equal(t.closed.length,0);
    assert.match(t.elements.slipDraftsList.innerHTML,/slip-save-error/);
    await t.save();
    assert.deepEqual(t.calls[1],t.calls[2]);
    assert.deepEqual(Array.from(t.ctx.slipDrafts,d=>d.id),['later']);
  });
  await test('dropped response after commit can retry without a second ledger entry',async()=>{
    const ledger=new Map();let balance=100;
    const t=setup([draft('one')],args=>{
      if(!ledger.has(args.p_request_id)){ledger.set(args.p_request_id,args);balance-=args.p_amount;throw new Error('Response lost');}
      return {data:{success:true,status:'IDEMPOTENT_RETRY'}};
    });
    await t.save();assert.equal(t.ctx.slipDrafts.length,1);
    await t.save();assert.equal(balance,75);assert.equal(ledger.size,1);assert.equal(t.ctx.slipDrafts.length,0);
  });
  await test('double click cannot start a second batch or modify a pending payload',async()=>{
    let release;const t=setup([draft('one')],()=>new Promise(resolve=>release=resolve));
    const pending=t.save();
    await t.save();vm.runInContext("updateSlipDraft('one','amount',999);removeSlipDraft('one');applyBulkWalletToSlips('2')",t.ctx);
    assert.equal(t.calls.length,1);assert.equal(t.ctx.slipDrafts[0].amount,25);assert.equal(t.ctx.slipDrafts[0].walletId,1);
    assert.equal(t.elements.btnConfirmSaveSlips.disabled,true);
    assert.match(t.elements.slipDraftsList.innerHTML,/<fieldset class="slip-fields" disabled>/);
    release({data:{success:true}});await pending;assert.equal(t.ctx.isSavingSlips,false);
  });
  await test('unconfirmed success payload is kept instead of discarded',async()=>{
    for(const response of [{data:null},{data:{success:false}},{data:{}}]){
      const t=setup([draft('one')],()=>response);await t.save();assert.equal(t.ctx.slipDrafts.length,1);
    }
  });
  await test('session switch during a rejected request never writes the next draft or alters the new user',async()=>{
    let reject;const t=setup([draft('one'),draft('two')],()=>new Promise((r,j)=>reject=j));
    const pending=t.save();t.ctx.currentSessionGeneration++;t.ctx.currentUser={id:'B'};t.ctx.slipDrafts=[draft('B')];t.ctx.isSavingSlips=false;
    reject(new Error('Network error'));await pending;
    assert.equal(t.calls.length,1);assert.equal(t.ctx.slipDrafts[0].id,'B');assert.equal(t.notices.length,0);assert.equal(t.closed.length,0);
  });
  await test('session switch during refresh cannot close or announce success in the new session',async()=>{
    let refresh;const t=setup([draft('one')],()=>({data:{success:true}}));
    t.ctx.loadAllData=()=>new Promise(r=>refresh=r);
    const pending=t.save();await new Promise(setImmediate);
    t.ctx.currentSessionGeneration++;t.ctx.currentUser={id:'B'};t.ctx.slipDrafts=[draft('B')];
    refresh();await pending;assert.equal(t.closed.length,0);assert.equal(t.notices.length,0);assert.equal(t.ctx.slipDrafts[0].id,'B');
  });
  await test('idempotency conflicts stay visible with no replacement request',async()=>{
    const t=setup([draft('one')],()=>({error:{message:'IDEMPOTENCY_CONFLICT: changed'}}));
    await t.save();assert.equal(t.ctx.slipDrafts[0].requestId,'request-one');assert.match(t.ctx.slipDrafts[0].saveError,/ตรวจรายการเงิน/);
  });
  await test('sign-out reset removes slip drafts and file references before the next user',async()=>{
    const t=setup([draft('private')],()=>({data:{success:true}}));
    vm.runInContext(html.slice(html.indexOf('    function resetSlipSession()'), html.indexOf('    function openSlipScannerModal()')),t.ctx);
    t.ctx.isSavingSlips=true;t.ctx.isScanningSlips=true;
    t.ctx.document.getElementById('slipFileInput').value='private-slip.jpg';
    t.ctx.document.getElementById('slipSaveStatus').textContent='Previous user progress';
    vm.runInContext('resetSlipSession()',t.ctx);
    assert.equal(t.ctx.slipDrafts.length,0);assert.equal(t.ctx.slipScanAbort,true);
    assert.equal(t.ctx.isSavingSlips,false);assert.equal(t.ctx.isScanningSlips,false);
    assert.equal(t.elements.slipFileInput.value,'');assert.equal(t.elements.slipSaveStatus.textContent,'');
    assert.equal(t.elements.slipSaveStatus.hidden,true);assert.equal(t.elements.btnConfirmSaveSlips.disabled,true);
  });
})().catch(e=>{console.error(e);process.exitCode=1;});
