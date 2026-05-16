// NightShift AI — create-add-property-checkout v2
// Creates a Stripe Checkout Session for an existing client adding a second+ property.
// No setup fee — additional properties waive the $299/$449 setup fee.
// Reuses existing Core/Pro monthly price IDs from the main intake flow.
//
// The original intake.html → create-payment-intent → create-subscription → provision-client
// flow is completely separate and untouched by this function.
//
// Required env vars (Supabase → Edge Functions → Secrets):
//   STRIPE_SECRET_KEY   — sk_live_... (your live key, same one used by other functions)
//   PROJECT_URL         — https://sbzdnzouoyxmawuhdvdi.supabase.co
//   SERVICE_ROLE_KEY    — Supabase service role key
//   APP_URL             — https://nightshifthotels.com  (optional, has default)

import { createClient } from 'jsr:@supabase/supabase-js@2';

// Reuse existing live monthly price IDs — no new products needed
// Core $549/mo: price_1TWtwyKNNp3HQbJEeJ9nH9fZ
// Pro  $699/mo: price_1TWtwwKNNp3HQbJEtMFa9dcQ
const PRICE_CORE = Deno.env.get('STRIPE_PRICE_CORE_ADDL') ?? 'price_1TWtwyKNNp3HQbJEeJ9nH9fZ';
const PRICE_PRO  = Deno.env.get('STRIPE_PRICE_PRO_ADDL')  ?? 'price_1TWtwwKNNp3HQbJEtMFa9dcQ';

const SUPABASE_URL     = Deno.env.get('PROJECT_URL')      ?? 'https://sbzdnzouoyxmawuhdvdi.supabase.co';
const SERVICE_ROLE_KEY = Deno.env.get('SERVICE_ROLE_KEY') ?? '';
const STRIPE_KEY       = Deno.env.get('STRIPE_SECRET_KEY') ?? '';
const APP_URL          = Deno.env.get('APP_URL')           ?? 'https://nightshifthotels.com';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey, x-client-info',
};

async function stripePost(path: string, params: Record<string, string>) {
  const body = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${STRIPE_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  return res.json();
}

async function stripeGet(path: string) {
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    headers: { 'Authorization': `Bearer ${STRIPE_KEY}` },
  });
  return res.json();
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: CORS });

  if (!STRIPE_KEY) {
    return new Response(JSON.stringify({ error: 'STRIPE_SECRET_KEY not configured in Supabase secrets' }), { status: 500, headers: CORS });
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch {
    return new Response('Bad JSON', { status: 400, headers: CORS });
  }

  const { user_id, property_draft, plan, addons } = body as {
    user_id: string;
    property_draft: { name: string; addr: string; city: string; state: string; rooms: string; type: string };
    plan: 'core' | 'pro';
    addons: string[];
  };

  if (!user_id || !property_draft?.name || !plan) {
    return new Response(JSON.stringify({ error: 'Missing required: user_id, property_draft.name, plan' }), { status: 400, headers: CORS });
  }

  const priceId = plan === 'pro' ? PRICE_PRO : PRICE_CORE;

  try {
    const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Get user email
    const { data: authUser } = await sb.auth.admin.getUserById(user_id);
    const email = authUser?.user?.email ?? '';

    // Find or create Stripe customer by email
    const custSearch = await stripeGet(`/customers?email=${encodeURIComponent(email)}&limit=1`);
    let customerId: string;
    if (custSearch.data?.length > 0) {
      customerId = custSearch.data[0].id;
    } else {
      const newCust = await stripePost('/customers', {
        email,
        'metadata[user_id]': user_id,
        'metadata[source]': 'nightshift_add_property',
      });
      if (!newCust.id) throw new Error(`Failed to create Stripe customer: ${JSON.stringify(newCust)}`);
      customerId = newCust.id;
    }

    // Encode property draft (Stripe metadata: 500 char limit per value)
    const draftJson = JSON.stringify(property_draft);
    if (draftJson.length > 490) throw new Error('Property name/address too long for checkout metadata');

    // Create Checkout Session
    const session = await stripePost('/checkout/sessions', {
      mode: 'subscription',
      customer: customerId,
      'line_items[0][price]': priceId,
      'line_items[0][quantity]': '1',
      success_url: `${APP_URL}/dashboard/client.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${APP_URL}/dashboard/client.html?cancelled=1`,
      // Session metadata — read by webhook to provision
      'metadata[user_id]':        user_id,
      'metadata[kind]':           'add_property',
      'metadata[plan]':           plan,
      'metadata[addons]':         JSON.stringify(addons ?? []),
      'metadata[property_draft]': draftJson,
      // Also on subscription so invoice events carry it
      'subscription_data[metadata][user_id]':        user_id,
      'subscription_data[metadata][kind]':           'add_property',
      'subscription_data[metadata][plan]':           plan,
      'subscription_data[metadata][property_draft]': draftJson,
    });

    if (!session.url) throw new Error(`Checkout session failed: ${JSON.stringify(session)}`);

    console.log(`Checkout created: ${session.id} | user: ${user_id} | plan: ${plan} | property: ${property_draft.name}`);

    return new Response(JSON.stringify({ url: session.url, session_id: session.id }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('create-add-property-checkout error:', String(err));
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: CORS });
  }
});
