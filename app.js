/* ═══════════════════════════════════════════════════════════════
   LEADFLOW · Command Center
   • Username + 4-digit PIN accounts
   • Forgot-PIN recovery codes
   • Admin console (PIN 2326)
   • Auto sub-sheet detection + live reads + add/edit/delete
   ═══════════════════════════════════════════════════════════════ */

const DEFAULTS = {
  sheetId: '1Pcy8PTNEC5S39sn0HA2xYRqwPi6t1NxWCUJVkO06FMY',
  endpoint: 'https://script.google.com/macros/s/AKfycby3RizqsY39x8YUAXDDJYVpvQcw10OGjN8tnfXFvBZF8u9L9-TVSZ4US6KoY9qqSx4BgQ/exec',
  refreshMs: 5000,
  sessionMs: 5 * 60 * 60 * 1000,
  maxRows: 5000,
  adminPin: '2326'
};

const KEY = {
  users: 'lf_users', session: 'lf_session',
  endpoint: 'lf_endpoint', sheetId: 'lf_sheetId',
  hidden: 'lf_hiddenGids', manual: 'lf_manualSources',
  cacheData: 'lf_cached_data', cacheSheets: 'lf_cached_sheets'
};

function saveCache() {
  try {
    localStorage.setItem(KEY.cacheData, JSON.stringify(state.data));
    localStorage.setItem(KEY.cacheSheets, JSON.stringify(state.sheets));
  } catch (_) {}
}

function restoreCache() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY.cacheSheets) || 'null');
    const d = JSON.parse(localStorage.getItem(KEY.cacheData) || 'null');
    if (s && s.length && d && Object.keys(d).length) {
      state.sheets = s;
      state.data = d;
      renderAll();
    }
  } catch (_) {}
}

const NAME_H = ['name','lead','client','customer','contact','full name','fullname','lead name'];
const MAIL_H = ['email','e-mail','mail','email id','email address'];
const PHONE_H = ['phone','mobile','number','whatsapp','tel','cell','contact no','phone number'];
const STATUS_H = ['status','stage','state','lead status','progress','disposition'];
const DATE_H = ['date','created','timestamp','time','received','enquiry','inquiry','added'];

const state = {
  endpoint: localStorage.getItem(KEY.endpoint) ?? DEFAULTS.endpoint,
  sheetId: localStorage.getItem(KEY.sheetId) || DEFAULTS.sheetId,
  mode: null,
  sheets: [],
  hidden: new Set(JSON.parse(localStorage.getItem(KEY.hidden) || '[]')),
  data: {},
  active: '__all__',
  query: '',
  statusFilter: 'ALL',
  sort: { col: null, dir: 1 },
  lastSync: null,
  timer: null,
  current: null,
  editing: null,
  authMode: 'login',
  pendingUser: null,
  userModal: { mode: 'add', id: null }
};

const $ = id => document.getElementById(id);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const initials = v => { const s = String(v || '').trim(); return s ? s.split(/\s+/).slice(0,2).map(w=>w[0]||'').join('').toUpperCase() : '✦'; };
const idxMatch = (cols, keys) => {
  const lower = cols.map(c => String(c).toLowerCase().trim());
  for (const k of keys) { const i = lower.findIndex(c => c === k); if (i >= 0) return i; }
  for (const k of keys) { const i = lower.findIndex(c => c.includes(k)); if (i >= 0) return i; }
  return -1;
};
const isEmail = v => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v).trim());
const isPhone = v => /^[+(]?\d[\d\s().-]{6,}$/.test(String(v).trim()) && String(v).replace(/\D/g,'').length >= 7;
const dateRE = /\b(\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{2,4})\b/;

/* ─────────── CRYPTO ─────────── */
async function sha(v) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v));
  return [...new Uint8Array(h)].map(x => x.toString(16).padStart(2, '0')).join('');
}
function makeRecovery() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s.slice(0, 4) + '-' + s.slice(4);
}
const normName = n => String(n || '').trim().toLowerCase();
const uid = () => 'u' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);

/* ─────────── USERS ─────────── */
function getUsers() { try { return JSON.parse(localStorage.getItem(KEY.users)) || []; } catch { return []; } }
function saveUsers(u) { localStorage.setItem(KEY.users, JSON.stringify(u)); }
function findUser(name) { const n = normName(name); return getUsers().find(u => u.nameLower === n); }

/* ─────────── SESSION ─────────── */
function getSession() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY.session) || 'null');
    if (s && s.exp > Date.now()) return s;
  } catch {}
  return null;
}
function setSession(name, role) {
  localStorage.setItem(KEY.session, JSON.stringify({ name, role, exp: Date.now() + DEFAULTS.sessionMs, at: Date.now() }));
}
function signOut() {
  clearInterval(state.timer);
  localStorage.removeItem(KEY.session);
  state.data = {}; state.sheets = [];
  $('appView').classList.add('hidden');
  $('adminView').classList.add('hidden');
  $('authView').classList.remove('hidden');
  setAuthMode('login');
  updateAuthUI();
}

/* ═══════════ AUTH UI ═══════════ */
function setAuthMode(mode) {
  state.authMode = mode;
  $('authError').textContent = '';
  $('recoveryBox').classList.add('hidden');
}

function updateAuthUI() {
  const m = state.authMode;
  const show = (id, on) => $(id).classList.toggle('hidden', !on);

  show('nameField', m === 'login' || m === 'signup' || m === 'forgot');
  show('confirmField', m === 'signup' || m === 'reset');
  show('recoveryField', m === 'forgot');

  $('pinLabel').textContent = m === 'reset' ? 'New 4-digit PIN' : '4-digit PIN';

  const T = {
    login:  ['LEADFLOW / SECURE ACCESS', 'Welcome<br><span>back.</span>', 'Sign in with your username and PIN.', 'Sign in'],
    signup: ['LEADFLOW / REGISTRATION', 'Create your<br><span>account.</span>', 'Pick a username and a 4-digit PIN to register.', 'Register account'],
    forgot: ['LEADFLOW / RECOVERY', 'Forgot your<br><span>PIN?</span>', 'Enter your username and the recovery code you saved.', 'Verify code'],
    reset:  ['LEADFLOW / RECOVERY', 'Set a new<br><span>PIN.</span>', 'Choose a new 4-digit PIN for your account.', 'Save PIN']
  }[m];
  $('authEyebrow').textContent = T[0];
  $('authTitle').innerHTML = T[1];
  $('authCopy').textContent = T[2];
  $('authSubmitText').textContent = T[3];

  // Dedicated register/switch button
  const switchBtn = $('switchBtn');
  if (switchBtn) {
    switchBtn.classList.remove('hidden');
    if (m === 'login') {
      $('switchBtnText').textContent = '＋ Register new account';
    } else {
      $('switchBtnText').textContent = '← Back to Sign in';
    }
  }

  // links visibility
  if ($('switchLink')) {
    $('switchLink').classList.toggle('hidden', m === 'forgot' || m === 'reset');
    $('switchLink').textContent = m === 'signup' ? 'Already have an account? Sign in' : 'Create account';
  }
  if ($('forgotLink')) {
    $('forgotLink').classList.toggle('hidden', m === 'signup' || m === 'forgot' || m === 'reset');
  }

  // always show the form unless we're displaying a recovery code
  $('authForm').classList.remove('hidden');
  // clear secrets when switching modes
  $('pinInput').value = '';
  $('confirmInput').value = '';
  if (m !== 'forgot') $('recoveryInput').value = '';
  if (m === 'reset' && state.pendingUser) $('usernameInput').value = state.pendingUser.name;
  else if (m === 'signup') $('usernameInput').value = '';

  setTimeout(() => {
    const focus = m === 'signup' ? 'usernameInput' : m === 'login' ? 'usernameInput' : m === 'forgot' ? 'usernameInput' : 'pinInput';
    $(focus)?.focus();
  }, 60);
}

async function submitAuth(e) {
  e.preventDefault();
  const err = $('authError');
  const mode = state.authMode;
  const name = $('usernameInput').value.trim();
  const pin = $('pinInput').value.trim();
  const confirm = $('confirmInput').value.trim();
  const rec = $('recoveryInput').value.trim().toUpperCase();

  err.style.color = '';
  err.textContent = '';

  if (mode === 'signup') {
    if (name.length < 2) return err.textContent = 'Username must be at least 2 characters.';
    if (findUser(name)) return err.textContent = 'That username is already taken.';
    if (!/^\d{4}$/.test(pin)) return err.textContent = 'PIN must be exactly 4 digits.';
    if (pin !== confirm) return err.textContent = 'PINs do not match.';
    const hash = await sha(pin);
    if (hash === await sha(DEFAULTS.adminPin)) return err.textContent = 'PIN 2326 is reserved for admin. Pick another.';

    const recovery = makeRecovery();
    const user = {
      id: uid(), name, nameLower: normName(name),
      pinHash: hash, recHash: await sha(recovery),
      role: 'user', createdAt: Date.now(), lastLogin: null
    };
    const users = getUsers(); users.push(user); saveUsers(users);

    $('recoveryCodeOut').textContent = recovery;
    $('recoveryBox').classList.remove('hidden');
    $('authForm').classList.add('hidden');
    return;
  }

  if (mode === 'login') {
    if (!/^\d{4}$/.test(pin)) return err.textContent = 'PIN must be exactly 4 digits.';

    const hash = await sha(pin);
    // Admin passcode works with or without a username
    if (hash === await sha(DEFAULTS.adminPin)) {
      setSession('admin', 'admin');
      enterDashboard();
      return;
    }
    if (!name) return err.textContent = 'Enter your username.';
    const user = findUser(name);
    if (!user) return err.textContent = 'No account found with that username. Click "Register new account" below.';
    if (user.pinHash !== hash) return err.textContent = 'Incorrect PIN. Try again.';

    const users = getUsers();
    const u = users.find(x => x.id === user.id);
    u.lastLogin = Date.now(); saveUsers(users);
    setSession(u.name, 'user');
    enterDashboard();
    return;
  }

  if (mode === 'forgot') {
    const user = findUser(name);
    if (!user) return err.textContent = 'No account found with that username.';
    if (!rec) return err.textContent = 'Enter your recovery code.';
    if (user.recHash !== await sha(rec)) return err.textContent = 'That recovery code is not correct.';
    state.pendingUser = user;
    setAuthMode('reset');
    updateAuthUI();
    return;
  }

  if (mode === 'reset') {
    if (!/^\d{4}$/.test(pin)) return err.textContent = 'PIN must be exactly 4 digits.';
    if (pin !== confirm) return err.textContent = 'PINs do not match.';
    if (await sha(pin) === await sha(DEFAULTS.adminPin)) return err.textContent = 'PIN 2326 is reserved for admin.';
    const users = getUsers();
    const u = users.find(x => x.id === state.pendingUser.id);
    u.pinHash = await sha(pin);
    saveUsers(users);
    state.pendingUser = null;
    setAuthMode('login');
    $('usernameInput').value = u.name;
    $('pinInput').value = '';
    updateAuthUI();
    $('authError').style.color = 'var(--green)';
    $('authError').textContent = '✓ PIN updated. Sign in with your new PIN.';
    return;
  }
}

function continueAfterRecovery() {
  $('authForm').classList.remove('hidden');
  const name = getUsers().slice(-1)[0]?.name || '';
  setAuthMode('login');
  updateAuthUI();
  $('usernameInput').value = name;
  $('pinInput').value = '';
}

/* ═══════════ ADMIN CONSOLE ═══════════ */
function enterAdmin() {
  $('authView').classList.add('hidden');
  $('appView').classList.add('hidden');
  $('adminView').classList.remove('hidden');
  renderAdmin();
  if (!state.sheets.length) {
    connect().then(() => renderAdmin());
  } else renderAdmin();
}

function renderAdmin() {
  const users = getUsers();
  $('adUsers').textContent = users.length;
  $('adUsersNote').textContent = users.length === 1 ? 'account on this device' : 'accounts on this device';
  $('adSheets').textContent = state.sheets.length;
  $('adSheetsNote').textContent = state.mode === 'api' ? 'live detected' : (state.mode || 'not connected');

  const total = state.sheets.reduce((n, s) => n + (Number(s.rows) || 0), 0);
  $('adLeads').textContent = total ? total.toLocaleString() : '—';
  $('adLeadsNote').textContent = total ? 'across all sub-sheets' : 'open dashboard to load';

  const conn = $('adConn');
  const ok = state.mode === 'api';
  conn.textContent = ok ? 'ONLINE' : state.mode ? state.mode.toUpperCase() : 'OFFLINE';
  conn.className = 'conn-text ' + (ok ? 'ok' : 'err');
  $('adConnNote').textContent = ok ? 'Apps Script connected' : 'check settings';

  $('sysEndpoint').textContent = state.endpoint ? state.endpoint.replace(/^https?:\/\//, '').slice(0, 34) + '…' : 'not set';
  $('sysSheet').textContent = state.sheetId.slice(0, 14) + '…';
  $('sysMode').textContent = state.mode || '—';
  $('sysSync').textContent = state.lastSync ? state.lastSync.toLocaleTimeString() : '—';

  renderUserTable();
}

function renderUserTable() {
  const users = getUsers();
  const body = $('userTableBody');
  $('noUsers').classList.toggle('hidden', users.length > 0);
  body.innerHTML = users.map(u => `
    <tr>
      <td><div class="u-cell"><span class="u-av">${initials(u.name)}</span><div><span class="u-name">${esc(u.name)}</span><span class="u-sub">joined ${fmtDate(u.createdAt)}</span></div></div></td>
      <td><span class="role-tag ${u.role === 'admin' ? 'admin' : 'user'}">${u.role === 'admin' ? 'Admin' : 'User'}</span></td>
      <td>${fmtDate(u.createdAt)}</td>
      <td>${u.lastLogin ? fmtDate(u.lastLogin) : 'never'}</td>
      <td class="ta-right"><div class="u-actions">
        <button class="u-btn" data-pin="${u.id}">Reset PIN</button>
        <button class="u-btn del" data-del="${u.id}">Delete</button>
      </div></td>
    </tr>`).join('');

  body.querySelectorAll('[data-pin]').forEach(b => b.addEventListener('click', () => openUserModal('pin', b.dataset.pin)));
  body.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => deleteUser(b.dataset.del)));
}

const fmtDate = ts => ts ? new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

function openUserModal(mode, id) {
  state.userModal = { mode, id };
  const u = id ? getUsers().find(x => x.id === id) : null;
  $('userModalEyebrow').textContent = mode === 'add' ? 'NEW ACCOUNT' : 'RESET PIN';
  $('userModalTitle').textContent = mode === 'add' ? 'Add user' : `Reset ${u?.name || 'user'}’s PIN`;
  $('nuName').value = mode === 'add' ? '' : (u?.name || '');
  $('nuName').disabled = mode !== 'add';
  $('nuName').style.opacity = mode !== 'add' ? .6 : 1;
  $('nuPin').value = '';
  $('userModalMsg').textContent = '';
  $('userModal').classList.remove('hidden');
  setTimeout(() => (mode === 'add' ? $('nuName') : $('nuPin')).focus(), 60);
}

async function saveUserForm(e) {
  e.preventDefault();
  const msg = $('userModalMsg');
  const { mode, id } = state.userModal;
  const name = $('nuName').value.trim();
  const pin = $('nuPin').value.trim();
  msg.style.color = '';

  if (!/^\d{4}$/.test(pin)) { msg.textContent = 'PIN must be exactly 4 digits.'; return; }
  if (await sha(pin) === await sha(DEFAULTS.adminPin)) { msg.textContent = 'PIN 2326 is reserved for admin.'; return; }

  const users = getUsers();

  if (mode === 'add') {
    if (name.length < 2) { msg.textContent = 'Username must be at least 2 characters.'; return; }
    if (findUser(name)) { msg.textContent = 'That username is already taken.'; return; }
    const recovery = makeRecovery();
    users.push({
      id: uid(), name, nameLower: normName(name),
      pinHash: await sha(pin), recHash: await sha(recovery),
      role: 'user', createdAt: Date.now(), lastLogin: null
    });
    saveUsers(users);
    $('userModal').classList.add('hidden');
    renderAdmin();
    alert(`User "${name}" created.\n\nRecovery code: ${recovery}\n\nGive this to the user — they need it to reset a forgotten PIN.`);
  } else {
    const u = users.find(x => x.id === id);
    if (!u) return;
    u.pinHash = await sha(pin);
    saveUsers(users);
    $('userModal').classList.add('hidden');
    renderAdmin();
  }
}

function deleteUser(id) {
  const u = getUsers().find(x => x.id === id);
  if (!u) return;
  if (!confirm(`Delete user "${u.name}"? They will no longer be able to sign in.`)) return;
  saveUsers(getUsers().filter(x => x.id !== id));
  renderAdmin();
}

/* ═══════════ DASHBOARD ═══════════ */
function enterDashboard() {
  const session = getSession();
  $('authView').classList.add('hidden');
  $('adminView').classList.add('hidden');
  $('appView').classList.remove('hidden');

  const name = session?.name || 'user';
  $('ucName').textContent = name;
  $('ucAvatar').textContent = initials(name)[0] || '?';
  $('openSheetLink').href = `https://docs.google.com/spreadsheets/d/${state.sheetId}/edit`;

  // admin shortcut in sidebar (only for admins)
  const foot = document.querySelector('.side-foot');
  const existing = $('adminShortcut');
  if (session?.role === 'admin') {
    if (!existing) {
      const b = document.createElement('button');
      b.id = 'adminShortcut';
      b.className = 'side-action';
      b.innerHTML = '<span>⚙</span> Admin';
      b.addEventListener('click', () => { $('appView').classList.add('hidden'); enterAdmin(); });
      foot.prepend(b);
    }
  } else if (existing) {
    existing.remove();
  }

  // Instant render from local cache so the UI opens in 0ms!
  restoreCache();

  connect().then(ok => {
    if (ok) {
      loadAll();
      clearInterval(state.timer);
      state.timer = setInterval(refreshTick, DEFAULTS.refreshMs);
    }
  });
}

function banner(kind, html) {
  const b = $('banner');
  if (!kind) { b.classList.add('hidden'); return; }
  b.className = `banner ${kind}`;
  b.innerHTML = `<span>${kind === 'ok' ? '✓' : kind === 'error' ? '⚠' : '◆'}</span><div>${html}</div>`;
  b.classList.remove('hidden');
}

/* ─────────── CONNECT ─────────── */
function apiUrl(params) {
  const u = new URL(state.endpoint);
  Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v));
  return u.toString();
}

function jsonp(url, timeout = 20000) {
  return new Promise((resolve, reject) => {
    const cb = 'lfj' + Date.now().toString(36) + Math.floor(Math.random() * 1e5).toString(36);
    const script = document.createElement('script');
    const to = setTimeout(() => { cleanup(); reject(new Error('timeout')); }, timeout);
    function cleanup() { clearTimeout(to); try { delete window[cb]; } catch (_) { window[cb] = undefined; } script.remove(); }
    window[cb] = d => { cleanup(); resolve(d); };
    script.onerror = () => { cleanup(); reject(new Error('network')); };
    script.src = url + (url.includes('?') ? '&' : '?') + 'callback=' + cb;
    document.head.appendChild(script);
  });
}

async function detectViaApi() {
  if (!state.endpoint) return null;
  // 1. Try batch getAllData: loads all sub-sheets + data in 1 instant call
  try {
    const r = await jsonp(apiUrl({ action: 'getAllData', t: Date.now() }), 15000);
    if (r && r.ok && r.data) {
      if (Array.isArray(r.sheets) && r.sheets.length) {
        state.sheets = r.sheets.map(s => ({ name: s.name, gid: String(s.gid), rows: Number(s.rows) || 0 }));
      }
      for (const [gid, sheetData] of Object.entries(r.data)) {
        state.data[gid] = {
          columns: sheetData.columns || [],
          rows: (sheetData.rows || []).slice(0, DEFAULTS.maxRows),
          ts: Date.now(),
          error: null
        };
      }
      state.mode = 'api';
      state.lastSync = new Date();
      saveCache();
      return state.sheets;
    }
  } catch (_) {}

  // 2. Fallback: listSheets
  try {
    const r = await jsonp(apiUrl({ action: 'listSheets', t: Date.now() }), 15000);
    if (r && r.ok && Array.isArray(r.sheets) && r.sheets.length) return r.sheets;
  } catch (_) {}
  return null;
}

async function detectViaPublic() {
  try {
    const r = await fetch(`https://spreadsheets.google.com/feeds/worksheets/${state.sheetId}/public/basic?alt=json&_=${Date.now()}`);
    if (!r.ok) return null;
    const d = await r.json();
    const sheets = (d.feed?.entry || []).map(e => {
      const href = (e.link || []).find(l => l.rel === 'self')?.href || '';
      const m = href.match(/gid=([^&]+)/);
      return { name: e.title?.$t || 'Sheet', gid: m ? m[1] : '' };
    }).filter(s => s.gid);
    return sheets.length ? sheets : null;
  } catch (_) { return null; }
}

async function connect() {
  setLoading(true);
  banner(null);

  let sheets = await detectViaApi();
  if (sheets) {
    state.mode = 'api';
    setSheets(sheets);
    return true;
  }
  sheets = await detectViaPublic();
  if (sheets) {
    state.mode = 'public';
    setSheets(sheets);
    banner('warn', 'Reading via the public link. Add your Apps Script URL in <b>Settings</b> for live reads and add/edit.');
    return true;
  }
  const manual = JSON.parse(localStorage.getItem(KEY.manual) || 'null');
  if (manual && manual.length) {
    state.mode = 'manual';
    setSheets(manual);
    banner('warn', 'Using saved manual sub-sheets. Open <b>Settings</b> and add your Apps Script URL.');
    return true;
  }
  state.mode = null;
  state.sheets = [];
  renderNav();
  banner('error', '<b>Cannot reach your sheet yet.</b> Open <b>Settings</b> and paste your Apps Script Web App URL (deploy <code>Code.gs</code> with access “Anyone”), then click Save &amp; connect.');
  setLoading(false);
  return false;
}

function setSheets(sheets) {
  state.sheets = sheets.map(s => ({ name: s.name, gid: String(s.gid), rows: Number(s.rows) || 0 }));
  if (!state.sheets.some(s => s.gid === state.active)) state.active = '__all__';
  renderNav();
  updateTitle();
}

/* ─────────── DATA ─────────── */
async function loadSheet(gid) {
  if (!gid) return;
  try {
    let cols, rows;
    if (state.mode === 'api') {
      const r = await jsonp(apiUrl({ action: 'getData', gid, t: Date.now() }), 25000);
      if (!r || !r.ok) throw new Error(r?.error || 'read failed');
      cols = r.columns || []; rows = r.rows || [];
    } else {
      const r = await fetch(`https://docs.google.com/spreadsheets/d/${state.sheetId}/gviz/tq?tqx=out:json&gid=${encodeURIComponent(gid)}&_=${Date.now()}`, { cache: 'no-store', credentials: 'omit' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const parsed = parseGviz(await r.text());
      cols = parsed.columns; rows = parsed.rows;
    }
    if (rows.length > DEFAULTS.maxRows) rows = rows.slice(0, DEFAULTS.maxRows);
    state.data[gid] = { columns: cols, rows, ts: Date.now(), error: null };
    const s = state.sheets.find(x => x.gid === gid);
    if (s) s.rows = rows.length;
  } catch (err) {
    state.data[gid] = state.data[gid] || { columns: [], rows: [] };
    state.data[gid].error = err.message || 'read failed';
  }
}

function parseGviz(text) {
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a < 0 || b < 0) return { columns: [], rows: [] };
  try {
    const d = JSON.parse(text.slice(a, b + 1));
    const columns = (d.table.cols || []).map((c, i) => c.label || c.id || `Column ${i + 1}`);
    const rows = (d.table.rows || []).map(r => (r.c || []).map(c => c == null ? '' : (c.f ?? c.v ?? '')));
    return { columns, rows };
  } catch (_) { return { columns: [], rows: [] }; }
}

async function loadAll() {
  setLoading(true);
  // Fast batch load if supported by Apps Script (1 request instead of N)
  if (state.mode === 'api') {
    try {
      const r = await jsonp(apiUrl({ action: 'getAllData', t: Date.now() }), 15000);
      if (r && r.ok && r.data) {
        if (Array.isArray(r.sheets) && r.sheets.length) setSheets(r.sheets);
        for (const [gid, sheetData] of Object.entries(r.data)) {
          state.data[gid] = {
            columns: sheetData.columns || [],
            rows: (sheetData.rows || []).slice(0, DEFAULTS.maxRows),
            ts: Date.now(),
            error: null
          };
        }
        state.lastSync = new Date();
        saveCache();
        setLoading(false);
        renderAll();
        return;
      }
    } catch (_) {}
  }

  // Fallback: parallel loadSheet
  await Promise.all(state.sheets.map(s => loadSheet(s.gid)));
  state.lastSync = new Date();
  saveCache();
  setLoading(false);
  renderAll();
}

async function refreshTick() {
  if (document.hidden) return;
  // If user is focused on a specific sub-sheet, refresh only that sheet (~300ms)
  if (state.active !== '__all__') {
    await loadSheet(state.active);
    state.lastSync = new Date();
    saveCache();
    renderAll();
    return;
  }
  // If on overview, use the fast batch endpoint
  await loadAll();
}

/* ─────────── VIEW ─────────── */
const visibleSheets = () => state.sheets.filter(s => !state.hidden.has(s.gid));
const sheetName = gid => state.sheets.find(s => s.gid === gid)?.name || 'Sheet';

// Merge the real headers from every visible sub-sheet (keeps original order).
function mergedColumns() {
  const seen = new Set(), out = [];
  for (const s of visibleSheets()) {
    const d = state.data[s.gid];
    if (!d) continue;
    d.columns.forEach(c => {
      const key = String(c).toLowerCase().trim();
      if (key && !seen.has(key)) { seen.add(key); out.push(c); }
    });
  }
  return out;
}

function buildView() {
  if (state.active === '__all__') {
    const base = mergedColumns();
    const showSource = visibleSheets().length > 1;
    const columns = showSource ? base.concat(['Sub-sheet']) : base.slice();
    const srcCol = showSource ? columns.length - 1 : -1;
    const rows = [];
    for (const s of visibleSheets()) {
      const d = state.data[s.gid];
      if (!d || !d.rows || !d.rows.length) continue;
      const lookup = (d.columns || []).map(c => String(c).toLowerCase().trim());
      d.rows.forEach((r, ri) => {
        const cells = base.map(c => {
          const i = lookup.indexOf(String(c).toLowerCase().trim());
          return i >= 0 ? (r[i] ?? '') : '';
        });
        if (showSource) cells.push(s.name);
        rows.push({ cells, gid: s.gid, rowIndex: ri });
      });
    }
    return {
      columns, rows,
      statusCol: idxMatch(columns, STATUS_H),
      emailCol: idxMatch(columns, MAIL_H),
      phoneCol: idxMatch(columns, PHONE_H),
      nameCol: idxMatch(columns, NAME_H),
      srcCol,
      overview: true
    };
  }

  const d = state.data[state.active] || { columns: [], rows: [] };
  const cols = (d.columns || []).slice();
  return {
    columns: cols,
    rows: (d.rows || []).map((r, ri) => {
      const cells = cols.map((_, i) => r[i] ?? '');
      return { cells, gid: state.active, rowIndex: ri };
    }),
    statusCol: idxMatch(cols, STATUS_H),
    emailCol: idxMatch(cols, MAIL_H),
    phoneCol: idxMatch(cols, PHONE_H),
    nameCol: idxMatch(cols, NAME_H),
    srcCol: -1,
    overview: false
  };
}

function statusClass(v) {
  const s = String(v).toLowerCase().trim();
  if (!s) return 'neutral';
  if (/not[\s_-]*interest/i.test(s)) return 'not-interested';
  if (/interest/i.test(s)) return 'interested';
  if (/follow/i.test(s)) return 'followup';
  if (/junk/i.test(s)) return 'junk';
  if (/rnr|ring|no[\s_-]*response|no[\s_-]*reply|no[\s_-]*answer|not[\s_-]*reach/i.test(s)) return 'rnr';
  if (/(convert|won|closed|sold|sale|done|complete|paid|success)/i.test(s)) return 'interested';
  if (/(lost|dead|reject|cancel|invalid)/i.test(s)) return 'not-interested';
  if (/(contact|reach|talk|spoke|connected|call)/i.test(s)) return 'followup';
  if (/(new|fresh|open|lead|enquir|inquir)/i.test(s)) return 'neutral';
  return 'neutral';
}

function isTodayRow(cells) {
  for (const v of cells) {
    const m = String(v).match(dateRE);
    if (m) { const d = new Date(m[1]); if (!isNaN(d) && d.toDateString() === new Date().toDateString()) return true; }
  }
  return false;
}

function renderAll() { renderStats(); renderNav(); renderTable(); renderStatus(); }

function renderStats() {
  const sheets = visibleSheets();
  let total = 0, interested = 0, followup = 0, notInterested = 0, junk = 0, rnr = 0;
  sheets.forEach(s => {
    const d = state.data[s.gid];
    if (!d || !d.rows.length) return;
    total += d.rows.length;
    const iStatus = idxMatch(d.columns, STATUS_H);
    d.rows.forEach(r => {
      const st = iStatus >= 0 ? statusClass(r[iStatus]) : 'neutral';
      if (st === 'interested') interested++;
      else if (st === 'followup') followup++;
      else if (st === 'not-interested') notInterested++;
      else if (st === 'junk') junk++;
      else if (st === 'rnr') rnr++;
    });
  });

  if ($('statTotal')) $('statTotal').textContent = total.toLocaleString();
  if ($('statTotalNote')) $('statTotalNote').textContent = `${sheets.length} sub-sheet${sheets.length !== 1 ? 's' : ''}`;
  if ($('statInterested')) $('statInterested').textContent = interested.toLocaleString();
  if ($('statFollowUp')) $('statFollowUp').textContent = followup.toLocaleString();
  if ($('statRnr')) $('statRnr').textContent = rnr.toLocaleString();

  // Dynamic count badges on filter pills
  if ($('fCountAll')) $('fCountAll').textContent = total ? `(${total})` : '';
  if ($('fCountInterested')) $('fCountInterested').textContent = interested ? `(${interested})` : '';
  if ($('fCountFollowup')) $('fCountFollowup').textContent = followup ? `(${followup})` : '';
  if ($('fCountNotInterested')) $('fCountNotInterested').textContent = notInterested ? `(${notInterested})` : '';
  if ($('fCountJunk')) $('fCountJunk').textContent = junk ? `(${junk})` : '';
  if ($('fCountRnr')) $('fCountRnr').textContent = rnr ? `(${rnr})` : '';
}

function renderNav() {
  const sheets = visibleSheets();
  const allCount = sheets.reduce((n, s) => n + (state.data[s.gid]?.rows.length || 0), 0);
  const all = `<button class="sheet-item overview ${state.active === '__all__' ? 'active' : ''}" data-gid="__all__">
      <span class="sheet-dot"></span><span class="sheet-name">All sub-sheets</span><span class="sheet-count">${allCount}</span></button>`;
  const items = sheets.map(s => {
    const d = state.data[s.gid];
    const n = d ? d.rows.length : (s.rows || '–');
    return `<button class="sheet-item ${state.active === s.gid ? 'active' : ''}" data-gid="${esc(s.gid)}">
        <span class="sheet-dot"></span><span class="sheet-name">${esc(s.name)}${d?.error ? ' ⚠' : ''}</span><span class="sheet-count">${n}</span></button>`;
  }).join('');
  $('sheetNav').innerHTML = all + (items || `<p style="padding:14px 10px;font-size:11.5px;color:var(--dim);line-height:1.6">No sub-sheets detected yet.<br>Open Settings to connect.</p>`);
  $('sheetNav').querySelectorAll('[data-gid]').forEach(b => b.addEventListener('click', () => selectSheet(b.dataset.gid)));
}

function selectSheet(gid) {
  state.active = gid;
  state.sort = { col: null, dir: 1 };
  updateTitle(); renderNav(); renderTable(); closeSidebar();
  if (gid !== '__all__' && !state.data[gid]) loadSheet(gid).then(() => renderAll());
}

function updateTitle() {
  if (state.active === '__all__') {
    const n = visibleSheets().length;
    $('pageTitle').textContent = 'Overview';
    $('pageSub').textContent = `${n} sub-sheet${n !== 1 ? 's' : ''} combined · ${state.mode === 'api' ? 'live via Apps Script' : state.mode || 'not connected'}`;
    $('panelTitle').textContent = 'All leads';
  } else {
    $('pageTitle').textContent = sheetName(state.active);
    $('pageSub').textContent = 'Sub-sheet · auto-refreshing every 5 seconds';
    $('panelTitle').textContent = sheetName(state.active);
  }
}

function renderTable() {
  const view = buildView();
  let cols = view.columns.slice();
  let rows = view.rows.map(r => ({ cells: r.cells.slice(), gid: r.gid, rowIndex: r.rowIndex }));

  // Keep ALL headers from the sheet (never drop empty or newly added columns)
  const iName = view.nameCol, iStatus = view.statusCol,
        iEmail = view.emailCol, iPhone = view.phoneCol, iSrc = view.srcCol;

  // the flexible column (absorbs leftover width): the name column, else the textiest one
  let flexIdx = iName;
  if (flexIdx < 0) {
    let best = 0, bestLen = -1;
    cols.forEach((_, ci) => {
      const m = rows.reduce((mx, r) => Math.max(mx, String(r.cells[ci] ?? '').length), 0);
      if (m > bestLen) { bestLen = m; best = ci; }
    });
    flexIdx = best;
  }

  // ── filter ──
  const q = state.query.toLowerCase().trim();
  if (q) rows = rows.filter(r => r.cells.some(c => String(c).toLowerCase().includes(q)));
  if (state.statusFilter && state.statusFilter !== 'ALL' && iStatus >= 0) {
    const targetStatus = state.statusFilter.toLowerCase().replace(/_/g, '-');
    rows = rows.filter(r => {
      const cellVal = String(r.cells[iStatus] ?? '');
      return statusClass(cellVal) === targetStatus;
    });
  }

  // ── sort ──
  if (state.sort.col != null && state.sort.col < cols.length) {
    const ci = state.sort.col;
    rows = [...rows].sort((a, b) => {
      const x = a.cells[ci] ?? '', y = b.cells[ci] ?? '';
      const nx = parseFloat(String(x).replace(/[^\d.-]/g, '')), ny = parseFloat(String(y).replace(/[^\d.-]/g, ''));
      const both = !isNaN(nx) && !isNaN(ny) && /\d/.test(String(x)) && /\d/.test(String(y));
      const cmp = both ? nx - ny : String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: 'base' });
      return cmp * state.sort.dir;
    });
  }

  // ── numeric columns get right-aligned (header + cells), except link columns ──
  const numeric = cols.map((_, ci) => rows.every(r => {
    const v = String(r.cells[ci] ?? '').trim();
    return v === '' || (!isNaN(parseFloat(v.replace(/[,\s₹$]/g, ''))) && /\d/.test(v));
  }));
  const isNumCol = i => numeric[i] && i !== flexIdx && i !== iPhone && i !== iEmail && i !== iStatus;

  // ── header ──
  $('tableHead').innerHTML = '<tr>' + cols.map((c, i) => {
    const sorted = state.sort.col === i;
    const cls = [sorted ? 'sorted' : '', i === flexIdx ? 'flex-col' : '', isNumCol(i) ? 'num' : ''].join(' ').trim();
    return `<th class="${cls}" data-col="${i}">${esc(c)}<span class="sort">${sorted ? (state.sort.dir > 0 ? '▲' : '▼') : '↕'}</span></th>`;
  }).join('') + '</tr>';
  $('tableHead').querySelectorAll('th').forEach(th => th.addEventListener('click', () => {
    const ci = Number(th.dataset.col);
    if (state.sort.col === ci) state.sort.dir *= -1; else { state.sort.col = ci; state.sort.dir = 1; }
    renderTable();
  }));

  // ── empty state ──
  const body = $('tableBody');
  if (!rows.length || !cols.length) {
    body.innerHTML = '';
    $('emptyState').classList.remove('hidden');
    $('emptyTitle').textContent = state.query ? 'No matches' : 'Nothing here yet';
    $('emptyText').textContent = state.query
      ? 'Try a different search term.'
      : (state.sheets.length ? 'Add a lead to get started.' : 'Open Settings to connect your sheet.');
    $('countBadge').textContent = '0';
    $('footLeft').textContent = '0 leads';
    return;
  }
  $('emptyState').classList.add('hidden');

  body.innerHTML = rows.map(r => {
    const tds = cols.map((_, ci) => {
      const val = String(r.cells[ci] ?? '');
      let inner;
      if (ci === iStatus) inner = val ? `<span class="pill ${statusClass(val)}">${esc(val)}</span>` : '';
      else if (ci === iEmail || (val && isEmail(val))) inner = `<a class="cell-link" href="mailto:${esc(val)}" onclick="event.stopPropagation()">${esc(val)}</a>`;
      else if (ci === iPhone || (val && isPhone(val))) inner = `<a class="cell-link" href="tel:${esc(val.replace(/[^\d+]/g, ''))}" onclick="event.stopPropagation()">${esc(val)}</a>`;
      else if (ci === iSrc) inner = val ? `<span class="src-tag">${esc(val)}</span>` : '';
      else if (ci === iName && /[a-z]/i.test(val)) inner = `<span class="cell-avatar ${initials(val).charCodeAt(0) % 2 ? 'alt' : ''}">${initials(val)}</span>${esc(val)}`;
      else inner = esc(val);
      const cls = [isNumCol(ci) && val !== '' && ci !== iName ? 'num' : '', ci === flexIdx ? 'flex-col' : ''].join(' ').trim();
      return `<td class="${cls}">${inner}</td>`;
    }).join('');
    return `<tr data-gid="${esc(r.gid)}" data-row="${r.rowIndex}">${tds}</tr>`;
  }).join('');

  body.querySelectorAll('tr').forEach(tr => tr.addEventListener('click', () => openDrawer(tr.dataset.gid, Number(tr.dataset.row))));
  $('countBadge').textContent = rows.length;
  $('footLeft').textContent = `${rows.length} lead${rows.length !== 1 ? 's' : ''}`;
}

function renderStatus() {
  const pill = document.querySelector('.live-pill');
  if (!state.mode) { pill.classList.add('err'); $('liveText').textContent = 'Offline'; return; }
  const errs = state.sheets.filter(s => state.data[s.gid]?.error);
  if (errs.length && errs.length === state.sheets.length && state.mode !== 'manual') {
    pill.classList.add('err'); $('liveText').textContent = 'Read failed';
    banner('error', `<b>Could not read the sub-sheets.</b> Redeploy <code>Code.gs</code> as a Web app (access: “Anyone”), then re-save your URL in Settings.`);
  } else {
    pill.classList.remove('err');
    $('liveText').textContent = state.lastSync ? state.lastSync.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Live';
  }
}

function setLoading(on) { $('loadingBar').classList.toggle('hidden', !on); }

/* ─────────── DRAWER ─────────── */
function openDrawer(gid, rowIndex) {
  const d = state.data[gid];
  const row = d?.rows?.[rowIndex];
  if (!row) return;
  state.current = { gid, rowIndex, row, columns: d.columns };
  $('drawerTitle').textContent = row[idxMatch(d.columns, NAME_H)] || row[0] || 'Lead';

  // Quick Action Buttons (Call, WhatsApp, Email)
  const iPhone = idxMatch(d.columns, PHONE_H);
  const iMail = idxMatch(d.columns, MAIL_H);
  const phoneVal = iPhone >= 0 ? String(row[iPhone] || '').trim() : '';
  const mailVal = iMail >= 0 ? String(row[iMail] || '').trim() : '';
  const qaContainer = $('drawerQuickActions');
  if (qaContainer) {
    let qaHtml = '';
    if (phoneVal) {
      const cleanPhone = phoneVal.replace(/[^\d+]/g, '');
      const waNumber = cleanPhone.replace(/^\+/, '');
      qaHtml += `<a class="quick-action-btn qa-call" href="tel:${esc(cleanPhone)}">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>
        Call
      </a>`;
      qaHtml += `<a class="quick-action-btn qa-wa" href="https://wa.me/${esc(waNumber)}" target="_blank" rel="noopener">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>
        WhatsApp
      </a>`;
    }
    if (mailVal && isEmail(mailVal)) {
      qaHtml += `<a class="quick-action-btn qa-mail" href="mailto:${esc(mailVal)}">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>
        Email
      </a>`;
    }
    qaContainer.innerHTML = qaHtml;
    qaContainer.classList.toggle('hidden', !qaHtml);
  }

  // Quick Status Buttons
  const iStatus = idxMatch(d.columns, STATUS_H);
  const statusContainer = $('drawerStatusBar');
  if (statusContainer && iStatus >= 0) {
    const curVal = String(row[iStatus] || '').trim();
    const curClass = statusClass(curVal);
    const opts = [
      { label: 'Interested', val: 'Interested', cls: 'interested' },
      { label: 'Follow up', val: 'follow up', cls: 'followup' },
      { label: 'Not Interested', val: 'Not Interested', cls: 'not-interested' },
      { label: 'JUNK', val: 'JUNK', cls: 'junk' },
      { label: 'RNR', val: 'RNR', cls: 'rnr' }
    ];
    statusContainer.innerHTML = `
      <label>Quick Update Status</label>
      <div class="drawer-status-pills">
        ${opts.map(o => `
          <button type="button" class="status-btn pill ${o.cls} ${curClass === o.cls ? 'active' : ''}" data-val="${o.val}">
            ${o.label}
          </button>
        `).join('')}
      </div>
    `;
    statusContainer.querySelectorAll('.status-btn').forEach(btn => {
      btn.addEventListener('click', () => quickUpdateStatus(gid, rowIndex, iStatus, btn.dataset.val));
    });
    statusContainer.classList.remove('hidden');
  } else if (statusContainer) {
    statusContainer.classList.add('hidden');
  }

  $('drawerBody').innerHTML = d.columns.map((col, i) => {
    const val = String(row[i] ?? '');
    if (!val) return '';
    let content = esc(val);
    if (isEmail(val)) content = `<a href="mailto:${esc(val)}">${esc(val)}</a>`;
    else if (isPhone(val)) content = `<a href="tel:${esc(val.replace(/[^\d+]/g, ''))}">${esc(val)}</a>`;
    else if (/^https?:\/\//i.test(val)) content = `<a href="${esc(val)}" target="_blank" rel="noopener">${esc(val)}</a>`;
    return `<div class="detail"><div class="d-ico">${esc(col)[0]?.toUpperCase() || '•'}</div><div class="d-body"><small>${esc(col)}</small><p>${content}</p></div></div>`;
  }).join('');
  $('drawer').classList.add('open');
  $('drawerBackdrop').classList.remove('hidden');
}

async function quickUpdateStatus(gid, rowIndex, colIndex, newVal) {
  const d = state.data[gid];
  if (!d || !d.rows[rowIndex]) return;
  d.rows[rowIndex][colIndex] = newVal;
  openDrawer(gid, rowIndex);
  renderAll();

  if (state.endpoint) {
    try {
      await fetch(state.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'update', gid, rowIndex, data: d.rows[rowIndex] }),
        mode: 'no-cors'
      });
    } catch (_) {}
  }
}

function closeDrawer() { $('drawer').classList.remove('open'); $('drawerBackdrop').classList.add('hidden'); state.current = null; }

/* ─────────── ADD / EDIT ─────────── */
function openLeadModal(edit = false) {
  const editCtx = edit ? state.current : null;
  state.editing = editCtx;
  const gid = editCtx ? editCtx.gid : (state.active === '__all__' ? (visibleSheets()[0]?.gid || '') : state.active);
  $('modalEyebrow').textContent = editCtx ? 'UPDATE LEAD' : 'NEW LEAD';
  $('modalTitle').textContent = editCtx ? 'Edit lead' : 'Add a lead';
  $('modalMessage').textContent = '';

  const cols = state.data[gid]?.columns?.length ? state.data[gid].columns : ['Name', 'Email', 'Phone', 'Status', 'Notes'];
  const reqIdx = (() => { const i = idxMatch(cols, NAME_H); return i >= 0 ? i : 0; })();
  const source = `<label class="wide">Sub-sheet
      <select id="leadSheetSelect" ${editCtx ? 'disabled' : ''}>
        ${visibleSheets().map(s => `<option value="${esc(s.gid)}" ${s.gid === gid ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}
      </select></label>`;
  const fields = cols.map((c, i) => {
    const isStatus = idxMatch([c], STATUS_H) >= 0 || /status|stage|state/i.test(String(c));
    const wide = i === reqIdx || /note|address|remark|comment|descri/i.test(String(c));
    const curVal = editCtx ? String(editCtx.row[i] ?? '').trim() : '';

    if (isStatus) {
      const opts = ['Interested', 'follow up', 'Not Interested', 'JUNK', 'RNR'];
      return `<label class="${wide ? 'wide' : ''}">${esc(c)}
        <select name="f${i}">
          <option value="">Select status…</option>
          ${opts.map(o => `<option value="${esc(o)}" ${o.toLowerCase() === curVal.toLowerCase() ? 'selected' : ''}>${esc(o)}</option>`).join('')}
          ${curVal && !opts.some(o => o.toLowerCase() === curVal.toLowerCase()) ? `<option value="${esc(curVal)}" selected>${esc(curVal)}</option>` : ''}
        </select></label>`;
    }

    return `<label class="${wide ? 'wide' : ''}">${esc(c)}
      <input name="f${i}" value="${editCtx ? esc(curVal) : ''}" ${i === reqIdx ? 'required' : ''} placeholder="Enter ${esc(String(c).toLowerCase())}…" /></label>`;
  }).join('');
  $('leadFields').innerHTML = source + fields;
  $('leadModal').classList.remove('hidden');
  setTimeout(() => $('leadFields').querySelector('input')?.focus(), 60);
}
function closeLeadModal() { $('leadModal').classList.add('hidden'); state.editing = null; }

async function saveLead(e) {
  e.preventDefault();
  const msg = $('modalMessage');
  const editCtx = state.editing;
  const gid = editCtx ? editCtx.gid : ($('leadSheetSelect')?.value || state.active);
  const cols = state.data[gid]?.columns?.length ? state.data[gid].columns : ['Name', 'Email', 'Phone', 'Status', 'Notes'];
  const fd = new FormData(e.target);
  const row = cols.map((_, i) => String(fd.get(`f${i}`) ?? '').trim());
  const reqIdx = (() => { const i = idxMatch(cols, NAME_H); return i >= 0 ? i : 0; })();

  if (!row[reqIdx]) { msg.textContent = `“${cols[reqIdx]}” is required.`; return; }
  if (!state.endpoint) { msg.textContent = 'No Apps Script URL set. Add it in Settings to save.'; return; }

  msg.style.color = 'var(--muted)'; msg.textContent = 'Saving…';
  try {
    await fetch(state.endpoint, {
      method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: editCtx ? 'update' : 'create', gid, rowIndex: editCtx ? editCtx.rowIndex : -1, data: row }),
      mode: 'no-cors'
    });
    msg.style.color = 'var(--green)'; msg.textContent = '✓ Saved to Google Sheets';
    setTimeout(() => { closeLeadModal(); closeDrawer(); loadSheet(gid).then(() => { state.lastSync = new Date(); renderAll(); }); }, 700);
  } catch (_) {
    msg.style.color = 'var(--red)'; msg.textContent = 'Could not reach Apps Script. Check your deployment and URL.';
  }
}

async function deleteLead() {
  if (!state.current) return;
  const { gid, rowIndex } = state.current;
  if (!confirm('Delete this lead from Google Sheets?')) return;
  if (state.endpoint) {
    try {
      await fetch(state.endpoint, {
        method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'delete', gid, rowIndex }), mode: 'no-cors'
      });
    } catch (_) {}
  }
  (state.data[gid]?.rows || []).splice(rowIndex, 1);
  closeDrawer(); renderAll();
  loadSheet(gid).then(() => renderAll());
}

/* ─────────── EXPORT ─────────── */
function exportCSV() {
  const view = buildView();
  if (!view.rows.length) return;
  const csv = [view.columns, ...view.rows.map(r => r.cells)]
    .map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const name = state.active === '__all__' ? 'all-sub-sheets' : sheetName(state.active).replace(/\s+/g, '-').toLowerCase();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `leadflow-${name}.csv`;
  a.click(); URL.revokeObjectURL(a.href);
}

/* ─────────── SIDEBAR / SETTINGS ─────────── */
function openSidebar() { $('sidebar').classList.add('open'); $('sideBackdrop').classList.remove('hidden'); }
function closeSidebar() { $('sidebar').classList.remove('open'); $('sideBackdrop').classList.add('hidden'); }

function openSettings() {
  $('cfgEndpoint').value = state.endpoint || '';
  $('cfgSheetId').value = state.sheetId || '';
  $('testResult').textContent = ''; $('testResult').className = 'test-result';
  renderDetected();
  $('settingsModal').classList.remove('hidden');
}
function renderDetected() {
  if (!state.sheets.length) { $('detectedWrap').classList.add('hidden'); return; }
  $('detectedWrap').classList.remove('hidden');
  $('detectedCount').textContent = state.sheets.length;
  $('detectedList').innerHTML = state.sheets.map(s => `
    <div class="det-row"><span class="det-dot"></span><span>${esc(s.name)}</span><span class="det-gid">gid ${esc(s.gid)}</span></div>`).join('');
}
async function testConnection() {
  const ep = $('cfgEndpoint').value.trim();
  const res = $('testResult');
  if (!ep) { res.textContent = 'Enter your Apps Script URL first.'; res.className = 'test-result err'; return; }
  res.textContent = 'Testing…'; res.className = 'test-result';
  const prev = state.endpoint;
  state.endpoint = ep;
  const sheets = await detectViaApi();
  if (sheets) {
    state.mode = 'api';
    state.sheets = sheets.map(s => ({ name: s.name, gid: String(s.gid), rows: Number(s.rows) || 0 }));
    res.textContent = `✓ Connected · ${sheets.length} sub-sheet${sheets.length !== 1 ? 's' : ''} detected`;
    res.className = 'test-result ok';
    renderDetected();
  } else {
    state.endpoint = prev;
    res.textContent = '✗ Could not connect. Check the URL and that the deployment is set to “Anyone”.';
    res.className = 'test-result err';
  }
}
async function saveSettings() {
  const ep = $('cfgEndpoint').value.trim(), sid = $('cfgSheetId').value.trim();
  if (ep) { state.endpoint = ep; localStorage.setItem(KEY.endpoint, ep); }
  if (sid) { state.sheetId = sid; localStorage.setItem(KEY.sheetId, sid); $('openSheetLink').href = `https://docs.google.com/spreadsheets/d/${sid}/edit`; }
  $('settingsModal').classList.add('hidden');
  state.data = {}; state.lastSync = null;
  const ok = await connect();
  if (ok) await loadAll();
  if (!$('adminView').classList.contains('hidden')) renderAdmin();
}

/* ═══════════ BINDINGS ═══════════ */
$('authForm').addEventListener('submit', submitAuth);

// Auto-redirect to dashboard immediately upon entering the correct PIN:
$('pinInput').addEventListener('input', async e => {
  if (state.authMode !== 'login') return;
  const pin = e.target.value.trim();
  if (/^\d{4}$/.test(pin)) {
    const hash = await sha(pin);
    const adminHash = await sha(DEFAULTS.adminPin);

    // 1. If admin PIN (2326), immediate auto-direction to dashboard!
    if (hash === adminHash) {
      setSession('admin', 'admin');
      $('authError').textContent = '';
      enterDashboard();
      return;
    }

    // 2. If username is entered, check user PIN and auto-direct!
    const name = $('usernameInput').value.trim();
    if (name) {
      const user = findUser(name);
      if (user && user.pinHash === hash) {
        const users = getUsers();
        const u = users.find(x => x.id === user.id);
        u.lastLogin = Date.now();
        saveUsers(users);
        setSession(u.name, 'user');
        $('authError').textContent = '';
        enterDashboard();
        return;
      } else if (user) {
        $('authError').textContent = 'Incorrect PIN. Try again.';
      }
    } else {
      // If no username entered, check if this PIN matches any user account
      const users = getUsers();
      const matchingUser = users.find(x => x.pinHash === hash);
      if (matchingUser) {
        matchingUser.lastLogin = Date.now();
        saveUsers(users);
        setSession(matchingUser.name, matchingUser.role || 'user');
        $('authError').textContent = '';
        enterDashboard();
        return;
      }
    }
  }
});

$('usernameInput').addEventListener('input', async () => {
  if (state.authMode !== 'login') return;
  const pin = $('pinInput').value.trim();
  const name = $('usernameInput').value.trim();
  if (/^\d{4}$/.test(pin) && name) {
    const hash = await sha(pin);
    const user = findUser(name);
    if (user && user.pinHash === hash) {
      const users = getUsers();
      const u = users.find(x => x.id === user.id);
      u.lastLogin = Date.now();
      saveUsers(users);
      setSession(u.name, 'user');
      $('authError').textContent = '';
      enterDashboard();
    }
  }
});
$('switchBtn')?.addEventListener('click', () => {
  if (state.authMode === 'signup' || state.authMode === 'forgot' || state.authMode === 'reset') {
    setAuthMode('login');
  } else {
    setAuthMode('signup');
  }
  updateAuthUI();
});
$('switchLink')?.addEventListener('click', () => { setAuthMode(state.authMode === 'signup' ? 'login' : 'signup'); updateAuthUI(); });
$('forgotLink').addEventListener('click', () => { setAuthMode('forgot'); updateAuthUI(); });
$('recoveryDone').addEventListener('click', continueAfterRecovery);
$('copyRecovery').addEventListener('click', async () => {
  const t = $('recoveryCodeOut').textContent;
  try { await navigator.clipboard.writeText(t); $('copyRecovery').textContent = 'Copied ✓'; }
  catch { $('copyRecovery').textContent = 'Select & copy'; }
  setTimeout(() => $('copyRecovery').textContent = 'Copy', 1600);
});

$('adminOpenDash').addEventListener('click', enterDashboard);
$('adminSettings').addEventListener('click', openSettings);
$('adminLogout').addEventListener('click', signOut);
$('addUserBtn').addEventListener('click', () => openUserModal('add'));
$('closeUserModal').addEventListener('click', () => $('userModal').classList.add('hidden'));
$('cancelUserModal').addEventListener('click', () => $('userModal').classList.add('hidden'));
$('userForm').addEventListener('submit', saveUserForm);
$('sysSettings').addEventListener('click', openSettings);
$('sysRetest').addEventListener('click', async e => {
  e.target.textContent = '↻ Detecting…';
  state.data = {};
  const ok = await connect();
  e.target.textContent = '↻ Re-detect sub-sheets';
  if (ok) renderAdmin();
});
$('resetUsers').addEventListener('click', () => {
  if (!confirm('Delete ALL user accounts on this device? This cannot be undone.')) return;
  localStorage.removeItem(KEY.users);
  renderAdmin();
});

$('settingsBtn').addEventListener('click', openSettings);
$('lockBtn').addEventListener('click', signOut);
$('menuBtn').addEventListener('click', openSidebar);
$('closeSidebar').addEventListener('click', closeSidebar);
$('sideBackdrop').addEventListener('click', closeSidebar);
$('refreshBtn').addEventListener('click', refreshTick);
$('addBtn').addEventListener('click', () => openLeadModal(false));
$('editBtn').addEventListener('click', () => { if (state.current) openLeadModal(true); });
$('deleteBtn').addEventListener('click', deleteLead);
$('exportBtn').addEventListener('click', exportCSV);
$('closeDrawer').addEventListener('click', closeDrawer);
$('drawerBackdrop').addEventListener('click', closeDrawer);
$('closeLeadModal').addEventListener('click', closeLeadModal);
$('cancelLeadModal').addEventListener('click', closeLeadModal);
$('leadForm').addEventListener('submit', saveLead);
$('closeSettings').addEventListener('click', () => $('settingsModal').classList.add('hidden'));
$('testConnBtn').addEventListener('click', testConnection);
$('saveSettings').addEventListener('click', saveSettings);

$('userChip').addEventListener('click', () => {
  if (confirm('Switch user? You will be signed out.')) signOut();
});
$('sideSearch').addEventListener('input', e => { state.query = e.target.value; $('tableSearch').value = e.target.value; renderTable(); });
$('tableSearch').addEventListener('input', e => { state.query = e.target.value; $('sideSearch').value = e.target.value; renderTable(); });

// Status filter pill listeners
document.querySelectorAll('.filter-pill').forEach(pill => {
  pill.addEventListener('click', () => {
    document.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
    state.statusFilter = pill.dataset.filter || 'ALL';
    renderTable();
  });
});



document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeLeadModal(); closeDrawer(); closeSidebar();
    $('settingsModal').classList.add('hidden'); $('userModal').classList.add('hidden');
  }
  if (e.key === '/' && !/input|textarea|select/i.test(document.activeElement.tagName) && !$('appView').classList.contains('hidden')) {
    e.preventDefault(); $('tableSearch').focus();
  }
});

setInterval(() => {
  const s = JSON.parse(localStorage.getItem(KEY.session) || 'null');
  if (s && s.exp < Date.now() && $('authView').classList.contains('hidden')) signOut();
}, 30000);

/* ═══════════ BOOT ═══════════ */
(function boot() {
  const session = getSession();
  if (session) {
    enterDashboard();
  } else {
    setAuthMode('login');
    updateAuthUI();
  }
})();
