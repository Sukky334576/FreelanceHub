const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const html = fs.readFileSync(require('path').join(__dirname, '../index.html'), 'utf8');
for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) new vm.Script(match[1]);
const source = html.slice(html.indexOf('    function renderSlipDrafts()'), html.indexOf('    // Export functions to window for tests and inline handlers'));
const elements = {};
const calls = [];
const ctx = vm.createContext({
  slipDrafts: [{id:'test', requestId:'req-test', selected:true, amount:5, date:'2026-10-21', walletId:1, category:'อาหาร', bankSource:'SCB / ไทยพาณิชย์', caption:'<b>ค่าอาหาร1000</b>', receiver:'ร้านทดสอบ'}],
  isSavingSlips:false, isScanningSlips:false, slipDraftFilter:'all', appData:{categories:[],wallets:[]},
  document:{getElementById:id=>elements[id] ||= {setAttribute(){}}},
  escapeHtml:s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'),
  currentSessionGeneration:1, currentUser:{id:'test'},
  confirm:()=>true, alert:()=>{}, setSyncStatus:()=>{}, isMutationSessionValid:()=>true,
  db:{rpc:async(name,args)=>{calls.push(args);return {data:{success:true}}}},
  closeSlipScannerModal:()=>{},loadAllData:async()=>{},showToast:()=>{},console
});
vm.runInContext(source,ctx);
(async()=>{
  vm.runInContext('renderSlipDrafts()',ctx);
  assert(elements.slipDraftsList.innerHTML.includes('SCB / ไทยพาณิชย์'));
  assert(elements.slipDraftsList.innerHTML.includes('&lt;b&gt;ค่าอาหาร1000&lt;/b&gt;'));
  vm.runInContext("updateSlipDraft('test','caption','แก้หมายเหตุแล้ว')",ctx);
  await vm.runInContext('confirmAndSaveSlipDrafts()',ctx);
  assert(calls[0].p_details.includes('แก้หมายเหตุแล้ว'));
  assert.equal(calls[0].p_request_id,'req-test');
  console.log('PASS: source label, escaped editable caption, edited caption persisted via real save handler');
})().catch(e=>{console.error(e);process.exitCode=1});
