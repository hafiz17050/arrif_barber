require("dotenv").config();

const express = require("express");
const crypto = require("crypto");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

const API_URL = (process.env.HITPAY_API_URL || "https://api.sandbox.hit-pay.com").replace(/\/$/, "");
const API_KEY = process.env.HITPAY_API_KEY || "";
const WEBHOOK_SALT = process.env.HITPAY_WEBHOOK_SALT || "";
const APP_URL = (process.env.APP_URL || `http://localhost:${PORT}`).replace(/\/$/, "");
const CURRENCY = (process.env.HITPAY_CURRENCY || "SGD").toUpperCase();
const BOOKING_PRICE = Number(process.env.BOOKING_PRICE_SGD || "35.00");

const ALLOWED_SERVICES = new Set([
  "Haircut",
  "Fade / Taper",
  "Beard Tidy-up",
  "Haircut + Beard"
]);

// Capture the raw body so webhook signatures can be validated.
app.use(express.json({
  limit: "100kb",
  verify: (req, res, buf) => {
    req.rawBody = Buffer.from(buf);
  }
}));

app.use(express.static(path.join(__dirname, "public")));

function safeString(value, max = 500) {
  return String(value || "").trim().slice(0, max);
}

function requireHitPayConfig(res) {
  if (!API_KEY) {
    res.status(500).json({
      error: "HitPay API key is not configured on the server."
    });
    return false;
  }
  return true;
}

app.post("/api/create-payment", async (req, res) => {
  if (!requireHitPayConfig(res)) return;

  const name = safeString(req.body.name, 100);
  const phone = safeString(req.body.phone, 30);
  const email = safeString(req.body.email, 120);
  const service = safeString(req.body.service, 50);
  const date = safeString(req.body.date, 20);
  const time = safeString(req.body.time, 20);
  const notes = safeString(req.body.notes, 500);

  if (!name || !phone || !date || !time || !ALLOWED_SERVICES.has(service)) {
    return res.status(400).json({ error: "Please complete all required booking fields." });
  }

  const reference = `ARRIF-${Date.now()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;

  const body = {
    amount: Number(BOOKING_PRICE.toFixed(2)),
    currency: CURRENCY,
    name,
    phone,
    purpose: `Arrif Barber - ${service}`,
    reference_number: reference,
    redirect_url: `${APP_URL}/payment-status.html`,
    allow_repeated_payments: "false",
    expires_after: "30 minutes",
    send_email: email ? "true" : "false",
    send_sms: "false",
    metadata: {
      service,
      preferred_date: date,
      preferred_time: time,
      notes: notes || "-"
    }
  };

  if (email) body.email = email;

  // Optional: force specific HitPay methods only when you know they are
  // enabled for your merchant account. Leave blank to let HitPay show
  // the available methods configured in the dashboard.
  const configuredMethods = safeString(process.env.HITPAY_PAYMENT_METHODS, 200);
  if (configuredMethods) {
    body.payment_methods = configuredMethods
      .split(",")
      .map(v => v.trim())
      .filter(Boolean);
  }

  try {
    const response = await fetch(`${API_URL}/v1/payment-requests`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-BUSINESS-API-KEY": API_KEY
      },
      body: JSON.stringify(body)
    });

    const text = await response.text();
    let data = {};
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    if (!response.ok || !data.url) {
      console.error("HitPay create payment error:", response.status, data);
      return res.status(502).json({
        error: data.message || data.error || "HitPay could not create the payment request."
      });
    }

    return res.json({
      checkout_url: data.url,
      payment_request_id: data.id,
      reference_number: reference
    });
  } catch (error) {
    console.error("Create payment error:", error);
    return res.status(500).json({ error: "Unable to connect to HitPay." });
  }
});

app.get("/api/payment-status", async (req, res) => {
  if (!requireHitPayConfig(res)) return;

  const requestId = safeString(req.query.requestId, 100);
  if (!requestId) {
    return res.status(400).json({ error: "Missing payment request ID." });
  }

  try {
    const response = await fetch(`${API_URL}/v1/payment-requests/${encodeURIComponent(requestId)}`, {
      headers: {
        "X-BUSINESS-API-KEY": API_KEY
      }
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: data.message || data.error || "Unable to retrieve payment status."
      });
    }

    return res.json({
      id: data.id,
      status: data.status,
      amount: data.amount,
      currency: data.currency,
      reference_number: data.reference_number,
      payment_methods: data.payment_methods
    });
  } catch (error) {
    console.error("Payment status error:", error);
    return res.status(500).json({ error: "Unable to connect to HitPay." });
  }
});

// HitPay webhook: register this public URL in the HitPay dashboard:
// https://YOUR-DOMAIN.com/api/hitpay-webhook
app.post("/api/hitpay-webhook", (req, res) => {
  if (!WEBHOOK_SALT) {
    console.error("Webhook received but HITPAY_WEBHOOK_SALT is not configured.");
    return res.status(500).send("Webhook salt is not configured");
  }

  const signature = req.get("Hitpay-Signature") || "";
  const rawPayload = req.rawBody || Buffer.from("");

  const calculated = crypto
    .createHmac("sha256", WEBHOOK_SALT)
    .update(rawPayload)
    .digest("hex");

  const sigBuffer = Buffer.from(signature, "utf8");
  const calcBuffer = Buffer.from(calculated, "utf8");

  const valid =
    sigBuffer.length === calcBuffer.length &&
    crypto.timingSafeEqual(sigBuffer, calcBuffer);

  if (!valid) {
    console.warn("Rejected invalid HitPay webhook signature.");
    return res.status(401).send("Invalid signature");
  }

  const eventType = req.get("Hitpay-Event-Type");
  const eventObject = req.get("Hitpay-Event-Object");

  if (eventObject === "payment_request" && eventType === "completed") {
    console.log("PAYMENT COMPLETED", {
      id: req.body.id,
      reference: req.body.reference_number,
      amount: req.body.amount,
      currency: req.body.currency,
      customer: req.body.name,
      metadata: req.body.metadata
    });
    // No local database is required for this starter:
    // the payment remains available in the HitPay Dashboard.
    // If you later want automatic WhatsApp/email/calendar workflows,
    // this is the place to trigger them.
  }

  return res.status(200).json({ received: true });
});

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    hitpay_environment: API_URL.includes("sandbox") ? "sandbox" : "production"
  });
});

app.listen(PORT, () => {
  console.log(`Arrif Barber running on ${APP_URL}`);
  console.log(`HitPay API: ${API_URL}`);
});
