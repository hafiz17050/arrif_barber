# Arrif Barber + HitPay

This project is a real server-side HitPay integration for the Arrif barber mini-site.

## Customer flow

1. Customer opens the Arrif website.
2. Clicks **Book a cut**.
3. Enters booking details.
4. Clicks **Continue to secure payment · S$35**.
5. Your server creates a HitPay Payment Request.
6. Customer is redirected to the official HitPay hosted checkout.
7. HitPay shows payment methods enabled for your merchant account.
8. After payment, customer returns to the payment-status page.
9. Your server independently checks the payment status using the HitPay API.
10. HitPay also sends a signed webhook to `/api/hitpay-webhook`.

## Important security design

The HitPay Business API Key is NEVER stored in browser HTML or JavaScript.
It remains in the server environment variables.

The amount is also controlled on the server (`BOOKING_PRICE_SGD`) so a customer
cannot edit the browser code and change S$35 to S$1.

---

## 1. Create a HitPay Sandbox account

Use HitPay Sandbox first.

Sandbox dashboard:
https://dashboard.sandbox.hit-pay.com/login

In the sandbox dashboard:

- Get the **Business API Key**.
- Get your webhook **salt**.
- Enable the payment methods you want to test.

HitPay Sandbox supports methods including PayNow, cards and GrabPay.

## 2. Configure this project

Copy:

`.env.example`

to:

`.env`

Then fill in:

```env
HITPAY_API_URL=https://api.sandbox.hit-pay.com
HITPAY_API_KEY=YOUR_SANDBOX_API_KEY
HITPAY_WEBHOOK_SALT=YOUR_SANDBOX_WEBHOOK_SALT
APP_URL=http://localhost:3000
BOOKING_PRICE_SGD=35.00
HITPAY_CURRENCY=SGD
```

Do not send your production API key to customers and do not commit `.env` to GitHub.

## 3. Run locally

Install Node.js 18+.

Then:

```bash
npm install
npm start
```

Open:

http://localhost:3000

The local booking form can create a sandbox checkout, but HitPay cannot send a
webhook to `localhost`. For full webhook testing, deploy the website or expose
localhost through a secure tunnel.

## 4. Deploy

This is a standard Node/Express app and can be hosted on platforms such as
Render, Railway, Fly.io, a VPS, or any Node-compatible hosting.

After deployment set:

```env
APP_URL=https://YOUR-DOMAIN
```

in your hosting environment variables.

## 5. Register the HitPay webhook

After the website has a public HTTPS URL, go to the HitPay Dashboard:

Developers → Webhook Endpoints → New Webhook

Webhook URL:

`https://YOUR-DOMAIN/api/hitpay-webhook`

Subscribe to:

`payment_request.completed`

The server validates the `Hitpay-Signature` using HMAC-SHA256 and your webhook salt.

## 6. Payment methods

By default `HITPAY_PAYMENT_METHODS` is blank. This is intentional.

When blank, HitPay uses the payment methods available/enabled on your merchant account.

For a Singapore-facing checkout, you want to enable the relevant methods in the
HitPay dashboard such as PayNow and cards. GrabPay availability depends on the
merchant/currency/payment configuration approved for the account.

If HitPay confirms that your account should explicitly request these codes, set:

```env
HITPAY_PAYMENT_METHODS=paynow_online,card,grabpay_direct
```

Otherwise leave it blank.

## 7. Move from Sandbox to Production

Sandbox and Production are separate HitPay environments.

After your real Malaysian merchant account is approved and your settlement bank
account is configured:

```env
HITPAY_API_URL=https://api.hit-pay.com
HITPAY_API_KEY=YOUR_PRODUCTION_API_KEY
HITPAY_WEBHOOK_SALT=YOUR_PRODUCTION_WEBHOOK_SALT
APP_URL=https://YOUR-LIVE-DOMAIN
```

Register the production webhook URL again in the production dashboard.

Do a small real transaction before sharing the site with customers.

## Files

- `public/index.html` — Arrif purple homepage
- `public/booking.html` — booking + S$35 checkout
- `public/payment-status.html` — verifies payment after redirect
- `public/arrif.jpg` — Arrif's image
- `server.js` — HitPay API + status + webhook backend
- `.env.example` — settings template
- `.gitignore` — protects secrets
- `package.json` — Node dependencies

## Current price

The project currently charges:

**S$35.00**

Change it using:

`BOOKING_PRICE_SGD=35.00`

The browser never decides the final price; the server does.
