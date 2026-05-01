/**
 * Authoritative per-market catalog (pricing display + gateway hints). v1: static config in repo.
 * Replace placeholder stripePriceId / razorpayPlanId when billing is wired.
 * Two tiers only: Free trial + Pro (individual practice—no team/seat plan).
 */

export const MARKET_IDS = ['US', 'EU', 'IN', 'ROW'];

/** EU member states + UK + EEA (NO, IS, LI) + CH — typical “EU pricing” block (placeholder). */
export const EU_ISO_COUNTRIES = new Set([
  'AT',
  'BE',
  'BG',
  'HR',
  'CY',
  'CZ',
  'DK',
  'EE',
  'FI',
  'FR',
  'DE',
  'GR',
  'HU',
  'IE',
  'IT',
  'LV',
  'LT',
  'LU',
  'MT',
  'NL',
  'PL',
  'PT',
  'RO',
  'SK',
  'SI',
  'ES',
  'SE',
  'GB',
  'NO',
  'IS',
  'LI',
  'CH',
]);

const FREE_FEATURES = [
  'Up to 3 completed mock interviews during your trial',
  'Full AI interviewer experience (voice-first practice)',
  'Summary scores and essential feedback',
  'Everything above for the length of your trial',
];

const PRO_FEATURES = [
  'Unlimited mock interviews',
  'Full scored reports and detailed breakdowns',
  'Unlimited history and progress tracking',
  'Priority email support',
];

function tier(id, name, intervalLabel, amountDisplay, highlight, features, gatewayIds) {
  return {
    id,
    name,
    intervalLabel,
    amountDisplay,
    highlight: Boolean(highlight),
    features,
    stripePriceId: gatewayIds.stripePriceId ?? null,
    razorpayPlanId: gatewayIds.razorpayPlanId ?? null,
  };
}

const NEUTRAL_COPY = {
  pricingTitle: 'Start free, go Pro when you’re ready',
  pricingSubtitle:
    'Try mock interviews on us—upgrade when you want unlimited practice and full reports.',
};

export const MARKETS = {
  US: {
    currency: 'USD',
    currencySymbol: '$',
    paymentProvider: 'stripe',
    pricing: [
      tier(
        'free_trial',
        'Free trial',
        'for your trial',
        '$0',
        false,
        FREE_FEATURES,
        {}
      ),
      tier(
        'pro_monthly',
        'Pro',
        'per month',
        '$29',
        true,
        PRO_FEATURES,
        { stripePriceId: 'price_placeholder_us_pro' }
      ),
    ],
    copy: { ...NEUTRAL_COPY },
  },
  EU: {
    currency: 'EUR',
    currencySymbol: '€',
    paymentProvider: 'stripe',
    pricing: [
      tier('free_trial', 'Free trial', 'for your trial', '€0', false, FREE_FEATURES, {}),
      tier(
        'pro_monthly',
        'Pro',
        'per month',
        '€27',
        true,
        PRO_FEATURES,
        { stripePriceId: 'price_placeholder_eu_pro' }
      ),
    ],
    copy: { ...NEUTRAL_COPY },
  },
  IN: {
    currency: 'INR',
    currencySymbol: '₹',
    paymentProvider: 'razorpay',
    pricing: [
      tier('free_trial', 'Free trial', 'for your trial', '₹0', false, FREE_FEATURES, {}),
      tier(
        'pro_monthly',
        'Pro',
        'per month',
        '₹2,499',
        true,
        PRO_FEATURES,
        { razorpayPlanId: 'plan_placeholder_in_pro' }
      ),
    ],
    copy: { ...NEUTRAL_COPY },
  },
  ROW: {
    currency: 'USD',
    currencySymbol: '$',
    paymentProvider: 'stripe',
    pricing: [
      tier('free_trial', 'Free trial', 'for your trial', '$0', false, FREE_FEATURES, {}),
      tier(
        'pro_monthly',
        'Pro',
        'per month',
        '$29',
        true,
        PRO_FEATURES,
        { stripePriceId: 'price_placeholder_row_pro' }
      ),
    ],
    copy: { ...NEUTRAL_COPY },
  },
};
