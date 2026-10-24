/* The database is authoritative. Client checks keep pending/expired sessions out of cached screens. */
var appAccessState = null;
var appAccessError = false;
var accessRequest = null;
var gateMode = 'signin';
var trialListOffset = 0;
var trialListRows = [];
var trialReviewBusy = false;
var trialListRequestId = 0;

function hasAppAccess() {
  return !!(currentUser && appAccessState && appAccessState.user_id === currentUser.id && appAccessState.allowed === true);
}
function isAccessAdmin() { return hasAppAccess() && appAccessState.is_admin === true; }
function renderAccessGate() {
  var signedIn = !!currentUser, allowed = hasAppAccess();
  var gate = document.getElementById('loginGateOverlay');
  if (gate) gate.style.display = allowed ? 'none' : 'flex';
  var layout = document.querySelector('.app-layout');
  if (layout) { layout.inert = !allowed; layout.setAttribute('aria-hidden', String(!allowed)); }
  var login = document.getElementById('gateLoginForm');
  var signup = document.getElementById('gateSignupForm');
  var waiting = document.getElementById('gateAccessStatus');
  var invite = document.getElementById('gateSignupInvite');
  if (login) login.hidden = signedIn || gateMode === 'signup';
  if (signup) signup.hidden = signedIn || gateMode !== 'signup';
  if (waiting) waiting.hidden = !signedIn;
  if (invite) invite.hidden = signedIn || gateMode === 'signup';
  var title = document.getElementById('gateAccessTitle');
  var message = document.getElementById('gateAccessMessage');
  var email = document.getElementById('gateAccessEmail');
  if (email) email.textContent = currentUser ? currentUser.email || '' : '';
  var status = appAccessState && appAccessState.status;
  if (title) title.textContent = appAccessError ? 'ตรวจสอบสิทธิ์ไม่สำเร็จ' : !appAccessState ? 'กำลังตรวจสอบสิทธิ์' : status === 'pending' ? 'ส่งคำขอแล้ว รอแอดมินอนุมัติ' : status === 'rejected' ? 'คำขอยังไม่ได้รับอนุมัติ' : status === 'suspended' ? 'บัญชีถูกระงับการใช้งาน' : 'สิทธิ์ทดลองใช้หมดอายุ';
  if (message) message.textContent = appAccessError ? 'กรุณาตรวจการเชื่อมต่อแล้วลองอีกครั้ง' : !appAccessState ? 'กรุณารอสักครู่' : status === 'pending' ? 'เมื่อได้รับอนุมัติ คุณจะเริ่มตั้งค่าบัญชีและใช้งานแอปได้ กดตรวจสอบสถานะเพื่ออัปเดตผล' : 'ติดต่อแอดมินเพื่อขอเปิดใช้งานบัญชีอีกครั้ง';
  var admin = document.getElementById('trialAdminPanel');
  if (admin) admin.hidden = !isAccessAdmin();
  if (!isAccessAdmin()) {
    trialListRows=[];trialListOffset=0;
    var requests=document.getElementById('trialRequestsList');
    if(requests)requests.innerHTML='';
  }
  if (!allowed) {
    var newEmail=document.getElementById('accountNewEmail'), emailMessage=document.getElementById('accountEmailMessage');
    if(newEmail)newEmail.value='';
    if(emailMessage){emailMessage.textContent='';emailMessage.hidden=true;}
    var emailSettings=document.getElementById('accountEmailSettings');
    if(emailSettings)emailSettings.open=false;
  }
  var role = document.getElementById('settingsAuthRole');
  if (role && allowed) role.textContent = isAccessAdmin() ? 'แอดมิน' : 'ผู้ใช้ที่ได้รับอนุมัติ';
}
function showGateMode(mode) {
  gateMode = mode === 'signup' ? 'signup' : 'signin';
  if (typeof closeAllDrawers === 'function') closeAllDrawers();
  renderAccessGate();
  var field = document.getElementById(gateMode === 'signup' ? 'signupName' : 'gateEmail');
  if (field) field.focus();
}
async function refreshAppAccess() {
  if (!currentUser) { appAccessState = null; appAccessError = false; renderAccessGate(); return false; }
  var userId = currentUser.id, generation = currentSessionGeneration;
  if (accessRequest && accessRequest.userId === userId && accessRequest.generation === generation) return accessRequest.promise;
  var request = {userId:userId,generation:generation};
  request.promise = (async function() {
    try {
      var result = await db.rpc('get_my_app_access');
      if (!currentUser || currentUser.id !== userId || currentSessionGeneration !== generation) return false;
      if (result.error) throw result.error;
      var value = result.data;
      if (value && value.allowed && value.status !== 'approved') throw new Error('Invalid access status');
      if (!value || value.user_id !== userId || typeof value.allowed !== 'boolean' || typeof value.is_admin !== 'boolean' || !['pending','approved','rejected','suspended'].includes(value.status)) throw new Error('Invalid access response');
      appAccessState = value; appAccessError = false;
      if (!value.allowed) {
        try { localStorage.removeItem(getUserStorageKey('freelancehub_snapshot_v1')); } catch (_) {}
        clearAppDataAndScreens();
      }
      renderAccessGate();
      return hasAppAccess();
    } catch (error) {
      if (!currentUser || currentUser.id !== userId || currentSessionGeneration !== generation) return false;
      appAccessState = null; appAccessError = true;
      clearAppDataAndScreens(); renderAccessGate();
      return false;
    } finally { if (accessRequest === request) accessRequest = null; }
  })();
  accessRequest = request;
  return request.promise;
}
async function loadApprovedSession() {
  var generation=currentSessionGeneration,userId=currentUser && currentUser.id;
  if (!await refreshAppAccess() || !hasAppAccess() || generation!==currentSessionGeneration || currentUser.id!==userId) return;
  loadAppDataSnapshot();
  renderCategoryOptions(); populateJobDropdowns(); populateAllWalletSelects(); renderAll();
  await loadAllData();
  if (typeof currentTab !== 'undefined' && currentTab === 'settings' && isAccessAdmin()) loadTrialRequests(true);
}
function trialSignupErrorMessage(error) {
  var code=error && error.code || '', message=error && error.message || '';
  if ((error && error.status===429) || ['over_email_send_rate_limit','over_request_rate_limit'].includes(code) || /rate.?limit|too many requests/i.test(message)) {
    return 'มีคำขอมากเกินไป กรุณารอสักครู่แล้วลองใหม่';
  }
  if (/error sending (confirmation|recovery|magic link) (email|mail)|smtp|application.specific password/i.test(message)) {
    return 'ระบบยังส่งอีเมลยืนยันไม่ได้ กรุณาแจ้งแอดมินให้ตรวจระบบส่งอีเมล แล้วลองสมัครอีกครั้งหลังแก้ไข';
  }
  if (['signup_disabled','email_provider_disabled'].includes(code) || /signups? (are |is )?(not allowed|disabled)|email.*(disabled|not allowed|not authorized)/i.test(message)) {
    return 'ระบบยังไม่พร้อมรับสมัครด้วยอีเมล กรุณาติดต่อแอดมิน';
  }
  if (code==='email_address_invalid' || /invalid email|email address.*invalid/i.test(message)) {
    return 'กรุณาตรวจสอบรูปแบบอีเมลแล้วลองอีกครั้ง';
  }
  if (code==='weak_password' || /password.*(weak|short|at least)/i.test(message)) {
    return 'รหัสผ่านยังไม่ผ่านข้อกำหนด กรุณาใช้รหัสผ่านที่ยาวและคาดเดายากขึ้น';
  }
  if (/failed to fetch|network|load failed/i.test(message)) {
    return 'เชื่อมต่อระบบไม่ได้ กรุณาตรวจอินเทอร์เน็ตแล้วลองอีกครั้ง';
  }
  return 'ส่งคำขอไม่สำเร็จ กรุณาลองอีกครั้ง หากยังพบปัญหาให้ติดต่อแอดมิน';
}
async function handleTrialSignup(event) {
  event.preventDefault();
  var button=document.getElementById('signupSubmit'), error=document.getElementById('signupError');
  if (button.disabled) return;
  var name=document.getElementById('signupName').value.trim();
  var email=document.getElementById('signupEmail').value.trim();
  var password=document.getElementById('signupPassword').value;
  var confirmPassword=document.getElementById('signupConfirmPassword').value;
  error.hidden=true;
  document.getElementById('gateSignupResult').hidden=true;
  if (!name || !email || password.length<8 || password!==confirmPassword) {
    error.textContent=password!==confirmPassword ? 'รหัสผ่านทั้งสองช่องไม่ตรงกัน' : 'กรอกชื่อ อีเมล และรหัสผ่านอย่างน้อย 8 ตัวอักษรให้ครบ'; error.hidden=false;return;
  }
  button.disabled=true; button.textContent='กำลังส่งคำขอ…';
  try {
    var result=await db.auth.signUp({email:email,password:password,options:{data:{display_name:name},emailRedirectTo:window.location.origin+'/'}});
    if(result.error)throw result.error;
    document.getElementById('signupPassword').value=''; document.getElementById('signupConfirmPassword').value='';
    var note=document.getElementById('gateSignupResult');
    note.textContent=result.data && result.data.session ? 'รับคำขอแล้ว กรุณารอแอดมินอนุมัติ' : 'หากอีเมลนี้สมัครได้ โปรดเปิดอีเมลยืนยันบัญชี แล้วเข้าสู่ระบบเพื่อตรวจสอบผลอนุมัติ หากมีบัญชีอยู่แล้วให้เข้าสู่ระบบ';
    note.hidden=false;
    document.getElementById('gateEmail').value=email;
    showGateMode('signin');
    if(result.data && result.data.session) {
      if (!currentUser || currentUser.id !== result.data.user.id) currentSessionGeneration++;
      currentUser=result.data.user; await loadApprovedSession();
    }
  } catch(e) {
    error.textContent=trialSignupErrorMessage(e);error.hidden=false;
  } finally {button.disabled=false;button.textContent='ส่งคำขอทดลองใช้';}
}
async function handleAccountEmailChange(event) {
  event.preventDefault();
  if (!hasAppAccess()) return;
  var button=document.getElementById('accountEmailSubmit'), message=document.getElementById('accountEmailMessage');
  if(button.disabled)return;
  var email=document.getElementById('accountNewEmail').value.trim();
  message.hidden=false;
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.toLowerCase()===(currentUser.email||'').toLowerCase()){
    message.textContent='กรอกอีเมลใหม่ที่ถูกต้องและต่างจากอีเมลปัจจุบัน';return;
  }
  var userId=currentUser.id,generation=currentSessionGeneration;
  button.disabled=true;message.textContent='กำลังส่งคำขอ…';
  try{
    var result=await db.auth.updateUser({email:email},{emailRedirectTo:window.location.origin+'/'});
    if(!currentUser || currentUser.id!==userId || generation!==currentSessionGeneration)return;
    if(result.error)throw result.error;
    document.getElementById('accountNewEmail').value='';
    message.textContent='ส่งคำขอแล้ว โปรดตรวจกล่องจดหมายทั้งอีเมลเดิมและอีเมลใหม่ แล้วกดยืนยันตามที่ระบบส่งให้ ข้อมูลยังอยู่ในบัญชีเดิม';
  }catch(error){
    if(currentUser && currentUser.id===userId && generation===currentSessionGeneration)message.textContent='ส่งคำขอเปลี่ยนอีเมลไม่สำเร็จ กรุณาตรวจอีเมลใหม่ หรือลองอีกครั้งภายหลัง';
  }finally{button.disabled=false;}
}
async function loadTrialRequests(reset) {
  if(!isAccessAdmin())return;
  if(reset)trialListOffset=0;
  var requestId=++trialListRequestId;
  var generation=currentSessionGeneration,userId=currentUser.id;
  var list=document.getElementById('trialRequestsList'), message=document.getElementById('trialAdminMessage');
  message.textContent='กำลังโหลดคำขอ…';
  try{
    var result=await db.rpc('list_trial_requests',{p_status:document.getElementById('trialStatusFilter').value,p_offset:trialListOffset});
    if(!isAccessAdmin() || currentUser.id!==userId || generation!==currentSessionGeneration || requestId!==trialListRequestId)return;
    if(result.error)throw result.error;
    if(!result.data || !Array.isArray(result.data.items))throw new Error('ข้อมูลคำขอไม่ถูกต้อง');
    trialListRows=result.data.items;
    var labels={pending:'รออนุมัติ',approved:'อนุมัติแล้ว',rejected:'ไม่อนุมัติ',suspended:'ระงับแล้ว'};
    list.innerHTML=trialListRows.map(function(row,index){
      var expired=row.expires_at && new Date(row.expires_at)<new Date();
      return '<article class="trial-request"><div class="trial-request-heading"><strong>'+escapeHtml(row.display_name||'ผู้สมัคร')+'</strong><span class="trial-status">'+escapeHtml(expired&&row.status==='approved'?'หมดอายุ':labels[row.status]||row.status)+'</span></div><div class="trial-email">'+escapeHtml(row.email||'')+'</div><p class="trial-meta">'+(row.email_confirmed?'ยืนยันอีเมลแล้ว':'ยังไม่ยืนยันอีเมล')+' · สมัคร '+escapeHtml(new Date(row.created_at).toLocaleDateString('th-TH'))+(row.expires_at?' · หมดอายุ '+escapeHtml(new Date(row.expires_at).toLocaleDateString('th-TH')):'')+'</p>'+ (row.is_admin?'<span class="trial-meta">บัญชีแอดมิน</span>':'<div class="trial-actions"><button type="button" class="btn-primary" onclick="reviewTrialRequest('+index+',\'approved\')">'+(row.status==='approved'?'ต่ออายุ / เปิดใช้':'อนุมัติ')+'</button><button type="button" class="btn-secondary" onclick="reviewTrialRequest('+index+',\''+(row.status==='approved'?'suspended':'rejected')+'\')">'+(row.status==='approved'?'ระงับ':'ไม่อนุมัติ')+'</button></div>')+'</article>';
    }).join('') || '<p class="trial-empty">ไม่มีคำขอในสถานะนี้</p>';
    message.textContent='ทั้งหมด '+result.data.total+' บัญชี';
    document.getElementById('trialPrevPage').disabled=trialListOffset===0;
    document.getElementById('trialNextPage').disabled=trialListOffset+50>=result.data.total;
  }catch(e){if(generation===currentSessionGeneration && requestId===trialListRequestId){list.innerHTML='';message.textContent='โหลดคำขอไม่สำเร็จ กรุณาลองอีกครั้ง';}}
}
function trialPage(direction) { trialListOffset=Math.max(0,trialListOffset+direction*50);loadTrialRequests(false); }
async function reviewTrialRequest(index,status) {
  if(!isAccessAdmin() || trialReviewBusy)return;
  var row=trialListRows[index];if(!row || row.is_admin)return;
  var verb=status==='approved'?'อนุมัติการทดลองใช้':status==='suspended'?'ระงับการใช้งาน':'ไม่อนุมัติคำขอ';
  if(!confirm(verb+'ของ '+(row.email||row.display_name)+' ใช่หรือไม่?'))return;
  trialReviewBusy=true;
  var generation=currentSessionGeneration,userId=currentUser.id;
  document.querySelectorAll('#trialRequestsList button').forEach(function(button){button.disabled=true;});
  try{
    var result=await db.rpc('review_trial_request',{p_user_id:row.user_id,p_status:status,p_expected_updated_at:row.updated_at,p_trial_days:null});
    if(!isAccessAdmin() || currentUser.id!==userId || generation!==currentSessionGeneration)return;
    if(result.error)throw result.error;
    if(!result.data || result.data.user_id!==row.user_id || result.data.status!==status)throw new Error('INVALID_REVIEW_RESULT');
    await loadTrialRequests(false);showToast(verb+'แล้ว');
  }catch(e){if(generation===currentSessionGeneration){await loadTrialRequests(false);document.getElementById('trialAdminMessage').textContent=/STALE_REVIEW/.test(e.message||'')?'คำขอนี้มีการเปลี่ยนแปลงแล้ว กรุณาตรวจสถานะใหม่':'บันทึกผลไม่สำเร็จ กรุณาลองอีกครั้ง';}}
  finally{trialReviewBusy=false;document.querySelectorAll('#trialRequestsList button').forEach(function(button){button.disabled=false;});}
}
