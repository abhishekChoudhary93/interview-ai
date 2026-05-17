/**
 * Per-market catalog (pricing display + gateway hints). v2: Starter / Pro / Elite.
 * Replace placeholder razorpayPlanId when Razorpay Plans are created in dashboard.
 */

export const MARKET_IDS = ['US', 'EU', 'IN', 'ROW'];

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

const STARTER_FEATURES = [
  '1 complete AI mock interview/month',
  'Core performance feedback & text summary',
  'Standard role-based question set',
];

const PRO_FEATURES = [
  '5 premium mock interviews/month',
  'Highly realistic & brutal feedback reports',
  'Custom role- & company-specific questions',
  'Full interview history & progress analytics',
];

const ELITE_FEATURES = [
  'Unlimited premium mock interviews',
  'Comprehensive reports & architectural suggestions',
  'Early access to System Design tracks',
  'Interactive Behavioral Blueprint scenarios',
  'Persistent canvas & audio mock history',
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
  pricingTitle: 'Flexible plans tailored to your preparation pace',
  pricingSubtitle:
    'Accelerate your tech career with realistic AI-driven mock interviews, brutal but constructive feedback, and custom role pathways.',
};

function marketPricing(currencySymbol, proDisplay, eliteDisplay, proStripe, eliteStripe, proRzp, eliteRzp) {
  return [
    tier('starter', 'Starter', 'forever', `${currencySymbol}0`, false, STARTER_FEATURES, {}),
    tier(
      'pro_monthly',
      'Pro',
      'per month',
      proDisplay,
      true,
      PRO_FEATURES,
      { stripePriceId: proStripe, razorpayPlanId: proRzp }
    ),
    tier(
      'elite_monthly',
      'Elite',
      'per month',
      eliteDisplay,
      false,
      ELITE_FEATURES,
      { stripePriceId: eliteStripe, razorpayPlanId: eliteRzp }
    ),
  ];
}

export const MARKETS = {
  US: {
    currency: 'USD',
    currencySymbol: '$',
    paymentProvider: 'stripe',
    pricing: marketPricing(
      '$',
      '$7.99',
      '$14.99',
      'price_placeholder_us_pro',
      'price_placeholder_us_elite',
      null,
      null
    ),
    copy: { ...NEUTRAL_COPY },
  },
  EU: {
    currency: 'EUR',
    currencySymbol: '€',
    paymentProvider: 'stripe',
    pricing: marketPricing(
      '€',
      '€7.99',
      '€14.99',
      'price_placeholder_eu_pro',
      'price_placeholder_eu_elite',
      null,
      null
    ),
    copy: { ...NEUTRAL_COPY },
  },
  IN: {
    currency: 'INR',
    currencySymbol: '₹',
    paymentProvider: 'razorpay',
    pricing: marketPricing(
      '₹',
      '₹499',
      '₹999',
      null,
      null,
      'plan_placeholder_in_pro',
      'plan_placeholder_in_elite'
    ),
    copy: { ...NEUTRAL_COPY },
  },
  ROW: {
    currency: 'USD',
    currencySymbol: '$',
    paymentProvider: 'stripe',
    pricing: marketPricing(
      '$',
      '$7.99',
      '$14.99',
      'price_placeholder_row_pro',
      'price_placeholder_row_elite',
      null,
      null
    ),
    copy: { ...NEUTRAL_COPY },
  },
};
