/**
 * index.js — Cloud Functions entry point
 * 
 * ROUTING LOGIC:
 *   Real-time questions  → Gemini 2.0 Flash (Google Search grounding built-in)
 *   All other questions  → DeepSeek (cheap, fast, no history sent)
 *   Images/Vision        → geminiVision endpoint (unchanged)
 */
const cors    = require("cors")({ origin: true });
const { onRequest } = require("firebase-functions/v2/https");
const functions     = require("firebase-functions");
const admin         = require("firebase-admin");
const axios         = require("axios");

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

// ─── API Keys ─────────────────────────────────────────────────────────────────
const DEEPSEEK_KEY = () => process.env.DEEPSEEK_API_KEY || "sk-f617d7a27b2b42579f7093e4857d015c";
const GEMINI_KEY   = () => process.env.GEMINI_API_KEY   || ""; // ⚠️ KEY ROTATED — set via env var GEMINI_API_KEY in Firebase

// ─── Allowed DeepSeek models ──────────────────────────────────────────────────
const ALLOWED_MODELS = new Set([
  "deepseek-chat",      // V4 Flash — default, fast, cheap
  "deepseek-reasoner",  // V4 Flash thinking/CoT — pro mode
  "deepseek-v4-pro",    // V4 Pro flagship — paid addon ₹149/mo
]);

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getTextContent(content) {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.filter(p => p.type === "text").map(p => p.text || "").join(" ");
  return String(content);
}

// ─── Real-time detection patterns ────────────────────────────────────────────
// If query matches → route to Gemini (has live Google Search grounding)
// If not → route to DeepSeek (cheaper, better for concepts/math/SSC)
const REALTIME_PATTERNS = [
  /who is (the )?(current |new |present )?/i,
  /who (is|are|was|were) .*(president|pm|prime minister|ceo|minister|chief|head|leader|governor|mayor|chairman)/i,
  /president of/i,
  /prime minister of/i,
  /(current|latest|recent|new|today|now|2025|2026).*(president|pm|minister|ceo|winner|champion|rank|result|score|rate|price)/i,
  /(price|rate|value) of (gold|silver|petrol|diesel|dollar|usd|bitcoin|share|stock)/i,
  /latest (news|update|result|match|score|notification)/i,
  /who won/i,
  /election result/i,
  /ipl|world cup|olympic|cricket score|football score|match result/i,
  /today.*(weather|news|rate|price)/i,
  /current (affairs|news|events|rate|price|government)/i,
  /admit card|answer key|result date|exam date|cutoff.*2025|cutoff.*2026/i,
  /vacancy.*2025|vacancy.*2026|notification.*2025|notification.*2026/i,
];

const REALTIME_KEYWORDS = [
  "who is","who are","current president","current pm","current ceo",
  "latest news","recent news","today news","breaking news",
  "live score","match score","ipl score","cricket score",
  "gold price","silver price","petrol price","diesel price",
  "stock price","share price","bitcoin price","dollar rate",
  "election result","election 2026","election 2025",
  "current affairs 2026","current affairs 2025",
  "admit card 2026","answer key 2026","result date 2026",
  "ssc result","upsc result","ibps result","rrb result",
];

function isRealTimeQuery(text) {
  const lower = text.toLowerCase();
  if (REALTIME_PATTERNS.some(p => p.test(lower))) return true;
  if (REALTIME_KEYWORDS.some(k => lower.includes(k))) return true;
  return false;
}

// ─── Gemini 2.0 Flash — Real-time answer with Google Search grounding ─────────
async function callGeminiRealTime(userQuestion, systemContext) {
  const GEMINI_MODEL = "gemini-2.5-flash";
  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY()}`;

  const today = new Date().toLocaleDateString("en-IN", {
    weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Kolkata"
  });

  // Build a focused prompt — no history, just the question + context
  const prompt = `Today is ${today}.

${systemContext ? `Context: ${systemContext.substring(0, 300)}\n\n` : ""}User question: ${userQuestion}

Answer using the most current information available. Be accurate, concise and helpful. If this is a current affairs / GK question relevant to Indian exams (SSC/UPSC/IBPS), also mention why it's important for exams.`;

  const requestBody = {
    contents: [{ parts: [{ text: prompt }] }],
    // Enable Google Search grounding — gives Gemini real-time web access
    tools: [{ google_search: {} }],
    generationConfig: {
      maxOutputTokens: 800,
      temperature: 0.3,
    },
  };

  const response = await axios.post(geminiUrl, requestBody, {
    timeout: 20000,
    headers: { "Content-Type": "application/json" },
  });

  const text = response.data?.candidates?.[0]?.content?.parts
    ?.filter(p => p.text)
    ?.map(p => p.text)
    ?.join("") || "";

  return text;
}

// ─── Scheduled: Clean up expired pending bookings ─────────────────────────────
exports.cleanupExpiredPendingBookings = functions
  .pubsub.schedule("every 30 minutes")
  .onRun(async () => {
    const cutoff = new Date(Date.now() - 30 * 60 * 1000);
    functions.logger.info(`🧹 Cleaning up pending bookings older than ${cutoff.toISOString()}`);
    const expiredSnap = await db.collection("pending_bookings")
      .where("createdAt", "<", cutoff)
      .where("status", "==", "pending_payment")
      .get();
    if (expiredSnap.empty) { functions.logger.info("No expired pending bookings found"); return null; }
    const batch = db.batch();
    for (const doc of expiredSnap.docs) {
      const pending = doc.data();
      batch.delete(doc.ref);
      try {
        const [startTime] = pending.slotTime.split("-");
        const slotSnap = await db.collection("slots")
          .where("groundId",    "==", pending.groundId)
          .where("date",        "==", pending.date)
          .where("startTime",   "==", startTime.trim())
          .where("lockOrderId", "==", doc.id)
          .limit(1).get();
        if (!slotSnap.empty) {
          batch.update(slotSnap.docs[0].ref, {
            status: "available", lockOrderId: null, lockExpiresAt: null,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        }
      } catch (e) {
        functions.logger.warn(`Could not release slot for ${doc.id}:`, e.message);
      }
    }
    await batch.commit();
    functions.logger.info(`✅ Cleaned up ${expiredSnap.size} expired pending bookings`);
    return null;
  });

// ─── geminiVision — image analysis via server-side key ────────────────────────
// Key is read from GEMINI_API_KEY env var (set via: firebase functions:secrets:set GEMINI_API_KEY)
// NEVER put the key in client code — rotate the key then set it server-side only.
exports.geminiVision = onRequest((req, res) => {
  cors(req, res, async () => {
    if (req.method === "OPTIONS") return res.status(204).send("");
    try {
      const key = GEMINI_KEY();
      if (!key) {
        functions.logger.error("[geminiVision] GEMINI_API_KEY env var is not set");
        return res.status(500).json({ error: "Vision service not configured. Set GEMINI_API_KEY env var." });
      }

      const GEMINI_MODEL = "gemini-2.5-flash";
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`;

      const requestBody = {
        contents: req.body.contents || [{
          parts: [{ text: req.body.message || "Describe this image in detail." }]
        }],
        generationConfig: req.body.generationConfig || {
          maxOutputTokens: 1500,
          temperature: 0.4,
        },
      };

      const response = await axios.post(geminiUrl, requestBody, {
        timeout: 30000,
        headers: { "Content-Type": "application/json" },
      });

      // Collect all text parts (Gemini can return multiple parts)
      const parts = response.data?.candidates?.[0]?.content?.parts || [];
      const text = parts
        .filter(p => p.text)
        .map(p => p.text)
        .join("\n") || "";

      functions.logger.info("[geminiVision] OK", { chars: text.length });
      res.json({ text });
    } catch (err) {
      const geminiMsg = err.response?.data?.error?.message || err.message;
      functions.logger.error("[geminiVision] FAILED", { message: geminiMsg, status: err.response?.status });
      res.status(err.response?.status || 500).json({ error: geminiMsg });
    }
  });
});

// ─── deepseek — main AI endpoint ─────────────────────────────────────────────
// Routes: real-time queries → Gemini 2.0 Flash | everything else → DeepSeek
// NO history sent to either API — saves input tokens significantly
exports.deepseek = onRequest((req, res) => {
  cors(req, res, async () => {
    try {
      const isPdf    = req.body.isPdf    || false;
      const isVision = req.body.isVision || false;

      // ── Pick DeepSeek model (allowlist enforced) ──────────────────────────
      const requestedModel = req.body.model || "deepseek-chat";
      const model = ALLOWED_MODELS.has(requestedModel) ? requestedModel : "deepseek-chat";
      if (!ALLOWED_MODELS.has(requestedModel)) {
        functions.logger.warn(`[router] Blocked model "${requestedModel}" → deepseek-chat`);
      }

      // ── Extract ONLY the latest user message (no history) ─────────────────
      // History is stripped here to save input tokens on every request
      let messages = req.body.messages || [];
      const systemMsg  = messages.find(m => m.role === "system");
      const lastUser   = [...messages].reverse().find(m => m.role === "user");
      const userText   = getTextContent(lastUser?.content || "").trim();
      const systemText = getTextContent(systemMsg?.content || "").trim();

      if (!userText) {
        return res.status(400).json({ error: "No user message found" });
      }

      // ── PDF path — needs DeepSeek with extracted text ─────────────────────
      if (isPdf && req.body.pdfBase64) {
        try {
          const pdfParse  = require("pdf-parse");
          const pdfBuffer = Buffer.from(req.body.pdfBase64, "base64");
          const pdfData   = await pdfParse(pdfBuffer);
          const extracted = (pdfData.text || "").substring(0, 10000);
          const questionMatch = userText.match(/then answer:\s*([\s\S]+)$/i);
          const userQuestion  = questionMatch ? questionMatch[1].trim() : userText.replace(/\[PDF.*?\]/g, "").trim();

          const pdfMessages = [
            { role: "system", content: systemText || "You are a helpful AI exam assistant." },
            { role: "user",   content: `[PDF — ${pdfData.numpages} pages]\n\n${extracted}\n\n---\nQuestion: ${userQuestion}` },
          ];
          const response = await axios.post(
            "https://api.deepseek.com/chat/completions",
            { model, messages: pdfMessages, max_tokens: 800, temperature: 0.7 },
            { headers: { Authorization: `Bearer ${DEEPSEEK_KEY()}` }, timeout: 45000 }
          );
          return res.json(response.data);
        } catch (pdfErr) {
          functions.logger.warn("[PDF parse skipped]", pdfErr.message);
          // Fall through to normal DeepSeek call
        }
      }

      // ── Vision path — images → Gemini 2.0 Flash (only model that supports base64 images) ──
      if (isVision && req.body.images && Array.isArray(req.body.images) && req.body.images.length > 0) {
        const key = GEMINI_KEY();
        if (!key) {
          return res.status(500).json({ error: "Vision service not configured. Set GEMINI_API_KEY env var." });
        }

        // Build Gemini-native multimodal parts (inline_data, NOT image_url)
        const imageParts = req.body.images.map(img => ({
          inline_data: {
            mime_type: img.mimeType || "image/jpeg",
            data: img.data
          }
        }));
        imageParts.push({
          text: userText ||
            "Read this image carefully. Identify every question, diagram, or text visible. Provide a complete step-by-step solution."
        });

        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`;
        const geminiBody = {
          contents: [{ parts: imageParts }],
          systemInstruction: systemText ? { parts: [{ text: systemText }] } : undefined,
          generationConfig: { maxOutputTokens: 1500, temperature: 0.4 }
        };

        const geminiRes = await axios.post(geminiUrl, geminiBody, {
          timeout: 45000,
          headers: { "Content-Type": "application/json" }
        });

        const parts = geminiRes.data?.candidates?.[0]?.content?.parts || [];
        const text = parts.filter(p => p.text).map(p => p.text).join("\n") || "";
        functions.logger.info("[vision] Gemini OK", { chars: text.length });

        // Return in DeepSeek shape so frontend needs no changes
        return res.json({
          choices: [{ message: { content: text }, finish_reason: "stop" }],
          _source: "gemini-2.5-flash-vision"
        });
      }
      // ── Vision fallback — no images passed, answer text-only ──
      if (isVision) {
        const visionMessages = [
          { role: "system", content: systemText || "You are a helpful AI exam assistant." },
          { role: "user",   content: userText },
        ];
        const response = await axios.post(
          "https://api.deepseek.com/chat/completions",
          { model, messages: visionMessages, max_tokens: 800, temperature: 0.7 },
          { headers: { Authorization: `Bearer ${DEEPSEEK_KEY()}` }, timeout: 45000 }
        );
        return res.json(response.data);
      }

      // ── Real-time query → Gemini 2.0 Flash (Google Search grounding) ───────
      if (isRealTimeQuery(userText)) {
        functions.logger.info("[router] Real-time → Gemini:", userText.substring(0, 80));
        try {
          const geminiAnswer = await callGeminiRealTime(userText, systemText);
          if (geminiAnswer) {
            // Return in same shape as DeepSeek so frontend needs no changes
            return res.json({
              choices: [{ message: { content: geminiAnswer }, finish_reason: "stop" }],
              _source: "gemini-2.5-flash",
            });
          }
        } catch (geminiErr) {
          functions.logger.warn("[Gemini real-time failed, falling back to DeepSeek]", geminiErr.message);
          // Fall through to DeepSeek
        }
      }

      // ── Standard query → DeepSeek (no history, just system + user) ──────────
      functions.logger.info("[router] Standard → DeepSeek:", userText.substring(0, 80));
      const today = new Date().toLocaleDateString("en-IN", {
        weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Kolkata"
      });

      const deepseekMessages = [
        {
          role: "system",
          content: `Today is ${today}.\n\n${systemText || "You are a helpful AI exam assistant for Indian students."}`,
        },
        { role: "user", content: userText },
      ];

      const maxTok = req.body.max_tokens || 600;
      const response = await axios.post(
        "https://api.deepseek.com/chat/completions",
        { model, messages: deepseekMessages, max_tokens: maxTok, temperature: 0.7 },
        { headers: { Authorization: `Bearer ${DEEPSEEK_KEY()}` }, timeout: 45000 }
      );
      return res.json(response.data);

    } catch (err) {
      const dsErr = err.response?.data?.error;
      functions.logger.error("[deepseek endpoint] FAILED", {
        message: err.message,
        dsError: dsErr,
        model: req.body?.model || "unknown",
      });
      res.status(500).json({
        error: dsErr?.message || err.message,
        code: dsErr?.code || err.response?.status || 500,
      });
    }
  });
});

// ─── createCashfreeOrder — direct Cashfree API call ──────────────────────────
// Keys loaded from functions/.env (never from frontend)
const CF_APP_ID     = () => process.env.CASHFREE_APP_ID     || "";
const CF_SECRET_KEY = () => process.env.CASHFREE_SECRET_KEY || "";
const CF_API        = process.env.CASHFREE_ENV === "sandbox"
  ? "https://sandbox.cashfree.com/pg"
  : "https://api.cashfree.com/pg";

exports.createCashfreeOrder = onRequest((req, res) => {
  cors(req, res, async () => {
    if (req.method === "OPTIONS") return res.status(204).send("");
    try {
      const {
        order_id, amount, plan, currency = "INR",
        customer_id, customer_name, customer_email,
        customer_phone = "9999999999", order_note,
        uid, name, email,
      } = req.body;

      if (!amount) return res.status(400).json({ error: "amount is required" });

      const orderId   = order_id  || `plan_${plan}_${uid || customer_id}_${Date.now()}`;
      const custId    = customer_id || uid  || "guest";
      const custName  = customer_name || name  || "Student";
      const custEmail = customer_email || email || "student@crackai.in";

      functions.logger.info("[createCashfreeOrder] creating", { orderId, amount, plan });

      const cfRes = await axios.post(`${CF_API}/orders`, {
        order_id:       orderId,
        order_amount:   Number(amount),
        order_currency: currency,
        order_note:     order_note || plan || orderId,
        customer_details: {
          customer_id:    custId,
          customer_name:  custName,
          customer_email: custEmail,
          customer_phone: String(customer_phone),
        },
      }, {
        headers: {
          "Content-Type":    "application/json",
          "x-api-version":   "2023-08-01",
          "x-client-id":     CF_APP_ID(),
          "x-client-secret": CF_SECRET_KEY(),
        },
        timeout: 15000,
      });

      functions.logger.info("[createCashfreeOrder] OK", { orderId });
      return res.json({
        payment_session_id: cfRes.data.payment_session_id,
        order_id:           cfRes.data.order_id || orderId,
        order_status:       cfRes.data.order_status,
      });

    } catch (err) {
      const cfErr = err.response?.data;
      functions.logger.error("[createCashfreeOrder] FAILED", cfErr || err.message);
      return res.status(err.response?.status || 500).json({ error: cfErr?.message || err.message });
    }
  });
});

// ─── verifyPayment ────────────────────────────────────────────────────────────
exports.verifyPayment = onRequest((req, res) => {
  cors(req, res, async () => {
    if (req.method === "OPTIONS") return res.status(204).send("");
    try {
      const { order_id } = req.body;
      if (!order_id) return res.status(400).json({ error: "order_id required" });

      const cfRes = await axios.get(`${CF_API}/orders/${order_id}`, {
        headers: {
          "x-api-version":   "2023-08-01",
          "x-client-id":     CF_APP_ID(),
          "x-client-secret": CF_SECRET_KEY(),
        },
        timeout: 10000,
      });

      const status = cfRes.data?.order_status;
      functions.logger.info("[verifyPayment]", { order_id, status });
      return res.json({ status });

    } catch (err) {
      functions.logger.error("[verifyPayment] FAILED", err.response?.data || err.message);
      return res.status(500).json({ error: err.message });
    }
  });
});