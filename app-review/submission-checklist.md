# Meta App Review Submission Checklist

Work through this list top-to-bottom. Don't skip — Meta auto-rejects incomplete submissions.

## Pre-flight (must be done before opening App Review)

- [ ] **Business Verification complete**
  - business.facebook.com → Business Settings → Business Info → Verify
  - Upload a business document (utility bill, bank statement, or tax certificate with Muhammad Haroon Sadiq's name)
  - Wait 1–3 business days for approval
  - Status must say "Verified" before continuing

- [ ] **Two test Facebook accounts created**
  - Account 1: will be Page admin of SellerDash
  - Account 2: will be the commenter / customer
  - Both must be real FB accounts (not Test Users — those don't work for review)
  - Both should be a few weeks old to avoid trust issues

- [ ] **App settings filled out completely**
  - App Dashboard → Settings → Basic
  - Display Name: FlowBot
  - App Domain: `chtmodel.vercel.app`
  - Privacy Policy URL: `https://chtmodel.vercel.app/privacy`
  - Terms of Service URL: `https://chtmodel.vercel.app/terms`
  - **Data Deletion Request Callback URL**: `https://chtmodel.vercel.app/api/data-deletion`
    (Meta POSTs a `signed_request` here; we verify it, queue the deletion, and return `{url, confirmation_code}`)
  - **Data Deletion Instructions URL** (if Meta asks separately): `https://chtmodel.vercel.app/data-deletion-status`
  - Category: **Business and Pages**
  - App Icon: 1024×1024 uploaded
  - Contact Email: `mharoonsadiq8@gmail.com`
  - "+ Add Platform" → Website → `https://chtmodel.vercel.app`

- [ ] **Data Use Checkup completed**
  - App Dashboard → look for the yellow "Data Use Checkup" banner
  - Confirm purpose for each requested permission
  - Submit

## Recording the screencast

- [ ] Read `screencast-script.md`
- [ ] Do a complete dry run of the flow end-to-end (no recording) — make sure every step works without errors
- [ ] Record at 720p+ using OBS Studio (or Loom)
- [ ] Length: 90–120 seconds
- [ ] Upload to YouTube as **Unlisted**
- [ ] Copy the YouTube link

## Submission

- [ ] App Dashboard → **App Review** → **Permissions and Features**
- [ ] For each of the 7 permissions:
  - Click **Request Advanced Access**
  - Paste the corresponding "How is your app using this permission?" text from `permission-justifications.md`
  - Paste the corresponding "Step-by-step test instructions" text
  - Upload the same screencast video (or paste the YouTube link if Meta accepts links)
- [ ] In the **Notes for Reviewer** field, paste the entire content of `test-credentials.md` (with real credentials filled in)
- [ ] Click **Submit for Review**

## After submission

- **Typical review time:** 5–15 business days for the first round
- **Most common outcome:** rejection on round 1 with vague feedback like "screencast doesn't show the use case clearly"
- **Iterate:** read the rejection note, re-record the screencast addressing the specific complaint, resubmit
- **Average:** 2–3 rounds before approval. Plan 4–8 weeks total.

## After approval

- App Dashboard → top toggle → switch from **Development** to **Live**
- Real Facebook users (not just testers) can now connect their Pages
- Webhooks deliver production traffic
- You're in business

---

## Files in this folder

- [screencast-script.md](screencast-script.md) — exact 90–120 second video script
- [permission-justifications.md](permission-justifications.md) — copy/paste text for each permission
- [test-credentials.md](test-credentials.md) — paste into "Notes for Reviewer"
- [submission-checklist.md](submission-checklist.md) — this file
