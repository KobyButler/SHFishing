import dotenv from 'dotenv';
import express from 'express';
import path from 'path';
import helmet from 'helmet';
import session from 'express-session';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import sanitizeHtml from 'sanitize-html';
import fs from 'fs';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

import { init, getSetting, setSetting, ensureUploads, prepare } from './db.js';
import { sendMail } from './email.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || '';
const supabaseConfigured = !!(supabaseUrl && supabaseAnonKey);
const stripeSecret = process.env.STRIPE_SECRET_KEY || '';
const stripe = stripeSecret ? new Stripe(stripeSecret, { apiVersion: '2024-06-20' }) : null;
const stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET || '';

const createSupabaseClient = (req) => {
  if (!supabaseConfigured) return null;
  const storage = {
    getItem: (key) => req.session?.supabaseAuth?.[key] || null,
    setItem: (key, value) => {
      req.session.supabaseAuth = req.session.supabaseAuth || {};
      req.session.supabaseAuth[key] = value;
    },
    removeItem: (key) => {
      if (req.session?.supabaseAuth) {
        delete req.session.supabaseAuth[key];
      }
    }
  };
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      storage
    }
  });
};

await init();
ensureUploads();

const db = { prepare };

app.set('view engine', 'ejs');
app.set('views', path.join(process.cwd(), 'views'));

app.use(helmet({
  contentSecurityPolicy: false
}));
app.use(cookieParser());

app.post('/webhooks/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripe || !stripeWebhookSecret) {
    return res.status(400).send('Stripe webhook not configured');
  }
  let event;
  try {
    const signature = req.headers['stripe-signature'];
    event = stripe.webhooks.constructEvent(req.body, signature, stripeWebhookSecret);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
  const settings = getSettings();

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const paymentStatus = session.payment_status;
    const sessionId = session.id;
    const paymentIntent = session.payment_intent;
    const customerId = session.customer;

    if (paymentStatus === 'paid') {
      db.prepare('UPDATE payments SET status = ?, stripe_payment_intent = ?, stripe_customer_id = ? WHERE stripe_session_id = ?')
        .run('paid', paymentIntent || null, customerId || null, sessionId);
    }

    const payment = db.prepare('SELECT * FROM payments WHERE stripe_session_id = ?').get(sessionId);
    if (payment) {
      const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(payment.booking_id);
      const service = booking ? getService(booking.service_id) : null;
      const receiptEmail = session.customer_details?.email || booking?.email;
      if (receiptEmail) {
        const amount = payment.amount;
        const currency = payment.currency.toUpperCase();
        const subject = 'Payment receipt - S&H Fishing';
        const text = `Thanks for your payment.\n\nService: ${service?.name || 'Charter'}\nAmount: ${currency} ${amount}\nStatus: ${payment.status}\n\nIf you have questions, contact ${settings.email}.`;
        await sendMail({ to: receiptEmail, subject, text });
      }
    }
  }

  if (event.type === 'payment_intent.payment_failed') {
    const intent = event.data.object;
    if (intent?.id) {
      db.prepare('UPDATE payments SET status = ? WHERE stripe_payment_intent = ?').run('failed', intent.id);
    }
  }

  if (event.type === 'setup_intent.succeeded') {
    const intent = event.data.object;
    const customerId = intent.customer;
    const paymentMethod = intent.payment_method;
    if (customerId && paymentMethod) {
      try {
        await stripe.customers.update(customerId, {
          invoice_settings: { default_payment_method: paymentMethod }
        });
      } catch (error) {
        // ignore
      }
      db.prepare('UPDATE members SET stripe_default_payment_method = ? WHERE stripe_customer_id = ?')
        .run(paymentMethod, customerId);
    }
  }

  if (event.type === 'invoice.paid') {
    const invoice = event.data.object;
    const email = invoice.customer_email;
    if (email) {
      const subject = 'Invoice paid - S&H Fishing';
      const total = (invoice.amount_paid || 0) / 100;
      const currency = (invoice.currency || 'usd').toUpperCase();
      const text = `Your invoice has been paid.\n\nInvoice: ${invoice.number || invoice.id}\nAmount: ${currency} ${total}\n\nThank you for your business.`;
      await sendMail({ to: email, subject, text });
    }
  }

  res.json({ received: true });
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(process.cwd(), 'public')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 8 }
}));

const upload = multer({
  dest: path.join(process.cwd(), 'public', 'uploads', 'gallery')
});

const siteDefaults = () => ({
  businessName: 'S&H Fishing',
  domain: 'shfishing.com',
  phone: '435-749-9980',
  email: 'hello@shfishing.com',
  facebook: 'https://facebook.com',
  instagram: 'https://instagram.com',
  address: 'Lakeview Marina, North Cove',
  licenseUrl: 'https://example.com/fishing-license',
  policyEffectiveDate: 'January 30, 2026',
  waiverEffectiveDate: 'January 30, 2026',
  paymentsEnabled: 'false',
  paymentMode: 'deposit',
  depositAmount: '150',
  paymentCurrency: 'usd',
  analyticsEnabled: 'false'
});

const seedDefaults = () => {
  const serviceCount = db.prepare('SELECT COUNT(*) as count FROM services').get().count;
  if (serviceCount === 0) {
    const insert = db.prepare('INSERT INTO services (name, duration_hours, description, price, start_times_json) VALUES (?, ?, ?, ?, ?)');
    insert.run('Full day', 8, 'Full-day guided trip for anglers looking to maximize time on the water.', 500, JSON.stringify(['06:00', '07:00']));
    insert.run('Half day', 5, 'Shorter guided trip with the same focused coaching and local expertise.', 350, JSON.stringify(['06:00', '12:00']));
    insert.run('Custom kids trip', 0, 'Kid-focused custom trip. Contact us for timing, length, and details.', 0, JSON.stringify(['08:00']));
  }

  const defaults = siteDefaults();
  for (const [key, value] of Object.entries(defaults)) {
    if (getSetting(key, null) === null) {
      setSetting(key, value);
    }
  }

  if (getSetting('lodgingList', null) === null) {
    setSetting('lodgingList', JSON.stringify([
      {
        name: 'Harborview Lodge',
        description: 'Rustic rooms with sunrise views and walking access to the marina.',
        url: 'https://example.com'
      },
      {
        name: 'Cedar Creek Cabins',
        description: 'Family-friendly cabins with full kitchens and lakefront fire pits.',
        url: 'https://example.com'
      }
    ]));
  }

  if (getSetting('foodList', null) === null) {
    setSetting('foodList', JSON.stringify([
      {
        name: 'Dockside Grill',
        description: 'Fresh sandwiches, chowder, and hot coffee at the boat ramp.',
        url: 'https://example.com'
      },
      {
        name: 'The Driftwood Diner',
        description: 'Comfort food with local pies and quick takeout options.',
        url: 'https://example.com'
      }
    ]));
  }

  if (getSetting('campingList', null) === null) {
    setSetting('campingList', JSON.stringify([
      'North Ridge Pullout (2 miles past the marina)',
      'Pine Flats BLM Road 14 turnout',
      'Bluewater Shoreline primitive sites'
    ]));
  }

  const galleryCount = db.prepare('SELECT COUNT(*) as count FROM gallery_images').get().count;
  if (galleryCount === 0) {
    const insertGallery = db.prepare('INSERT INTO gallery_images (filename, caption, created_at) VALUES (?, ?, ?)');
    const now = new Date().toISOString();
    const samples = [
      { file: 'sh-fishing-hero.jpg', caption: 'Trophy catch with mountain views.' },
      { file: 'sh-fishing-guide.jpg', caption: 'Guide highlight from a successful trip.' },
      { file: 'sh-fishing-catch-01.jpg', caption: 'Calm water and a great lake trout.' },
      { file: 'sh-fishing-catch-02.jpg', caption: 'Bluebird skies and a quality fish.' },
      { file: 'sh-fishing-catch-03.jpg', caption: 'Cold weather, big fish, big smiles.' },
      { file: 'sh-fishing-catch-04.jpg', caption: 'Heavy fish landed in windy conditions.' },
      { file: 'sh-fishing-catch-05.jpg', caption: 'Sunny day trophy with clear water.' },
      { file: 'sh-fishing-catch-06.jpg', caption: 'Catching silver in the midday sun.' },
      { file: 'sh-fishing-catch-07.jpg', caption: 'A full cleaning table after a great day.' },
      { file: 'sh-fishing-kids-trip.jpg', caption: 'Custom kids trip success story.' },
      { file: 'sh-fishing-catch-08.jpg', caption: 'Another big fish brought to the boat.' },
      { file: 'sh-fishing-catch-09.jpg', caption: 'Golden light and a healthy catch.' }
    ];
    for (const sample of samples) {
      insertGallery.run(sample.file, sample.caption, now);
    }
  }
};

seedDefaults();

const sanitize = (input) => sanitizeHtml(input || '', { allowedTags: [], allowedAttributes: {} }).trim();

const getSettings = () => {
  const defaults = siteDefaults();
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const data = { ...defaults };
  for (const row of rows) {
    data[row.key] = row.value;
  }
  return data;
};

const requireAdmin = (req, res, next) => {
  if (req.session?.isAdmin) {
    return next();
  }
  return res.redirect('/admin/login');
};

const csrfToken = (req) => {
  if (!req.session.csrf) {
    req.session.csrf = Math.random().toString(36).slice(2);
  }
  return req.session.csrf;
};

app.use((req, res, next) => {
  res.locals.settings = getSettings();
  res.locals.currentPath = req.path;
  res.locals.csrfToken = csrfToken(req);
  res.locals.pageTitle = res.locals.pageTitle || res.locals.settings.businessName;
  res.locals.metaDescription = res.locals.metaDescription || 'Guided fishing charters with modern gear and local expertise.';
  res.locals.member = req.session.member || null;
  res.locals.paymentsReady = paymentsActive(res.locals.settings);
  next();
});

const withMeta = (res, { title, description }) => {
  res.locals.pageTitle = title;
  res.locals.metaDescription = description;
};

const getGalleryImages = () => db.prepare('SELECT * FROM gallery_images ORDER BY created_at DESC').all();

const getServices = () => db.prepare('SELECT * FROM services WHERE active = 1 ORDER BY id').all();

const getService = (id) => db.prepare('SELECT * FROM services WHERE id = ?').get(id);

const getMemberBySupabaseId = (id) => db.prepare('SELECT * FROM members WHERE supabase_id = ?').get(id);
const getMemberById = (id) => db.prepare('SELECT * FROM members WHERE id = ?').get(id);

const paymentsActive = (settings) => settings.paymentsEnabled === 'true' && !!stripe;

const upsertMember = (profile) => {
  const existing = getMemberBySupabaseId(profile.supabase_id);
  if (existing) {
    db.prepare('UPDATE members SET email = ?, name = ? WHERE supabase_id = ?')
      .run(profile.email, profile.name, profile.supabase_id);
    return getMemberBySupabaseId(profile.supabase_id);
  }
  const createdAt = new Date().toISOString();
  const insert = db.prepare('INSERT INTO members (supabase_id, email, name, created_at) VALUES (?, ?, ?, ?)');
  const info = insert.run(profile.supabase_id, profile.email, profile.name, createdAt);
  return getMemberById(info.lastInsertRowid);
};

const requireMember = (req, res, next) => {
  if (req.session?.member) {
    return next();
  }
  return res.redirect('/member/login');
};

const getBaseUrl = (req) => `${req.protocol}://${req.get('host')}`;

const getBookingsForMonth = (serviceId, month) => {
  return db.prepare(`
    SELECT date, time, status
    FROM bookings
    WHERE service_id = ? AND date LIKE ?
  `).all(serviceId, `${month}-%`);
};

const getBlocksForMonth = (serviceId, month) => {
  return db.prepare(`
    SELECT date, time
    FROM availability
    WHERE service_id = ? AND date LIKE ? AND is_blocked = 1
  `).all(serviceId, `${month}-%`);
};

app.get('/', (req, res) => {
  withMeta(res, {
    title: 'S&H Fishing | Guided Fishing Trips on the Lake',
    description: 'Book a guided fishing charter with S&H Fishing. Personalized trips, modern gear, and unforgettable catches.'
  });
  const testimonials = [
    {
      quote: 'Best morning on the water I have had in years. The guide knew exactly where the fish were holding.',
      name: 'Mia K.'
    },
    {
      quote: 'Our family trip was smooth, safe, and so much fun. We landed our first bass in under 10 minutes.',
      name: 'Marcus T.'
    },
    {
      quote: 'Clear instructions, great gear, and a guide who loves teaching. Worth every penny.',
      name: 'Lena P.'
    }
  ];
  const highlights = getGalleryImages().slice(0, 8);
  res.render('home', { testimonials, highlights });
});

app.get('/gallery', (req, res) => {
  withMeta(res, {
    title: 'Gallery | S&H Fishing',
    description: 'Explore our bragging wall of recent catches and charter memories.'
  });
  res.render('gallery', { images: getGalleryImages() });
});

app.get('/book', (req, res) => {
  withMeta(res, {
    title: 'Book Your Trip | S&H Fishing',
    description: 'Choose a charter package and request availability with S&H Fishing.'
  });
  res.render('book', { services: getServices() });
});

app.get('/book/:id', (req, res) => {
  const service = getService(req.params.id);
  if (!service) {
    return res.status(404).send('Service not found');
  }
  withMeta(res, {
    title: `Schedule Your Trip | ${service.name}`,
    description: `Request availability for ${service.name}.`
  });
  res.render('schedule', { service });
});

app.post('/book/:id/request', async (req, res) => {
  const service = getService(req.params.id);
  if (!service) {
    return res.status(404).send('Service not found');
  }

  if (req.body.csrf !== req.session.csrf) {
    return res.status(400).send('Invalid session token');
  }

  if (req.body.company) {
    return res.status(200).render('booking-confirm', { service, bookingId: null, spam: true });
  }

  const name = sanitize(req.body.name);
  const email = sanitize(req.body.email);
  const phone = sanitize(req.body.phone);
  const guests = Number(req.body.guests || 1);
  const notes = sanitize(req.body.notes);
  const date = sanitize(req.body.date);
  const time = sanitize(req.body.time);

  if (!name || !email || !phone || !date || !time || !guests) {
    return res.status(400).send('Missing required fields');
  }

  const blocked = db.prepare('SELECT 1 FROM availability WHERE service_id = ? AND date = ? AND time = ? AND is_blocked = 1').get(service.id, date, time);
  const existing = db.prepare('SELECT 1 FROM bookings WHERE service_id = ? AND date = ? AND time = ? AND status IN (\'pending\', \'confirmed\')').get(service.id, date, time);
  if (blocked || existing) {
    return res.status(400).send('Selected time is no longer available.');
  }

  const createdAt = new Date().toISOString();
  const memberId = req.session?.member?.id || null;
  const insert = db.prepare(`
    INSERT INTO bookings (service_id, date, time, name, email, phone, guests, notes, status, created_at, member_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
  `);
  const info = insert.run(service.id, date, time, name, email, phone, guests, notes, createdAt, memberId);

  const bookingId = info.lastInsertRowid;

  const ownerEmail = res.locals.settings.email;
  const adminMessage = `New booking request (#${bookingId}) for ${service.name}.\n\nDate: ${date}\nTime: ${time}\nGuests: ${guests}\nName: ${name}\nEmail: ${email}\nPhone: ${phone}\nNotes: ${notes || 'None'}\n\nLog in to confirm or propose a new time.`;
  const customerMessage = `Hi ${name},\n\nThanks for requesting a trip with S&H Fishing. We received your request for ${service.name} on ${date} at ${time}. Our team will review availability and reply shortly.\n\nIf you need to make changes, reply to this email or call ${res.locals.settings.phone}.\n\nTight lines,\nS&H Fishing`;

  await sendMail({
    to: ownerEmail,
    subject: `New booking request #${bookingId} - ${service.name}`,
    text: adminMessage
  });

  await sendMail({
    to: email,
    subject: 'We received your booking request',
    text: customerMessage
  });

  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(bookingId);
  res.render('booking-confirm', { service, bookingId, booking, spam: false });
});

app.get('/api/availability', (req, res) => {
  const serviceId = Number(req.query.serviceId);
  const month = req.query.month;
  const service = getService(serviceId);
  if (!service || !month) {
    return res.status(400).json({ error: 'Missing service or month' });
  }
  const blocks = getBlocksForMonth(serviceId, month);
  const bookings = getBookingsForMonth(serviceId, month).filter(b => ['pending', 'confirmed'].includes(b.status));
  res.json({
    startTimes: JSON.parse(service.start_times_json),
    blocks,
    bookings
  });
});

app.post('/contact', async (req, res) => {
  if (req.body.csrf !== req.session.csrf) {
    return res.status(400).send('Invalid session token');
  }

  if (req.body.company) {
    return res.redirect('/?contact=success');
  }

  const first = sanitize(req.body.firstName);
  const last = sanitize(req.body.lastName);
  const email = sanitize(req.body.email);
  const message = sanitize(req.body.message);

  if (!first || !last || !email || !message) {
    return res.status(400).send('Missing required fields');
  }

  const ownerEmail = res.locals.settings.email;
  const adminMessage = `New website message from ${first} ${last}.\n\nEmail: ${email}\nMessage: ${message}`;

  await sendMail({
    to: ownerEmail,
    subject: 'New message from S&H Fishing website',
    text: adminMessage
  });

  res.redirect('/?contact=success');
});

app.get('/policies/refund', (req, res) => {
  withMeta(res, {
    title: 'Refund Policy | S&H Fishing',
    description: 'Read S&H Fishing cancellation and refund policies.'
  });
  res.render('policy-refund');
});

app.get('/policies/privacy', (req, res) => {
  withMeta(res, {
    title: 'Privacy Policy | S&H Fishing',
    description: 'Learn how S&H Fishing collects and uses personal information.'
  });
  res.render('policy-privacy');
});

app.get('/policies/terms', (req, res) => {
  withMeta(res, {
    title: 'Terms & Conditions | S&H Fishing',
    description: 'Review the terms and conditions for booking a trip with S&H Fishing.'
  });
  res.render('policy-terms');
});

app.get('/know-before-you-go', (req, res) => {
  withMeta(res, {
    title: 'Know Before You Go | S&H Fishing',
    description: 'Everything you need to prepare for your charter.'
  });
  res.render('know-before');
});

app.get('/places', (req, res) => {
  withMeta(res, {
    title: 'Places to Stay and Eat | S&H Fishing',
    description: 'Local lodging, dining, and camping recommendations near the marina.'
  });
  const lodgingList = JSON.parse(res.locals.settings.lodgingList || '[]');
  const foodList = JSON.parse(res.locals.settings.foodList || '[]');
  const campingList = JSON.parse(res.locals.settings.campingList || '[]');
  res.render('places', { lodgingList, foodList, campingList });
});

app.get('/member/login', (req, res) => {
  if (req.session?.member) {
    return res.redirect('/member');
  }
  withMeta(res, {
    title: 'Member Access | S&H Fishing',
    description: 'Sign up or log in to manage your trips and booking history.'
  });
  res.render('member-login', { authEnabled: supabaseConfigured });
});

app.get('/member/logout', (req, res) => {
  req.session.member = null;
  res.redirect('/');
});

app.get('/member', requireMember, (req, res) => {
  withMeta(res, {
    title: 'Member Dashboard | S&H Fishing',
    description: 'Manage saved trips, booking history, and account details.'
  });
  const member = getMemberById(req.session.member.id);
  const savedTrips = db.prepare(`
    SELECT member_saved_trips.id AS saved_id, services.*
    FROM member_saved_trips
    JOIN services ON services.id = member_saved_trips.service_id
    WHERE member_saved_trips.member_id = ?
    ORDER BY member_saved_trips.created_at DESC
  `).all(member.id);
  const bookingHistory = db.prepare(`
    SELECT bookings.*, services.name AS service_name
    FROM bookings
    JOIN services ON services.id = bookings.service_id
    WHERE bookings.member_id = ? OR bookings.email = ?
    ORDER BY bookings.created_at DESC
  `).all(member.id, member.email);
  const payments = db.prepare(`
    SELECT payments.*, bookings.service_id
    FROM payments
    JOIN bookings ON bookings.id = payments.booking_id
    WHERE payments.member_id = ?
    ORDER BY payments.created_at DESC
  `).all(member.id);
  const paymentByBooking = new Map();
  for (const payment of payments) {
    if (!paymentByBooking.has(payment.booking_id)) {
      paymentByBooking.set(payment.booking_id, payment);
    }
  }
  const bookingsWithPayments = bookingHistory.map((booking) => ({
    ...booking,
    payment: paymentByBooking.get(booking.id) || null
  }));
  res.render('member-dashboard', {
    member,
    savedTrips,
    bookingHistory: bookingsWithPayments,
    payments,
    paymentsEnabled: paymentsActive(res.locals.settings),
    setupStatus: req.query.setup || null
  });
});

app.post('/member/save/:serviceId', requireMember, (req, res) => {
  if (req.body.csrf !== req.session.csrf) {
    return res.status(400).send('Invalid session token');
  }
  const serviceId = Number(req.params.serviceId);
  const service = getService(serviceId);
  if (!service) {
    return res.status(404).send('Service not found');
  }
  const memberId = req.session.member.id;
  const existing = db.prepare('SELECT 1 FROM member_saved_trips WHERE member_id = ? AND service_id = ?')
    .get(memberId, serviceId);
  if (!existing) {
    const createdAt = new Date().toISOString();
    db.prepare('INSERT INTO member_saved_trips (member_id, service_id, created_at) VALUES (?, ?, ?)')
      .run(memberId, serviceId, createdAt);
  }
  res.redirect('/member');
});

app.post('/member/remove/:id', requireMember, (req, res) => {
  if (req.body.csrf !== req.session.csrf) {
    return res.status(400).send('Invalid session token');
  }
  db.prepare('DELETE FROM member_saved_trips WHERE id = ? AND member_id = ?').run(req.params.id, req.session.member.id);
  res.redirect('/member');
});

app.post('/member/billing-portal', requireMember, async (req, res) => {
  if (req.body.csrf !== req.session.csrf) {
    return res.status(400).send('Invalid session token');
  }
  if (!stripe || res.locals.settings.paymentsEnabled !== 'true') {
    return res.status(400).send('Payments are not enabled.');
  }
  const member = getMemberById(req.session.member.id);
  if (!member) {
    return res.status(404).send('Member not found');
  }
  let customerId = member.stripe_customer_id;
  try {
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: member.email,
        name: member.name || undefined
      });
      customerId = customer.id;
      db.prepare('UPDATE members SET stripe_customer_id = ? WHERE id = ?').run(customerId, member.id);
    }
    const portal = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${getBaseUrl(req)}/member`
    });
    res.redirect(portal.url);
  } catch (error) {
    res.status(500).send('Unable to open billing portal.');
  }
});

app.post('/payments/setup', requireMember, async (req, res) => {
  if (req.body.csrf !== req.session.csrf) {
    return res.status(400).send('Invalid session token');
  }
  if (!stripe || res.locals.settings.paymentsEnabled !== 'true') {
    return res.status(400).send('Payments are not enabled.');
  }
  const member = getMemberById(req.session.member.id);
  if (!member) {
    return res.status(404).send('Member not found');
  }
  try {
    let customerId = member.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: member.email,
        name: member.name || undefined
      });
      customerId = customer.id;
      db.prepare('UPDATE members SET stripe_customer_id = ? WHERE id = ?').run(customerId, member.id);
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'setup',
      customer: customerId,
      success_url: `${getBaseUrl(req)}/member?setup=success`,
      cancel_url: `${getBaseUrl(req)}/member?setup=cancel`
    });
    res.redirect(session.url);
  } catch (error) {
    res.status(500).send('Unable to start setup session.');
  }
});

app.get('/auth/:provider', (req, res) => {
  const provider = req.params.provider;
  const supabaseClient = createSupabaseClient(req);
  if (!supabaseClient) {
    return res.status(500).send('SSO is not configured.');
  }
  const allowed = ['google', 'facebook', 'apple'];
  if (!allowed.includes(provider)) {
    return res.status(404).send('Provider not supported');
  }
  const redirectTo = `${getBaseUrl(req)}/auth/callback`;
  supabaseClient.auth.signInWithOAuth({ provider, options: { redirectTo } })
    .then(({ data, error }) => {
      if (error || !data?.url) {
        return res.status(500).send('Unable to start SSO flow.');
      }
      res.redirect(data.url);
    });
});

app.get('/auth/callback', async (req, res) => {
  const supabaseClient = createSupabaseClient(req);
  if (!supabaseClient) {
    return res.status(500).send('SSO is not configured.');
  }
  const code = req.query.code;
  if (!code) {
    return res.redirect('/member/login');
  }
  const { data, error } = await supabaseClient.auth.exchangeCodeForSession(code);
  if (error || !data?.user) {
    return res.redirect('/member/login');
  }
  const profile = {
    supabase_id: data.user.id,
    email: data.user.email,
    name: data.user.user_metadata?.full_name || data.user.user_metadata?.name || ''
  };
  const member = upsertMember(profile);
  req.session.member = { id: member.id, email: member.email, name: member.name };
  res.redirect('/member');
});

app.post('/payments/checkout', async (req, res) => {
  if (req.body.csrf !== req.session.csrf) {
    return res.status(400).send('Invalid session token');
  }
  if (!stripe || res.locals.settings.paymentsEnabled !== 'true') {
    return res.status(400).send('Payments are not enabled.');
  }
  const bookingId = Number(req.body.bookingId);
  const mode = sanitize(req.body.mode) || res.locals.settings.paymentMode || 'deposit';
  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(bookingId);
  if (!booking) {
    return res.status(404).send('Booking not found');
  }
  const service = getService(booking.service_id);
  if (!service) {
    return res.status(404).send('Service not found');
  }

  const amount =
    mode === 'full'
      ? service.price
      : Math.max(0, Number(res.locals.settings.depositAmount || 0));

  if (amount <= 0) {
    return res.status(400).send('Invalid payment amount.');
  }

  const currency = (res.locals.settings.paymentCurrency || 'usd').toLowerCase();
  const lineItemName = mode === 'full' ? `${service.name} - Full Payment` : `${service.name} - Deposit`;

  try {
    let customerId = null;
    if (booking.member_id) {
      const member = getMemberById(booking.member_id);
      if (member) {
        customerId = member.stripe_customer_id;
        if (!customerId) {
          const customer = await stripe.customers.create({
            email: member.email,
            name: member.name || undefined
          });
          customerId = customer.id;
          db.prepare('UPDATE members SET stripe_customer_id = ? WHERE id = ?').run(customerId, member.id);
        }
      }
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency,
            product_data: { name: lineItemName },
            unit_amount: amount * 100
          },
          quantity: 1
        }
      ],
      success_url: `${getBaseUrl(req)}/payments/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${getBaseUrl(req)}/payments/cancel?bookingId=${booking.id}`,
      customer: customerId || undefined,
      customer_email: customerId ? undefined : booking.email,
      metadata: {
        booking_id: String(booking.id),
        mode
      }
    });

    const createdAt = new Date().toISOString();
    db.prepare(`
      INSERT INTO payments (booking_id, member_id, amount, currency, status, stripe_session_id, payment_mode, stripe_customer_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(booking.id, booking.member_id || null, amount, currency, 'pending', session.id, mode, customerId, createdAt);

    res.redirect(session.url);
  } catch (error) {
    res.status(500).send('Unable to start payment session.');
  }
});

app.get('/payments/success', async (req, res) => {
  if (!stripe) {
    return res.status(400).send('Payments are not enabled.');
  }
  const sessionId = req.query.session_id;
  if (!sessionId) {
    return res.redirect('/');
  }
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session?.id) {
      db.prepare('UPDATE payments SET status = ? WHERE stripe_session_id = ?').run('paid', session.id);
    }
  } catch (error) {
    // ignore
  }
  res.render('payment-success');
});

app.get('/payments/cancel', (req, res) => {
  res.render('payment-cancel');
});

app.get('/admin/login', (req, res) => {
  res.render('admin-login', { error: null });
});

app.post('/admin/login', (req, res) => {
  const username = req.body.username;
  const password = req.body.password;
  if (username === process.env.ADMIN_USER && password === process.env.ADMIN_PASSWORD) {
    req.session.isAdmin = true;
    return res.redirect('/admin');
  }
  res.render('admin-login', { error: 'Invalid credentials' });
});

app.post('/admin/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
});

app.get('/admin', requireAdmin, (req, res) => {
  const bookings = db.prepare('SELECT * FROM bookings ORDER BY created_at DESC LIMIT 5').all();
  res.render('admin-dashboard', { bookings });
});

app.get('/admin/services', requireAdmin, (req, res) => {
  const services = db.prepare('SELECT * FROM services ORDER BY id').all();
  res.render('admin-services', { services });
});

app.post('/admin/services', requireAdmin, (req, res) => {
  if (req.body.csrf !== req.session.csrf) {
    return res.status(400).send('Invalid session token');
  }
  const name = sanitize(req.body.name);
  const description = sanitize(req.body.description);
  const duration = Number(req.body.duration);
  const price = Number(req.body.price);
  const startTimes = sanitize(req.body.startTimes);
  if (!name || !description || !duration || !price || !startTimes) {
    return res.status(400).send('Missing fields');
  }
  db.prepare('INSERT INTO services (name, duration_hours, description, price, start_times_json) VALUES (?, ?, ?, ?, ?)')
    .run(name, duration, description, price, JSON.stringify(startTimes.split(',').map(t => t.trim()).filter(Boolean)));
  res.redirect('/admin/services');
});

app.post('/admin/services/:id/delete', requireAdmin, (req, res) => {
  if (req.body.csrf !== req.session.csrf) {
    return res.status(400).send('Invalid session token');
  }
  db.prepare('DELETE FROM services WHERE id = ?').run(req.params.id);
  res.redirect('/admin/services');
});

app.post('/admin/services/:id/update', requireAdmin, (req, res) => {
  if (req.body.csrf !== req.session.csrf) {
    return res.status(400).send('Invalid session token');
  }
  const name = sanitize(req.body.name);
  const description = sanitize(req.body.description);
  const duration = Number(req.body.duration);
  const price = Number(req.body.price);
  const startTimes = sanitize(req.body.startTimes);
  db.prepare('UPDATE services SET name = ?, description = ?, duration_hours = ?, price = ?, start_times_json = ? WHERE id = ?')
    .run(name, description, duration, price, JSON.stringify(startTimes.split(',').map(t => t.trim()).filter(Boolean)), req.params.id);
  res.redirect('/admin/services');
});

app.get('/admin/availability', requireAdmin, (req, res) => {
  const services = getServices();
  const blocks = db.prepare(`
    SELECT availability.*, services.name AS service_name
    FROM availability
    JOIN services ON services.id = availability.service_id
    ORDER BY date DESC, time DESC
  `).all();
  res.render('admin-availability', { services, blocks });
});

app.post('/admin/availability', requireAdmin, (req, res) => {
  if (req.body.csrf !== req.session.csrf) {
    return res.status(400).send('Invalid session token');
  }
  const serviceId = Number(req.body.serviceId);
  const date = sanitize(req.body.date);
  const time = sanitize(req.body.time);
  const note = sanitize(req.body.note);
  if (!serviceId || !date || !time) {
    return res.status(400).send('Missing fields');
  }
  db.prepare(`
    INSERT INTO availability (service_id, date, time, is_blocked, note)
    VALUES (?, ?, ?, 1, ?)
    ON CONFLICT(service_id, date, time) DO UPDATE SET is_blocked = 1, note = excluded.note
  `).run(serviceId, date, time, note);
  res.redirect('/admin/availability');
});

app.post('/admin/availability/:id/delete', requireAdmin, (req, res) => {
  if (req.body.csrf !== req.session.csrf) {
    return res.status(400).send('Invalid session token');
  }
  db.prepare('DELETE FROM availability WHERE id = ?').run(req.params.id);
  res.redirect('/admin/availability');
});

app.get('/admin/bookings', requireAdmin, (req, res) => {
  const bookings = db.prepare(`
    SELECT bookings.*, services.name AS service_name
    FROM bookings
    JOIN services ON services.id = bookings.service_id
    ORDER BY created_at DESC
  `).all();
  const pending = bookings.filter((b) => b.status === 'pending');
  const confirmed = bookings.filter((b) => b.status === 'confirmed');
  const cancelled = bookings.filter((b) => b.status === 'cancelled');
  const tab = ['pending', 'confirmed', 'cancelled'].includes(req.query.tab) ? req.query.tab : 'pending';
  res.render('admin-bookings', {
    bookings,
    pending,
    confirmed,
    cancelled,
    tab,
    updated: req.query.updated === '1'
  });
});

app.post('/admin/bookings/:id/update', requireAdmin, async (req, res) => {
  if (req.body.csrf !== req.session.csrf) {
    return res.status(400).send('Invalid session token');
  }
  const status = sanitize(req.body.status);
  const adminNotes = sanitize(req.body.adminNotes);
  const proposedDate = sanitize(req.body.proposedDate);
  const proposedTime = sanitize(req.body.proposedTime);
  const notify = req.body.notify === 'on';

  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
  if (!booking) {
    return res.status(404).send('Booking not found');
  }

  db.prepare(`
    UPDATE bookings
    SET status = ?, admin_notes = ?, proposed_date = ?, proposed_time = ?
    WHERE id = ?
  `).run(status, adminNotes, proposedDate, proposedTime, req.params.id);

  if (notify) {
    const message = `Hi ${booking.name},\n\nYour booking request (#${booking.id}) has been updated.\n\nStatus: ${status}\n${proposedDate && proposedTime ? `Proposed time: ${proposedDate} at ${proposedTime}\n` : ''}${adminNotes ? `Notes: ${adminNotes}\n` : ''}\nIf you have questions, reply to this email or call ${res.locals.settings.phone}.\n\nS&H Fishing`;
    await sendMail({
      to: booking.email,
      subject: `Booking update for request #${booking.id}`,
      text: message
    });
  }

  res.redirect(`/admin/bookings?updated=1&tab=${encodeURIComponent(status)}`);
});

app.get('/admin/gallery', requireAdmin, (req, res) => {
  const images = getGalleryImages();
  res.render('admin-gallery', { images });
});

app.post('/admin/gallery', requireAdmin, upload.single('image'), (req, res) => {
  if (req.body.csrf !== req.session.csrf) {
    return res.status(400).send('Invalid session token');
  }
  if (!req.file) {
    return res.status(400).send('No file uploaded');
  }
  const caption = sanitize(req.body.caption);
  const createdAt = new Date().toISOString();
  const filename = path.basename(req.file.path);
  db.prepare('INSERT INTO gallery_images (filename, caption, created_at) VALUES (?, ?, ?)')
    .run(filename, caption, createdAt);
  res.redirect('/admin/gallery');
});

app.post('/admin/gallery/:id/delete', requireAdmin, (req, res) => {
  if (req.body.csrf !== req.session.csrf) {
    return res.status(400).send('Invalid session token');
  }
  const image = db.prepare('SELECT * FROM gallery_images WHERE id = ?').get(req.params.id);
  if (image) {
    const filePath = path.join(process.cwd(), 'public', 'uploads', 'gallery', image.filename);
    try {
      fs.unlinkSync(filePath);
    } catch (error) {
      // ignore missing file
    }
  }
  db.prepare('DELETE FROM gallery_images WHERE id = ?').run(req.params.id);
  res.redirect('/admin/gallery');
});

app.get('/admin/settings', requireAdmin, (req, res) => {
  const safeParse = (value, fallback) => {
    try {
      return value ? JSON.parse(value) : fallback;
    } catch (error) {
      return fallback;
    }
  };
  const lodgingList = safeParse(res.locals.settings.lodgingList, []);
  const foodList = safeParse(res.locals.settings.foodList, []);
  const campingList = safeParse(res.locals.settings.campingList, []);
  res.render('admin-settings', {
    settings: res.locals.settings,
    lodgingList,
    foodList,
    campingList,
    saved: req.query.saved === '1'
  });
});

app.post('/admin/settings', requireAdmin, (req, res) => {
  if (req.body.csrf !== req.session.csrf) {
    return res.status(400).send('Invalid session token');
  }
  const fields = ['businessName', 'domain', 'phone', 'email', 'facebook', 'instagram', 'address', 'licenseUrl', 'policyEffectiveDate', 'waiverEffectiveDate', 'paymentsEnabled', 'paymentMode', 'depositAmount', 'paymentCurrency', 'analyticsEnabled'];
  for (const field of fields) {
    const value = sanitize(req.body[field]);
    setSetting(field, value);
  }

  const toArray = (value) => {
    if (!value) return [];
    return Array.isArray(value) ? value : [value];
  };

  const lodgingNames = toArray(req.body.lodgingName);
  const lodgingDescriptions = toArray(req.body.lodgingDescription);
  const lodgingUrls = toArray(req.body.lodgingUrl);

  const foodNames = toArray(req.body.foodName);
  const foodDescriptions = toArray(req.body.foodDescription);
  const foodUrls = toArray(req.body.foodUrl);

  const campingItems = toArray(req.body.campingItem);

  const lodgingList = lodgingNames.map((name, index) => ({
    name: sanitize(name),
    description: sanitize(lodgingDescriptions[index] || ''),
    url: sanitize(lodgingUrls[index] || '')
  })).filter((item) => item.name);

  const foodList = foodNames.map((name, index) => ({
    name: sanitize(name),
    description: sanitize(foodDescriptions[index] || ''),
    url: sanitize(foodUrls[index] || '')
  })).filter((item) => item.name);

  const campingList = campingItems.map((item) => sanitize(item)).filter(Boolean);

  setSetting('lodgingList', JSON.stringify(lodgingList));
  setSetting('foodList', JSON.stringify(foodList));
  setSetting('campingList', JSON.stringify(campingList));

  res.redirect('/admin/settings?saved=1');
});

app.get('/sitemap.xml', (req, res) => {
  const base = `https://${res.locals.settings.domain}`;
  const urls = [
    '/',
    '/gallery',
    '/book',
    '/policies/refund',
    '/policies/privacy',
    '/policies/terms',
    '/know-before-you-go',
    '/places'
  ];
  const serviceUrls = getServices().map((service) => `/book/${service.id}`);
  const allUrls = [...urls, ...serviceUrls];
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${allUrls
    .map((url) => `  <url><loc>${base}${url}</loc></url>`)
    .join('\n')}\n</urlset>`;
  res.header('Content-Type', 'application/xml');
  res.send(sitemap);
});

app.get('/robots.txt', (req, res) => {
  res.type('text/plain');
  res.send(`User-agent: *\nAllow: /\nSitemap: https://${res.locals.settings.domain}/sitemap.xml`);
});

app.use((req, res) => {
  res.status(404).render('404');
});

app.listen(PORT, () => {
  console.log(`S&H Fishing running at http://localhost:${PORT}`);
});

