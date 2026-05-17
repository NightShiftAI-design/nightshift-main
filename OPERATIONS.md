# NightShift AI — Operations Manual
**Last updated: May 17, 2026**

---

## 1. STRIPE TAX SETTINGS — STATUS & ACTION REQUIRED

### Current Status: NOT CONFIGURED ⚠️
Stripe Tax (automatic tax calculation) is **not enabled** on the account. This means:
- No sales tax is being collected on any subscription
- No tax line items appear on invoices
- You are not remitting tax to any jurisdiction

### What you need to know
NightShift AI is a B2B SaaS product sold to hotel/motel operators. Tax obligations depend on:
- **Your business location:** Tennessee — TN taxes SaaS as tangible personal property in some cases
- **Client locations:** Tennessee, other US states — each state has different SaaS tax rules
- **Revenue threshold:** Most states have economic nexus thresholds ($100K revenue or 200 transactions) before you must collect

### Recommended action (before you reach $10K MRR)
1. Go to **dashboard.stripe.com → Tax → Get started**
2. Register your business address (Dayton, TN)
3. Enable automatic tax on subscriptions — Stripe calculates and adds tax per invoice
4. Add your TN tax registration number once you have one
5. **Do not retroactively charge existing clients** — apply to new signups only

### At current revenue ($699/mo) you are almost certainly below nexus thresholds everywhere. But set it up now before you forget.

---

## 2. WEBHOOK RETRY HANDLING — STATUS: ADEQUATE ✅

### How it works
Stripe retries failed webhooks automatically: 5 attempts over 3 days (immediately, 1hr, 6hr, 24hr, 72hr).

### Current implementation
- `stripe-webhook` edge function verifies signature before processing
- `provisioning_jobs` table has `UNIQUE(stripe_session_id)` — idempotency guaranteed
- If webhook fires twice for same `checkout.session.completed`, second call returns "already processed"
- `invoice.payment_failed` and `invoice.payment_succeeded` are idempotent by design (UPDATE is safe to run multiple times)

### Gap identified: no `webhook_events` logging
The `webhook_events` table exists but `stripe-webhook` does not insert into it. Every event received should be logged for audit. **Fix below.**

### What to do
Add one line to `stripe-webhook` before processing — insert to `webhook_events ON CONFLICT DO NOTHING`. Low priority but good hygiene.

---

## 3. CANCELLATION / MINIMUM TERM ENFORCEABILITY

### What's in place
- Stripe `cancel_at` set to 180 days (6 months) from signup on every subscription
- MSA at `/msa.html` includes Minimum Term language
- Packages page states "6-month minimum term"
- Intake success screen shows next billing date

### What's missing / gaps
- **Client never signs the MSA** — it's a public page, not a clickwrap. No signature, no acceptance record.
- **No IP/timestamp logged** when client completes intake (could defend as implied acceptance but weak)
- **Stripe cancel_at is not truly enforceable** — Stripe will cancel at that date automatically but if a client disputes a charge you have no signed document

### How to make it enforceable (in order of priority)
1. **Add MSA checkbox to intake form** — "I agree to the [Master Service Agreement] and 6-month minimum term" with link. Log `agreed_to_msa: true` + timestamp in `properties` table. This is clickwrap and legally defensible.
2. **Send MSA acceptance email** — after provisioning, Zapier sends client an email with the MSA terms they agreed to. Creates paper trail.
3. **Longer term:** DocuSign or HelloSign for clients above $1K/mo.

### For now
The 6-month `cancel_at` in Stripe means the subscription simply doesn't cancel early — you're not relying on the client to honor a contract, Stripe just doesn't let them cancel. That's your best protection at this stage.

---

## 4. CHARGE DISPUTE SOP (Standard Operating Procedure)

### If a client disputes a charge in Stripe:

**Step 1 — Respond within 7 days** (Stripe gives you that long before ruling for client)

**Step 2 — Gather evidence:**
- Screenshot of intake form completion with timestamp
- `properties` table entry showing `provisioned_at`, `contact_email`, `stripe_customer_id`
- Retell agent creation timestamp
- Zapier confirmation email sent to client
- Call logs showing agent was active and handled calls
- MSA link (until clickwrap is added, cite public MSA page + payment as implied acceptance)

**Step 3 — Submit to Stripe with:**
- Service description: "AI-powered overnight phone answering service for hotel/motel operations"
- Evidence the service was delivered (call logs, agent activity, emails sent)
- Reference to 6-month minimum term in MSA

**Step 4 — If dispute lost:**
- Stripe charges a $15 dispute fee win or lose
- Cancel the property in Retell immediately
- Disable the agent
- Update `properties.status = 'canceled'` and `is_active = false`

**Step 5 — Prevention:**
- Add MSA clickwrap to intake ASAP
- Send welcome email day 1 with service confirmation
- Log every call so you always have delivery evidence

---

## 5. CLIENT ONBOARDING PROCESS (Current SOP)

### End-to-end flow

```
Client visits nightshifthotels.com
       ↓
Fills intake form (8 steps)
       ↓
Pays setup + month 1 via Stripe
       ↓
provision-client runs:
  - Creates Retell LLM + Agent
  - Inserts property into Supabase
  - Creates hotel_users entry
  - Fires Zapier CRM webhook
       ↓
Zapier sends founder email with:
  - Full property details
  - Generated agent script
  - Activate button link
       ↓
Founder reviews script (target: within 4 hours)
       ↓
Founder clicks Activate → activate-client runs:
  - Sends magic link email to client
  - Updates agent name (removes "PENDING REVIEW")
       ↓
Client receives magic link → logs into dashboard
       ↓
Client sets up call forwarding on their existing number
       ↓
Agent goes live
```

### Target SLAs
- Script review + activation: **< 4 hours** (same business day)
- Client magic link: sent automatically on activation
- Call forwarding instructions: included in activation email (TODO — add to activate-client)

### What still needs automation
1. Call forwarding instructions not yet emailed to client on activation
2. Day 1 welcome email not automated (Zapier can do this)
3. Day 7 check-in email not automated

---

## 6. RETELL AGENT TESTING — REQUIRED BEFORE EACH NEW CLIENT GOES LIVE

### Test checklist per agent (run after provision, before activation)

**Minimum info test (worst case intake):**
Call the agent and test:
- [ ] Greeting fires correctly with property name
- [ ] Rate quoted correctly when asked
- [ ] Check-in/check-out times answered
- [ ] Pet policy answered
- [ ] Room type offered
- [ ] Reservation flow completes (ask for name, dates, guests → confirmation)
- [ ] Transfer works — say "I need to speak to someone" → should transfer to emergency_phone
- [ ] Emergency test — say "there's a fire" → should say "call 911 immediately" first
- [ ] Spanish test — respond in Spanish → agent should switch

**Edge cases to test:**
- [ ] Caller gives partial date ("next Friday") → agent should confirm with full year
- [ ] Caller asks for rate that isn't configured → agent should give range or escalate
- [ ] Caller is aggressive/rude → agent should stay calm and offer transfer
- [ ] Long silence → agent should prompt after 30 seconds

### How to test without a Twilio number
Use Retell dashboard → select agent → "Test in browser" → voice conversation directly.

### Known script issues with minimal intake
- If `rate_from` is empty → agent says "TBD" — acceptable
- If no rooms configured → agent says "TBD" — acceptable but should escalate instead
- If `emergency_phone` missing → provision-client now rejects (v24+) — handled
- If `agent_greeting` empty → falls back to default greeting — acceptable

---

## 7. ZAPIER CLIENT NOTIFICATION — CURRENT GAP + FIX

### Current problem
Every new client needs a **separate notification Zap** — currently you manually duplicate and edit via Copilot prompt. This doesn't scale.

### Fix: Dynamic client notification via existing Zap
Instead of per-client Zaps, use one Zap that dynamically sends to `{{contact_email}}` from the payload.

**Steps:**
1. Go to zapier.com → your CRM new client Zap (`hooks.zapier.com/hooks/catch/25632035/4y0ohth/`)
2. Add a second action after the founder email: **Email by Zapier** (or Gmail)
3. Set **To** = `{{contact_email}}` (dynamic from payload)
4. Set **Subject** = `Your NightShift AI agent is being configured — {{property_name}}`
5. Set **Body** = (see template below)
6. This fires automatically for every new client — no manual work

**Client welcome email template for Zapier:**
```
Hi {{contact_name}},

Thanks for signing up for NightShift AI.

Your AI agent is being configured for {{property_name}} and will be ready within 4 hours.

Here's what happens next:
1. We'll review your agent script and activate it
2. You'll receive a separate email with your dashboard login link
3. Once logged in, set up call forwarding on your existing number

Your plan: {{tier}} — ${{monthly_fee_display}}/month
Next charge: 30 days from today

Questions? Reply to this email or contact founder@nightshifthotels.com

— NightShift AI
```

**This replaces the manual duplicate-and-edit workflow entirely.**

---

## 8. BUSINESS INSURANCE — WHAT YOU NEED NOW

### Current exposure
- **E&O (Errors & Omissions):** If your agent gives wrong info (wrong rate, misroutes emergency) and client loses revenue or faces liability → you need E&O
- **General Liability:** Standard for any business
- **Cyber Liability:** You store call recordings, guest names, reservation data

### What to get (in order)
1. **E&O / Tech E&O** — most important. Typical cost $500–$1,500/yr for early SaaS. Start with Hiscox or Next Insurance online.
2. **General Liability** — required if you ever sign a client contract that asks for it. Same providers, bundled with E&O.
3. **Cyber Liability** — wait until $5K MRR. Not urgent at 1 client.

### What changes at key milestones
- **First signed contract (enterprise/franchise):** They'll require proof of E&O before signing
- **$5K MRR:** Get cyber liability, review T&Cs
- **$25K MRR:** Formal legal review of MSA, proper entity structure review, possibly LLC → S-Corp election

---

## 9. ACQUISITION + RETENTION MACHINE

### Current state
- 1 paying client ($699/mo)
- 0 automated acquisition channels
- 0 systematic retention touchpoints
- 0 referral mechanism

### What to build (in order of ROI)

**Acquisition (distribution first):**
1. Direct outbound to your 40-target B2B database — personalized 3-line email, link to calculator
2. Google Business Profile (done ✅) — operators search locally
3. One LinkedIn post per week showing call log / dashboard screenshot / operational data
4. Facebook Groups — "Independent Motel Owners," "Hotel Management Network" — post case study
5. Referral program: $200 credit per referred client who pays month 2

**Retention (keep who you have):**
1. Day 1: Welcome email with dashboard link + call forwarding instructions (automate in Zapier)
2. Day 7: Check-in email — "How's the first week going?" — manual for now
3. Monthly: Automated call summary email (calls handled, reservations captured, escalations)
4. Day 150 (before 6-month term ends): Renewal email with usage stats and what they'd lose

**Referrals:**
- Build into the client dashboard: "Refer a property, get $200 off your next month"
- Currently zero friction to refer — they just email you

### Biggest threats (in order)
1. **Poor onboarding** — client can't figure out call forwarding, agent goes unused, churns
2. **AI edge case failures** — agent says something wrong, client gets a complaint, blames NightShift
3. **Call routing failures** — Twilio/Retell outage, client gets complaints, blames NightShift
4. **Owner distrust** — "is this really AI or just voicemail" — solve with call logs visible in dashboard
5. **Inconsistent follow-up** — client pays, hears nothing for 4 hours, sends angry email
6. **Overbuilding** — adding features nobody asked for instead of getting clients 2-5

### What not to build yet
- Mobile app
- PMS integrations
- Multi-language dashboard UI
- White-label / reseller portal
- Advanced analytics

Build these only after client 10.

---

## 10. TECHNICAL RELIABILITY CHECKLIST

### Current monitoring gaps
- No uptime monitoring on nightshifthotels.com (add UptimeRobot — free)
- No alerting if Retell agent fails mid-call
- No alerting if provision-client returns 500
- reconcile-subscriptions cron runs silently — no alert if it errors

### Quick fixes (30 min total)
1. **UptimeRobot** — uptimerobot.com, free, monitors nightshifthotels.com every 5 min, emails you on downtime
2. **Supabase email on edge function error** — set up a Zapier webhook that fires when provision-client returns `ok: false` (check Supabase logs via cron or webhook)
3. **Retell webhook** — already deployed, logs call outcomes to `call_logs` — verify it's firing

### Known reliability risks
- Retell API outage → agents stop answering → clients get dead air
- ElevenLabs voice outage → Retell falls back to default voice (acceptable)
- Supabase edge function cold start → 1-2 second delay on first provision → not guest-facing so OK
- Stripe webhook replay → handled by idempotency on `provisioning_jobs`

---

## Key IDs Reference

| Resource | ID |
|---|---|
| Supabase project | sbzdnzouoyxmawuhdvdi |
| Founder UUID | 65b99794-2174-4e70-aab5-04a884a5992d |
| Stripe account | acct_1TWiNfKNNp3HQbJE |
| Core price ID | price_1TWtwyKNNp3HQbJEeJ9nH9fZ |
| Pro price ID | price_1TWtwwKNNp3HQbJEtMFa9dcQ |
| Lang add-on | price_1TWtwpKNNp3HQbJEbIeLgdRh |
| Minute add-on 500 | price_1TXBHpKNNp3HQbJErH33bN4T |
| Minute add-on 1000 | price_1TXBHzKNNp3HQbJEHF7mWhDv |
| Mountain Inn property | fbed1d94-66e8-4d3a-872a-be290e931223 |
| Riverside Inn property | 83497273-fc99-41fc-ab8b-a32474a952e9 |
| Zapier CRM webhook | https://hooks.zapier.com/hooks/catch/25632035/4y0ohth/ |
| Zapier reservation webhook | https://hooks.zapier.com/hooks/catch/25632035/uwjgi3k/ |
