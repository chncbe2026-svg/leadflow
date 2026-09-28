# LeadFlow — Live Google Sheets Command Center

One dashboard for **every sub-sheet (tab)** inside your Google Spreadsheet, with
username + PIN accounts, PIN recovery, and a built-in admin console.

---

## Sign in

| | |
|---|---|
| **First launch** | Create an account: username + 4-digit PIN |
| **Returning** | Sign in with username + PIN |
| **Forgot PIN?** | Use the recovery code shown when the account was created |
| **Admin panel** | Enter PIN **`2326`** (username optional) |
| **Session** | Stays unlocked **5 hours** on the device |

> PIN `2326` is reserved — it can never be assigned to a normal user.

---

## Admin console — PIN `2326`

- See every registered user, their role, and last sign-in
- **Add user**, **Reset PIN**, **Delete user**
- View connection status, sub-sheet count, and total leads
- Re-detect sub-sheets or open connection settings
- Jump into the dashboard with an **Admin** shortcut in the sidebar
- Danger zone: delete all users on the device

---

## Setup

### 1. Deploy the Apps Script (required)

1. [script.google.com](https://script.google.com) → **New project**
2. Paste everything from **`Code.gs`**, check the `SPREADSHEET_ID`
3. **Deploy → New deployment → Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
4. Copy the **`/exec`** URL
5. In LeadFlow: account → **Settings** → paste the URL → **Test & detect sub-sheets**

> Already deployed? **Manage deployments → ✎ Edit → Version: New version → Deploy.** URL stays the same.

### 2. In-app Settings

**Settings → Connect your sheet** — paste the Apps Script URL and click
**Test & detect sub-sheets**. Your tabs appear in the sidebar automatically.

---

## Features

| Feature | Details |
|---|---|
| 🔐 **Accounts** | Username + 4-digit PIN, 5-hour sessions |
| ♻️ **PIN recovery** | Per-user recovery code |
| ⚙️ **Admin console** | PIN `2326` — users, PIN resets, system status |
| 🔍 **Auto sub-sheet detection** | Every tab appears in the sidebar automatically |
| ⚡ **Live refresh** | Re-reads every 5 seconds |
| ➕ **Add / ✏️ Edit / 🗑️ Delete** | Writes straight back to Google Sheets |
| 🔎 **Search & sort** | Live filter + click headers to sort |
| 📊 **Overview** | All sub-sheets combined with a source column |
| 📥 **CSV export** | Export the current view |
| 📱 **Responsive** | Phone, tablet, desktop |
| 🎨 **Neon UI** | Glass panels, glowing accents, status pills |

---

## How reads work

1. **Apps Script (preferred)** — JSONP reads, works with a private sheet.
2. **Published fallback** — *File → Share → Publish to web → Publish entire document*.

---

## Sheet format

- **Row 1** = column headers (used as table columns).
- Any columns work — the dashboard adapts.
- `email` / `phone` columns become clickable links.
- `status` / `stage` columns become colored pills.
- Overview uses the *name, email, phone, status* columns.

---

## Files

| File | Purpose |
|---|---|
| `index.html` | Markup: auth, admin, dashboard |
| `styles.css` | Neon theme + admin console styling |
| `app.js` | Auth, admin, sheet sync, UI logic |
| `Code.gs` | Google Apps Script backend (deploy this) |

---

## Security notes

- PINs are stored **hashed (SHA-256)** in this browser's `localStorage`.
- Accounts are **device-local** — they do not sync between devices or browsers.
- The admin PIN `2326` is a shared code; change `DEFAULTS.adminPin` in `app.js` if you need a different one.
- For true multi-user security across devices, add a server-side login.
