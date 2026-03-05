# S&H Fishing Website

Production-ready fishing charter website with booking requests, admin management, and downloadable waiver.

## Tech stack
- Node.js + Express
- EJS templates
- SQL.js (SQLite in WebAssembly, persisted to disk)
- Nodemailer for email

## Quick start
```bash
npm install
npm run make-waiver
npm run dev
```

Open http://localhost:3000

## Environment variables
Create a `.env` file:
```
ADMIN_USER=admin
ADMIN_PASSWORD=change-me
SESSION_SECRET=change-this

SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=your_user
SMTP_PASS=your_pass
SMTP_SECURE=false
MAIL_FROM=S&H Fishing <no-reply@shfishing.com>

SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your_anon_key

STRIPE_SECRET_KEY=sk_test_your_key
STRIPE_WEBHOOK_SECRET=whsec_your_secret
```

If SMTP variables are not provided, emails are logged to the console.

## Admin dashboard
- Login at `/admin/login`.
- Manage services, availability, booking requests, gallery, and site settings.
- Note: have an attorney review the policy and waiver text.

## Member accounts + SSO
- Member login page: `/member/login`
- Requires Supabase Auth. Add `SUPABASE_URL` and `SUPABASE_ANON_KEY` to `.env`.
- Enable OAuth providers (Google, Facebook, Apple) in the Supabase dashboard and set the redirect URL to:
  - `http://localhost:3000/auth/callback` for local
  - `https://your-domain.com/auth/callback` for production

## Data storage
SQLite is stored at `db/data.sqlite` and updated on each write.

## Deployment steps
1. Provision a server (Render, Railway, Fly, or a VPS).
2. Set environment variables from the list above.
3. Run `npm install` and `npm run make-waiver`.
4. Start the service with `npm start` (configure a process manager like PM2 for VPS).
5. Ensure the server is behind HTTPS (required if enabling payments).

## DNS setup for shfishing.com
- Point an `A` record to your server IP, or
- Use a `CNAME` to your hosting provider domain.
- Add a `www` CNAME to the same target.
- Set SSL/TLS to full and redirect HTTP to HTTPS.

## Optional payments
Payments are toggled by `paymentsEnabled` in Admin Settings. This build supports Stripe Checkout for deposits or full payments.

Stripe setup:
1. Create a Stripe account (free).
2. Add `STRIPE_SECRET_KEY` to `.env`.
3. Add webhook endpoint: `/webhooks/stripe` in Stripe dashboard and copy the signing secret into `STRIPE_WEBHOOK_SECRET`.
4. Enable Billing Portal in Stripe (for member payment method management).
5. In Admin Settings, set `paymentsEnabled=true`, choose payment mode and deposit amount.

After enabling, members can pay from their dashboard or immediately after submitting a booking request.

Email receipts & invoices:
- Stripe can send automatic receipts. Enable in Stripe dashboard (Customer emails).
- This app also sends a receipt email on `checkout.session.completed` and invoice notifications on `invoice.paid`.
