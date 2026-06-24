const DATA_URL = 'data.json';
// GitHub Pages frontend connects to Google Apps Script through this URL.
// After deploying Apps Script as Web App, paste the Web App URL here. Keep blank only for local UI preview.
const API_URL = 'https://script.google.com/macros/s/AKfycbzIOC31eWS8NNq0jFUnfMyV0JaF2CxE0lcgJlo60UZv-gmbioNzvPnGA5DNFwdRQdBZ/exec'; // visual QA demo mode
const APP_VERSION = '2.6.1-timeout-fixed';
const STORAGE_KEY = 'parkar-task-app-v2-6-1-deployment-preview';
const SESSION_KEY = 'parkar-session-v2-6-1-secure';
const REFRESH_MODE_KEY = 'parkar-refresh-mode-v1';
const FOUR_HOUR_MS = 4 * 60 * 60 * 1000;
const PRIORITY_ORDER = { Urgent: 1, High: 2, Medium: 3, Low: 4 };
let master = null;
let state = null;
let currentView = 'dashboard';
let refreshTimer = null;
let lastRefreshAt = null;
let sessionUserCode = null;
let sessionToken = null;
let sessionUser = null;

const $ = (id) => document.getElementById(id);
const clean = (txt='') => String(txt ?? '').trim();
const todayISO = () => new Date().toISOString().slice(0,10);
function formatDateReadable(value){
  const raw = clean(value);
  if(!raw) return '-';
  const d = new Date(raw);
  if(!Number.isNaN(d.getTime())) return d.toLocaleDateString('en-IN', {day:'2-digit', month:'short', year:'numeric'});
  return raw;
}
const addDays = (n) => { const d = new Date(); d.setDate(d.getDate()+n); return d.toISOString().slice(0,10); };
function formatDateReadable(value){
  const raw = clean(value);
  if(!raw) return '-';
  const d = new Date(raw);
  if(Number.isNaN(d.getTime())) return raw;
  return d.toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' });
}
const isDeleted = (t) => String(t.deleted || 'No') === 'Yes';
const isOpen = (t) => !['Completed','Cancelled'].includes(t.status) && !isDeleted(t);
const isOverdue = (t) => t.dueDate && new Date(t.dueDate) < new Date(todayISO()) && isOpen(t);
const cssToken = (value='') => clean(value).replace(/[^a-zA-Z0-9_-]/g, '-');
const statusClass = s => cssToken(s).replaceAll(' ','-');
function safeUrl(value){
  const url = clean(value);
  if(!url) return '';
  try{
    const parsed = new URL(url, window.location.href);
    return ['http:', 'https:', 'mailto:'].includes(parsed.protocol) ? parsed.href : '';
  }catch(e){ return ''; }
}

function storageGet(key){ try { return localStorage.getItem(key); } catch(e){ return null; } }
function storageSet(key,value){ try { localStorage.setItem(key,value); } catch(e){} }
function storageRemove(key){ try { localStorage.removeItem(key); } catch(e){} }
function saveState(){ if(!API_URL) storageSet(STORAGE_KEY, JSON.stringify(state)); }
function loadState(data){ const saved = storageGet(STORAGE_KEY); if(saved){ try { return JSON.parse(saved); } catch(e){} } return JSON.parse(JSON.stringify(data)); }
function toast(msg){ const el=$('toast'); el.textContent=msg; el.classList.add('show'); setTimeout(()=>el.classList.remove('show'),2800); }
function showError(err){ if(err?.sessionHandled) return; toast(err?.message || String(err) || 'Action failed'); }
function escapeHtml(value){ return clean(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[ch])); }
function initials(name){ return clean(name).split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]).join('').toUpperCase() || 'AC'; }

function people(){ return state?.staff || []; }
function personByCode(code){ return people().find(s=>s.code===code); }
function deletedPersonLabel(code){ return code ? `Removed person (${code})` : ''; }
function personHasTaskHistory(code){ return state.tasks.some(t => [t.assignedTo, t.createdBy, t.checkedBy, t.managerCode].includes(code)); }
function currentUser(){ return personByCode(sessionUserCode) || sessionUser || people()[0]; }
function activePeople(){ return people().filter(p => String(p.active || 'Yes').toLowerCase() !== 'no'); }
function activeByRole(role){ return activePeople().filter(p => p.role === role); }
function nowStamp(){ return new Date().toLocaleString('en-IN', {year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit'}); }
function auditCategory(action=''){
  if(action.includes('LOGIN') || action.includes('PIN') || action.includes('LOCK')) return 'Security';
  if(action.includes('DELETE') || action.includes('RESTORE') || action.includes('ARCHIVE')) return 'Delete / Archive';
  if(action.includes('PERSON')) return 'People';
  if(action.includes('EXPORT') || action.includes('BACKUP')) return 'Backup';
  if(action.includes('REVIEW') || action.includes('STATUS') || action.includes('TASK')) return 'Task';
  return 'System';
}
function ensureAudit(){ state.auditLogs ||= []; }
function addAudit(action, target, detail='', oldValue='', newValue='', reason=''){
  ensureAudit();
  const user=currentUser();
  state.auditLogs.unshift({ time: nowStamp(), by: user?.code || 'SYSTEM', role:user?.role || 'System', category:auditCategory(action), action, target, detail, oldValue, newValue, reason:reason || detail });
}
function addTimeline(t, action, note){ t.timeline ||= []; const user=currentUser(); t.timeline.unshift({ date: nowStamp(), by:user?.code || 'SYSTEM', action, note: note || '' }); }
function noUpdate3Days(t){ if(!isOpen(t) || !t.lastUpdated) return false; const d=new Date(t.lastUpdated); const diff=(new Date(todayISO())-d)/(1000*60*60*24); return diff>=3; }
function maxPeople(){ return state?.limits?.maxActivePeople || 30; }
function maxOwners(){ return state?.limits?.maxOwners || 2; }
function defaultTaskGroup(){ return { code:'GENERAL', name:'General Tasks' }; }
function staffCapacityText(){ return `${activePeople().length}/${maxPeople()} People`; }
function visiblePeopleCodes(){
  const user = currentUser();
  if(!user) return [];
  if(user.role === 'Owner') return people().map(s=>s.code);
  if(user.role === 'Manager') return people().filter(s=>s.managerCode===user.code || s.code===user.code).map(s=>s.code);
  return [user.code];
}
function visibleTasks(includeDeleted=false){
  const user = currentUser();
  const codes = visiblePeopleCodes();
  const q = clean($('globalSearch')?.value).toLowerCase();
  let rows = state.tasks.filter(t=>(includeDeleted || !isDeleted(t)) && (codes.includes(t.assignedTo) || codes.includes(t.createdBy)));
  if(user?.role === 'Staff') rows = rows.filter(t => t.status !== 'Completed');
  if(q){ rows = rows.filter(t => Object.values(t).some(v => clean(v).toLowerCase().includes(q)) || clean(personByCode(t.assignedTo)?.name).toLowerCase().includes(q)); }
  return rows;
}
function applyQuick(rows, quick){
  if(!quick || quick === 'All Tasks') return rows;
  if(quick === 'Open Tasks') return rows.filter(isOpen);
  if(quick === 'Completed History') return rows.filter(t=>t.status==='Completed' && !isDeleted(t));
  if(quick === 'Deleted / Archive') return visibleTasks(true).filter(t=>isDeleted(t) || t.archived==='Yes');
  if(quick === 'No Update 3 Days') return rows.filter(noUpdate3Days);
  if(quick === 'Overdue') return rows.filter(isOverdue);
  if(quick === 'Due Next 7 Days') { const d = addDays(7); return rows.filter(t => isOpen(t) && t.dueDate <= d); }
  return rows.filter(t=>t.status===quick);
}
function sortedRows(rows, sort){
  const s = sort || 'Due Date';
  return [...rows].sort((a,b)=>{
    if(s==='Priority') return (PRIORITY_ORDER[a.priority]||9)-(PRIORITY_ORDER[b.priority]||9);
    if(s==='Status') return clean(a.status).localeCompare(clean(b.status));
    if(s==='Staff') return clean(a.assignedTo).localeCompare(clean(b.assignedTo));
    if(s==='Created Date') return clean(a.dateAssigned).localeCompare(clean(b.dateAssigned));
    if(s==='Last Updated') return clean(b.lastUpdated).localeCompare(clean(a.lastUpdated));
    return clean(a.dueDate).localeCompare(clean(b.dueDate));
  });
}

async function boot(){
  $('todayLabel').textContent = new Date().toLocaleDateString('en-IN', {weekday:'long', day:'numeric', month:'short', year:'numeric'});
  prepareLoginScreen();
  bindEvents();
  if(API_URL){
    const saved = safeSessionParse();
    if(saved?.token && saved?.user){
      sessionToken = saved.token; sessionUser = saved.user; sessionUserCode = saved.user.code;
      try { master = await fetchBootstrap(); state = JSON.parse(JSON.stringify(master)); migrateDemoState(); lastRefreshAt = new Date(); showApp(); setupRefreshTimer(); return; }
      catch(err){ handleExpiredSession('Session expired. Please login again.'); }
    }
    showLogin(); setupRefreshTimer(); return;
  }
  master = await fetchBootstrap();
  state = loadState(master);
  migrateDemoState();
  lastRefreshAt = new Date();
  const savedSession = storageGet(SESSION_KEY);
  if(savedSession && personByCode(savedSession)){ sessionUserCode = savedSession; showApp(); } else { showLogin(); }
  setupRefreshTimer();
}
function migrateDemoState(){
  state.limits ||= { maxOwners:2, maxActivePeople:30 };
  if(state.limits.maxOwners !== 2) state.limits.maxOwners = 2;
  if(!state.limits.maxActivePeople) state.limits.maxActivePeople = 30;
  delete state.limits.maxManagers;
  delete state.limits.maxActiveStaff;
  state.staff.forEach((p,i)=>{ p.email ||= ''; if(!API_URL && p.pin === undefined) p.pin = ''; p.active ||= 'Yes'; });
  state.tasks.forEach(t=>{ t.deleted ||= 'No'; t.archived ||= 'No'; t.drawingLink ||= ''; t.timeline ||= [{date:t.dateAssigned || todayISO(), by:t.createdBy || 'SYSTEM', action:'Created', note:t.historyNotes || 'Task created'}]; });
  state.auditLogs ||= [];
}
async function fetchBootstrap(){
  if(API_URL){
    if(!sessionToken) throw new Error('Please login before loading data.');
    const payload = await apiPost({ action:'bootstrap' });
    return payload.data || payload;
  }
  const res = await fetch(DATA_URL); return await res.json();
}
function genNonce(){
  try { return (crypto.randomUUID ? crypto.randomUUID() : (Date.now()+'-'+Math.random().toString(36).slice(2))).replace(/-/g,''); }
  catch(e){ return Date.now()+'-'+Math.random().toString(36).slice(2); }
}
async function apiPost(body){
  if(!API_URL) return null;
  const finalBody = { ...body, nonce: genNonce(), ts: Date.now(), clientVersion: APP_VERSION };
  if(sessionToken && !finalBody.token) finalBody.token = sessionToken;
  const res = await fetch(API_URL, { method:'POST', body: JSON.stringify(finalBody), headers: {'Content-Type':'text/plain;charset=utf-8'} });
  const payload = await res.json();
  if(!payload.ok){
    const msg = payload.error || 'Request failed';
    if(isSessionErrorMessage(msg)){
      handleExpiredSession('Session expired. Please login again.');
      const err = new Error('Session expired. Please login again.');
      err.sessionHandled = true;
      throw err;
    }
    throw new Error(msg);
  }
  return payload;
}
function isSessionErrorMessage(msg=''){ return /session expired|session signature failed|login required|invalid session token|missing session token/i.test(String(msg)); }
function handleExpiredSession(message='Session expired. Please login again.'){ clearSession(); if(refreshTimer) clearInterval(refreshTimer); refreshTimer = null; showLogin(); toast(message); }
function safeSessionParse(){ try { return JSON.parse(storageGet(SESSION_KEY) || 'null'); } catch(e){ return null; } }
function saveSession(user, token){ sessionUserCode = user?.code || null; sessionUser = user || null; sessionToken = token || null; storageSet(SESSION_KEY, JSON.stringify({ user, token })); }
function clearSession(){ sessionUserCode = null; sessionUser = null; sessionToken = null; storageRemove(SESSION_KEY); }
function setButtonBusy(btn, busy, busyText='Working...'){
  if(!btn) return;
  if(busy){ btn.dataset.originalText = btn.dataset.originalText || btn.textContent; btn.textContent = busyText; btn.disabled = true; btn.dataset.busy = '1'; }
  else { btn.textContent = btn.dataset.originalText || btn.textContent; btn.disabled = false; delete btn.dataset.busy; }
}
function formBusy(e, busy, busyText='Saving...'){
  const form = e?.target; if(!form) return false;
  if(busy && form.dataset.busy === '1') return true;
  form.dataset.busy = busy ? '1' : '';
  const btn = e.submitter || form.querySelector('button[type="submit"]');
  setButtonBusy(btn, busy, busyText);
  if(!busy) delete form.dataset.busy;
  return false;
}

function prepareLoginScreen(){
  const demo = document.querySelector('.demo-logins');
  if(demo) demo.remove();
  if(!API_URL){
    $('loginEmail').value = 'Ar.kartikverma@gmail.com';
    $('loginPin').value = '0000';
  }
}
function showLogin(){ $('loginScreen').classList.remove('hidden'); $('appShell').classList.add('hidden'); }
function showApp(){ $('loginScreen').classList.add('hidden'); $('appShell').classList.remove('hidden'); renderAll(); }
async function attemptLogin(e){
  e.preventDefault();
  const emailOrCode = clean($('loginEmail').value).toLowerCase();
  const pin = clean($('loginPin').value);
  try{
    if(API_URL){
      const payload = await apiPost({ action:'login', login: emailOrCode, pin });
      const user = payload.user || payload.data?.user;
      if(!user || !payload.token) throw new Error('Login could not be completed. Please retry.');
      saveSession(user, payload.token);
      master = payload.data || await fetchBootstrap();
      state = JSON.parse(JSON.stringify(master));
      await maybeForcePinChange(user);
      maybeWarnVersionMismatch(master);
      migrateDemoState(); lastRefreshAt = new Date(); showApp(); setupRefreshTimer(); toast(`Logged in as ${user.name}`); return;
    }
    const user = activePeople().find(p => (p.role === 'Staff' ? clean(p.code).toLowerCase() === emailOrCode : clean(p.email).toLowerCase() === emailOrCode || clean(p.code).toLowerCase() === emailOrCode));
    if(!user || clean(user.pin) !== pin){ toast('Login failed. Check email/code and PIN.'); return; }
    sessionUserCode = user.code;
    storageSet(SESSION_KEY, user.code);
    showApp();
    toast(`Logged in as ${user.name}`);
  }catch(err){ showError(err); }
}
function logout(){ clearSession(); showLogin(); }

function refreshStatusText(){
  const label = $('refreshStatus'); if(!label) return;
  const mode = $('refreshMode')?.value || storageGet(REFRESH_MODE_KEY) || 'manual';
  const time = lastRefreshAt ? lastRefreshAt.toLocaleTimeString('en-IN', {hour:'2-digit', minute:'2-digit'}) : 'not loaded';
  label.textContent = mode === '4hr' ? `Auto refresh: 4 hr • Last: ${time}` : `Manual refresh only • Last: ${time}`;
  updateApiBanner();
}
function updateApiBanner(){
  const banner = $('apiModeBanner'); if(!banner) return;
  if(API_URL){
    banner.className = 'api-mode-banner live';
    banner.textContent = 'Live connection active — changes are saved to the office task database.';
  } else {
    banner.className = 'api-mode-banner demo';
    banner.textContent = 'Preview mode — changes stay in this browser and are not saved for the team.';
  }
}
function setupRefreshTimer(){
  if(refreshTimer) clearInterval(refreshTimer); refreshTimer = null;
  const mode = $('refreshMode')?.value || storageGet(REFRESH_MODE_KEY) || 'manual'; storageSet(REFRESH_MODE_KEY, mode);
  if(mode === '4hr') refreshTimer = setInterval(() => refreshFromBackend('auto'), FOUR_HOUR_MS);
  refreshStatusText();
}
async function refreshFromBackend(source='manual'){
  try{ master = await fetchBootstrap(); state = API_URL ? JSON.parse(JSON.stringify(master)) : loadState(master); migrateDemoState(); lastRefreshAt = new Date(); renderAll(); refreshStatusText(); if(source === 'manual') toast(API_URL ? 'Data refreshed' : 'Preview data refreshed'); }
  catch(err){ if(!err?.sessionHandled) toast('Refresh failed: ' + err.message); }
}

function bindEvents(){
  $('loginForm').addEventListener('submit', attemptLogin);
  $('logoutBtn').addEventListener('click', logout);
  $('changePinBtn')?.addEventListener('click',()=>openPinChangeModal(false));
  $('systemStatusBtn')?.addEventListener('click',runSystemStatusCheck);
  document.querySelectorAll('.nav-item').forEach(btn=>btn.addEventListener('click',()=>showView(btn.dataset.view)));
  document.querySelectorAll('[data-view-target]').forEach(btn=>btn.addEventListener('click',()=>showView(btn.dataset.viewTarget)));
  $('openTasksBtn')?.addEventListener('click',()=>showView('tasks'));
  $('globalSearch')?.addEventListener('input',renderAll);
  ['filterQuick','filterPriority','filterStaff','sortBy'].forEach(id=>$(id)?.addEventListener('change',renderTaskTable));
  document.querySelectorAll('.quick-cards button').forEach(b=>b.addEventListener('click',()=>{ showView('tasks'); $('filterQuick').value=b.dataset.filter; renderTaskTable(); }));
  $('refreshNow')?.addEventListener('click',()=>refreshFromBackend('manual'));
  if($('refreshMode')){ $('refreshMode').value = storageGet(REFRESH_MODE_KEY) || 'manual'; $('refreshMode').addEventListener('change',setupRefreshTimer); }
  $('addTaskForm').addEventListener('submit',submitNewTask);
  $('updateForm').addEventListener('submit',submitUpdate);
  $('updateTaskId').addEventListener('change',renderSelectedTaskDetail);
  $('personForm').addEventListener('submit',submitPerson);
  $('personRole').addEventListener('change',renderPersonFormRules);
  document.addEventListener('click', handlePeopleActions);
  document.addEventListener('click', handleTaskDeleteActions);
  document.addEventListener('click', handleDashboardTaskOpen);
  document.addEventListener('keydown', handleDashboardTaskKey);
  $('editTaskForm')?.addEventListener('submit', submitTaskEdit);
  $('cancelEditTask')?.addEventListener('click',()=>$('taskEditModal').classList.add('hidden'));
  $('closeSystemStatus')?.addEventListener('click',()=>$('systemStatusModal').classList.add('hidden'));
  $('exportTasksBtn')?.addEventListener('click',(e)=>exportCsv('tasks', e.currentTarget));
  $('exportPeopleBtn')?.addEventListener('click',(e)=>exportCsv('people', e.currentTarget));
  $('exportAuditBtn')?.addEventListener('click',(e)=>exportCsv('audit', e.currentTarget));
  $('exportFullBackupBtn')?.addEventListener('click',(e)=>exportFullBackup(e.currentTarget));
  ['auditCategoryFilter','auditActionFilter','auditUserFilter','auditDateFrom','auditDateTo','auditSearch'].forEach(id=>$(id)?.addEventListener('input', renderAudit));
  $('archiveCompletedBtn')?.addEventListener('click',archiveCompletedTasks);
}
function initDynamicControls(){
  fillSelect('filterQuick', state.config.quickViews, 'Open Tasks');
  fillSelect('filterPriority', ['ALL', ...state.config.priorities], 'ALL');
  fillSelect('sortBy', state.config.sorts, 'Due Date');
  fillSelect('addPriority', state.config.priorities, 'Medium');
  $('addDueDate').value = addDays(2);
  fillSelect('personRole', ['Staff','Manager','Owner'], 'Staff');
}
function optionHtml(value, label=value){ return `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`; }
function fillSelect(id, items, selected){ const el=$(id); if(!el) return; el.innerHTML = items.map(x=>optionHtml(x)).join(''); if(selected) el.value = selected; }
function showView(view){
  currentView=view;
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  $(`${view}View`).classList.add('active');
  document.querySelectorAll('.nav-item').forEach(b=>b.classList.toggle('active', b.dataset.view===view));
  const titles={dashboard:'Dashboard',tasks:'Tasks',add:'Add Task',update:'Update / Review',team:'Team',people:'Admin / People',audit:'Audit / Backup'};
  $('pageTitle').textContent=titles[view] || 'Dashboard';
  renderAll();
}
function updateNavPermissions(){
  const user = currentUser();
  document.querySelector('[data-view="people"]').style.display = ['Owner','Manager'].includes(user.role) ? '' : 'none';
  document.querySelector('[data-view="audit"]').style.display = user.role === 'Owner' ? '' : 'none';
  if(user.role === 'Staff' && currentView === 'people') showView('dashboard');
  if(user.role !== 'Owner' && currentView === 'audit') showView('dashboard');
  const statusBtn = $('systemStatusBtn');
  if(statusBtn) statusBtn.style.display = user.role === 'Owner' ? '' : 'none';
}
function refreshFilterSelects(){
  const codes = visiblePeopleCodes();
  const opts = ['ALL', ...people().filter(s=>codes.includes(s.code) && s.role !== 'Owner').map(s=>s.code)];
  fillSelect('filterStaff', opts, $('filterStaff')?.value || 'ALL');
  refreshAssigneeOptions();
}
function refreshAssigneeOptions(){
  const user=currentUser(); let allowed=[];
  if(user.role==='Owner') allowed=activePeople().filter(p => ['Owner','Manager','Staff'].includes(p.role));
  else if(user.role==='Manager') allowed=activePeople().filter(s=>s.managerCode===user.code || s.code===user.code);
  else allowed=[user];
  $('addAssignee').innerHTML = allowed.map(s=>optionHtml(s.code, `${s.name} (${s.role})`)).join('');
  if(user.role==='Staff') $('addAssignee').value=user.code;
}
function renderAll(){
  if(!sessionUserCode) return;
  if(!$('filterQuick').options.length) initDynamicControls();
  updateNavPermissions();
  const user=currentUser();
  $('loginUserBadge').innerHTML = `<b>${escapeHtml(user.name)}</b><span>${escapeHtml(user.role)} · ${escapeHtml(user.email || user.code)}</span>`;
  refreshFilterSelects();
  renderDashboard(); renderTaskTable(); renderUpdateOptions(); renderTeam(); renderPeople(); renderPersonFormRules(); renderAudit(); renderLoginSecurity(); refreshStatusText();
  $('addHelp').textContent = user.role==='Owner' ? 'Owner can assign to any active owner, manager or staff.' : user.role==='Manager' ? 'Manager can assign only to self or own team.' : 'Staff can add only their own self-task/request.';
  $('updateTitle').textContent = user.role==='Staff' ? 'Staff Progress Update' : `${user.role} Review Action`;
}
function filteredTaskRows(){
  let rows = visibleTasks(); rows = applyQuick(rows, $('filterQuick').value);
  const fpri=$('filterPriority').value, fs=$('filterStaff').value;
  if(fpri && fpri!=='ALL') rows = rows.filter(t=>t.priority===fpri);
  if(fs && fs!=='ALL') rows = rows.filter(t=>t.assignedTo===fs);
  return sortedRows(rows, $('sortBy').value);
}
function renderDashboard(){
  const user=currentUser();
  const rows = visibleTasks();
  const open = rows.filter(isOpen).length;
  const overdue = rows.filter(isOverdue).length;
  const done = rows.filter(t=>t.status==='Completed').length;
  const ready = rows.filter(t=>t.status==='Ready for Check' && !isDeleted(t)).length;
  const requested = rows.filter(t=>t.status==='Requested' && !isDeleted(t)).length;
  const revision = rows.filter(t=>t.status==='Revision Required' && !isDeleted(t)).length;
  const stale = rows.filter(noUpdate3Days).length;
  if($('kpiTotal')) $('kpiTotal').textContent=rows.length;
  if($('kpiOpen')) $('kpiOpen').textContent=open;
  if($('kpiOverdue')) $('kpiOverdue').textContent=overdue;
  if($('kpiCompleted')) $('kpiCompleted').textContent=done;
  if($('kpiApproval')) $('kpiApproval').textContent=ready;
  if($('kpiScope')) $('kpiScope').textContent = `${user?.role || ''} view`;
  const ownerOnly = user?.role === 'Owner';
  document.querySelectorAll('.role-owner-only').forEach(el=>el.classList.toggle('hidden', !ownerOnly));
  document.querySelectorAll('.role-owner-manager-only').forEach(el=>el.classList.toggle('hidden', !['Owner','Manager'].includes(user?.role)));
  document.querySelectorAll('.role-staff-hide').forEach(el=>el.classList.toggle('hidden', user?.role === 'Staff'));

  const statuses=['Pending','In Progress','Ready for Check','Revision Required','Completed'];
  const max = Math.max(1,...statuses.map(s=>rows.filter(t=>t.status===s).length));
  if($('statusBars')) $('statusBars').innerHTML = statuses.map((s,i)=>{ const n=rows.filter(t=>t.status===s).length; const h=24+(n/max)*120; return `<div class="bar-wrap"><div class="bar ${i%3===1?'alt':i%3===2?'warn':''}" style="height:${h}px" title="${s}: ${n}"></div><div class="bar-label">${s}<br><b>${n}</b></div></div>`}).join('');
  if($('statusLegend')) $('statusLegend').innerHTML = statuses.map(s=>`<span>● ${s}</span>`).join('');

  const preview = sortedRows(applyQuick(rows,'Open Tasks'),'Due Date').slice(0,5);
  if($('dashboardTaskList')) $('dashboardTaskList').innerHTML = preview.length ? preview.map(taskRow).join('') : `<p>No active tasks in this view.</p>`;
  const approvalRows = sortedRows(rows.filter(t=>t.status==='Ready for Check' && !isDeleted(t)),'Due Date').slice(0,6);
  if($('approvalTaskList')) $('approvalTaskList').innerHTML = approvalRows.length ? approvalRows.map(taskRow).join('') : `<p>No tasks currently sent for approval.</p>`;

  if($('reviewSummaryGrid')){
    const cards = [
      ['Ready for Check', ready, 'Staff has sent work for review', 'Ready for Check'],
      ['Requested Tasks', requested, 'Staff task requests need approval', 'Requested'],
      ['Revision Required', revision, 'Sent back for correction', 'Revision Required'],
      ['No Update 3 Days', stale, 'Needs follow-up', 'No Update 3 Days'],
      ['Overdue', overdue, 'Due date crossed', 'Overdue']
    ];
    $('reviewSummaryGrid').innerHTML = cards.map(([label,count,hint,filter])=>`<button class="review-summary-card" data-review-filter="${escapeHtml(filter)}"><b>${count}</b><span>${escapeHtml(label)}</span><small>${escapeHtml(hint)}</small></button>`).join('');
  }
  if($('reviewWaitingList')){
    const waitRows = sortedRows(rows.filter(t=>['Ready for Check','Requested','Revision Required'].includes(t.status) && !isDeleted(t)),'Due Date').slice(0,6);
    $('reviewWaitingList').innerHTML = waitRows.length ? waitRows.map(taskRow).join('') : `<p>No review/correction items right now.</p>`;
  }

  renderTeamPie(rows);
}

function renderTeamPie(rows){
  const box=$('teamPieList'); if(!box) return;
  const user=currentUser();
  if(user?.role === 'Staff'){ box.innerHTML=''; return; }
  const candidates = activePeople().filter(p=>['Manager','Staff'].includes(p.role) && visiblePeopleCodes().includes(p.code));
  const peopleWithData = candidates.map(p=>{
    const tasks = rows.filter(t=>t.assignedTo===p.code && !isDeleted(t));
    const pending = tasks.filter(t=>['Requested','Pending','In Progress','Revision Required','Ready for Check'].includes(t.status)).length;
    const latest = tasks.map(t=>new Date(t.lastUpdated || t.dateAssigned || 0).getTime()).sort((a,b)=>b-a)[0] || 0;
    return {p,tasks,pending,total:tasks.length,latest};
  }).filter(x=>x.total>0).sort((a,b)=>b.latest-a.latest).slice(0,4);
  if(!peopleWithData.length){ box.innerHTML='<p>No team task data yet.</p>'; return; }
  box.innerHTML = peopleWithData.map(x=>{
    const pct = x.total ? Math.round(x.pending/x.total*100) : 0;
    return `<div class="team-pie-card"><div class="mini-donut" style="--pct:${pct}"><span>${x.pending}/${x.total}</span></div><div><b>${escapeHtml(x.p.name)}</b><small>${escapeHtml(x.p.role)} · ${escapeHtml(x.p.code)}</small><em>${x.pending} pending of ${x.total} total</em></div></div>`;
  }).join('');
}

function openTaskInUpdate(taskId){
  if(!taskId) return;
  showView('update');
  setTimeout(()=>{ const sel=$('updateTaskId'); if(sel){ sel.value=taskId; renderSelectedTaskDetail(); } }, 0);
}
function handleDashboardTaskOpen(e){
  const summary=e.target.closest('.review-summary-card');
  if(summary){ showView('tasks'); const f=$('filterQuick'); if(f){ f.value=summary.dataset.reviewFilter || 'Open Tasks'; renderTaskTable(); } return; }
  const row=e.target.closest('.dashboard-open-task');
  if(!row || e.target.closest('button,a,select,input,textarea')) return;
  openTaskInUpdate(row.dataset.taskId);
}
function handleDashboardTaskKey(e){
  const row=e.target.closest?.('.dashboard-open-task');
  if(!row) return;
  if(e.key==='Enter' || e.key===' '){ e.preventDefault(); openTaskInUpdate(row.dataset.taskId); }
}
function taskRow(t){
  const status = isOverdue(t)?'Overdue':t.status;
  const edit = canEditTask(t) ? `<button class="pill edit-task dashboard-edit" data-task-id="${escapeHtml(t.taskId)}" type="button">Edit</button>` : '';
  return `<div class="task-row dashboard-open-task" data-task-id="${escapeHtml(t.taskId)}" tabindex="0" role="button" title="Open Update / Review for ${escapeHtml(t.taskId)}"><div class="circle"></div><div><div class="task-title">${escapeHtml(t.taskDescription)}</div><div class="task-meta">${escapeHtml(personByCode(t.assignedTo)?.name || t.assignedTo)} • Due ${escapeHtml(formatDateReadable(t.dueDate))}</div></div><span class="badge ${cssToken(t.priority)}">${escapeHtml(t.priority)}</span><span class="badge status ${statusClass(status)}">${escapeHtml(status)}</span>${edit}</div>`;
}
function canEditTask(t){ const user=currentUser(); if(!user || isDeleted(t)) return false; if(user.role==='Owner') return true; if(user.role==='Manager') return visiblePeopleCodes().includes(t.assignedTo); if(user.role==='Staff') return t.assignedTo===user.code && ['Requested','Pending','In Progress','Revision Required'].includes(t.status); return false; }
function renderTaskTable(){
  const rows = filteredTaskRows();
  const user = currentUser();
  const showActions = ['Owner','Manager','Staff'].includes(user?.role);
  const head = $('taskActionHead'); if(head) head.style.display = showActions ? 'table-cell' : 'none';
  $('taskTableBody').innerHTML = rows.length ? rows.map(t=>{
    const deleted=isDeleted(t); const safeLink=safeUrl(t.drawingLink); const link=safeLink ? `<a class="link-pill" href="${escapeHtml(safeLink)}" target="_blank" rel="noopener noreferrer">Open link</a>` : '-';
    const safeTaskId = escapeHtml(t.taskId);
    const status = deleted ? 'Deleted' : isOverdue(t) ? 'Overdue' : t.status;
    const actions = showActions ? `<td>${canEditTask(t)?`<button class="pill edit-task" data-task-id="${safeTaskId}">Edit</button>`:''}${user.role==='Owner'?` ${deleted?`<button class="pill restore-task" data-task-id="${safeTaskId}">Restore</button>`:`<button class="pill danger-task delete-task" data-task-id="${safeTaskId}">Delete</button>`}`:''}</td>` : '';
    return `<tr class="${deleted?'soft-deleted':''}"><td><b>${safeTaskId}</b></td><td>${escapeHtml(t.taskDescription)}</td><td>${escapeHtml(t.assignedTo)}<br><small>${escapeHtml(personByCode(t.assignedTo)?.name || deletedPersonLabel(t.assignedTo))}</small></td><td><span class="badge ${cssToken(t.priority)}">${escapeHtml(t.priority)}</span></td><td>${escapeHtml(formatDateReadable(t.dueDate))}</td><td><span class="badge status ${statusClass(status)}">${escapeHtml(status)}</span></td><td>${escapeHtml(t.staffRemarks || t.checkRemarks || '-')}</td><td>${link}</td>${actions}</tr>`;
  }).join('') : `<tr><td colspan="${showActions ? 9 : 8}">No tasks match selected filters.</td></tr>`;
}
function statusOptionsForTask(user, task){
  if(!user || !task) return [];
  if(user.role==='Staff'){
    if(task.status === 'Requested') return ['Cancelled'];
    return state.config.staffAllowedStatuses || ['Pending','In Progress','Ready for Check'];
  }
  if(task?.status === 'Requested') return ['Pending','Cancelled'];
  if(task?.status === 'Ready for Check') return ['Completed','Revision Required'];
  return [];
}
function renderUpdateOptions(){
  const user=currentUser();
  let rows = visibleTasks().filter(t=> t.status !== 'Completed' && t.status !== 'Cancelled');
  if(user.role !== 'Staff') rows = rows.filter(t=>['Ready for Check','Requested'].includes(t.status));
  $('updateTaskId').innerHTML = rows.map(t=>optionHtml(t.taskId, `${t.taskId} — ${clean(t.taskDescription).slice(0,55)}`)).join('') || '<option value="">No eligible task</option>';
  renderSelectedTaskDetail();
}
function renderSelectedTaskDetail(){
  const id=$('updateTaskId').value; const t=state.tasks.find(x=>x.taskId===id); const user=currentUser();
  const opts = t ? statusOptionsForTask(user, t) : [];
  $('updateStatus').innerHTML = opts.length ? opts.map(x=>optionHtml(x)).join('') : '<option value="">No valid status</option>';
  if(!t){ $('selectedTaskDetail').innerHTML='<h2>Selected Task</h2><p>No eligible task selected.</p>'; return; }
  const reviewWarning = user.role !== 'Staff' ? '<div class="staff-capacity-note">Refresh before reviewing if this page has been open for a long time.</div>' : '';
  const canOwnerManagerEdit = ['Owner','Manager'].includes(user.role) && canEditTask(t);
  const editButton = canOwnerManagerEdit ? `<button class="pill edit-task selected-task-edit-btn" data-task-id="${escapeHtml(t.taskId)}" type="button">Edit Selected Task Details</button>` : '';
  const rows = [['Task ID',t.taskId],['Description',t.taskDescription],['Assigned To',`${personByCode(t.assignedTo)?.name || ''} (${t.assignedTo})`],['Priority',t.priority],['Due Date',formatDateReadable(t.dueDate)],['Status',t.status],['Staff Remarks',t.staffRemarks || '-'],['Check Remarks',t.checkRemarks || '-'],['Link',t.drawingLink || '-'],['History',t.historyNotes || '-']];
  $('selectedTaskDetail').innerHTML = `<div class="selected-task-head"><h2>Selected Task</h2>${editButton}</div>${reviewWarning}${rows.map(([k,v])=>`<div class="detail-line"><b>${k}</b><span>${escapeHtml(v)}</span></div>`).join('')}<div class="staff-capacity-note">Owner/Manager can edit task description, assignee, priority, due date and file link from this button. Status and review remarks are updated from the form on the left.</div>`;
}
function renderTeam(){
  const codes=visiblePeopleCodes(); const rows=people().filter(s=>codes.includes(s.code));
  $('teamTableBody').innerHTML=rows.map(s=>`<tr><td><b>${escapeHtml(s.code)}</b></td><td>${escapeHtml(s.name)}</td><td>${escapeHtml(s.role)}</td><td>${escapeHtml(s.managerCode || '-')}</td><td>${escapeHtml(s.email || '-')}</td><td>${escapeHtml(s.active || 'Yes')}</td><td>${state.tasks.filter(t=>t.assignedTo===s.code && isOpen(t)).length}</td></tr>`).join('') + `<tr><td colspan="7"><div class="staff-capacity-note">Active limits: ${activePeople().length}/${maxPeople()} people total, ${activeByRole('Owner').length}/${maxOwners()} owners. Managers and staff share the 30-person cap. Inactive people remain in task history.</div></td></tr>`;
}

function canEditPerson(target){ const user = currentUser(); if(!user || !target) return false; if(user.role === 'Owner') return true; if(user.role === 'Manager') return target.role === 'Staff' && target.managerCode === user.code; return false; }
function peopleRowsForUser(){ const user=currentUser(); if(!user) return []; if(user.role === 'Owner') return people(); if(user.role === 'Manager') return people().filter(s => s.role === 'Staff' && s.managerCode === user.code); return []; }
function renderPeople(){
  const list = $('peopleList'); if(!list) return; const rows = peopleRowsForUser(); const user=currentUser();
  $('peopleHelp').textContent = user.role === 'Owner' ? 'Owner can add, rename, set email/PIN, assign managers and deactivate people.' : 'Manager can rename and set PIN for staff under their team only.';
  $('personForm').style.display = ['Owner','Manager'].includes(user.role) ? 'grid' : 'none';
  if(!rows.length){ list.innerHTML = `<div class="empty-state"><b>No people settings available.</b><span>Staff cannot manage users.</span></div>`; return; }
  list.innerHTML = rows.map(s=>{ const editable = canEditPerson(s); const managerName = s.managerCode ? (personByCode(s.managerCode)?.name || s.managerCode) : '-'; const deleted = s.deleted === 'Yes'; const canDelete = currentUser()?.role === 'Owner' && ['Manager','Staff'].includes(s.role); return `<div class="person-row ${deleted ? 'deleted-person' : ''}" data-code="${escapeHtml(s.code)}"><div class="person-avatar">${escapeHtml(initials(s.name || s.code))}</div><div class="person-info"><b>${escapeHtml(s.code)} · ${escapeHtml(s.role)}${deleted ? ' · Deleted' : ''}</b><small>${escapeHtml(s.email || '-')} · Manager: ${escapeHtml(managerName)} · ${escapeHtml(s.active || 'Yes')}</small></div><button class="pill edit-person" data-code="${escapeHtml(s.code)}" ${editable && !deleted ? '' : 'disabled'}>Edit</button><button class="pill danger-person" data-code="${escapeHtml(s.code)}" ${editable && s.role==='Staff' && !deleted ? '' : 'disabled'}>${s.active==='No'?'Activate':'Deactivate'}</button><button class="pill danger-task delete-person" data-code="${escapeHtml(s.code)}" ${canDelete && !deleted ? '' : 'disabled'}>Delete</button></div>`; }).join('') + `<div class="staff-capacity-note">Owner can delete tasks and staff/manager records. If a person has task history, deletion becomes safe deactivation so old records stay readable.</div>`;
}
function renderPersonFormRules(){
  const user=currentUser(); if(!user) return;
  const role=$('personRole')?.value || 'Staff';
  const managers = activeByRole('Manager');
  $('personManager').innerHTML = ['<option value="">No manager</option>', ...managers.map(m=>optionHtml(m.code, `${m.name} (${m.code})`))].join('');
  if(user.role==='Manager'){ $('personRole').value='Staff'; $('personRole').disabled=true; $('personManager').value=user.code; $('personManager').disabled=true; }
  else { $('personRole').disabled=false; $('personManager').disabled = role !== 'Staff'; }
  $('personCode').readOnly = true;
  if(!$('personEditingCode').value) $('personCode').value = nextPersonCode(role);
}

function nextPersonCode(role=$('personRole')?.value || 'Staff'){ const prefix = role === 'Owner' ? 'O' : role === 'Manager' ? 'M' : 'S'; const nums = people().filter(p=>String(p.code).startsWith(prefix)).map(p=>Number(String(p.code).replace(prefix,''))).filter(Boolean); return `${prefix}${String(Math.max(0,...nums)+1).padStart(3,'0')}`; }
function clearPersonForm(){ ['personEditingCode','personName','personEmail','personPin'].forEach(id=>$(id).value=''); $('personActive').value='Yes'; $('personRole').value='Staff'; $('personCode').value=nextPersonCode('Staff'); renderPersonFormRules(); }
async function handlePeopleActions(e){
  const edit = e.target.closest('.edit-person');
  const danger=e.target.closest('.danger-person');
  const del=e.target.closest('.delete-person');
  if(edit){ const p=personByCode(edit.dataset.code); if(!p) return; $('personEditingCode').value=p.code; $('personCode').value=p.code; $('personName').value=p.name||''; $('personEmail').value=p.email||''; $('personPin').value= API_URL ? '' : (p.pin||''); $('personRole').value=p.role; $('personManager').value=p.managerCode||''; $('personActive').value=p.active||'Yes'; renderPersonFormRules(); showView('people'); return; }
  if(danger){ const p=personByCode(danger.dataset.code); if(!p || !canEditPerson(p)) return; const nextActive = p.active==='No' ? 'Yes' : 'No';
    if(API_URL){ try{ const payload = await apiPost({ action:'upsertPerson', person:{...p, active:nextActive} }); master = payload.data || await fetchBootstrap(); state = JSON.parse(JSON.stringify(master)); renderAll(); toast(`${p.name} ${nextActive==='No'?'deactivated':'activated'}`); } catch(err){ showError(err); } return; }
    p.active = nextActive; saveState(); renderAll(); toast(`${p.name} ${p.active==='No'?'deactivated':'activated'}`); return; }
  if(del){ await deletePerson(del.dataset.code); return; }
}

async function deletePerson(code){
  const user=currentUser(); const p=personByCode(code);
  if(!p || user?.role !== 'Owner'){ toast('Only Owner can delete staff/manager.'); return; }
  if(!['Manager','Staff'].includes(p.role)){ toast('Owner records cannot be deleted from this button.'); return; }
  if(p.code === user.code){ toast('You cannot delete your own login.'); return; }
  const hasHistory = personHasTaskHistory(code);
  const msg = hasHistory ? `Delete ${p.name}? This person has task history, so they will be safely deactivated and hidden from login/assignment.` : `Delete ${p.name}? This will remove the record.`;
  if(!confirm(msg)) return;
  try{
    if(API_URL){ const payload = await apiPost({ action:'deletePerson', userCode:user.code, personCode:code }); master = payload.data || await fetchBootstrap(); state = JSON.parse(JSON.stringify(master)); }
    else if(hasHistory){ Object.assign(p,{ active:'No', deleted:'Yes', email:'', pin:'', notes:`Deleted by ${user.code} on ${todayISO()} — kept for task history` }); addAudit('PERSON_DEACTIVATED', code, 'Has task history; preserved safely'); }
    else { state.staff = state.staff.filter(x=>x.code!==code); addAudit('PERSON_DELETED', code, 'No task history; record removed'); }
    saveState(); clearPersonForm(); renderAll(); toast(hasHistory ? 'Person deactivated and preserved for history' : 'Person deleted');
  }catch(err){ showError(err); }
}

async function handleTaskDeleteActions(e){
  const edit = e.target.closest('.edit-task');
  const restore = e.target.closest('.restore-task');
  const btn = e.target.closest('.delete-task');
  if(edit){ openTaskEdit(edit.dataset.taskId); return; }
  if(restore){ await restoreTask(restore.dataset.taskId); return; }
  if(btn){ await deleteTask(btn.dataset.taskId); return; }
}

async function restoreTask(taskId){
  const user=currentUser(); if(user?.role !== 'Owner'){ toast('Only Owner can restore tasks.'); return; }
  const t=state.tasks.find(x=>x.taskId===taskId); if(!t) return;
  try{
    if(API_URL){ const payload = await apiPost({ action:'restoreTask', taskId }); master = payload.data || await fetchBootstrap(); state = JSON.parse(JSON.stringify(master)); }
    else { t.deleted='No'; t.archived='No'; t.lastUpdated=todayISO(); addTimeline(t,'Restored','Task restored by owner'); addAudit('TASK_RESTORED', taskId, 'Soft-deleted task restored'); }
    saveState(); renderAll(); toast(`Task ${taskId} restored`);
  }catch(err){ showError(err); }
}
function openTaskEdit(taskId){
  const t=state.tasks.find(x=>x.taskId===taskId); if(!t || !canEditTask(t)){ toast('You cannot edit this task.'); return; }
  $('editTaskId').value=t.taskId; $('editDescription').value=t.taskDescription || ''; $('editDueDate').value=t.dueDate || ''; $('editLink').value=t.drawingLink || ''; $('editNote').value='';
  fillSelect('editPriority', state.config.priorities, t.priority);
  const user=currentUser(); let allowed=[]; if(user.role==='Owner') allowed=activePeople(); else if(user.role==='Manager') allowed=activePeople().filter(p=>p.code===user.code || p.managerCode===user.code); else allowed=[user];
  $('editAssignee').innerHTML=allowed.map(p=>optionHtml(p.code, `${p.name} (${p.role})`)).join(''); $('editAssignee').value=t.assignedTo;
  $('taskEditModal').classList.remove('hidden');
}
async function submitTaskEdit(e){
  e.preventDefault(); if(formBusy(e, true, 'Saving edit...')) return; const user=currentUser(); const id=$('editTaskId').value; const t=state.tasks.find(x=>x.taskId===id); if(!t || !canEditTask(t)){ formBusy(e, false); toast('Edit not allowed'); return; }
  try{
    if(API_URL){ const payload = await apiPost({ action:'editTask', taskId:id, taskDescription:clean($('editDescription').value), assignedTo:$('editAssignee').value, priority:$('editPriority').value, dueDate:$('editDueDate').value, drawingLink:clean($('editLink').value), note:clean($('editNote').value) }); master = payload.data || await fetchBootstrap(); state = JSON.parse(JSON.stringify(master)); }
    else { const old=`${t.taskDescription} | ${t.assignedTo} | ${t.priority} | ${t.dueDate}`; t.taskDescription=clean($('editDescription').value); t.assignedTo=$('editAssignee').value; t.priority=$('editPriority').value; t.dueDate=$('editDueDate').value; t.drawingLink=clean($('editLink').value); t.lastUpdated=todayISO(); addTimeline(t,'Edited', clean($('editNote').value)); addAudit('TASK_EDITED', id, `Old: ${old}`); saveState(); }
    $('taskEditModal').classList.add('hidden'); renderAll(); toast('Task edited');
  }catch(err){ showError(err); } finally { formBusy(e, false); }
}


async function deleteTask(taskId){
  const user=currentUser();
  if(user?.role !== 'Owner'){ toast('Only Owner can delete tasks.'); return; }
  const t=state.tasks.find(x=>x.taskId===taskId); if(!t) return;
  if(!confirm(`Delete task ${taskId}? This removes it from active task records. Keep backups before deleting important work.`)) return;
  try{
    if(API_URL){ const payload = await apiPost({ action:'deleteTask', userCode:user.code, taskId }); master = payload.data || await fetchBootstrap(); state = JSON.parse(JSON.stringify(master)); }
    else { t.deleted='Yes'; t.archived='Yes'; t.lastUpdated=todayISO(); addTimeline(t,'Deleted',`Soft deleted by ${user.code}`); addAudit('TASK_DELETED', taskId, 'Soft delete / archived'); }
    saveState(); renderAll(); toast(`Task ${taskId} moved to Deleted / Archive`);
  }catch(err){ showError(err); }
}

async function submitPerson(e){
  e.preventDefault(); if(formBusy(e, true, 'Saving person...')) return;
  const user=currentUser(); if(!['Owner','Manager'].includes(user.role)){ formBusy(e, false); toast('Only Owner/Manager can manage people'); return; }
  const editingCode=clean($('personEditingCode').value); const role=$('personRole').value; const target = editingCode ? personByCode(editingCode) : null;
  const codeForLocalChecks=editingCode || nextPersonCode(role);
  const pinValue = clean($('personPin').value);
  const record={ code: editingCode || (API_URL ? '' : codeForLocalChecks), name:clean($('personName').value), role, email:clean($('personEmail').value), pin:pinValue, managerCode: role==='Staff' ? $('personManager').value : (role==='Manager' ? currentUser().code : ''), active:$('personActive').value, notes:`Updated ${todayISO()} by ${user.code}` };
  if(!record.name){ formBusy(e, false); toast('Name is required.'); return; }
  if(!target && !pinValue){ formBusy(e, false); toast('PIN is required for a new person.'); return; }
  if(role !== 'Staff' && user.role !== 'Owner'){ formBusy(e, false); toast('Manager can add/edit staff only.'); return; }
  if(target && !canEditPerson(target)){ formBusy(e, false); toast('You cannot edit this person.'); return; }
  if(target?.role === 'Owner' && target.code === user.code && (record.active === 'No' || record.role !== 'Owner')){ formBusy(e, false); toast('You cannot deactivate or demote your own owner login.'); return; }
  const willBeActive = record.active !== 'No';
  const ownerCountExcludingTarget = activeByRole('Owner').filter(p => p.code !== codeForLocalChecks).length;
  const activeCountExcludingTarget = activePeople().filter(p => p.code !== codeForLocalChecks).length;
  if(target?.role === 'Owner' && !willBeActive && ownerCountExcludingTarget < 1){ formBusy(e, false); toast('At least one active owner must remain.'); return; }
  if(willBeActive){
    if(role === 'Owner' && ownerCountExcludingTarget >= maxOwners()){ formBusy(e, false); toast('Maximum 2 active owners allowed.'); return; }
    if(activeCountExcludingTarget >= maxPeople()){ formBusy(e, false); toast('Maximum 30 active people allowed. Deactivate someone first.'); return; }
  }
  if(user.role==='Manager'){ record.role='Staff'; record.managerCode=user.code; }
  try{
    if(API_URL){ const payload = await apiPost({ action:'upsertPerson', userCode:user.code, person:record }); master = payload.data || await fetchBootstrap(); state = JSON.parse(JSON.stringify(master)); }
    else { if(target) Object.assign(target, {...record, pin: pinValue || target.pin}); else state.staff.push(record); saveState(); }
    if(!API_URL) addAudit(target ? 'PERSON_UPDATED' : 'PERSON_CREATED', record.code, `${record.role} ${record.name}`); saveState(); clearPersonForm(); renderAll(); toast(target ? 'Person updated' : 'New person added');
  }catch(err){ showError(err); } finally { formBusy(e, false); }
}


function renderLoginSecurity(){
  const box=$('loginSecurityList'); if(!box) return;
  const user=currentUser();
  if(!['Owner','Manager'].includes(user?.role)){ box.innerHTML='<p>Login security is visible to Owner/Manager only.</p>'; return; }
  const sessions = state.loginSessions || [];
  if(!sessions.length){ box.innerHTML='<p>Login session tracking will appear here after live Apps Script is updated and users login again.</p>'; return; }
  const codes=visiblePeopleCodes();
  const rows=sessions.filter(x=>codes.includes(x.code)).slice(0,12);
  box.innerHTML = rows.length ? rows.map(x=>`<div class="login-session-row"><b>${escapeHtml(personByCode(x.code)?.name || x.code)}</b><span>${escapeHtml(x.loginTime || '-')} · ${escapeHtml(x.duration || '-')}</span><small>IP: ${escapeHtml(x.ip || 'Unavailable')} · ${escapeHtml(x.ipChanged || 'Same/unknown')} · ${escapeHtml(x.device || '-')}</small></div>`).join('') : '<p>No visible login sessions yet.</p>';
}

function normalizeAudit(a){ return { category:a.category || auditCategory(a.action || ''), role:a.role || personByCode(a.by)?.role || '', oldValue:a.oldValue || '', newValue:a.newValue || '', reason:a.reason || a.detail || '', ...a }; }
function refreshAuditFilterOptions(rows){
  const current = id => $(id)?.value || 'All';
  const cats=['All',...new Set(rows.map(a=>normalizeAudit(a).category).filter(Boolean))];
  const actions=['All',...new Set(rows.map(a=>a.action).filter(Boolean))].sort();
  const users=['All',...new Set(rows.map(a=>a.by).filter(Boolean))];
  const fill=(id,items,val,label)=>{ const el=$(id); if(!el) return; el.innerHTML=items.map(x=>`<option value="${escapeHtml(x)}">${escapeHtml(x==='All'?'All '+label:personByCode(x)?.name || x)}</option>`).join(''); el.value=items.includes(val)?val:'All'; };
  fill('auditCategoryFilter',cats,current('auditCategoryFilter'),'Categories');
  fill('auditActionFilter',actions,current('auditActionFilter'),'Actions');
  fill('auditUserFilter',users,current('auditUserFilter'),'Users');
}
function filteredAuditRows(){
  const all=(state.auditLogs||[]).map(normalizeAudit);
  refreshAuditFilterOptions(all);
  let rows=[...all];
  const cat=$('auditCategoryFilter')?.value || 'All', act=$('auditActionFilter')?.value || 'All', usr=$('auditUserFilter')?.value || 'All';
  const from=$('auditDateFrom')?.value, to=$('auditDateTo')?.value, q=clean($('auditSearch')?.value).toLowerCase();
  if(cat!=='All') rows=rows.filter(a=>a.category===cat);
  if(act!=='All') rows=rows.filter(a=>a.action===act);
  if(usr!=='All') rows=rows.filter(a=>a.by===usr);
  if(from) rows=rows.filter(a=>clean(a.time).slice(0,10)>=from);
  if(to) rows=rows.filter(a=>clean(a.time).slice(0,10)<=to);
  if(q) rows=rows.filter(a=>[a.time,a.by,a.role,a.category,a.action,a.target,a.detail,a.oldValue,a.newValue,a.reason].some(v=>clean(v).toLowerCase().includes(q)));
  return rows;
}
function renderAudit(){
  const body=$('auditTableBody'); if(!body) return;
  const all=(state.auditLogs||[]).map(normalizeAudit);
  if($('auditTotalCount')) $('auditTotalCount').textContent=all.length;
  if($('auditSecurityCount')) $('auditSecurityCount').textContent=all.filter(a=>a.category==='Security').length;
  if($('auditDeleteCount')) $('auditDeleteCount').textContent=all.filter(a=>a.category==='Delete / Archive').length;
  const rows=filteredAuditRows().slice(0,150);
  body.innerHTML = rows.length ? rows.map(a=>`<tr><td>${escapeHtml(a.time)}</td><td><b>${escapeHtml(personByCode(a.by)?.name || a.by)}</b><div class="audit-note">${escapeHtml(a.role || personByCode(a.by)?.role || '')}</div></td><td><span class="badge">${escapeHtml(a.category)}</span></td><td><b>${escapeHtml(a.action)}</b></td><td>${escapeHtml(a.target)}</td><td><div class="audit-change"><span>${escapeHtml(a.oldValue)}</span><b>→</b><span>${escapeHtml(a.newValue)}</span></div></td><td>${escapeHtml(a.reason || a.detail)}</td></tr>`).join('') : '<tr><td colspan="7">No audit activity found for the selected filters.</td></tr>';
}
function csvEscape(v){ return '"'+clean(v).replaceAll('"','""')+'"'; }
function downloadFile(name, text){ const blob=new Blob([text],{type:'text/csv'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=name; a.click(); URL.revokeObjectURL(url); }
function dateStamp(){ return new Date().toISOString().slice(0,10); }
function taskCsv(rows=state.tasks||[]){ const headers=['Task ID','Description','Assigned To','Assigned Name','Priority','Due Date','Status','Deleted','Archived','Staff Remarks','Check Remarks','Link','Created By','Checked By','Last Updated']; return [headers.join(','),...rows.map(t=>[t.taskId,t.taskDescription,t.assignedTo,personByCode(t.assignedTo)?.name||'',t.priority,t.dueDate,t.status,t.deleted,t.archived,t.staffRemarks,t.checkRemarks,t.drawingLink,t.createdBy,t.checkedBy,t.lastUpdated].map(csvEscape).join(','))].join('\n'); }
function peopleCsv(rows=people()){ const headers=['Code','Name','Role','Email','Manager Code','Manager Name','Active','Deleted','Notes']; return [headers.join(','),...rows.map(p=>[p.code,p.name,p.role,p.email,p.managerCode,personByCode(p.managerCode)?.name||'',p.active,p.deleted,p.notes].map(csvEscape).join(','))].join('\n'); }
function auditCsv(rows=state.auditLogs||[]){ const headers=['Time','By Code','By Name','Role','Category','Action','Record','Old Value','New Value','Reason','Detail']; return [headers.join(','),...rows.map(x=>normalizeAudit(x)).map(a=>[a.time,a.by,personByCode(a.by)?.name||a.by,a.role||'',a.category,a.action,a.target,a.oldValue,a.newValue,a.reason,a.detail].map(csvEscape).join(','))].join('\n'); }
function remarksCsv(rows=state.tasks||[]){ const headers=['Task ID','Timeline Date','By Code','By Name','Action','Note']; const lines=[]; rows.forEach(t=>(t.timeline||[]).forEach(r=>lines.push([t.taskId,r.date,r.by,personByCode(r.by)?.name||r.by,r.action,r.note].map(csvEscape).join(',')))); return [headers.join(','),...lines].join('\n'); }
async function liveBackup(type){ if(!API_URL) return null; const payload=await apiPost({ action:'backup', backupType:type }); return payload.data; }
async function exportCsv(type, btn){ const user=currentUser(); if(user?.role!=='Owner'){ toast('Only Owner can export backup.'); return; }
  if(btn?.dataset.busy === '1') return; setButtonBusy(btn, true, 'Preparing backup...');
  try{
    let live=null; if(API_URL) live=await liveBackup(type);
    if(type==='audit'){ downloadFile(`parkar-audit-log-${dateStamp()}.csv`, live?.csv || auditCsv()); if(!API_URL) addAudit('EXPORT_AUDIT','AUDIT','Audit CSV exported'); saveState(); renderAudit(); return; }
    if(type==='people'){ downloadFile(`parkar-people-backup-${dateStamp()}.csv`, live?.csv || peopleCsv()); if(!API_URL) addAudit('EXPORT_PEOPLE','PEOPLE','People CSV backup exported'); saveState(); renderAudit(); return; }
    downloadFile(`parkar-task-backup-${dateStamp()}.csv`, live?.csv || taskCsv()); if(!API_URL) addAudit('EXPORT_TASKS','TASKS','Task CSV backup exported'); saveState(); renderAudit();
  }catch(err){ showError(err); } finally { setButtonBusy(btn, false); }
}
async function exportFullBackup(btn){ const user=currentUser(); if(user?.role!=='Owner'){ toast('Only Owner can export backup.'); return; }
  if(btn?.dataset.busy === '1') return; setButtonBusy(btn, true, 'Preparing backup...');
  try{
    const d=dateStamp(); let live=null; if(API_URL) live=await liveBackup('full');
    const files=live?.files || [{name:`parkar-tasks-${d}.csv`,csv:taskCsv()},{name:`parkar-people-${d}.csv`,csv:peopleCsv()},{name:`parkar-audit-${d}.csv`,csv:auditCsv()},{name:`parkar-remarks-timeline-${d}.csv`,csv:remarksCsv()}];
    files.forEach(f=>downloadFile(f.name, f.csv)); if(!API_URL) addAudit('EXPORT_FULL_BACKUP','BACKUP','Full backup exported'); saveState(); renderAudit(); toast('Full backup files downloaded');
  }catch(err){ showError(err); } finally { setButtonBusy(btn, false); }
}
async function archiveCompletedTasks(){ const user=currentUser(); if(user?.role!=='Owner'){ toast('Only Owner can archive.'); return; }
  try{
    if(API_URL){ const payload = await apiPost({ action:'archiveCompleted' }); master = payload.data || await fetchBootstrap(); state = JSON.parse(JSON.stringify(master)); renderAll(); toast('Completed tasks archived'); return; }
    let count=0; state.tasks.forEach(t=>{ if(t.status==='Completed' && t.archived!=='Yes'){ t.archived='Yes'; addTimeline(t,'Archived','Completed task archived by owner'); count++; }}); addAudit('ARCHIVE_COMPLETED','TASKS',`${count} completed tasks archived`); saveState(); renderAll(); toast(`${count} completed tasks archived`);
  }catch(err){ showError(err); }
}


function nextTaskId(){ const nums = state.tasks.map(t => Number(clean(t.taskId).replace(/^PA-T-/,''))).filter(Boolean); return `PA-T-${String(Math.max(0,...nums)+1).padStart(3,'0')}`; }
async function submitNewTask(e){
  e.preventDefault(); if(formBusy(e, true, 'Submitting task...')) return; const user=currentUser(); const assignee=$('addAssignee').value;
  if(user.role==='Staff' && assignee!==user.code){ formBusy(e, false); toast('Staff can add only own task.'); return; }
  if(user.role==='Manager' && !visiblePeopleCodes().includes(assignee)){ formBusy(e, false); toast('Manager can assign only own team tasks.'); return; }
  const project=defaultTaskGroup(); const staff=personByCode(assignee);
  try { if(API_URL){ const payload = await apiPost({ action:'addTask', userCode:user.code, userRole:user.role, projectCode:project.code, taskDescription:clean($('addDescription').value), assignedTo:assignee, priority:$('addPriority').value, dueDate:$('addDueDate').value, note:clean($('addNote').value), drawingLink:clean($('addLink').value) }); master = payload.data || await fetchBootstrap(); state = JSON.parse(JSON.stringify(master)); }
    else { const t={ taskId: nextTaskId(), dateAssigned: todayISO(), projectCode: project.code, projectName: project.name, taskDescription: clean($('addDescription').value), assignedTo: assignee, assignedRole: staff?.role || 'Staff', managerCode: staff?.role==='Manager'?staff.code:(staff?.managerCode || user.code), priority: $('addPriority').value, dueDate: $('addDueDate').value, status: user.role==='Staff' ? 'Requested' : 'Pending', staffRemarks: user.role==='Staff' ? clean($('addNote').value) : '', checkRemarks: user.role!=='Staff' ? clean($('addNote').value) : '', completedDate:'', lastUpdated: todayISO(), createdBy: user.code, createdRole: user.role, source: user.role==='Staff' ? 'Staff Add Task' : `${user.role} Add Task`, updateCount:0, checkedBy:'', historyNotes:`${todayISO()} created by ${user.code}`, drawingLink: clean($('addLink').value), deleted:'No', archived:'No', timeline:[{date:nowStamp(), by:user.code, action:'Created', note:clean($('addNote').value)}] }; state.tasks.push(t); addAudit('TASK_CREATED', t.taskId, `Assigned to ${assignee}`); saveState(); }
    e.target.reset(); $('addDueDate').value=addDays(2); renderAll(); toast('New task created'); showView('tasks'); } catch(err){ showError(err); } finally { formBusy(e, false); }
}
async function submitUpdate(e){
  e.preventDefault(); if(formBusy(e, true, 'Submitting update...')) return; const user=currentUser(); const id=$('updateTaskId').value; const t=state.tasks.find(x=>x.taskId===id); if(!t){ formBusy(e, false); toast('No eligible task selected'); return; }
  const newStatus=$('updateStatus').value; const remarks=clean($('updateRemarks').value);
  try { if(API_URL){ const payload = await apiPost({ action:'updateTask', userCode:user.code, userRole:user.role, taskId:id, newStatus, remarks }); master = payload.data || await fetchBootstrap(); state = JSON.parse(JSON.stringify(master)); $('updateRemarks').value=''; renderAll(); toast('Task updated'); return; }
    if(user.role==='Staff'){
      if(t.assignedTo!==user.code){ toast('Staff can update only own task'); return; }
      if(['Completed','Cancelled'].includes(t.status)){ toast('Closed task cannot be updated by staff'); return; }
      if(t.status==='Requested' && newStatus!=='Cancelled'){ toast('Requested self-task can only be cancelled by staff or approved by Owner/Manager.'); return; }
      if(t.status!=='Requested' && !(state.config.staffAllowedStatuses||[]).includes(newStatus)){ toast('Staff cannot mark Completed'); return; }
      t.staffRemarks=remarks; addTimeline(t,newStatus,remarks); addAudit('TASK_UPDATED', id, `${newStatus} by staff`);
    }
    else { if(user.role==='Manager' && !visiblePeopleCodes().includes(t.assignedTo)){ toast('Manager cannot review outside team'); return; } if(t.status==='Requested'){ if(!['Pending','Cancelled'].includes(newStatus)){ toast('Requested tasks can only be approved to Pending or Cancelled.'); return; } }
      else { if(t.status!=='Ready for Check'){ toast('Review allowed only when task is Ready for Check'); return; } if(!['Completed','Revision Required'].includes(newStatus)){ toast('Invalid review action'); return; } }
      t.checkRemarks=remarks; t.checkedBy=user.code; if(newStatus==='Completed') t.completedDate=todayISO(); addTimeline(t,newStatus,remarks); addAudit(t.status==='Requested'?'TASK_REQUEST_REVIEWED':'TASK_REVIEWED', id, `${newStatus} by ${user.role}`); }
    t.status=newStatus; t.lastUpdated=todayISO(); t.updateCount=(Number(t.updateCount)||0)+1; t.historyNotes = `${t.historyNotes || ''}\n${todayISO()} ${newStatus} by ${user.code}: ${remarks}`; saveState(); $('updateRemarks').value=''; renderAll(); toast('Task updated'); }
  catch(err){ showError(err); } finally { formBusy(e, false); }
}

boot();


// ---------- v2.6 hardened login UI helpers ----------
async function maybeForcePinChange(user){
  if(!user || !user.mustChangePin) return;
  toast('Please set a new PIN before continuing.');
  const changed = await openPinChangeModal(true);
  if(!changed){
    clearSession();
    showLogin();
    throw new Error('PIN change is required before continuing.');
  }
}
function resetPinModal(){
  ['pinOld','pinNew','pinConfirm'].forEach(id=>{ const el=$(id); if(el) el.value=''; });
  const err=$('pinModalError'); if(err) err.textContent='';
}
function openPinChangeModal(force=false){
  if(!API_URL){ toast('Change PIN is available after live deployment.'); return Promise.resolve(false); }
  const modal=$('pinChangeModal');
  const form=$('pinChangeForm');
  const cancel=$('cancelPinChange');
  const title=$('pinModalTitle');
  const hint=$('pinModalHint');
  resetPinModal();
  if(title) title.textContent = force ? 'Set New PIN' : 'Change PIN';
  if(hint) hint.textContent = force ? 'Your current PIN must be changed before continuing.' : 'Use a non-trivial PIN. Avoid 1234, 1111, or simple sequences.';
  if(cancel) cancel.style.display = force ? 'none' : '';
  modal.classList.remove('hidden');
  return new Promise(resolve=>{
    const cleanup=()=>{ form.removeEventListener('submit', onSubmit); cancel?.removeEventListener('click', onCancel); };
    const close=(value)=>{ cleanup(); modal.classList.add('hidden'); resetPinModal(); resolve(value); };
    const onCancel=()=>close(false);
    const onSubmit=async(e)=>{
      e.preventDefault();
      const oldPin=clean($('pinOld').value), newPin=clean($('pinNew').value), confirm=clean($('pinConfirm').value);
      const err=$('pinModalError'); if(err) err.textContent='';
      if(!oldPin || !newPin || !confirm){ if(err) err.textContent='Fill all PIN fields.'; return; }
      if(newPin !== confirm){ if(err) err.textContent='New PIN and confirm PIN do not match.'; return; }
      try{
        if(formBusy(e, true, 'Saving PIN...')) return;
        const payload = await apiPost({ action:'changePin', oldPin, newPin });
        master = payload.data || master;
        state = JSON.parse(JSON.stringify(master));
        toast('PIN updated.');
        close(true);
      } catch(error){ if(err) err.textContent = error?.message || 'Could not change PIN.'; }
      finally{ formBusy(e, false); }
    };
    form.addEventListener('submit', onSubmit);
    cancel?.addEventListener('click', onCancel);
  });
}
async function runSystemStatusCheck(){
  const box=$('systemStatusBody');
  const modal=$('systemStatusModal');
  if(box) box.innerHTML = '<p>Checking system...</p>';
  modal?.classList.remove('hidden');
  try{
    let status;
    if(API_URL){
      const payload = await apiPost({ action:'systemStatus' });
      status = payload.status || {};
    } else {
      status = { frontendVersion:APP_VERSION, backendVersion:'Preview mode', loggedInUser:currentUser()?.name || '-', sheetConnection:'Not connected in preview', writePermission:'Not tested in preview' };
    }
    if(box) box.innerHTML = `
      <div class="status-check-grid">
        <div><b>Frontend</b><span>${escapeHtml(status.frontendVersion || APP_VERSION)}</span></div>
        <div><b>Server</b><span>${escapeHtml(status.backendVersion || '-')}</span></div>
        <div><b>Logged-in user</b><span>${escapeHtml(status.loggedInUser || '-')}</span></div>
        <div><b>Sheet connection</b><span>${escapeHtml(status.sheetConnection || '-')}</span></div>
        <div><b>Write permission</b><span>${escapeHtml(status.writePermission || '-')}</span></div>
        <div><b>Checked at</b><span>${escapeHtml(status.checkedAt || nowStamp())}</span></div>
      </div>`;
  }catch(err){ if(box) box.innerHTML = `<p class="modal-error">${escapeHtml(err?.message || 'Status check failed')}</p>`; }
}
function maybeWarnVersionMismatch(payload){
  try{
    const backendVer = payload && payload.version;
    if(backendVer && backendVer !== APP_VERSION){
      toast('App update available — please refresh.');
    }
  } catch(e){}
}
// ---------- end v2.6 helpers ----------
