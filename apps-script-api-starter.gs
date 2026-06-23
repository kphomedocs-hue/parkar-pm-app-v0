/**
 * Parkar and Associates Task App — LIVE Apps Script API v2.6.0
 * Live Google Sheet API for the Parkar internal task app.
 *
 * Security model:
 * - PINs are stored as salted SHA-256 hashes, never as plaintext.
 * - Login returns a short-lived signed session token.
 * - Every write action validates the token and repeats permissions server-side.
 * - Failed PIN attempts are counted and locked for 15 minutes after 5 failures.
 * - Audit is stored in BE_Audit Log and is not capped in the backend.
 *
 * First-time setup:
 * 1. Paste this file into Apps Script attached to the Google Sheet.
 * 2. Run setupInitialSheets() once from Apps Script editor.
 * 3. Deploy as Web app: Execute as Me, Access Anyone with link / or your Workspace users.
 * 4. Paste the Web App URL into API_URL in app.js.
 */

const APP_VERSION = '2.6.0-hardened-login';
const PIN_HASH_ITERATIONS = 50000;       // PBKDF2-equivalent iterations
const REQUEST_MAX_SKEW_MS = 2 * 60 * 1000; // reject ts older/newer than 2 minutes
const NONCE_TTL_SECONDS = 300;           // reject reused nonce within 5 minutes
const TRIVIAL_PINS = ['0000','1111','2222','3333','4444','5555','6666','7777','8888','9999','1234','4321','1235','0001','9876','1212','1122'];
const SHEET_PEOPLE = 'BE_People Master';
const SHEET_TASKS = 'BE_Task Database';
const SHEET_AUDIT = 'BE_Audit Log';
const SHEET_SETTINGS = 'BE_Settings';
const SESSION_HOURS = 8;
const LOCK_MINUTES = 15;
const MAX_FAILED_ATTEMPTS = 5;

const PEOPLE_HEADERS = ['Code','Name','Role','Email','PinSalt','PinHash','ManagerCode','Active','Deleted','FailedAttempts','LockedUntil','Notes','CreatedAt','UpdatedAt'];
const TASK_HEADERS = ['TaskID','DateAssigned','TaskDescription','AssignedTo','ManagerCode','Priority','DueDate','Status','StaffRemarks','CheckRemarks','CompletedDate','LastUpdated','CreatedBy','CreatedRole','Source','UpdateCount','CheckedBy','HistoryNotes','DrawingLink','Deleted','Archived','TimelineJSON'];
const AUDIT_HEADERS = ['Time','ActorCode','ActorName','ActorRole','Category','Action','Target','Detail','OldValue','NewValue','Reason'];
const SETTINGS_HEADERS = ['Key','Value'];

function doGet(e) {
  return json_({ ok:true, message:'Parkar Task API is running. Use POST login/bootstrap/actions.', version: APP_VERSION });
}

function doPost(e) {
  try {
    const body = JSON.parse((e.postData && e.postData.contents) || '{}');
    const action = clean_(body.action);
    if (action === 'login') return json_(login_(body));

    const actor = requireActor_(body.token);
    enforceRequestIntegrity_(body);
    if (action === 'bootstrap') return json_({ ok:true, data: bootstrap_(actor) });
    if (action === 'systemStatus') return json_(systemStatus_(actor, body));
    const writeActions = ['addTask','updateTask','editTask','deleteTask','restoreTask','upsertPerson','deletePerson','archiveCompleted','backup','changePin'];
    if (writeActions.indexOf(action) !== -1) {
      return json_(withLock_(function(){
        if (action === 'addTask') return addTask_(actor, body);
        if (action === 'updateTask') return updateTask_(actor, body);
        if (action === 'editTask') return editTask_(actor, body);
        if (action === 'deleteTask') return deleteTask_(actor, body);
        if (action === 'restoreTask') return restoreTask_(actor, body);
        if (action === 'upsertPerson') return upsertPerson_(actor, body);
        if (action === 'deletePerson') return deletePerson_(actor, body);
        if (action === 'archiveCompleted') return archiveCompleted_(actor);
        if (action === 'backup') return backup_(actor, body);
        if (action === 'changePin') return changePin_(actor, body);
      }));
    }
    return json_({ ok:false, error:'Unknown action: ' + action });
  } catch (err) {
    return json_({ ok:false, error: err.message || String(err) });
  }
}


// ---------- v2.6 hardened login helpers ----------
function enforceRequestIntegrity_(body) {
  const ts = Number(body.ts || 0);
  const nonce = clean_(body.nonce);
  if (!ts || Math.abs(Date.now() - ts) > REQUEST_MAX_SKEW_MS) {
    throw new Error('Request expired or clock skew. Please retry.');
  }
  if (!nonce || nonce.length < 12) {
    throw new Error('Missing request nonce.');
  }
  const cache = CacheService.getScriptCache();
  const key = 'nonce:' + nonce;
  if (cache.get(key)) throw new Error('Duplicate request detected.');
  cache.put(key, '1', NONCE_TTL_SECONDS);
}

function hashPinV2_(pin, salt) {
  // Iterated HMAC-SHA256 — PBKDF2-equivalent without the native API.
  var bytes = Utilities.computeHmacSha256Signature(clean_(pin), salt);
  for (var i = 1; i < PIN_HASH_ITERATIONS; i++) {
    bytes = Utilities.computeHmacSha256Signature(bytes, Utilities.newBlob(salt).getBytes());
  }
  return 'v2:' + b64_(bytes);
}

function verifyPin_(pin, person) {
  var stored = clean_(person.PinHash);
  if (!stored) return false;
  if (stored.indexOf('v2:') === 0) {
    return hashPinV2_(pin, person.PinSalt) === stored;
  }
  // legacy v1 (single SHA-256). On match, caller should upgrade silently.
  return hashPin_(pin, person.PinSalt) === stored;
}

function isTrivialPin_(pin) {
  pin = clean_(pin);
  if (!/^[0-9]{4,}$/.test(pin)) return true;          // PINs must be numeric 4+ digits
  if (TRIVIAL_PINS.indexOf(pin) !== -1) return true;
  if (/^(.)\1+$/.test(pin)) return true;              // all-same digit
  if (/^0123|1234|2345|3456|4567|5678|6789|9876|8765|7654|6543|5432|4321|3210$/.test(pin)) return true;
  return false;
}

function changePin_(actor, body) {
  var oldPin = clean_(body.oldPin);
  var newPin = clean_(body.newPin);
  if (!oldPin || !newPin) throw new Error('Old and new PIN are required.');
  if (oldPin === newPin) throw new Error('New PIN must differ from current PIN.');
  if (isTrivialPin_(newPin)) throw new Error('PIN is too weak. Use 4+ digits, not sequential or repeating.');
  var person = getPersonByCode_(actor.Code);
  if (!person || !verifyPin_(oldPin, person)) throw new Error('Current PIN is incorrect.');
  var salt = uuid_();
  writeObjectToRow_(SHEET_PEOPLE, person.__row, {
    PinSalt: salt, PinHash: hashPinV2_(newPin, salt),
    FailedAttempts: 0, LockedUntil: '', UpdatedAt: stamp_()
  });
  addAudit_(actor, 'PIN_CHANGED', actor.Code, 'User rotated PIN', '', '');
  return { ok:true, data: bootstrap_(actor) };
}
// ---------- end v2.6 helpers ----------

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function clean_(v) { return String(v == null ? '' : v).trim(); }
function now_() { return new Date(); }
function today_() { return Utilities.formatDate(now_(), Session.getScriptTimeZone(), 'yyyy-MM-dd'); }
function stamp_() { return Utilities.formatDate(now_(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss'); }
function uuid_() { return Utilities.getUuid().replace(/-/g,''); }
function b64_(bytes) { return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/,''); }
function digestB64_(text) { return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text)); }
function hmacB64_(text) { return b64_(Utilities.computeHmacSha256Signature(text, getSessionSecret_())); }

function getSessionSecret_() {
  const props = PropertiesService.getScriptProperties();
  let secret = props.getProperty('SESSION_SECRET');
  if (!secret) { secret = uuid_() + uuid_(); props.setProperty('SESSION_SECRET', secret); }
  return secret;
}

function hashPin_(pin, salt) {
  return digestB64_(salt + ':' + clean_(pin));
}

function makeToken_(person) {
  const payload = {
    code: person.Code,
    role: person.Role,
    exp: Date.now() + SESSION_HOURS * 60 * 60 * 1000,
    nonce: uuid_().slice(0,16)
  };
  const payloadText = JSON.stringify(payload);
  const encoded = b64_(Utilities.newBlob(payloadText).getBytes());
  const sig = hmacB64_(encoded);
  return encoded + '.' + sig;
}

function verifyToken_(token) {
  token = clean_(token);
  const parts = token.split('.');
  if (parts.length !== 2) throw new Error('Invalid session. Please login again.');
  const encoded = parts[0], sig = parts[1];
  if (hmacB64_(encoded) !== sig) throw new Error('Session signature failed. Please login again.');
  const json = Utilities.newBlob(Utilities.base64DecodeWebSafe(encoded)).getDataAsString();
  const payload = JSON.parse(json);
  if (Date.now() > Number(payload.exp || 0)) throw new Error('Session expired. Please login again.');
  return payload;
}

function requireActor_(token) {
  const payload = verifyToken_(token);
  const person = getPersonByCode_(payload.code);
  if (!person || !isActive_(person)) throw new Error('User is inactive or removed.');
  return person;
}

function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }
function sheet_(name) { const sh = ss_().getSheetByName(name); if (!sh) throw new Error('Missing sheet: ' + name); return sh; }

function ensureSheet_(name, headers) {
  const book = ss_();
  let sh = book.getSheetByName(name);
  if (!sh) sh = book.insertSheet(name);
  const existing = sh.getRange(1,1,1,Math.max(headers.length, sh.getLastColumn() || 1)).getValues()[0].filter(String);
  if (!existing.length) sh.getRange(1,1,1,headers.length).setValues([headers]);
  else {
    const current = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(clean_);
    const missing = headers.filter(h => current.indexOf(h) === -1);
    if (missing.length) sh.getRange(1, current.length + 1, 1, missing.length).setValues([missing]);
  }
  return sh;
}

function setupInitialSheets() {
  ensureSheet_(SHEET_PEOPLE, PEOPLE_HEADERS);
  ensureSheet_(SHEET_TASKS, TASK_HEADERS);
  ensureSheet_(SHEET_AUDIT, AUDIT_HEADERS);
  const settings = ensureSheet_(SHEET_SETTINGS, SETTINGS_HEADERS);
  if (readRows_(SHEET_SETTINGS).length === 0) {
    settings.getRange(2,1,5,2).setValues([
      ['BRAND','Parkar and Associates'],
      ['MAX_ACTIVE_PEOPLE','30'],
      ['MAX_ACTIVE_OWNERS','2'],
      ['DEFAULT_OWNER_EMAIL','Ar.kartikverma@gmail.com'],
      ['DEFAULT_TIMEZONE', Session.getScriptTimeZone()]
    ]);
  }
  seedInitialPeopleIfEmpty_();
  addAudit_(null, 'SETUP', 'SYSTEM', 'Initial sheet setup checked', '', '');
}

function seedInitialPeopleIfEmpty_() {
  if (readRows_(SHEET_PEOPLE).length > 0) return;
  const props = PropertiesService.getScriptProperties();
  const ownerPin = props.getProperty('INITIAL_OWNER_PIN');
  const aliPin = props.getProperty('INITIAL_ALI_PIN');
  const gitanjaliPin = props.getProperty('INITIAL_GITANJALI_PIN');
  if (!ownerPin || !aliPin || !gitanjaliPin) {
    throw new Error('Before setup, set Script Properties INITIAL_OWNER_PIN, INITIAL_ALI_PIN and INITIAL_GITANJALI_PIN. Do not store real PINs in GitHub files.');
  }
  const rows = [
    makePersonRow_('O001','Ar. Kartik Verma','Owner','Ar.kartikverma@gmail.com',ownerPin,'','Yes','Primary owner'),
    makePersonRow_('M001','Gitanjali','Manager','Staff@parkar.associates',gitanjaliPin,'O001','Yes','Reporting manager for S001.'),
    makePersonRow_('S001','Ali','Staff','Staff@parkar.associates',aliPin,'M001','Yes','Starting staff')
  ];
  appendObjects_(SHEET_PEOPLE, rows);
}

function makePersonRow_(code, name, role, email, pin, managerCode, active, notes) {
  const salt = pin ? uuid_() : '';
  return { Code:code, Name:name, Role:role, Email:email, PinSalt:salt, PinHash:pin ? hashPinV2_(pin, salt) : '', ManagerCode:managerCode, Active:active, Deleted:'No', FailedAttempts:0, LockedUntil:'', Notes:notes, CreatedAt:stamp_(), UpdatedAt:stamp_() };
}

function headers_(sh) { return sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(clean_); }
function readRows_(sheetName) {
  const sh = sheet_(sheetName);
  const last = sh.getLastRow();
  if (last < 2) return [];
  const headers = headers_(sh);
  return sh.getRange(2,1,last-1,headers.length).getValues().map((row, i) => {
    const obj = { __row: i+2 };
    headers.forEach((h,j)=>obj[h]=row[j]);
    return obj;
  });
}
function writeObjectToRow_(sheetName, rowNum, obj) {
  const sh = sheet_(sheetName);
  const headers = headers_(sh);
  const current = sh.getRange(rowNum,1,1,headers.length).getValues()[0];
  headers.forEach((h,i)=>{ if (Object.prototype.hasOwnProperty.call(obj,h)) current[i] = obj[h]; });
  sh.getRange(rowNum,1,1,headers.length).setValues([current]);
}
function appendObjects_(sheetName, objs) {
  if (!objs.length) return;
  const sh = sheet_(sheetName);
  const headers = headers_(sh);
  const values = objs.map(obj => headers.map(h => Object.prototype.hasOwnProperty.call(obj,h) ? obj[h] : ''));
  sh.getRange(sh.getLastRow()+1,1,values.length,headers.length).setValues(values);
}
function deleteRow_(sheetName, rowNum) { sheet_(sheetName).deleteRow(rowNum); }

function getPersonByCode_(code) { return readRows_(SHEET_PEOPLE).find(p => clean_(p.Code) === clean_(code)); }
function getTaskById_(taskId) { return readRows_(SHEET_TASKS).find(t => clean_(t.TaskID) === clean_(taskId)); }
function isActive_(p) { return clean_(p.Active || 'Yes') !== 'No' && clean_(p.Deleted || 'No') !== 'Yes'; }
function activePeople_() { return readRows_(SHEET_PEOPLE).filter(isActive_); }
function activeOwners_() { return activePeople_().filter(p => p.Role === 'Owner'); }
function settings_() {
  const out = { BRAND:'Parkar and Associates', MAX_ACTIVE_PEOPLE:'30', MAX_ACTIVE_OWNERS:'2' };
  readRows_(SHEET_SETTINGS).forEach(r => { out[clean_(r.Key)] = clean_(r.Value); });
  return out;
}
function maxPeople_() { return Number(settings_().MAX_ACTIVE_PEOPLE || 30); }
function maxOwners_() { return Number(settings_().MAX_ACTIVE_OWNERS || 2); }

function sanitizePerson_(p) {
  var mustChange = clean_(p.PinHash).indexOf('v2:') !== 0;
  return { code:clean_(p.Code), name:clean_(p.Name), role:clean_(p.Role), email:clean_(p.Email), managerCode:clean_(p.ManagerCode), active:clean_(p.Active || 'Yes'), deleted:clean_(p.Deleted || 'No'), notes:clean_(p.Notes), mustChangePin: mustChange };
}
function taskToClient_(t) {
  let timeline = [];
  try { timeline = t.TimelineJSON ? JSON.parse(t.TimelineJSON) : []; } catch(e) { timeline = []; }
  return {
    taskId: clean_(t.TaskID), dateAssigned: clean_(t.DateAssigned), projectCode:'GENERAL', projectName:'General Tasks', taskDescription: clean_(t.TaskDescription),
    assignedTo: clean_(t.AssignedTo), assignedRole:'', managerCode: clean_(t.ManagerCode), priority: clean_(t.Priority || 'Medium'), dueDate: clean_(t.DueDate), status: clean_(t.Status || 'Pending'),
    staffRemarks: clean_(t.StaffRemarks), checkRemarks: clean_(t.CheckRemarks), completedDate: clean_(t.CompletedDate), lastUpdated: clean_(t.LastUpdated), createdBy: clean_(t.CreatedBy), createdRole: clean_(t.CreatedRole),
    source: clean_(t.Source), updateCount: Number(t.UpdateCount || 0), checkedBy: clean_(t.CheckedBy), historyNotes: clean_(t.HistoryNotes), drawingLink: clean_(t.DrawingLink),
    deleted: clean_(t.Deleted || 'No'), archived: clean_(t.Archived || 'No'), timeline: timeline
  };
}
function auditToClient_(a) { return { time:clean_(a.Time), by:clean_(a.ActorCode), role:clean_(a.ActorRole), category:clean_(a.Category), action:clean_(a.Action), target:clean_(a.Target), detail:clean_(a.Detail), oldValue:clean_(a.OldValue), newValue:clean_(a.NewValue), reason:clean_(a.Reason || a.Detail) }; }

function visiblePeopleCodes_(actor) {
  const people = readRows_(SHEET_PEOPLE);
  if (actor.Role === 'Owner') return people.map(p => clean_(p.Code));
  if (actor.Role === 'Manager') return people.filter(p => clean_(p.Code) === clean_(actor.Code) || clean_(p.ManagerCode) === clean_(actor.Code)).map(p => clean_(p.Code));
  return [clean_(actor.Code)];
}
function canSeeTask_(actor, t) {
  if (actor.Role === 'Owner') return true;
  const codes = visiblePeopleCodes_(actor);
  return codes.indexOf(clean_(t.AssignedTo)) !== -1 || codes.indexOf(clean_(t.CreatedBy)) !== -1;
}
function canManagePerson_(actor, target) {
  if (actor.Role === 'Owner') return true;
  return actor.Role === 'Manager' && target.Role === 'Staff' && clean_(target.ManagerCode) === clean_(actor.Code);
}
function canAssignTo_(actor, person) {
  if (!person || !isActive_(person)) return false;
  if (actor.Role === 'Owner') return true;
  if (actor.Role === 'Manager') return clean_(person.Code) === clean_(actor.Code) || clean_(person.ManagerCode) === clean_(actor.Code);
  return clean_(person.Code) === clean_(actor.Code);
}

function bootstrap_(actor) {
  const cfg = {
    priorities:['Urgent','High','Medium','Low'],
    statuses:['Requested','Pending','In Progress','Ready for Check','Revision Required','Completed','Cancelled'],
    staffAllowedStatuses:['Pending','In Progress','Ready for Check'],
    reviewStatuses:['Pending','Completed','Revision Required','Cancelled'],
    quickViews:['Open Tasks','All Tasks','Overdue','Due Next 7 Days','Requested','Pending','In Progress','Ready for Check','Revision Required','Completed History','Deleted / Archive','No Update 3 Days'],
    sorts:['Due Date','Priority','Status','Staff','Created Date','Last Updated']
  };
  const visibleCodes = visiblePeopleCodes_(actor);
  const staff = readRows_(SHEET_PEOPLE).filter(p => visibleCodes.indexOf(clean_(p.Code)) !== -1).map(sanitizePerson_);
  const tasks = readRows_(SHEET_TASKS).filter(t => canSeeTask_(actor, t)).map(taskToClient_);
  const auditRows = actor.Role === 'Owner' ? readRows_(SHEET_AUDIT).slice(-300).reverse().map(auditToClient_) : [];
  return { brand: settings_().BRAND || 'Parkar and Associates', version: APP_VERSION, limits:{ maxOwners:maxOwners_(), maxActivePeople:maxPeople_() }, staff, tasks, auditLogs:auditRows, config:cfg };
}

function login_(body) {
  const login = clean_(body.login).toLowerCase();
  const pin = clean_(body.pin);
  if (!login || !pin) throw new Error('Email/code and PIN are required.');
  const people = readRows_(SHEET_PEOPLE);
  const person = people.find(p => p.Role === 'Staff' ? clean_(p.Code).toLowerCase() === login : (clean_(p.Email).toLowerCase() === login || clean_(p.Code).toLowerCase() === login));
  if (!person || !isActive_(person)) throw new Error('Login failed.');
  if (!person.PinHash) throw new Error('PIN is not set for this user. Ask Owner to set/reset PIN.');
  if (person.LockedUntil && new Date(person.LockedUntil).getTime() > Date.now()) throw new Error('Too many wrong PIN attempts. Try after ' + person.LockedUntil);
  const ok = verifyPin_(pin, person);
  if (!ok) {
    const attempts = Number(person.FailedAttempts || 0) + 1;
    const patch = { FailedAttempts: attempts, UpdatedAt: stamp_() };
    if (attempts >= MAX_FAILED_ATTEMPTS) {
      const locked = new Date(Date.now() + LOCK_MINUTES * 60 * 1000);
      patch.LockedUntil = Utilities.formatDate(locked, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
      addAudit_(person, 'LOCKOUT', person.Code, 'Account locked for ' + LOCK_MINUTES + ' min after ' + attempts + ' wrong PINs', '', patch.LockedUntil);
    }
    writeObjectToRow_(SHEET_PEOPLE, person.__row, patch);
    addAudit_(person, 'LOGIN_FAILED', person.Code, 'Wrong PIN attempt ' + attempts, '', '');
    throw new Error('Login failed.');
  }
  // v2.6: silent upgrade of legacy v1 hash on first successful login
  var pinHashPatch = { FailedAttempts:0, LockedUntil:'', UpdatedAt: stamp_() };
  if (clean_(person.PinHash).indexOf('v2:') !== 0) {
    var newSalt = uuid_();
    pinHashPatch.PinSalt = newSalt;
    pinHashPatch.PinHash = hashPinV2_(pin, newSalt);
    addAudit_(person, 'PIN_HASH_UPGRADED', person.Code, 'Legacy PIN hash upgraded to v2', '', '');
  }
  writeObjectToRow_(SHEET_PEOPLE, person.__row, pinHashPatch);
  const token = makeToken_(person);
  addAudit_(person, 'LOGIN_SUCCESS', person.Code, 'User logged in', '', '');
  return { ok:true, user:sanitizePerson_(person), token:token, data:bootstrap_(person) };
}

function systemStatus_(actor, body) {
  if (actor.Role !== 'Owner') throw new Error('Only Owner can run system status check.');
  const status = {
    frontendVersion: clean_(body.clientVersion || ''),
    backendVersion: APP_VERSION,
    loggedInUser: actor.Name + ' (' + actor.Role + ')',
    checkedAt: stamp_(),
    sheetConnection: 'OK',
    writePermission: 'Not tested'
  };
  try {
    const sh = ensureSheet_(SHEET_SETTINGS, SETTINGS_HEADERS);
    const rows = readRows_(SHEET_SETTINGS);
    const existing = rows.find(function(r){ return clean_(r.Key) === 'LAST_STATUS_CHECK'; });
    if (existing) writeObjectToRow_(SHEET_SETTINGS, existing.__row, { Value: status.checkedAt });
    else appendObjects_(SHEET_SETTINGS, [{ Key:'LAST_STATUS_CHECK', Value:status.checkedAt }]);
    status.writePermission = 'OK';
  } catch(e) {
    status.writePermission = 'Failed: ' + (e.message || e);
  }
  addAudit_(actor, 'SYSTEM_STATUS_CHECK', 'SYSTEM', 'Owner deployment status check', '', JSON.stringify(status));
  return { ok:true, status:status };
}

function addTask_(actor, body) {
  const assignee = getPersonByCode_(body.assignedTo);
  if (!canAssignTo_(actor, assignee)) throw new Error('Assignment not allowed.');
  const desc = clean_(body.taskDescription);
  if (!desc) throw new Error('Task description is required.');
  const status = actor.Role === 'Staff' ? 'Requested' : 'Pending';
  const id = nextTaskId_();
  const timeline = [{ date: stamp_(), by: actor.Code, action:'Created', note: clean_(body.note) }];
  const task = {
    TaskID:id, DateAssigned:today_(), TaskDescription:desc, AssignedTo:assignee.Code, ManagerCode:assignee.Role === 'Manager' ? assignee.Code : clean_(assignee.ManagerCode || actor.Code),
    Priority: clean_(body.priority || 'Medium'), DueDate: clean_(body.dueDate), Status: status,
    StaffRemarks: actor.Role === 'Staff' ? clean_(body.note) : '', CheckRemarks: actor.Role !== 'Staff' ? clean_(body.note) : '', CompletedDate:'', LastUpdated:today_(),
    CreatedBy:actor.Code, CreatedRole:actor.Role, Source: actor.Role === 'Staff' ? 'Staff Request' : actor.Role + ' Add Task', UpdateCount:0, CheckedBy:'',
    HistoryNotes: today_() + ' created by ' + actor.Code, DrawingLink: clean_(body.drawingLink), Deleted:'No', Archived:'No', TimelineJSON: JSON.stringify(timeline)
  };
  appendObjects_(SHEET_TASKS, [task]);
  addAudit_(actor, 'TASK_CREATED', id, 'Assigned to ' + assignee.Code + ' with status ' + status, '', JSON.stringify(task));
  return { ok:true, data:bootstrap_(actor) };
}

function updateTask_(actor, body) {
  const task = getTaskById_(body.taskId);
  if (!task || clean_(task.Deleted) === 'Yes') throw new Error('Task not found.');
  if (!canSeeTask_(actor, task)) throw new Error('Task access denied.');
  const newStatus = clean_(body.newStatus);
  const remarks = clean_(body.remarks);
  const oldStatus = clean_(task.Status);
  if (actor.Role === 'Staff') {
    if (clean_(task.AssignedTo) !== clean_(actor.Code)) throw new Error('Staff can update only own task.');
    if (oldStatus === 'Requested') throw new Error('Requested task must be approved first.');
    if (['Completed','Cancelled'].indexOf(oldStatus) !== -1) throw new Error('Closed task cannot be updated.');
    if (['Pending','In Progress','Ready for Check'].indexOf(newStatus) === -1) throw new Error('Staff cannot use this status.');
    patchTask_(task, { Status:newStatus, StaffRemarks:remarks, LastUpdated:today_(), UpdateCount:Number(task.UpdateCount || 0)+1, HistoryNotes:appendHistory_(task, newStatus, actor, remarks), TimelineJSON:addTimelineJson_(task, newStatus, actor, remarks) });
    addAudit_(actor, 'TASK_UPDATED', task.TaskID, oldStatus + ' → ' + newStatus, oldStatus, newStatus);
  } else {
    if (actor.Role === 'Manager' && visiblePeopleCodes_(actor).indexOf(clean_(task.AssignedTo)) === -1) throw new Error('Manager cannot review outside own team.');
    if (oldStatus === 'Requested') {
      if (['Pending','Cancelled'].indexOf(newStatus) === -1) throw new Error('Requested task can only be approved to Pending or Cancelled.');
    } else {
      if (oldStatus !== 'Ready for Check') throw new Error('Review allowed only when task is Ready for Check.');
      if (['Completed','Revision Required'].indexOf(newStatus) === -1) throw new Error('Invalid review status.');
    }
    patchTask_(task, { Status:newStatus, CheckRemarks:remarks, CheckedBy:actor.Code, CompletedDate:newStatus === 'Completed' ? today_() : clean_(task.CompletedDate), LastUpdated:today_(), UpdateCount:Number(task.UpdateCount || 0)+1, HistoryNotes:appendHistory_(task, newStatus, actor, remarks), TimelineJSON:addTimelineJson_(task, newStatus, actor, remarks) });
    addAudit_(actor, oldStatus === 'Requested' ? 'TASK_REQUEST_REVIEWED' : 'TASK_REVIEWED', task.TaskID, oldStatus + ' → ' + newStatus, oldStatus, newStatus);
  }
  return { ok:true, data:bootstrap_(actor) };
}

function editTask_(actor, body) {
  const task = getTaskById_(body.taskId);
  if (!task || clean_(task.Deleted) === 'Yes') throw new Error('Task not found.');
  if (!canSeeTask_(actor, task)) throw new Error('Task access denied.');
  if (actor.Role === 'Manager' && visiblePeopleCodes_(actor).indexOf(clean_(task.AssignedTo)) === -1) throw new Error('Manager can edit only team tasks.');
  if (actor.Role === 'Staff') {
    const allowed = clean_(task.CreatedBy) === clean_(actor.Code) && clean_(task.AssignedTo) === clean_(actor.Code) && ['Pending','In Progress','Revision Required'].indexOf(clean_(task.Status)) !== -1;
    if (!allowed) throw new Error('Staff cannot edit this task.');
  }
  const newAssignee = getPersonByCode_(body.assignedTo || task.AssignedTo);
  if (!canAssignTo_(actor, newAssignee)) throw new Error('New assignee not allowed.');
  const oldValue = JSON.stringify(taskToClient_(task));
  patchTask_(task, { TaskDescription: clean_(body.taskDescription || task.TaskDescription), AssignedTo:newAssignee.Code, ManagerCode:newAssignee.Role === 'Manager' ? newAssignee.Code : clean_(newAssignee.ManagerCode || actor.Code), Priority: clean_(body.priority || task.Priority), DueDate: clean_(body.dueDate || task.DueDate), DrawingLink: clean_(body.drawingLink || task.DrawingLink), LastUpdated:today_(), TimelineJSON:addTimelineJson_(task, 'Edited', actor, clean_(body.note)) });
  addAudit_(actor, 'TASK_EDITED', task.TaskID, 'Task fields edited', oldValue, JSON.stringify(body));
  return { ok:true, data:bootstrap_(actor) };
}

function deleteTask_(actor, body) {
  if (actor.Role !== 'Owner') throw new Error('Only Owner can delete tasks.');
  const task = getTaskById_(body.taskId);
  if (!task) throw new Error('Task not found.');
  patchTask_(task, { Deleted:'Yes', Archived:'Yes', LastUpdated:today_(), TimelineJSON:addTimelineJson_(task, 'Deleted', actor, 'Soft deleted by owner') });
  addAudit_(actor, 'TASK_DELETED', task.TaskID, 'Soft deleted / archived', '', 'Deleted=Yes');
  return { ok:true, data:bootstrap_(actor) };
}
function restoreTask_(actor, body) {
  if (actor.Role !== 'Owner') throw new Error('Only Owner can restore tasks.');
  const task = getTaskById_(body.taskId);
  if (!task) throw new Error('Task not found.');
  patchTask_(task, { Deleted:'No', Archived:'No', LastUpdated:today_(), TimelineJSON:addTimelineJson_(task, 'Restored', actor, 'Restored by owner') });
  addAudit_(actor, 'TASK_RESTORED', task.TaskID, 'Soft deleted task restored', '', 'Deleted=No');
  return { ok:true, data:bootstrap_(actor) };
}

function upsertPerson_(actor, body) {
  if (['Owner','Manager'].indexOf(actor.Role) === -1) throw new Error('Only Owner/Manager can manage people.');
  const input = body.person || {};
  const requestedCode = clean_(input.code);
  const existing = requestedCode ? getPersonByCode_(requestedCode) : null;
  // New person codes are always assigned server-side inside LockService.
  // A client-supplied code is accepted only when it matches an existing person being edited.
  let code = existing ? requestedCode : '';
  const role = actor.Role === 'Manager' ? 'Staff' : clean_(input.role || 'Staff');
  if (actor.Role === 'Manager' && role !== 'Staff') throw new Error('Manager can add/edit staff only.');
  if (existing && !canManagePerson_(actor, existing)) throw new Error('You cannot edit this person.');
  if (!clean_(input.name)) throw new Error('Name is required.');
  if (!existing && !clean_(input.pin)) throw new Error('PIN is required for new person.');
  if (!code) code = nextPersonCode_(role);
  const active = clean_(input.active || 'Yes');
  if (existing && existing.Role === 'Owner') {
    const activeOwnerCountExcluding = activeOwners_().filter(p => clean_(p.Code) !== code).length;
    if (clean_(actor.Code) === code && (active === 'No' || role !== 'Owner')) throw new Error('You cannot deactivate or demote your own owner login.');
    if ((active === 'No' || role !== 'Owner') && activeOwnerCountExcluding < 1) throw new Error('At least one active owner must remain.');
  }
  enforcePeopleLimits_(code, role, active);
  const managerCode = role === 'Staff' ? (actor.Role === 'Manager' ? actor.Code : clean_(input.managerCode)) : (role === 'Manager' ? clean_(input.managerCode || actor.Code) : '');
  const patch = { Code:code, Name:clean_(input.name), Role:role, Email:clean_(input.email), ManagerCode:managerCode, Active:active, Deleted: active === 'No' ? clean_(existing && existing.Deleted || 'No') : 'No', Notes:clean_(input.notes || ''), UpdatedAt:stamp_() };
  if (input.pin) {
    if (isTrivialPin_(input.pin)) throw new Error('PIN is too weak. Use 4+ digits, not trivial/sequential.');
    const salt = uuid_();
    patch.PinSalt = salt; patch.PinHash = hashPinV2_(input.pin, salt);
    patch.FailedAttempts = 0; patch.LockedUntil = '';
    addAudit_(actor, 'PIN_CHANGED', code, 'PIN set/reset by ' + actor.Role, '', '');
  }
  if (existing) {
    writeObjectToRow_(SHEET_PEOPLE, existing.__row, patch);
    addAudit_(actor, 'PERSON_UPDATED', code, role + ' ' + patch.Name, JSON.stringify(sanitizePerson_(existing)), JSON.stringify(sanitizePerson_(Object.assign({}, existing, patch))));
  } else {
    patch.CreatedAt = stamp_(); patch.Deleted = 'No'; patch.FailedAttempts = 0; patch.LockedUntil = '';
    appendObjects_(SHEET_PEOPLE, [patch]);
    addAudit_(actor, 'PERSON_CREATED', code, role + ' ' + patch.Name, '', JSON.stringify(sanitizePerson_(patch)));
  }
  return { ok:true, data:bootstrap_(actor) };
}

function deletePerson_(actor, body) {
  if (actor.Role !== 'Owner') throw new Error('Only Owner can delete people.');
  const person = getPersonByCode_(body.personCode);
  if (!person) throw new Error('Person not found.');
  if (person.Role === 'Owner') throw new Error('Owner records cannot be deleted here. Deactivate owner only after adding another active owner.');
  if (personHasTaskHistory_(person.Code)) {
    writeObjectToRow_(SHEET_PEOPLE, person.__row, { Active:'No', Deleted:'Yes', UpdatedAt:stamp_() });
    addAudit_(actor, 'PERSON_DEACTIVATED', person.Code, 'Person had task history, so safely deactivated', '', 'Active=No;Deleted=Yes');
  } else {
    deleteRow_(SHEET_PEOPLE, person.__row);
    addAudit_(actor, 'PERSON_DELETED', person.Code, 'No task history, row removed', '', 'Row deleted');
  }
  return { ok:true, data:bootstrap_(actor) };
}

function archiveCompleted_(actor) {
  if (actor.Role !== 'Owner') throw new Error('Only Owner can archive completed tasks.');
  let count = 0;
  readRows_(SHEET_TASKS).forEach(t => { if (clean_(t.Status) === 'Completed' && clean_(t.Archived) !== 'Yes') { patchTask_(t, { Archived:'Yes', LastUpdated:today_(), TimelineJSON:addTimelineJson_(t, 'Archived', actor, 'Completed task archived') }); count++; } });
  addAudit_(actor, 'ARCHIVE_COMPLETED', 'TASKS', count + ' completed tasks archived', '', '');
  return { ok:true, data:bootstrap_(actor) };
}

function enforcePeopleLimits_(code, role, active) {
  if (clean_(active) === 'No') return;
  const activeRows = activePeople_().filter(p => clean_(p.Code) !== clean_(code));
  if (activeRows.length >= maxPeople_()) throw new Error('Maximum ' + maxPeople_() + ' active people allowed.');
  const ownerCount = activeRows.filter(p => p.Role === 'Owner').length;
  if (role === 'Owner' && ownerCount >= maxOwners_()) throw new Error('Maximum ' + maxOwners_() + ' active owners allowed.');
}
function personHasTaskHistory_(code) {
  code = clean_(code);
  return readRows_(SHEET_TASKS).some(t => [t.AssignedTo, t.CreatedBy, t.CheckedBy, t.ManagerCode].map(clean_).indexOf(code) !== -1);
}
function nextPersonCode_(role) {
  const prefix = role === 'Owner' ? 'O' : role === 'Manager' ? 'M' : 'S';
  const nums = readRows_(SHEET_PEOPLE).filter(p => clean_(p.Code).indexOf(prefix) === 0).map(p => Number(clean_(p.Code).replace(prefix,''))).filter(Boolean);
  const next = Math.max(0, ...nums) + 1;
  return prefix + String(next).padStart(3,'0');
}
function nextTaskId_() {
  const nums = readRows_(SHEET_TASKS).map(t => Number(clean_(t.TaskID).replace(/^PA-T-/,''))).filter(Boolean);
  const next = Math.max(0, ...nums) + 1;
  return 'PA-T-' + String(next).padStart(3,'0');
}
function patchTask_(task, patch) { writeObjectToRow_(SHEET_TASKS, task.__row, patch); }
function appendHistory_(task, status, actor, remarks) { return clean_(task.HistoryNotes) + '\n' + today_() + ' ' + status + ' by ' + actor.Code + ': ' + remarks; }
function addTimelineJson_(task, action, actor, note) {
  let arr = [];
  try { arr = task.TimelineJSON ? JSON.parse(task.TimelineJSON) : []; } catch(e) { arr = []; }
  arr.unshift({ date: stamp_(), by: actor.Code, action: action, note: note || '' });
  return JSON.stringify(arr);
}
function categoryForAction_(action) {
  action = clean_(action);
  if (action.indexOf('LOGIN') !== -1 || action.indexOf('PIN') !== -1 || action.indexOf('LOCK') !== -1) return 'Security';
  if (action.indexOf('DELETE') !== -1 || action.indexOf('RESTORE') !== -1 || action.indexOf('ARCHIVE') !== -1) return 'Delete / Archive';
  if (action.indexOf('PERSON') !== -1) return 'People';
  if (action.indexOf('EXPORT') !== -1 || action.indexOf('BACKUP') !== -1) return 'Backup';
  if (action.indexOf('TASK') !== -1 || action.indexOf('REVIEW') !== -1 || action.indexOf('STATUS') !== -1) return 'Task';
  return 'System';
}
function addAudit_(actor, action, target, detail, oldValue, newValue, reason) {
  const actorCode = actor ? clean_(actor.Code) : 'SYSTEM';
  const actorName = actor ? clean_(actor.Name) : 'System';
  const actorRole = actor ? clean_(actor.Role) : 'System';
  appendObjects_(SHEET_AUDIT, [{ Time:stamp_(), ActorCode:actorCode, ActorName:actorName, ActorRole:actorRole, Category:categoryForAction_(action), Action:action, Target:clean_(target), Detail:clean_(detail), OldValue:clean_(oldValue), NewValue:clean_(newValue), Reason:clean_(reason || detail) }]);
}

function csvEscape_(v) { return '"' + clean_(v).replace(/"/g, '""') + '"'; }
function csvFromObjects_(headers, rows, mapper) { return headers.join(',') + '\n' + rows.map(r => mapper(r).map(csvEscape_).join(',')).join('\n'); }
function backup_(actor, body) {
  if (actor.Role !== 'Owner') throw new Error('Only Owner can export backup.');
  const type = clean_(body.backupType || 'full');
  const today = today_();
  const tasks = readRows_(SHEET_TASKS);
  const people = readRows_(SHEET_PEOPLE);
  const audit = readRows_(SHEET_AUDIT);
  const taskCsv = csvFromObjects_(['Task ID','Description','Assigned To','Priority','Due Date','Status','Deleted','Archived','Staff Remarks','Check Remarks','Link','Created By','Checked By','Last Updated'], tasks, t => [t.TaskID,t.TaskDescription,t.AssignedTo,t.Priority,t.DueDate,t.Status,t.Deleted,t.Archived,t.StaffRemarks,t.CheckRemarks,t.DrawingLink,t.CreatedBy,t.CheckedBy,t.LastUpdated]);
  const peopleCsv = csvFromObjects_(['Code','Name','Role','Email','Manager Code','Active','Deleted','Notes'], people, p => [p.Code,p.Name,p.Role,p.Email,p.ManagerCode,p.Active,p.Deleted,p.Notes]);
  const auditCsv = csvFromObjects_(['Time','Actor Code','Actor Name','Actor Role','Category','Action','Record','Old Value','New Value','Reason','Detail'], audit, a => [a.Time,a.ActorCode,a.ActorName,a.ActorRole,a.Category,a.Action,a.Target,a.OldValue,a.NewValue,a.Reason,a.Detail]);
  const timelineRows = [];
  tasks.forEach(t => { try { (t.TimelineJSON ? JSON.parse(t.TimelineJSON) : []).forEach(x => timelineRows.push({ TaskID:t.TaskID, Date:x.date, By:x.by, Action:x.action, Note:x.note })); } catch(e) {} });
  const timelineCsv = csvFromObjects_(['Task ID','Timeline Date','By','Action','Note'], timelineRows, r => [r.TaskID,r.Date,r.By,r.Action,r.Note]);
  addAudit_(actor, type === 'full' ? 'EXPORT_FULL_BACKUP' : 'EXPORT_' + type.toUpperCase(), 'BACKUP', 'Backup exported', '', '', 'Owner backup/export');
  if (type === 'tasks') return { ok:true, data:{ csv:taskCsv } };
  if (type === 'people') return { ok:true, data:{ csv:peopleCsv } };
  if (type === 'audit') return { ok:true, data:{ csv:auditCsv } };
  return { ok:true, data:{ files:[{name:'parkar-tasks-' + today + '.csv', csv:taskCsv},{name:'parkar-people-' + today + '.csv', csv:peopleCsv},{name:'parkar-audit-' + today + '.csv', csv:auditCsv},{name:'parkar-remarks-timeline-' + today + '.csv', csv:timelineCsv}] } };
}

