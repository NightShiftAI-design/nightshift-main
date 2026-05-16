// NightShift AI — create-add-property-checkout
// Creates a Stripe Checkout Session for an existing client adding a second+ property.
// ALWAYS uses test mode price IDs — live keys are NEVER used here.
// The existing intake.html → create-payment-intent → create-subscription flow is
// completely separate and untouched by this function.
//
// Flow:
//   client.html (Add Property modal)
//     → POST /create-add-property-checkout  (this function)
//     → returns { url }  (Stripe-hosted checkout)
//     → user pays on Stripe
//     → Stripe fires checkout.session.completed to your webhook
//     → webhook calls provision-client internally
//     → client.html polls properties table for new row
//
// Required env vars (set in Supabase dashboard → Edge Functions → Secrets):
//   STRIPE_SECRET_KEY_TEST   — sk_test_...  (never sk_live_)
//   PROJECT_URL              — https://sbzdnzouoyxmawuhdvdi.supabase.co
//   APP_URL                  — https://nightshifthotels.com

import { createClient } from 'jsr:@supabase/supabase-js@2';

// ── Stripe TEST mode price IDs ────────────────────────────────────────────────
// These are test prices — create them in your Stripe test dashboard if they
// don't exist yet. Instructions below each constant.
//
// To create in Stripe (test mode):
//   dashboard.stripe.com → Products → + Add product
//   Name: "NightShift AI Core — Additional Property"
//   Pricing: $549/mo recurring, no trial, no setup fee
//   Copy the price ID (price_test_xxx) into PRICE_TEST_CORE_ADDL
//
const PRICE_TEST_CORE_ADDL = Deno.env.get('STRIPE_PRICE_TEST_CORE_ADDL') ?? '';
const PRICE_TEST_PRO_ADDL  = Deno.env.get('STRIPE_PRICE_TEST_PRO_ADDL')  ?? '';

// Existing language add-on price IDs (already live — reused in test mode via metadata)
// These come from intake.html: addon_500 and addon_1000
// For the add-property flow, language add-ons are provisioned via provision-client
// based on metadata — no separate Stripe line item needed for MVP.

const SUPABASE_URL      = Deno.env.get('PROJECT_URL') ?? 'https://sbzdnzouoyxmawuhdvdi.supabase.co';
const SERVICE_ROLE_KEY  = Deno.env.get('SERVICE_ROLE_KEY') ?? '';
const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY_TEST') ?? '';
const APP_URL           = Deno.env.get('APP_URL') ?? 'https://nightshifthotels.com';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey, x-client-info',
};

// ── Stripe helpers (no SDK — raw API calls to keep bundle small) ──────────────
async function stripePost(path: string, body: Record<string, string>) {
  const encoded = Object.entries(body)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: encoded,
  });
  return res.json();
}

async function stripeGet(path: string) {
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    headers: { 'Authorization': `Bearer ${STRIPE_SECRET_KEY}` },
  });
  return res.json();
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: CORS });

  // ── Validate auth ──────────────────────────────────────────────────────────
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: CORS });
  }

  if (!STRIPE_SECRET_KEY) {
    return new Response(JSON.stringify({ error: 'STRIPE_SECRET_KEY_TEST not configured. Add it in Supabase → Edge Functions → Secrets.' }), { status: 500, headers: CORS });
  }

  // Verify it's a test key — hard block on live keys
  if (!STRIPE_SECRET_KEY.startsWith('sk_test_')) {
    return new Response(JSON.stringify({ error: 'Only test mode Stripe keys are permitted in this function. Use sk_test_...' }), { status: 400, headers: CORS });
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return new Response('Bad JSON', { status: 400, headers: CORS }); }

  const { user_id, property_draft, plan, addons } = body as {
    user_id: string;
    property_draft: { name: string; addr: string; city: string; state: string; rooms: string; type: string };
    plan: 'core' | 'pro';
    addons: string[];
  };

  if (!user_id || !property_draft?.name || !plan) {
    return new Response(JSON.stringify({ error: 'Missing required fields: user_id, property_draft.name, plan' }), { status: 400, headers: CORS });
  }

  // ── Validate plan has a price ID configured ────────────────────────────────
  const priceId = plan === 'pro' ? PRICE_TEST_PRO_ADDL : PRICE_TEST_CORE_ADDL;
  if (!priceId) {
    // Price IDs not configured yet — return a clear setup instruction
    return new Response(JSON.stringify({
      error: `STRIPE_PRICE_TEST_${plan.toUpperCase()}_ADDL not set. Create the product in Stripe test dashboard and add the price ID to Supabase Edge Function secrets.`,
      setup_required: true,
      instructions: {
        step1: 'Go to dashboard.stripe.com (make sure you are in TEST mode — toggle top left)',
        step2: `Create product: "NightShift AI ${plan === 'pro' ? 'Pro' : 'Core'} — Additional Property"`,
        step3: `Set price: $${plan === 'pro' ? 699 : 549}/month recurring`,
        step4: 'Copy the price ID (starts with price_)',
        step5: `In Supabase → Edge Functions → Secrets → add STRIPE_PRICE_TEST_${plan.toUpperCase()}_ADDL = <price_id>`,
      }
    }), { status: 400, headers: CORS });
  }

  try {
    const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // ── Get or create Stripe test customer for this user ───────────────────
    const { data: authUser } = await sb.auth.admin.getUserById(user_id);
    const email = authUser?.user?.email ?? '';

    // Check if user already has a Stripe test customer ID stored
    // We use hotel_users metadata or a separate lookup
    // For simplicity: search Stripe for existing customer by email
    const custSearch = await stripeGet(`/customers?email=${encodeURIComponent(email)}&limit=1`);
    let customerId: string;

    if (custSearch.data && custSearch.data.length > 0) {
      customerId = custSearch.data[0].id;
    } else {
      const newCust = await stripePost('/customers', {
        email,
        'metadata[user_id]': user_id,
        'metadata[source]': 'nightshift_add_property',
      });
      customerId = newCust.id;
    }

    if (!customerId) throw new Error('Failed to get or create Stripe customer');

    // ── Encode property draft in metadata (Stripe limit: 500 chars per value) ─
    const draftJson = JSON.stringify(property_draft);
    if (draftJson.length > 490) throw new Error('Property draft too large for Stripe metadata');

    // ── Create Checkout Session ────────────────────────────────────────────
    const successUrl = `${APP_URL}/dashboard/client.html?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl  = `${APP_URL}/dashboard/client.html?cancelled=1`;

    // Build flat body for Stripe (no SDK)
    const checkoutBody: Record<string, string> = {
      mode: 'subscription',
      customer: customerId,
      'line_items[0][price]': priceId,
      'line_items[0][quantity]': '1',
      success_url: successUrl,
      cancel_url:  cancelUrl,
      'metadata[user_id]':        user_id,
      'metadata[kind]':           'add_property',
      'metadata[plan]':           plan,
      'metadata[addons]':         JSON.stringify(addons ?? []),
      'metadata[property_draft]': draftJson,
      // Subscription metadata for webhook
      'subscription_data[metadata][user_id]':        user_id,
      'subscription_data[metadata][kind]':           'add_property',
      'subscription_data[metadata][property_draft]': draftJson,
      'subscription_data[metadata][plan]':           plan,
    };

    const session = await stripePost('/checkout/sessions', checkoutBody);

    if (!session.url) {
      throw new Error(`Stripe session creation failed: ${JSON.stringify(session)}`);
    }

    console.log(`Checkout session created: ${session.id} for user ${user_id}, plan ${plan}, property: ${property_draft.name}`);

    return new Response(JSON.stringify({
      url: session.url,
      session_id: session.id,
    }), { headers: { ...CORS, 'Content-Type': 'application/json' } });

  } catch (err) {
    console.error('create-add-property-checkout error:', String(err));
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: CORS });
  }
});
