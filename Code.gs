/* ═══════════════════════════════════════════════════════════════
   LEADFLOW · Google Apps Script Backend & Meta Webhook Receiver
   ───────────────────────────────────────────────────────────────
   1. Paste this code in script.google.com
   2. Configure your META_ACCESS_TOKEN & META_VERIFY_TOKEN below
   3. Deploy → New deployment → Web app (Execute as: Me, Access: Anyone)
   4. Use the /exec URL as your Meta Webhook Callback URL
   ═══════════════════════════════════════════════════════════════ */

/* ── CONFIGURATION ── */
const SPREADSHEET_ID = '1Pcy8PTNEC5S39sn0HA2xYRqwPi6t1NxWCUJVkO06FMY';
const TARGET_SHEET_NAME = 'LEADS DEPOSIT'; // Sub-sheet where Meta webhook leads are saved
const MAX_ROWS = 5000;

// Meta (Facebook / Instagram) Credentials:
const META_ACCESS_TOKEN = 'EAAOsv2mMLcoBSs4y5l0SpyKELzZAOJkE6CZAqKKQH8111DI4zzLAaBblPdYZAp3DatHzpZCmDp4T6QUAjWsZBNbudKLI2oxbBPQT0WUiBPHSKB1D5dCXP9kiceUCzo1udsEUBGMxZBeTd59OY8omdhl13NdiJCB78DtlQGTXZCRJYasAZCx4q0T1h2LeSVnkHJRJUWWVc5bF';
const META_PAGE_ID = '1406205024946599'; // Chn India Page ID
const META_VERIFY_TOKEN = 'leadflow_meta_2026';

/* ── GET: Webhook Verification & LeadFlow Data (supports JSONP) ── */
function doGet(e) {
  const p = (e && e.parameter) || {};

  // 1. Meta Webhook Verification Challenge
  if (p['hub.mode'] === 'subscribe') {
    if (p['hub.verify_token'] === META_VERIFY_TOKEN) {
      return ContentService.createTextOutput(p['hub.challenge'] || '')
        .setMimeType(ContentService.MimeType.TEXT);
    }
    return ContentService.createTextOutput('Verification token mismatch')
      .setMimeType(ContentService.MimeType.TEXT);
  }

  // 2. LeadFlow Dashboard & Sync Actions
  let result;
  try {
    switch (p.action) {
      case 'getAllData':     result = getAllData(); break;
      case 'listSheets':     result = listSheets(); break;
      case 'getData':        result = getData(p.gid); break;
      case 'syncPastLeads':  result = syncHistoricalLeads(p.pageId || META_PAGE_ID); break;
      default:               result = { ok: true, message: 'LeadFlow API & Webhook online', targetSheet: TARGET_SHEET_NAME };
    }
  } catch (err) {
    result = { ok: false, error: err.message };
  }
  return output(result, p.callback);
}

/* ── POST: Meta Webhook Lead Event & LeadFlow CRUD ── */
function doPost(e) {
  try {
    const rawContent = (e && e.postData && e.postData.contents) || '{}';
    const body = JSON.parse(rawContent);

    // 1. Meta LeadGen Webhook Notification
    if (body.object === 'page' && Array.isArray(body.entry)) {
      handleMetaWebhook(body);
      return ContentService.createTextOutput(JSON.stringify({ status: 'EVENT_RECEIVED' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // 2. LeadFlow CRUD Actions
    let result;
    switch (body.action) {
      case 'test':          result = { ok: true, message: 'LeadFlow connection working' }; break;
      case 'create':        result = createRow(body); break;
      case 'update':        result = updateRow(body); break;
      case 'delete':        result = deleteRow(body); break;
      case 'syncPastLeads': result = syncHistoricalLeads(body.pageId || META_PAGE_ID); break;
      default: throw new Error('Unknown action: ' + body.action);
    }
    return output(result, (e && e.parameter && e.parameter.callback) || null);
  } catch (err) {
    return output({ ok: false, error: err.message }, (e && e.parameter && e.parameter.callback) || null);
  }
}

/* ═══════════════════════════════════════════════════════════════
   META LEADGEN WEBHOOK PROCESSOR
   ═══════════════════════════════════════════════════════════════ */
function handleMetaWebhook(body) {
  const entries = body.entry || [];
  for (let i = 0; i < entries.length; i++) {
    const changes = entries[i].changes || [];
    for (let j = 0; j < changes.length; j++) {
      const change = changes[j];
      if (change.field === 'leadgen' && change.value) {
        const leadgenId = change.value.leadgen_id;
        const pageId = change.value.page_id || entries[i].id;
        const formId = change.value.form_id;
        const createdTime = change.value.created_time || Math.floor(Date.now() / 1000);

        processMetaLead(leadgenId, pageId, formId, createdTime);
      }
    }
  }
}

function processMetaLead(leadgenId, pageId, formId, createdTime) {
  if (!leadgenId) return;

  let leadData = null;
  if (META_ACCESS_TOKEN && META_ACCESS_TOKEN !== 'YOUR_META_ACCESS_TOKEN') {
    try {
      const url = 'https://graph.facebook.com/v19.0/' + leadgenId +
        '?access_token=' + encodeURIComponent(META_ACCESS_TOKEN) +
        '&fields=created_time,id,ad_id,form_id,field_data';
      const resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
      if (resp.getResponseCode() === 200) {
        leadData = JSON.parse(resp.getContentText());
      } else {
        Logger.log('Meta API Error: ' + resp.getContentText());
      }
    } catch (err) {
      Logger.log('Meta UrlFetchApp Error: ' + err.message);
    }
  }

  const b = book();
  let sheet = b.getSheetByName(TARGET_SHEET_NAME);
  if (!sheet) sheet = b.insertSheet(TARGET_SHEET_NAME);
  ensureDepositHeaders(sheet);

  insertLeadRow(sheet, leadData || { id: leadgenId, created_time: new Date(createdTime * 1000).toISOString() }, formId);
}

/* Format and append a lead row into LEADS DEPOSIT */
function insertLeadRow(sheet, leadData, formId) {
  const leadgenId = leadData.id;
  const dateStr = leadData.created_time
    ? new Date(leadData.created_time).toLocaleString()
    : new Date().toLocaleString();

  let fullName = '';
  let phone = '';
  let email = '';
  let city = '';
  const customFields = {};

  if (Array.isArray(leadData.field_data)) {
    leadData.field_data.forEach(f => {
      const fn = String(f.name || '').toLowerCase().trim();
      const val = Array.isArray(f.values) ? f.values.join(', ') : String(f.values || '');
      if (fn.includes('full_name') || fn === 'name' || fn.includes('first_name')) {
        fullName = fullName ? (fullName + ' ' + val) : val;
      } else if (fn.includes('phone') || fn.includes('mobile') || fn.includes('contact') || fn.includes('whatsapp')) {
        phone = val;
      } else if (fn.includes('email') || fn.includes('mail')) {
        email = val;
      } else if (fn.includes('city') || fn.includes('location') || fn.includes('address')) {
        city = val;
      } else {
        customFields[f.name] = val;
      }
    });
  }

  const lastCol = Math.max(sheet.getLastColumn(), 1);
  const headers = sheet.getRange(1, 1, 1, lastCol).getDisplayValues()[0];

  const newRow = headers.map(h => {
    const k = String(h).toLowerCase().trim();
    if (k.includes('date') || k.includes('time')) return dateStr;
    if (k.includes('lead id') || k === 'id') return String(leadgenId);
    if (k.includes('name') || k.includes('client') || k.includes('customer')) return fullName || ('Lead ' + leadgenId);
    if (k.includes('phone') || k.includes('mobile') || k.includes('whatsapp') || k.includes('contact')) return phone;
    if (k.includes('email') || k.includes('mail')) return email;
    if (k.includes('city') || k.includes('location') || k.includes('address')) return city;
    if (k.includes('status') || k.includes('stage')) return 'New';
    if (k.includes('form')) return String(formId || leadData.form_id || '');
    if (k.includes('details') || k.includes('notes') || k.includes('custom') || k.includes('raw')) {
      return Object.keys(customFields).length ? JSON.stringify(customFields) : JSON.stringify(leadData);
    }
    for (const [cfKey, cfVal] of Object.entries(customFields)) {
      if (cfKey.toLowerCase().trim() === k || k.includes(cfKey.toLowerCase().trim())) {
        return cfVal;
      }
    }
    return '';
  });

  sheet.appendRow(newRow);
}

function ensureDepositHeaders(sheet) {
  if (sheet.getLastRow() < 1 || sheet.getLastColumn() < 1) {
    const defaultHeaders = ['Date', 'Lead ID', 'Full Name', 'Phone Number', 'Email', 'City / Location', 'Status', 'Custom Details'];
    sheet.getRange(1, 1, 1, defaultHeaders.length).setValues([defaultHeaders]);
    sheet.getRange(1, 1, 1, defaultHeaders.length).setFontWeight('bold');
    return;
  }
  const firstCell = String(sheet.getRange(1, 1).getValue() || '').trim();
  if (!firstCell) {
    const defaultHeaders = ['Date', 'Lead ID', 'Full Name', 'Phone Number', 'Email', 'City / Location', 'Status', 'Custom Details'];
    sheet.getRange(1, 1, 1, defaultHeaders.length).setValues([defaultHeaders]);
    sheet.getRange(1, 1, 1, defaultHeaders.length).setFontWeight('bold');
  }
}

/* ═══════════════════════════════════════════════════════════════
   SYNC HISTORICAL / PAST LEADS
   Run this function in Apps Script editor or via URL to fetch
   all past leads from all Lead Forms on your Facebook Page!
   ═══════════════════════════════════════════════════════════════ */
/* ═══════════════════════════════════════════════════════════════
   SYNC HISTORICAL / PAST LEADS
   Supports either:
   1. A Facebook Page ID (syncs all forms on that Page)
   2. A Lead Form ID (syncs that specific form directly)
   ═══════════════════════════════════════════════════════════════ */
function syncHistoricalLeads(targetId) {
  const id = targetId || META_PAGE_ID;
  if (!id) throw new Error('Facebook Page ID or Form ID is missing.');
  if (!META_ACCESS_TOKEN || META_ACCESS_TOKEN.startsWith('YOUR_')) {
    throw new Error('Valid META_ACCESS_TOKEN is required.');
  }

  // Check if targetId is a Form ID or Page ID
  let forms = [];
  const formsUrl = 'https://graph.facebook.com/v19.0/' + id + '/leadgen_forms?access_token=' + encodeURIComponent(META_ACCESS_TOKEN) + '&limit=100';
  const formsResp = UrlFetchApp.fetch(formsUrl, { muteHttpExceptions: true });
  const formsJson = JSON.parse(formsResp.getContentText());

  if (formsResp.getResponseCode() === 200 && Array.isArray(formsJson.data)) {
    forms = formsJson.data;
  } else {
    // Check if the ID provided is directly a Lead Form ID
    const testFormUrl = 'https://graph.facebook.com/v19.0/' + id + '?access_token=' + encodeURIComponent(META_ACCESS_TOKEN) + '&fields=id,name';
    const formResp = UrlFetchApp.fetch(testFormUrl, { muteHttpExceptions: true });
    const formJson = JSON.parse(formResp.getContentText());

    if (formResp.getResponseCode() === 200 && formJson.id) {
      forms = [{ id: formJson.id, name: formJson.name || 'Lead Form ' + formJson.id }];
    } else {
      const errMsg = (formsJson.error && formsJson.error.message) || formsResp.getContentText();
      Logger.log('Meta Error Detail: ' + errMsg);
      throw new Error(
        'The ID "' + id + '" is NOT a valid Facebook Page ID or Form ID.\n' +
        'Note: 1406205024946599 is your Developer User ID (Chn India), not the Page ID.\n' +
        'Please enter your actual numeric Facebook Page ID or Lead Form ID from Meta Business Suite / Ads Manager.'
      );
    }
  }

  if (!forms.length) {
    return { ok: true, message: 'No lead forms found for ID: ' + id, synced: 0 };
  }

  // Open sheet and collect existing Lead IDs to prevent duplicates
  const b = book();
  let sheet = b.getSheetByName(TARGET_SHEET_NAME);
  if (!sheet) sheet = b.insertSheet(TARGET_SHEET_NAME);
  ensureDepositHeaders(sheet);

  const existingIds = new Set();
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow > 1 && lastCol >= 2) {
    const idValues = sheet.getRange(2, 2, lastRow - 1, 1).getDisplayValues(); // Column 2 is Lead ID
    idValues.forEach(r => {
      const existingId = String(r[0] || '').trim();
      if (existingId) existingIds.add(existingId);
    });
  }

  let totalSynced = 0;

  // Loop through forms and sync leads
  for (let f = 0; f < forms.length; f++) {
    const form = forms[f];
    let nextUrl = 'https://graph.facebook.com/v19.0/' + form.id + '/leads?access_token=' + encodeURIComponent(META_ACCESS_TOKEN) + '&fields=created_time,id,ad_id,form_id,field_data&limit=500';

    while (nextUrl) {
      const leadsResp = UrlFetchApp.fetch(nextUrl, { muteHttpExceptions: true });
      if (leadsResp.getResponseCode() !== 200) {
        Logger.log('Failed fetching leads for form ' + form.id + ': ' + leadsResp.getContentText());
        break;
      }
      const leadsJson = JSON.parse(leadsResp.getContentText());
      const leads = leadsJson.data || [];

      for (let i = 0; i < leads.length; i++) {
        const lead = leads[i];
        if (!existingIds.has(String(lead.id))) {
          insertLeadRow(sheet, lead, form.id);
          existingIds.add(String(lead.id));
          totalSynced++;
        }
      }

      nextUrl = (leadsJson.paging && leadsJson.paging.next) ? leadsJson.paging.next : null;
    }
  }

  Logger.log('Sync complete! Total historical leads synced: ' + totalSynced);
  return { ok: true, message: 'Historical leads synced successfully', synced: totalSynced, formsCount: forms.length };
}

/* ═══════════════════════════════════════════════════════════════
   LEADFLOW SPREADSHEET HELPERS
   ═══════════════════════════════════════════════════════════════ */
function book() { return SpreadsheetApp.openById(SPREADSHEET_ID); }

function findSheet(gid) {
  const sheet = book().getSheets().filter(s => String(s.getSheetId()) === String(gid))[0];
  if (!sheet) throw new Error('Sub-sheet not found for gid ' + gid);
  return sheet;
}

/* Extract headers & data safely, guaranteeing every header in row 1 is preserved */
function readSheetData(sheet) {
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 1 || lastCol < 1) return { columns: [], rows: [] };

  const headerValues = sheet.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
  let maxCol = 0;
  for (let i = headerValues.length - 1; i >= 0; i--) {
    if (String(headerValues[i] || '').trim() !== '') {
      maxCol = i + 1;
      break;
    }
  }
  if (maxCol === 0) return { columns: [], rows: [] };

  const columns = headerValues.slice(0, maxCol).map((c, i) => String(c).trim() || ('Column ' + (i + 1)));
  let rows = [];
  if (lastRow > 1) {
    const dataRange = sheet.getRange(2, 1, Math.min(lastRow - 1, MAX_ROWS), maxCol);
    const dataValues = dataRange.getDisplayValues();
    rows = dataValues.filter(r => r.some(c => String(c).trim() !== ''));
  }
  return { columns: columns, rows: rows, total: rows.length };
}

/* Reads every sub-sheet in 1 fast call */
function getAllData() {
  const b = book();
  const sheets = b.getSheets();
  const resultData = {};
  const sheetList = [];

  sheets.forEach(s => {
    const gid = String(s.getSheetId());
    const name = s.getName();
    const sheetData = readSheetData(s);
    resultData[gid] = sheetData;
    sheetList.push({ name: name, gid: gid, rows: sheetData.rows ? sheetData.rows.length : 0 });
  });

  return { ok: true, sheets: sheetList, data: resultData };
}

function listSheets() {
  const sheets = book().getSheets().map(s => ({
    name: s.getName(),
    gid: String(s.getSheetId()),
    rows: Math.max(s.getLastRow() - 1, 0)
  }));
  return { ok: true, sheets: sheets };
}

function getData(gid) {
  const sheet = findSheet(gid);
  const data = readSheetData(sheet);
  return { ok: true, columns: data.columns, rows: data.rows, total: data.total };
}

function createRow(body) {
  const sheet = findSheet(body.gid);
  sheet.appendRow(body.data || []);
  return { ok: true, action: 'create' };
}

function updateRow(body) {
  const sheet = findSheet(body.gid);
  const rowNum = Number(body.rowIndex) + 2; // +1 header, +1 for 1-based rows
  if (!rowNum || rowNum < 2) throw new Error('Invalid row index');
  const data = body.data || [];
  if (data.length) sheet.getRange(rowNum, 1, 1, data.length).setValues([data]);
  return { ok: true, action: 'update', row: rowNum };
}

function deleteRow(body) {
  const sheet = findSheet(body.gid);
  const rowNum = Number(body.rowIndex) + 2;
  if (!rowNum || rowNum < 2) throw new Error('Invalid row index');
  sheet.deleteRow(rowNum);
  return { ok: true, action: 'delete', row: rowNum };
}

/* ── output (JSON or JSONP) ── */
function output(obj, callback) {
  const text = JSON.stringify(obj);
  if (callback) {
    return ContentService.createTextOutput(callback + '(' + text + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(text)
    .setMimeType(ContentService.MimeType.JSON);
}
