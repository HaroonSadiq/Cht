# Permission Justifications — copy/paste into Meta App Review

For each permission, Meta asks two questions:
1. **How is your app using this permission?** (1 short paragraph, max 1000 chars)
2. **Step-by-step instructions for the reviewer to test this permission**

Below is the exact text to paste into each field.

---

## 1. `pages_show_list`

**How is your app using this permission?**

FlowBot is a comment-to-DM automation platform for Facebook Page admins. After the admin completes Facebook Login for Business, we use `pages_show_list` to display the list of Pages they administer so they can choose which Page to connect to FlowBot. Without this permission, the admin would have no way to select which of their Pages to automate. This list is shown only to the admin in their FlowBot dashboard and is never stored beyond the session needed for connection.

**Step-by-step test instructions:**

1. Visit https://chtmodel.vercel.app
2. Sign in with the test credentials provided in the submission notes
3. On the dashboard, click **"Connect Facebook Page"**
4. Complete Facebook Login for Business
5. On the Page selection screen, observe the list of Pages — this list is populated using `pages_show_list`
6. Select a Page and click **Continue**

---

## 2. `pages_manage_metadata`

**How is your app using this permission?**

FlowBot uses `pages_manage_metadata` exclusively to subscribe the connected Page to webhook notifications for the `feed`, `messages`, and `messaging_postbacks` fields. This subscription is what allows FlowBot to receive a real-time notification when a customer comments on the Page's posts, which is the trigger for our automated reply flow. Without this permission, the entire product cannot function. The Page subscription is created on connection and removed if the admin disconnects the integration.

**Step-by-step test instructions:**

1. Complete steps 1–6 above for `pages_show_list`
2. After Page selection, the OAuth callback handler subscribes the Page to webhooks using `pages_manage_metadata`
3. To verify, navigate to https://developers.facebook.com/apps/YOUR_APP_ID/webhooks/ → Page object → confirm SellerDash appears in the subscribed Pages list

---

## 3. `pages_read_engagement`

**How is your app using this permission?**

FlowBot uses `pages_read_engagement` to receive comment events delivered through the Page webhook. When a customer comments on a Page post, Meta sends a `feed` webhook event containing the comment metadata (post_id, comment_id, from). FlowBot uses this metadata to identify which post was commented on and locate the customer who left the comment. Without this permission, our service receives no comment notifications.

**Step-by-step test instructions:**

1. Complete the integration setup (steps 1–6 above)
2. As the test user (not the Page admin), comment "LIFETIME" on any SellerDash post
3. Within ~10 seconds, observe in the FlowBot dashboard that the comment was registered (counter increments on the rule card)

---

## 4. `pages_read_user_content`

**How is your app using this permission?**

FlowBot uses `pages_read_user_content` to read the **text content** of incoming comments so we can match them against the keywords the Page admin has configured. For example, if a Page admin has configured a rule with keyword "LIFETIME", we need to read the comment's text to determine if it contains "LIFETIME" before triggering the automated reply. We only read text from comments on the connected Page's own posts; we never read content from other Pages or Profiles.

**Step-by-step test instructions:**

1. In FlowBot dashboard, create a rule with keyword `LIFETIME` and DM body `Here's your offer: https://example.com`
2. As the test user, comment **"LIFETIME"** on a SellerDash post
3. Observe that the rule fires (counter increments). The keyword match required reading the comment text using `pages_read_user_content`.

---

## 5. `pages_manage_engagement`

**How is your app using this permission?**

FlowBot uses `pages_manage_engagement` to publicly reply to the customer's comment from the Page's voice. This serves two purposes: (1) it acknowledges the customer publicly so they know their comment was seen, and (2) it tells them to check their DMs for the requested information. The reply text is configured by the Page admin per rule (e.g., "Check your DMs!"). We only post replies in response to a matched keyword trigger, never spontaneously.

**Step-by-step test instructions:**

1. Complete steps 1–3 of the `pages_read_user_content` test
2. After commenting "LIFETIME", refresh the post within ~15 seconds
3. Observe the public reply **"Check your DMs!"** appears under the test user's comment, posted as the SellerDash Page

---

## 6. `pages_messaging`

**How is your app using this permission?**

FlowBot uses `pages_messaging` to send a private Direct Message from the connected Page to the customer who triggered a keyword. The DM body is configured by the Page admin per rule (e.g., a link, coupon code, or product information). DMs are sent only via the Comment-to-Message use case, where the recipient is identified by `comment_id`, complying with Meta's Messenger Platform policies. The DM is sent immediately after the public reply, within Meta's 24-hour Standard Messaging window.

**Step-by-step test instructions:**

1. Complete steps 1–2 of `pages_manage_engagement` test
2. Switch to the test user's Messenger inbox at messenger.com
3. Within ~15 seconds, observe a new DM from SellerDash containing the configured body (e.g., "Here's your offer: https://example.com")

---

## 7. `business_management` (only if you keep FB Login for Business)

**How is your app using this permission?**

FlowBot uses Facebook Login for Business with `business_management` to allow Business Manager admins to grant Page access on behalf of their organization. This is the recommended login flow for B2B SaaS products and provides better access management for our customers, who are typically e-commerce sellers managing one or more business Pages through Business Manager.

**Step-by-step test instructions:**

1. The reviewer logs in with a test account that has Business Manager admin role
2. Visit https://chtmodel.vercel.app/dashboard → click **Connect Facebook Page**
3. The Facebook Login for Business dialog appears (configuration ID `2728012970932296`)
4. Complete the connection — the Business Manager-managed Pages are listed
