// The Asset Frequency API
// Mirrors the RateWire architecture — deploy to Render in minutes
// vg@ratewire.app · V&DG Management LLC

const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// ─── API Key Store ──────────────────────────────────────────────────────────
const API_KEYS = {
  'af_demo_free_1': { tier: 'free', email: 'demo@theassetfrequency.com' },
};

// ─── Rate Limiters ──────────────────────────────────────────────────────────
const freeLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => req.apiKey || req.ip,
  message: {
    error: 'rate_limit_exceeded',
    message: 'Free tier: 10 requests/day. Upgrade to Pro at theassetfrequency.com/developer',
  },
});

const proLimiter = rateLimit({
  windowMs: 30 * 24 * 60 * 60 * 1000,
  max: 1000,
  keyGenerator: (req) => req.apiKey || req.ip,
  message: {
    error: 'rate_limit_exceeded',
    message: 'Pro tier: 1,000 requests/month. Upgrade to Enterprise for unlimited.',
  },
});

// ─── Auth Middleware ─────────────────────────────────────────────────────────
const authenticate = (req, res, next) => {
  const auth = req.headers['authorization'] || req.query.api_key;
  const key  = auth && auth.startsWith('Bearer ') ? auth.slice(7) : auth;

  if (!key) {
    return res.status(401).json({
      error: 'unauthorized',
      message: 'Pass your key: Authorization: Bearer YOUR_KEY',
      docs: 'https://theassetfrequency.com/developer',
    });
  }

  const record = API_KEYS[key];
  if (!record) {
    return res.status(403).json({
      error: 'invalid_api_key',
      message: 'Key not recognized. Get yours at theassetfrequency.com/developer',
    });
  }

  req.apiKey = key;
  req.tier   = record.tier;
  next();
};

const limitByTier = (req, res, next) => {
  if (req.tier === 'free') return freeLimiter(req, res, next);
  if (req.tier === 'pro')  return proLimiter(req, res, next);
  next();
};

// ─── Helpers ─────────────────────────────────────────────────────────────────
const getWeekNumber = () => {
  const d = new Date();
  const start = new Date(d.getFullYear(), 0, 1);
  return Math.ceil(((d - start) / 86400000 + start.getDay() + 1) / 7);
};

const getMonthYear = () =>
  new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' });

// ─── Data Layer ──────────────────────────────────────────────────────────────
const getWeeklyData = () => ({
  frequency_score: 72,
  market_posture:  'Accumulation',
  capital_flow:    'Inward',
  week_label:      `Week ${getWeekNumber()} – ${getMonthYear()}`,
  signal:          'Bullish bias with rotation toward defensives',
  confidence:      'High',
  timestamp:       new Date().toISOString(),
});

const getIndustriesData = () => ({
  week_label: `Week ${getWeekNumber()} – ${getMonthYear()}`,
  industries: [
    { name: 'Technology',       score: 78, signal: 'Buy',  momentum: '+2.4%' },
    { name: 'Healthcare',       score: 65, signal: 'Hold', momentum: '+0.8%' },
    { name: 'Energy',           score: 81, signal: 'Buy',  momentum: '+3.1%' },
    { name: 'Financials',       score: 59, signal: 'Hold', momentum: '-0.3%' },
    { name: 'Consumer Staples', score: 45, signal: 'Sell', momentum: '-1.2%' },
  ],
  rotation_theme: 'Cyclicals over defensives',
  timestamp: new Date().toISOString(),
});

const getDailyData = () => ({
  date:            new Date().toISOString().split('T')[0],
  signal:          'Momentum',
  direction:       'Upward',
  frequency_pulse: 68,
  note:            'Watch for volume confirmation in the first 90 min',
  key_levels: { support: 4480, resistance: 4620 },
  timestamp: new Date().toISOString(),
});

// ─── Routes ──────────────────────────────────────────────────────────────────

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'asset-frequency-api', version: '1.0.0' });
});

app.get('/v1', (req, res) => {
  res.json({
    service: 'The Asset Frequency API',
    version: '1.0.0',
    endpoints: [
      'GET /v1/frequency/weekly',
      'GET /v1/frequency/industries',
      'GET /v1/frequency/daily',
    ],
    docs:    'https://theassetfrequency.com/developer',
    pricing: 'https://theassetfrequency.com/developer#pricing',
  });
});

app.get('/v1/frequency/weekly', authenticate, limitByTier, (req, res) => {
  res.json({ ok: true, tier: req.tier, data: getWeeklyData() });
});

app.get('/v1/frequency/industries', authenticate, limitByTier, (req, res) => {
  if (req.tier === 'free') {
    return res.status(403).json({
      error:   'plan_required',
      message: 'Industry rotation data requires Pro or Enterprise.',
      upgrade: 'https://theassetfrequency.com/developer#pricing',
    });
  }
  res.json({ ok: true, tier: req.tier, data: getIndustriesData() });
});

app.get('/v1/frequency/daily', authenticate, limitByTier, (req, res) => {
  if (req.tier === 'free') {
    return res.status(403).json({
      error:   'plan_required',
      message: 'Daily signals require Pro or Enterprise.',
      upgrade: 'https://theassetfrequency.com/developer#pricing',
    });
  }
  res.json({ ok: true, tier: req.tier, data: getDailyData() });
});

// ─── Stripe Webhook ──────────────────────────────────────────────────────────
app.post('/webhooks/stripe', express.raw({ type: 'application/json' }), (req, res) => {
  const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  const sig    = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    return res.status(400).send(`Webhook error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const email   = session.customer_details?.email;
    const plan    = session.metadata?.plan || 'pro';
    const newKey  = `af_${plan}_${crypto.randomBytes(16).toString('hex')}`;
    API_KEYS[newKey] = { tier: plan, email };
    console.log(`✅ New ${plan} key issued to ${email}: ${newKey}`);
  }

  if (event.type === 'customer.subscription.deleted') {
    console.log('Subscription cancelled — revoke associated key');
  }

  res.json({ received: true });
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🟡 Asset Frequency API running on port ${PORT}`);
});
