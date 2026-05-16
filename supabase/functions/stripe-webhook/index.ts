// NightShift AI — stripe-webhook
// Handles Stripe events for the ADD-PROPERTY flow ONLY.
// The original intake flow uses create-payment-intent + create-subscription directly
// and does NOT go through this webhook — that flow is completely unaffected.
//
// Events handled:
//   checkout.session.completed   → provisions new property (add-property kind only)
//   invoice.payment_failed       → marks property past_due
//   invoice.payment_succeeded    → clears past_due back to active
//
// Required env vars:
//   STRIPE_WEBHOOK_SECRET   — whsec_... from Stripe test webhook endpoint
//   STRIPE_SECRET_KEY       — sk_test_...
//   PROJECT_URL                  — https://sbzdnzouoyxmawuhdvdi.supabase.co
//   SERVICE_ROLE_KEY             — your Supabase service role key
//   RETELL_API_KEY               — for provision-client passthrough

import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL      = Deno.env.get('PROJECT_URL') ?? 'https://sbzdnzouoyxmawuhdvdi.supabase.co';
const SERVICE_ROLE_KEY  = Deno.env.get('SERVICE_ROLE_KEY') ?? '';
const WEBHOOK_SECRET    = Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? '';
const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY') ?? '';
const PROVISION_URL     = `${SUPABASE_URL}/functions/v1/provision-client`;

const CORS = { 'Access-Control-Allow-Origin': '*' };

// ── Stripe signature verification ─────────────────────────────────────────────
async function verifyStripeSignature(payload: string, header: string, secret: string): Promise<boolean> {
  const parts = header.split(',').reduce((acc: Record<string, string>, part) => {
    const [k, v] = part.split('=');
    acc[k] = v;
    return acc;
  }, {});

  const timestamp = parts['t'];
  const sig = parts['v1'];
  if (!timestamp || !sig) return false;

  const signedPayload = `${timestamp}.${payload}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const computed = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedPayload));
  const computedHex = Array.from(new Uint8Array(computed)).map(b => b.toString(16).padStart(2, '0')).join('');
  return computedHex === sig;
}

Deno.serve(async (req) => {
  if (req.method === 'GET') return new Response('NightShift AI Stripe webhook active', { headers: CORS });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: CORS });

  const payload = await req.text();
  const sigHeader = req.headers.get('stripe-signature') ?? '';

  // Verify signature if secret is configured
  if (WEBHOOK_SECRET) {
    const valid = await verifyStripeSignature(payload, sigHeader, WEBHOOK_SECRET);
    if (!valid) {
      console.error('Invalid Stripe signature');
      return new Response('Invalid signature', { status: 400, headers: CORS });
    }
  } else {
    console.warn('STRIPE_WEBHOOK_SECRET not set — skipping signature verification');
  }

  let event: Record<string, unknown>;
  try { event = JSON.parse(payload); } catch {
    return new Response('Bad JSON', { status: 400, headers: CORS });
  }

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const eventType = event.type as string;
  const eventObj = event.data as { object: Record<string, unknown> };
  const obj = eventObj?.object ?? {};

  console.log(`Stripe webhook: ${eventType}`);

  try {
    // ── checkout.session.completed ─────────────────────────────────────────
    if (eventType === 'checkout.session.completed') {
      const metadata = (obj.metadata ?? {}) as Record<string, string>;

      // ONLY handle add_property kind — original intake flow is unaffected
      if (metadata.kind !== 'add_property') {
        console.log('Skipping non-add_property checkout session');
        return new Response('ok', { headers: CORS });
      }

      const sessionId = obj.id as string;
      const userId    = metadata.user_id;
      const plan      = metadata.plan ?? 'core';
      const addons    = JSON.parse(metadata.addons ?? '[]') as string[];
      const subscriptionId = obj.subscription as string;

      let propertyDraft: Record<string, string> = {};
      try { propertyDraft = JSON.parse(metadata.property_draft ?? '{}'); } catch (_) {}

      if (!userId || !propertyDraft.name) {
        console.error('Missing user_id or property_draft in metadata');
        return new Response('Missing metadata', { status: 400, headers: CORS });
      }

      // Idempotency — check if we already processed this session
      const { data: existing } = await sb
        .from('provisioning_jobs')
        .select('id, status')
        .eq('stripe_session_id', sessionId)
        .maybeSingle();

      if (existing) {
        console.log(`Session ${sessionId} already processed with status: ${existing.status}`);
        return new Response('already processed', { headers: CORS });
      }

      // Record the job
      const { data: job, error: jobErr } = await sb
        .from('provisioning_jobs')
        .insert({
          stripe_session_id: sessionId,
          user_id: userId,
          payload: { property_draft: propertyDraft, plan, addons, subscription_id: subscriptionId },
          status: 'pending',
        })
        .select()
        .single();

      if (jobErr || !job) {
        console.error('Failed to insert provisioning_job:', jobErr?.message);
        return new Response('DB error', { status: 500, headers: CORS });
      }

      // Get user email
      const { data: authUser } = await sb.auth.admin.getUserById(userId);
      const email = authUser?.user?.email ?? '';

      // Call provision-client with the property details
      const provisionPayload = {
        property_name:    propertyDraft.name,
        address:          propertyDraft.addr ?? '',
        city:             propertyDraft.city ?? '',
        state_zip:        propertyDraft.state ?? '',
        tier:             plan,
        extra_languages:  addons.join(','),
        contact_email:    email,
        contact_name:     email.split('@')[0],
        stripe_subscription_id: subscriptionId ?? '',
        // No setup fee for additional properties
        _source:          'add_property_webhook',
      };

      const provRes = await fetch(PROVISION_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(provisionPayload),
      });
      const provData = await provRes.json();

      if (provData.ok) {
        await sb.from('provisioning_jobs')
          .update({ status: 'succeeded', property_id: provData.property_id })
          .eq('id', job.id);
        console.log(`Property provisioned: ${provData.property_id} for session ${sessionId}`);
      } else {
        await sb.from('provisioning_jobs')
          .update({ status: 'failed', error: provData.error ?? 'Unknown error' })
          .eq('id', job.id);
        console.error(`Provisioning failed for session ${sessionId}:`, provData.error);
        // Return 200 so Stripe doesn't retry — the job is recorded and recoverable from founder dashboard
      }
    }

    // ── invoice.payment_failed ─────────────────────────────────────────────
    else if (eventType === 'invoice.payment_failed') {
      const subscriptionId = obj.subscription as string;
      if (subscriptionId) {
        const { error } = await sb
          .from('properties')
          .update({ status: 'past_due' })
          .eq('stripe_subscription_id', subscriptionId);
        if (error) console.error('Failed to update past_due:', error.message);
        else console.log(`Marked past_due: subscription ${subscriptionId}`);
      }
    }

    // ── invoice.payment_succeeded ──────────────────────────────────────────
    else if (eventType === 'invoice.payment_succeeded') {
      const subscriptionId = obj.subscription as string;
      if (subscriptionId) {
        // Only clear past_due — don't touch active/provisioning/other statuses
        const { error } = await sb
          .from('properties')
          .update({ status: 'active' })
          .eq('stripe_subscription_id', subscriptionId)
          .eq('status', 'past_due');
        if (error) console.error('Failed to clear past_due:', error.message);
        else console.log(`Cleared past_due: subscription ${subscriptionId}`);
      }
    }

    else {
      console.log(`Unhandled event type: ${eventType}`);
    }

  } catch (err) {
    console.error('Webhook handler error:', String(err));
    // Return 200 to prevent Stripe retries on unexpected errors
    return new Response(JSON.stringify({ error: String(err) }), { headers: CORS });
  }

  return new Response('ok', { headers: CORS });
});
