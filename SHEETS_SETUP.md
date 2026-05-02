# Live signup-survey → Google Sheets

Wire `/api/auth/survey` (Postgres) to your live spreadsheet
[`11AO4-W_O9zF-cP7HcoaD9HNeD8xFQUok`](https://docs.google.com/spreadsheets/d/11AO4-W_O9zF-cP7HcoaD9HNeD8xFQUok/edit)
without a Google Cloud project, service account, or OAuth.
Mechanism: a Google Apps Script bound to the sheet, deployed as a
public Web App. The backend POSTs JSON, the script appends a row.

This document has three parts: (1) paste the Apps Script,
(2) deploy it as a Web App, (3) save the URL to Vercel.

---

## 1. Paste the Apps Script

Open the spreadsheet → **Extensions → Apps Script**. Replace the
default `Code.gs` content with:

```javascript
// FlowBot signup-survey appender. Receives JSON from /api/auth/survey
// and writes one row per response to a tab named "Signups".

const SHEET_NAME = 'Signups';

const HEADER = [
  'Timestamp', 'User ID', 'Email', 'Name',
  'Heard From', 'Heard From (other)',
  'Role', 'Business Type',
  'Platforms', 'Use Case', 'Volume',
];

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) sheet = ss.insertSheet(SHEET_NAME);

    // First write: lay down the header row.
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(HEADER);
      sheet.setFrozenRows(1);
    }

    sheet.appendRow([
      data.timestamp || new Date().toISOString(),
      data.userId || '',
      data.email || '',
      data.name || '',
      data.heardFrom || '',
      data.heardFromOther || '',
      data.role || '',
      data.businessType || '',
      Array.isArray(data.platforms) ? data.platforms.join(', ') : '',
      data.useCase || '',
      data.volume || '',
    ]);

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// GET handler exists only so you can hit the URL in a browser to confirm
// the deployment is live. Returns "OK" — never use it from the backend.
function doGet() {
  return ContentService
    .createTextOutput('OK · POST JSON to write a row')
    .setMimeType(ContentService.MimeType.TEXT);
}
```

Save (`Ctrl+S` / `Cmd+S`).

---

## 2. Deploy as Web App

In the Apps Script editor: **Deploy → New deployment**.

- **Type**: gear icon → **Web app**
- **Description**: `FlowBot signup webhook` (or whatever)
- **Execute as**: **Me** (your account — that's how the script gets
  permission to write to the sheet)
- **Who has access**: **Anyone** — required so the FlowBot backend
  can POST without an auth header. The endpoint only accepts JSON
  with a known shape; nothing destructive is exposed.

Click **Deploy**. Google will prompt for permissions the first time
(read/write the spreadsheet, run as you). Approve.

Copy the **Web app URL** — looks like:

```
https://script.google.com/macros/s/AKfycbx.../exec
```

Quick sanity check: open that URL in a browser. You should see
`OK · POST JSON to write a row`. If you see a Google sign-in page,
the **Who has access** setting is wrong — re-deploy with "Anyone".

---

## 3. Set the env var on Vercel

Vercel dashboard → `chtmodel` project → **Settings → Environment Variables** → add:

| Key | Value | Environment |
|---|---|---|
| `SHEETS_WEBHOOK_URL` | the `/exec` URL from step 2 | Production (and Preview if you want it on previews too) |

Save, then trigger a redeploy (Deployments → top deployment → `…` → Redeploy)
so the new env var is loaded into the function bundle.

---

## How to verify end-to-end

1. Sign up a test account at `https://chtmodel.vercel.app/signup`.
2. Walk through Steps 1–4, then on Step 5 pick a "heard from" option
   and click **Submit**.
3. In the spreadsheet, check the **Signups** tab — a new row should
   appear within a couple of seconds.
4. If nothing shows up, check `signup_surveys.sync_error` in
   Postgres (Supabase / Neon UI) for the row — the failure reason
   is recorded there.

---

## Updating the script later

If you change the script (e.g. add a column), you must
**Deploy → Manage deployments → edit the active deployment → New version**
for the change to take effect. The web app URL stays the same.
Adding a column on the sheet by hand is fine; the script only
appends.

---

## What happens if Sheets is down

The signup-survey response always succeeds: the row is written to
Postgres first, then the Sheets POST is fire-and-forget. On failure
the error is recorded on `signup_surveys.sync_error` and
`synced_to_sheets = false`. You can re-sync later by querying the
unsynced rows and replaying the webhook — the script appends every
call, so you'd get duplicates if the original eventually arrived;
de-dupe by `User ID` in the sheet if needed.
