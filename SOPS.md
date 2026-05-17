# NightShift AI — Operations SOPs & Sales Assets
**Version 1.0 | May 2026**

---

# SOP 1: CLIENT ONBOARDING

## Overview
From payment to first live call. Target: < 4 hours same business day.

## Step-by-Step

### Step 1 — Payment received (automated)
Trigger: Client completes intake and pays at nightshifthotels.com/intake

System automatically:
- Charges setup fee + month 1 via Stripe
- Creates Retell LLM + agent (PENDING REVIEW status)
- Inserts property into Supabase
- Logs MSA acceptance (IP, timestamp, user agent) to `legal_acceptances` table
- Fires Zapier CRM webhook → you receive founder email with full script

**Your action:** None yet. Wait for founder email.

---

### Step 2 — Review founder email (your action, < 4 hours)
You receive an email at founder@nightshifthotels.com with:
- Full property details
- Generated agent script (review this)
- Activate button link

**Check the script for:**
- [ ] Property name is correct
- [ ] Phone number looks like a real US number in E.164 format
- [ ] Room types and rates are present
- [ ] Check-in/check-out times set
- [ ] Escalation number is the client's actual cell/front desk
- [ ] Greeting sounds natural for the property
- [ ] No obvious errors or blank fields

**If script looks wrong:** Email client at their contact_email, ask them to clarify, do NOT activate yet.

**If script looks good:** Click the Activate button.

---

### Step 3 — Activation (automated after you click)
System automatically:
- Sets `is_active = true`, `status = active` in Supabase
- Removes `(PENDING REVIEW)` from Retell agent name
- Generates magic link for client dashboard
- Fires Zapier → sends client their dashboard access email
- You see success screen

---

### Step 4 — Client setup (client action)
Client receives:
- Dashboard magic link email
- Call forwarding instructions (via Zapier email)

Client needs to:
1. Click magic link → log into their dashboard
2. Set up call forwarding on their existing phone line

**Call forwarding by carrier:**
- **iPhone:** Settings → Phone → Call Forwarding → ON → enter NightShift number
- **Android:** Phone app → Settings → Supplementary Services → Call Forwarding
- **AT&T:** Dial `*72` + NightShift number → press Call
- **Verizon:** Dial `*72` + NightShift number → press Send
- **T-Mobile:** Dial `**21*` + NightShift number + `#`
- **Landline POTS:** Dial `*72` + NightShift number (standard conditional forwarding)

**Note:** For after-hours only forwarding, use conditional forwarding (when busy/no answer) not unconditional forwarding.

---

### Step 5 — Verify agent is live (your action, optional)
Test call the agent using Retell dashboard → Test in browser. Run through:
1. Greeting fires
2. Ask for room rate
3. Ask about pets
4. Say "I want to make a reservation" and go through the flow
5. Say "I need to speak to someone" → should transfer

---

### Escalation if anything fails
| Problem | Action |
|---|---|
| provision-client 500 | Check founder dashboard → Failed Provisioning → Retry |
| Stripe payment taken but agent not created | Same as above |
| Client can't log in | Run manual-activate console fetch, resend magic link |
| Agent gives wrong info | Edit LLM prompt in Retell dashboard, or reprovision |

---

# SOP 2: SUPPORT

## Tier 1 — Self-service (before contacting you)
Direct client to:
- Dashboard FAQ
- faq.html on marketing site
- Call forwarding instructions in activation email

## Tier 2 — Common issues

### "My agent isn't answering calls"
1. Ask: Did you set up call forwarding?
2. Check Retell dashboard → is agent active?
3. Check `properties.is_active` in Supabase
4. Verify transfer number is in E.164 format in `properties.transfer_phone`

### "The agent said the wrong rate"
1. Check Retell LLM prompt — open agent → LLM → general_prompt
2. Find the rates section
3. Edit directly in Retell if minor typo
4. For major changes, update intake data and redeploy agent

### "The agent transferred instead of taking a reservation"
1. Check if call happened during operating hours (night_hours_start / night_hours_end)
2. Check Retell call transcript for what happened
3. If outside hours, that's correct behavior
4. If inside hours and wrong, check the script HOURS section

### "I can't log into the dashboard"
1. Go to nightshifthotels.com/dashboard
2. Click "Sign in with email"
3. Enter the email they used during intake
4. They'll get a magic link

### "I want to update my room rates"
Currently: Edit the LLM prompt in Retell dashboard manually.
Long-term: Build a self-serve prompt editor (post client 10).

## Response time targets
- Urgent (agent down): < 2 hours
- Non-urgent (wrong info): < 24 hours
- Feature requests: log and review monthly

---

# SOP 3: DISPUTE RESPONSE

## If a client files a Stripe chargeback

### Timeline
Stripe gives you 7 days to respond. Act within 24 hours.

### Evidence to gather immediately
Run this SQL:
```sql
SELECT 
  p.id, p.name, p.contact_email, p.provisioned_at, p.activated_at,
  p.stripe_customer_id, p.stripe_payment_intent_id,
  la.agreed_to_msa, la.accepted_at as msa_accepted_at, la.ip_address, la.user_agent,
  (SELECT COUNT(*) FROM call_logs cl WHERE cl.property_id = p.id) as total_calls
FROM properties p
LEFT JOIN legal_acceptances la ON la.property_id = p.id
WHERE p.stripe_customer_id = 'cus_XXXX';
```

### What to submit to Stripe
1. **Service description:** "AI-powered overnight phone answering service. Virtual front desk configured specifically for [Property Name], answering guest calls between [hours] nightly."

2. **Service delivery evidence:**
   - `provisioned_at` timestamp — agent was created
   - `activated_at` timestamp — service went live
   - Call log count and date range — service was used
   - Screenshot of Retell agent dashboard showing call history

3. **MSA acceptance record:**
   - `la.accepted_at` — exact timestamp
   - `la.ip_address` — IP address of submission
   - `la.user_agent` — browser/device used
   - "Client checked MSA agreement box including 6-month minimum term at [timestamp] from IP [ip]"

4. **Minimum term clause:**
   - Reference MSA section on minimum term
   - "Client agreed to 6-month minimum commitment at time of purchase"

5. **No-refund clause:**
   - "Setup fee is non-refundable per MSA once agent is configured"
   - Agent was configured within [X] hours

### After dispute is resolved
Win: Continue service normally.
Loss: Immediately cancel in Retell, set `is_active = false`, `status = 'canceled'`.

---

# SOP 4: AUTOMATED CLIENT COMMUNICATIONS (Zapier)

## Events fired from provision-client + activate-client

### Event: `new_client_provisioned` → Founder email
Trigger: Client pays and agent is created
Send to: founder@nightshifthotels.com
Content: Full property details, generated script, activate button

### Event: `client_welcome_email` → Client email
Trigger: Same as above, fires simultaneously
Send to: {{contact_email}}
Content:
```
Subject: We received your intake — NightShift AI is being configured for {{property_name}}

Hi {{contact_name}},

Thanks for signing up. Your AI agent is being configured for {{property_name}} and will be ready within 4 hours.

Plan: NightShift AI {{tier}} — ${{monthly_fee_display}}/month
Next charge: 30 days from today

What happens next:
1. We review your agent script (usually under 4 hours)
2. You'll receive your dashboard login link by email
3. Set up call forwarding and your agent goes live

Questions? Reply to this email.

— NightShift AI
```

### Event: `client_activated` → Client activation email
Trigger: You click activate
Send to: {{contact_email}}
Content:
```
Subject: Your NightShift AI agent is live — {{property_name}}

Hi {{contact_name}},

Your AI agent is now live for {{property_name}}.

ACCESS YOUR DASHBOARD:
{{dashboard_link}}

(This link expires in 24 hours. After that, go to nightshifthotels.com/dashboard and sign in with your email.)

SET UP CALL FORWARDING:
Forward calls to your NightShift AI number during your overnight hours ({{hours_start}} – {{hours_end}}).

iPhone: Settings → Phone → Call Forwarding → ON
Android: Phone app → Settings → Call Forwarding
AT&T: Dial *72 + your NightShift number
Verizon: Dial *72 + your NightShift number
T-Mobile: **21* + your NightShift number + #

Need your NightShift number? It's in your dashboard under Settings.

WHAT YOUR AGENT HANDLES:
- Reservation inquiries (captures and emails you a summary)
- Guest FAQs (rates, policies, directions, amenities)
- Escalations to you when needed
- Emergencies → instructs guests to call 911 first

Questions or issues? Email {{support_email}}

— NightShift AI
```

## Day 7 / Day 150 / Monthly (set up as Zapier scheduled Zaps)
These require Zapier to query Supabase directly via webhook + filter.
**Setup:** Create a Zap with a Schedule trigger → POST to health-check endpoint → filter by property → send email.
For now, do manually by checking dashboard weekly.

---

# SALES ASSET 1: ONE-PAGE SALES SHEET

## NightShift AI — Overnight Coverage for Independent Motels

**The problem every independent operator knows:**
Guests call after 10pm. Your phone rings. Nobody answers. They book somewhere else.

---

### What NightShift AI does
Answers every overnight guest call — automatically. Trained on your property, your rates, your policies. Sounds like your front desk. Works while you sleep.

**Not a call center. Not voicemail. Your property, automated.**

---

### What it handles
| Situation | What happens |
|---|---|
| Reservation inquiry | Takes the booking, emails you a summary |
| Rate question | Quotes your exact current rates |
| Pet policy, directions, amenities | Answers from your configuration |
| Maintenance issue | Routes to your on-call contact |
| Guest asks to speak to someone | Transfers immediately, no argument |
| Emergency | "Please call 911 immediately." — always first |

---

### How it works
1. You complete a short setup form (20 minutes)
2. We build and review your custom agent
3. You set up call forwarding on your existing number
4. Your agent goes live — usually within one business day

**No new phone number needed. No hardware. No PMS integration.**

---

### What it costs
| Plan | Coverage | Price |
|---|---|---|
| Core | 10pm–8am, 1,000 min/mo | $549/mo + $299 setup |
| Pro | 10pm–8am, 2,000 min/mo | $699/mo + $449 setup |

6-month minimum term. Setup fee non-refundable once agent is live.

---

### Why operators choose NightShift AI
- **Built by motel operators** — we run Mountain Inn in Dayton, TN. This is the product we needed.
- **Trained on your property** — not a generic script
- **Works with your existing number** — call forwarding, not a new line
- **Every call logged** — see exactly what was said, what was captured
- **Safe escalation** — your staff only gets called when it matters

---

### Book a demo
nightshifthotels.com/contact
founder@nightshifthotels.com

---

# SALES ASSET 2: 90-SECOND DEMO VIDEO SCRIPT

**[OPENING — 0:00–0:10]**
[Screen: dark motel lobby at night, phone ringing]
VO: "It's 2am. A guest calls about a reservation. Nobody picks up. That booking just went somewhere else."

**[PROBLEM — 0:10–0:25]**
[Screen: NightShift AI homepage]
VO: "NightShift AI is a virtual front desk trained on your property. It answers overnight calls automatically — reservations, FAQs, escalations — so you never miss a booking while you're asleep."

**[DEMO — 0:25–1:05]**
[Screen: real call recording or Retell test]
VO: "Here's a real call. A guest asks about a room for next Thursday."
[Call plays: agent answers, quotes rate, captures reservation, says "you're all set"]
VO: "That reservation just got emailed to the front desk. No staff. No missed call."

**[DASHBOARD — 1:05–1:20]**
[Screen: client dashboard screenshot]
VO: "Every call is logged. You see the outcome, the summary, what was said. The agent only escalates when a human is actually needed."

**[CLOSE — 1:20–1:30]**
[Screen: contact page]
VO: "NightShift AI. Setup in under one business day. No hardware. No new phone number. Starting at $549 a month."
[URL on screen: nightshifthotels.com]

---

# SALES ASSET 3: ROI TALKING POINTS FOR MOTEL OWNERS

## The staffing cost comparison

**Overnight staff (realistic total cost):**
- Hourly wage: $14–$18/hr
- Hours: 10pm–8am = 10 hours/night
- 7 nights/week = 70 hours/week
- Monthly wages: ~$4,480 at $16/hr average
- Payroll tax + overhead (22%): +$986
- Turnover cost (1.5x/yr at $1,500/replacement): +$188/mo
- **Total: ~$5,654/month**

**NightShift AI Core:**
- Monthly subscription: $549
- Payroll overhead: $0
- Turnover: $0
- **Total: $549/month**

**Potential monthly savings: ~$5,100**
**Potential annual savings: ~$61,200**

---

## The missed booking argument

Average motel rate: $89–$129/night
Average booking: 1.5 nights
Average overnight call volume: 1–3 calls/night (30–90 calls/month)
Conversion rate when answered vs voicemail: roughly 60% vs 5%

**At 30 calls/month, $109 avg rate, 1.5 nights:**
- Currently answered: 0 calls (nobody overnight)
- With NightShift: 18 reservations × $163 avg = **$2,934 revenue/month**
- NightShift cost: $549
- **Net new revenue: $2,385/month**

---

## The risk argument (for skeptical operators)

"What if the AI says something wrong?"
- Every call is logged — you see exactly what was said
- The agent only quotes rates and policies you configured
- Escalates immediately if it can't answer
- Emergency calls: 911 first, always

"What if it breaks?"
- reconcile-subscriptions runs nightly to catch any issues
- You get emailed call summaries
- health-check endpoint monitors system status
- Retell SLA: 99.9% uptime

"What if guests don't like talking to AI?"
- Most guests don't know it's AI — they think it's your front desk
- If they ask, the agent doesn't confirm or deny
- If they demand a human, it transfers immediately

---

## One-liner pitch options (for outreach)

1. "Stop losing overnight bookings to voicemail. NightShift AI answers every call, trained on your property. $549/month."

2. "What if your front desk answered every 2am call automatically? That's NightShift AI."

3. "We built an AI overnight front desk for our own motel. It works. Now it's available for yours."

4. "Independent motel owners: your competitors are already using AI for overnight calls. Here's the affordable version."
