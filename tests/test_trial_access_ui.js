'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../js/access-control.js'),'utf8');
function harness(rpc=async()=>({data:{user_id:'a',status:'approved',allowed:true,is_admin:false}})){
 const elements={},calls=[],cached=[],storage=new Map();let cleared=0,loaded=0;
 const element=id=>elements[id]||(elements[id]={value:'',disabled:false,hidden:false,style:{},textContent:'',innerHTML:'',setAttribute(){},focus(){}});
 const c=vm.createContext({currentUser:{id:'a',email:'a@example.test'},currentSessionGeneration:1,
  document:{getElementById:element,querySelector:()=>element('layout'),querySelectorAll:()=>[]},
  localStorage:{removeItem:key=>storage.delete(key)},getUserStorageKey:k=>k+'_a',
  db:{rpc:async(name,args)=>{calls.push([name,args]);return rpc(name,args);},auth:{signUp:async args=>{calls.push(['signup',args]);return {data:{session:null},error:null};}}},
  window:{location:{origin:'https://example.test'}},
  clearAppDataAndScreens(){cleared++;c.currentSessionGeneration++;},
  loadAppDataSnapshot(){cached.push(true);},renderCategoryOptions(){},populateJobDropdowns(){},populateAllWalletSelects(){},renderAll(){},loadAllData:async()=>loaded++,closeAllDrawers(){},
  escapeHtml:s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
  showToast(){},confirm:()=>true,console});
 vm.runInContext(source,c);return {c,element,calls,cached,storage,get cleared(){return cleared;},get loaded(){return loaded;}};
}
let n=0;async function test(name,fn){await fn();console.log('PASS: '+name);n++;}
(async()=>{
 await test('pending session cannot restore snapshots or load application data',async()=>{
  const h=harness(async()=>({data:{user_id:'a',status:'pending',allowed:false,is_admin:false}}));h.storage.set('freelancehub_snapshot_v1_a','cached');
  await h.c.loadApprovedSession();assert.equal(h.cached.length,0);assert.equal(h.loaded,0);assert.equal(h.storage.size,0);assert.equal(h.element('loginGateOverlay').style.display,'flex');assert(h.element('layout').inert);
 });
 await test('approved session opens app only after server verification',async()=>{
  let resolve;const h=harness(()=>new Promise(r=>resolve=r));const waiting=h.c.loadApprovedSession();assert.equal(h.cached.length,0);
  resolve({data:{user_id:'a',status:'approved',allowed:true,is_admin:false}});await waiting;
  assert.equal(h.loaded,1);assert.equal(h.cached.length,1);assert.equal(h.element('loginGateOverlay').style.display,'none');
 });
 await test('late approval responses cannot unlock another user session',async()=>{
  let resolve;const h=harness(()=>new Promise(r=>resolve=r));const waiting=h.c.loadApprovedSession();h.c.currentUser={id:'b'};h.c.currentSessionGeneration++;
  resolve({data:{user_id:'a',status:'approved',allowed:true,is_admin:true}});await waiting;assert.equal(h.c.hasAppAccess(),false);assert.equal(h.cached.length,0);
 });
 await test('network failures and malformed access data fail closed',async()=>{
  for(const result of [{error:{message:'offline'}},{data:{}},{data:{user_id:'a',status:'pending',allowed:true,is_admin:true}}]){
   const h=harness(async()=>result);await h.c.loadApprovedSession();assert(!h.c.hasAppAccess());assert.equal(h.loaded,0);assert.equal(h.cached.length,0);assert(h.c.appAccessError);
  }
 });
 await test('signup validates matching password and submits display data only, with no requested role',async()=>{
  const h=harness();h.c.currentUser=null;h.element('signupName').value='Applicant';h.element('signupEmail').value='new@example.test';h.element('signupPassword').value='example-password';h.element('signupConfirmPassword').value='wrong';
  await h.c.handleTrialSignup({preventDefault(){}});assert.equal(h.calls.length,0);
  h.element('signupConfirmPassword').value='example-password';await h.c.handleTrialSignup({preventDefault(){}});
  assert.equal(h.calls[0][0],'signup');assert.deepEqual(Object.keys(h.calls[0][1].options.data),['display_name']);assert.equal(h.element('signupPassword').value,'');assert.equal(h.element('gateSignupResult').hidden,false);
 });
 await test('non-admin UI cannot invoke request listing or approval; applicant text is escaped for admins',async()=>{
  const h=harness(async()=>({data:{items:[{user_id:'b',display_name:'<img src=x onerror=alert(1)>',email:'b@example.test',status:'pending',created_at:'2026-10-24',updated_at:'2026-10-24'}],total:1}}));
  h.c.appAccessState={user_id:'a',status:'approved',allowed:true,is_admin:false};await h.c.loadTrialRequests(true);await h.c.reviewTrialRequest(0,'approved');assert.equal(h.calls.length,0);
  h.c.appAccessState.is_admin=true;h.element('trialStatusFilter').value='pending';await h.c.loadTrialRequests(true);
  assert(h.element('trialRequestsList').innerHTML.includes('&lt;img'));assert(!h.element('trialRequestsList').innerHTML.includes('<img'));
  h.c.currentUser=null;h.c.renderAccessGate();assert.equal(h.element('trialRequestsList').innerHTML,'');
 });
 await test('confirmation email failure stays on signup with actionable Thai guidance and no false success',async()=>{
  const h=harness();h.c.currentUser=null;h.c.gateMode='signup';
  h.element('signupName').value='Applicant';h.element('signupEmail').value='new@example.test';
  h.element('signupPassword').value='example-password';h.element('signupConfirmPassword').value='example-password';
  h.element('gateSignupResult').hidden=false;
  h.c.db.auth.signUp=async()=>({error:{code:'unexpected_failure',status:500,message:'Error sending confirmation email'}});
  await h.c.handleTrialSignup({preventDefault(){}});
  assert.equal(h.c.gateMode,'signup');assert.equal(h.c.currentUser,null);assert.equal(h.loaded,0);
  assert.equal(h.element('signupError').hidden,false);assert(h.element('signupError').textContent.includes('ระบบยังส่งอีเมลยืนยันไม่ได้'));
  assert.equal(h.element('gateSignupResult').hidden,true);assert.equal(h.element('signupSubmit').disabled,false);
  assert.equal(h.element('signupEmail').value,'new@example.test');assert.equal(h.element('signupPassword').value,'example-password');
 });
 await test('signup errors distinguish rate limits and validation without exposing raw backend diagnostics',async()=>{
  const h=harness();
  assert(h.c.trialSignupErrorMessage({code:'over_email_send_rate_limit'}).includes('รอสักครู่'));
  assert(h.c.trialSignupErrorMessage({status:429,message:'Request rejected'}).includes('รอสักครู่'));
  assert(h.c.trialSignupErrorMessage({code:'email_address_invalid'}).includes('รูปแบบอีเมล'));
  assert(h.c.trialSignupErrorMessage({code:'weak_password'}).includes('รหัสผ่าน'));
  assert(h.c.trialSignupErrorMessage({message:'Failed to fetch'}).includes('อินเทอร์เน็ต'));
  const unknown='private backend diagnostic';
  assert(!h.c.trialSignupErrorMessage({message:unknown}).includes(unknown));
  assert(h.c.trialSignupErrorMessage({message:'Failed to generate confirmation email'}).includes('ส่งคำขอไม่สำเร็จ'));
 });
 await test('approval uses the displayed version and grants no-expiry access',async()=>{
  const row={user_id:'b',email:'b@example.test',status:'pending',updated_at:'2026-10-24T09:00:00Z'};
  const h=harness(async name=>name==='review_trial_request'?{data:{user_id:'b',status:'approved'}}:{data:{items:[],total:0}});
  h.c.appAccessState={user_id:'a',status:'approved',allowed:true,is_admin:true};h.c.trialListRows=[row];
  await h.c.reviewTrialRequest(0,'approved');
  const [name,args]=h.calls[0];assert.equal(name,'review_trial_request');assert.equal(args.p_user_id,'b');assert.equal(args.p_expected_updated_at,row.updated_at);assert.equal(args.p_trial_days,null);
 });
 await test('email change uses the existing authenticated account and never changes its ID or admin role',async()=>{
  const h=harness();h.c.appAccessState={user_id:'a',status:'approved',allowed:true,is_admin:true};
  h.c.db.auth.updateUser=async(attributes,options)=>{h.calls.push(['updateUser',attributes,options]);return {data:{user:{id:'a',email:'a@example.test',new_email:attributes.email}}};};
  h.element('accountNewEmail').value='a@example.test';await h.c.handleAccountEmailChange({preventDefault(){}});assert.equal(h.calls.length,0);
  h.element('accountNewEmail').value='new@example.test';await h.c.handleAccountEmailChange({preventDefault(){}});
  assert.equal(h.calls[0][0],'updateUser');assert.deepEqual(Object.keys(h.calls[0][1]),['email']);assert.equal(h.calls[0][1].email,'new@example.test');
  assert.equal(h.c.currentUser.id,'a');assert.equal(h.c.currentUser.email,'a@example.test');assert(h.c.isAccessAdmin());assert(h.element('accountEmailMessage').textContent.includes('อีเมลเดิมและอีเมลใหม่'));
 });
 await test('email delivery failure stays actionable and a late response cannot update another session',async()=>{
  const h=harness();h.c.appAccessState={user_id:'a',status:'approved',allowed:true,is_admin:false};
  h.element('accountNewEmail').value='new@example.test';h.c.db.auth.updateUser=async()=>({error:{message:'smtp unavailable'}});
  await h.c.handleAccountEmailChange({preventDefault(){}});assert(h.element('accountEmailMessage').textContent.includes('ไม่สำเร็จ'));assert.equal(h.element('accountNewEmail').value,'new@example.test');
  let resolve;h.c.db.auth.updateUser=()=>new Promise(r=>resolve=r);const pending=h.c.handleAccountEmailChange({preventDefault(){}});
  h.c.currentUser={id:'b',email:'b@example.test'};h.c.currentSessionGeneration++;h.c.renderAccessGate();resolve({data:{user:{id:'a'}}});await pending;
  assert.equal(h.element('accountEmailMessage').textContent,'');assert.equal(h.element('accountNewEmail').value,'');
 });
 console.log(`Trial UI regression: ${n}/${n} passed`);
})().catch(e=>{console.error(e);process.exitCode=1;});
