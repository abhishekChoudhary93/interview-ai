Here is the complete, exhaustive list of work items required to build, secure, and launch **HireVerdict.in** as an unregistered solo founder.

---

### 1. Authentication & Security

* [ ] **Password Reset Flow:** Implement a "Forgot Password" link on the login page that triggers an email via your transactional email provider.
* [ ] **Manual Reset Plan:** Create a quick script or fallback route in your backend to manually reset a password in the database if a user emails support.
* [ ] **Session Persistence:** Ensure user tokens (JWT, cookies, etc.) don't expire mid-interview so a user doesn't lose their progress.
* [ ] **Route Protection:** Lock down the interview dashboard and reporting pages so non-logged-in users cannot access them.

### 2. The Interview Engine & Chat UI

* [ ] **Interview State Management:** Build backend logic to track the current stage of the chat (e.g., Question 1, Question 2, Follow-up, Wrap-up).
* [ ] **"I'm Stuck" Hint Button:** Add a button in the UI that triggers a special LLM prompt to give a subtle hint (and flag the backend to dock points from the final score).
* [ ] **Panic / Reset Button:** Create a "Restart Interview" button in case the AI hallucinates, gets stuck in a loop, or the user wants to start over.
* [ ] **Resume Text / Profile Upload:** Add an optional text area or PDF parser on the profile page so the AI can read the user's actual background for behavioral rounds.

### 3. AI Engineering & Content

* [ ] **System Design Database:** Load a JSON array of at least 10 distinct, structured system design problem statements (e.g., "Design a distributed job scheduler", "Design TikTok").
* [ ] **Behavioral Prompts:** Create a dedicated "System Prompt" instructing the LLM to act as a strict engineering manager asking STAR-method behavioral questions.
* [ ] **Mixed-Round Logic:** Build a toggle for the user to choose "System Design", "Behavioral", or "Mixed" and route the backend to use the correct prompt structure.
* [ ] **Token / Context Window Management:** Ensure old chat messages are properly summarized or pruned if the interview goes long, preventing the LLM from crashing or getting expensive.

### 4. Reporting, Feedback & The Paywall

* [ ] **The Report Evaluator Prompt:** Create a separate, heavy LLM call that triggers *only* when the interview ends. It must review the transcript and output JSON formatting for categories (e.g., Architecture, Communication, Edge Cases) and a final Hire/No-Hire decision.
* [ ] **The Feedback UI:** Design a professional dashboard page for the report. Use progress bars or clean UI charts to visualize their scores.
* [ ] **The Teaser State:** Hide the detailed report behind an overlay if the user hasn't paid. Show only a sneak peek (e.g., *"Your overall score is 68%. Unlock the brutal breakdown to see why you got a No-Hire verdict."*)
* [ ] **Post-Payment Redirect Handler:** Create a success landing page (e.g., `/payment-success?session_id=X`) that verifies the payment status and instantly flips the `isPaid` boolean for that interview in your database.

### 5. Payments Integration (No Registered Business)

* [ ] **Razorpay Account Setup (India/UPI):** Register as an "Individual/Freelancer". Submit PAN and bank details.
* [ ] **Razorpay Payment Button:** Generate a static or dynamic payment link for your INR price and embed the script into your frontend.
* [ ] **Lemon Squeezy Setup (Global/USD Cards):** Register an individual account. Create your digital product (e.g., "HireVerdict Single Interview Report").
* [ ] **Lemon Squeezy Overlay:** Embed their clean JavaScript overlay checkout directly onto your payment button.
* [ ] **Webhook Logic for repeat payments:**
* Password reset link.


### 6. Email Infrastructure

* [ ] **DNS Authentication:** Go to your domain registrar and add the MX, SPF, DKIM, and DMARC text records provided by your email tools.
* [ ] **Support "Inbox" (Google Form Hack):** Embed a Google Form or Typeform on a `/support` page to collect user bugs, sending notifications directly to your personal Gmail.
* [ ] **Resend API Integration:** Hook up the `resend` library to your backend code.
* [ ] **Transactional Triggers:** Write code to fire an email for:
* Password reset link.
* A "Thank you for practicing" email with a direct link back to their unlocked report right after a successful payment.



### 7. Landing Page & Marketing Setup

* [ ] **Value Proposition Refocus:** Update your hero section to focus heavily on the *Hire/No-Hire Report and System Design Chat*.
* [ ] **The "Fake Door" Waitlists:** Keep the "Audio/Video Rounds" buttons on the landing page, but make them trigger a pop-up: *"Audio/Video mode is currently in private beta. Enter your email to jump the queue."*
* [ ] **Email Waitlist Collection:** Connect those fake door pop-ups to a simple list (like loops.so, Mailchimp, or an API posting straight to a Google Sheet).

### 8. Deployment & Analytics

* [ ] **Hosting Infrastructure:** Deploy your frontend and backend. (Fastest setups: Vercel for Next.js/React frontend; Render, Railway, or AWS Lightsail for Node.js backend; Supabase or Neon for a Postgres database).
* [ ] **Environment Variables Audit:** Securely move all API keys (OpenAI/Anthropic, Resend, Razorpay tokens, Database URLs) to your hosting environment variables. Do not commit them to Git.
* [ ] **User Session Analytics:** Install a free tracking script like Microsoft Clarity or PostHog to see recordings of how users interact with your AI chat interface. (This will show you exactly where they get confused or quit).

---

Which bucket do you want to tackle first to get the momentum going?