# Test Credentials for Meta App Reviewer

Paste this entire block into the **"Notes for Reviewer"** field of the App Review submission.

---

## How to test FlowBot

FlowBot is a comment-to-DM automation SaaS for Facebook Page admins.
Live URL: **https://chtmodel.vercel.app**

### Test account 1 — Page admin (use this first)

- Email: `<<<FILL IN — create a fresh test FB account that admins SellerDash>>>`
- Password: `<<<FILL IN>>>`
- This account is admin of the test Page **SellerDash** (Page ID: 115174924807817)

### Test account 2 — Customer / commenter

- Email: `<<<FILL IN — create a second fresh test FB account>>>`
- Password: `<<<FILL IN>>>`
- Use this account to leave the trigger comment on a SellerDash post

### FlowBot dashboard login (separate from Facebook)

- Visit https://chtmodel.vercel.app
- Click **Sign In**
- Email: `<<<FILL IN — create a FlowBot account using test account 1's email or any email>>>`
- Password: `<<<FILL IN>>>`

### Step-by-step end-to-end test

1. **Sign in to FlowBot** — visit https://chtmodel.vercel.app and log in with the FlowBot dashboard credentials above
2. **Connect Facebook Page** — on the dashboard, click **Connect Facebook Page**, complete Facebook Login for Business as test account 1, select **SellerDash**, click Continue
3. **Verify Page is connected** — a card showing "SellerDash" should appear in your dashboard
4. **Create a rule** — click **+ New Rule**:
   - Trigger keyword: `LIFETIME`
   - Public reply: `Check your DMs!`
   - DM body: `Here's the lifetime deal: https://example.com/lifetime`
   - Click **Create & Activate**
5. **Trigger the flow** — open a new browser tab, log in to facebook.com as test account 2, navigate to any SellerDash post, and comment **LIFETIME**
6. **Observe the public reply** — within 15 seconds, refresh the post. You'll see "Check your DMs!" posted as SellerDash under your comment
7. **Observe the DM** — open Messenger as test account 2. A new DM from SellerDash will be in the inbox containing the configured body

### Demo video

A full screencast of the above flow is available here: **<<<YOUTUBE UNLISTED LINK>>>**

### Contact

If anything is unclear or fails during your review, please email **mharoonsadiq8@gmail.com** and I will respond within 24 hours.

---

## ❗ ACTION ITEMS BEFORE SUBMITTING ❗

Replace ALL `<<<FILL IN>>>` placeholders above with real credentials. Meta will reject the submission if test credentials don't work, or if the screencast link is missing/broken/private.
