// Netlify Function: creates a Stripe Checkout Session for the cart
// and returns its URL so the front-end can redirect the customer to it.
//
// SECURITY NOTE: the unit price (39,00 €) is fixed here, server-side.
// The front-end only ever sends product name / size / quantity — never
// a price — so nobody can tamper with the amount from the browser.
//
// Requires the STRIPE_SECRET_KEY environment variable to be set in
// Netlify (Site configuration -> Environment variables). Never put the
// secret key in the code or commit it to GitHub.

const Stripe = require('stripe');

const UNIT_PRICE_CENTS = 3900; // 39,00 €
const ALLOWED_COUNTRIES = ['FR', 'BE', 'CH', 'LU', 'DE', 'ES', 'IT', 'NL', 'GB', 'PT', 'IE', 'AT'];

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'STRIPE_SECRET_KEY manquante côté serveur.' }),
    };
  }

  const stripe = Stripe(secretKey);

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (err) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Requête invalide.' }) };
  }

  const items = Array.isArray(payload.items) ? payload.items : [];
  if (items.length === 0) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Panier vide.' }) };
  }

  const line_items = items.map(function (item) {
    const name = String(item.name || 'Sailor Tales').slice(0, 120);
    const size = String(item.size || '').slice(0, 10);
    const qty = Math.min(20, Math.max(1, parseInt(item.qty, 10) || 1));
    return {
      price_data: {
        currency: 'eur',
        product_data: {
          name: size ? name + ' — Taille ' + size : name,
        },
        unit_amount: UNIT_PRICE_CENTS,
      },
      quantity: qty,
    };
  });

  const origin =
    event.headers.origin ||
    (event.headers.referer ? event.headers.referer.replace(/\/$/, '') : null) ||
    process.env.SITE_URL ||
    'https://sailortales.netlify.app';

  // If the customer already entered a valid promo code on the site,
  // look up its Stripe Promotion Code ID so the discount carries over
  // automatically — they shouldn't have to type it a second time.
  // "discounts" and "allow_promotion_codes" are mutually exclusive on a
  // Checkout Session, so we only fall back to the manual entry field
  // when no code (or an invalid one) was passed in.
  let discounts;
  let allow_promotion_codes;
  const requestedCode = typeof payload.promoCode === 'string' ? payload.promoCode.trim() : '';

  if (requestedCode) {
    try {
      const found = await stripe.promotionCodes.list({
        code: requestedCode,
        active: true,
        limit: 1,
      });
      if (found.data.length > 0) {
        discounts = [{ promotion_code: found.data[0].id }];
      } else {
        allow_promotion_codes = true;
      }
    } catch (err) {
      allow_promotion_codes = true;
    }
  } else {
    allow_promotion_codes = true;
  }

  try {
    const session = await stripe.checkout.sessions.create(Object.assign(
      {
        mode: 'payment',
        line_items: line_items,
        phone_number_collection: { enabled: true },
        shipping_address_collection: { allowed_countries: ALLOWED_COUNTRIES },
        success_url: origin + '/?checkout=success',
        cancel_url: origin + '/?checkout=cancel',
      },
      discounts ? { discounts: discounts } : { allow_promotion_codes: allow_promotion_codes }
    ));

    return {
      statusCode: 200,
      body: JSON.stringify({ url: session.url }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message || 'Erreur Stripe.' }),
    };
  }
};
