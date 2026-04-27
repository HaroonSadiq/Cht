# FlowBot App Review Screencast Script

**Target length:** 90–120 seconds. Must be screen-recorded at ≥720p with audio narration or on-screen text captions.

**Recording tool:** OBS Studio (free), Loom, or Windows Game Bar (Win+G).

**Upload format:** MP4. Upload to YouTube as **unlisted** and paste the link into the App Review submission.

---

## What the reviewer must see in order

The screencast must show ONE continuous flow from sign-up to a DM landing in a real user's inbox. Pause/cuts are fine but the path must be linear.

### 0:00 — Title card (3s)
On-screen text:
```
FlowBot — Comment-to-DM automation for Facebook Pages
Demonstrating: pages_show_list, pages_manage_metadata,
pages_read_engagement, pages_read_user_content,
pages_manage_engagement, pages_messaging, business_management
```

### 0:03 — Visit FlowBot landing page (5s)
- Browser → `https://chtmodel.vercel.app`
- Show the landing page briefly
- Click **"Sign In"** or **"Get Started"**

### 0:08 — Sign up / log in to FlowBot (10s)
- Show the auth screen
- Sign in (use your test account email + password)
- Land on `/dashboard`

### 0:18 — Click "Connect Facebook Page" (5s)
- Show the empty dashboard (no integrations yet)
- Click the **"Connect Facebook Page"** button

### 0:23 — OAuth consent screen (15s) ★ KEY MOMENT
- Facebook Login dialog appears
- **Show the permissions list clearly** — pause for 3 seconds so reviewer can read every requested scope
- Click **Continue as [Your Name]**
- Select the test Page (SellerDash)
- Click **Continue**
- **Show the permissions toggle screen** — leave all permissions ON
- Click **Save**

### 0:38 — Redirected back to dashboard (5s)
- URL shows `/dashboard?connected=meta`
- Page list now shows **SellerDash** as a connected page

### 0:43 — Create a comment-to-DM rule (15s)
- Click **"+ New Rule"** or fill the form
- Trigger keyword: `LIFETIME`
- Public comment reply: `Check your DMs!`
- DM body: `Here's the lifetime deal: https://example.com/lifetime`
- Click **Create & Activate**
- Show the rule card appears in the list

### 0:58 — Demonstrate webhook subscription (5s)
- (Optional but strong) Open browser tab to Meta App Dashboard → Webhooks → Page
- Show that `feed`, `messages`, `messaging_postbacks` are subscribed
- Cut back to FlowBot dashboard

### 1:03 — Trigger a real comment (15s) ★ KEY MOMENT
- Open a NEW browser tab → facebook.com
- Log in as a SECOND test user (NOT the page admin)
- Navigate to a SellerDash post
- Type comment: `LIFETIME`
- Hit Post
- Wait ~5 seconds

### 1:18 — Show the public reply appears (8s)
- Refresh the post
- Show the public reply `"Check your DMs!"` now visible under the user's comment

### 1:26 — Show the DM arrives (10s)
- Switch to the second test user's Messenger inbox
- Open the conversation from SellerDash
- Show the DM message: `"Here's the lifetime deal: https://example.com/lifetime"`

### 1:36 — Show analytics in dashboard (5s)
- Switch back to FlowBot dashboard
- Show the rule card now displays counters (1 trigger, 1 DM sent)

### 1:41 — End card (3s)
On-screen text:
```
FlowBot ends the manual work of replying to every comment.
Page admins set rules once. Customers get instant DMs.
```

---

## Common rejection reasons — avoid these

1. **"Permissions screen not visible"** → make sure the OAuth consent dialog is on screen for ≥3 seconds with all scope names readable
2. **"Cannot see end-user benefit"** → the screencast MUST show a real comment causing a real DM to arrive in a real inbox. No mock data.
3. **"Test credentials don't work"** → provide a working test FB account in the submission notes (see test-credentials.md)
4. **"Cannot reproduce flow"** → the dashboard must work without you logging in; provide email + password for reviewer to use
5. **Video too short** → minimum 60s, target 90–120s

---

## Recording checklist

- [ ] Use a fresh Chrome profile (no other tabs/extensions visible)
- [ ] Hide bookmarks bar, browser notifications, OS notifications
- [ ] Record at 1280×720 minimum, 1920×1080 ideal
- [ ] Use OBS Studio with display capture, 30 fps, MP4 output
- [ ] Add on-screen text captions for each step (if no audio narration)
- [ ] Final upload: YouTube → Unlisted → copy link
- [ ] Do a dry run end-to-end before recording to catch broken steps
