const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { defineSecret } = require("firebase-functions/params");
const { HttpsError, onCall } = require("firebase-functions/v2/https");

initializeApp();

const db = getFirestore();
const anthropicApiKey = defineSecret("ANTHROPIC_API_KEY");
const REGION = "asia-southeast1";
const MODEL = "claude-sonnet-5-5";
const MAX_INPUT_CHARS = 6000;
const MAX_MESSAGES = 8;
const MAX_OUTPUT_TOKENS = 512;
const USER_DAILY_REQUEST_LIMIT = 5;
const MONTHLY_ANTHROPIC_BUDGET_USD = 4.5;
const RESERVED_BUDGET_USD = 0.15;
const INPUT_USD_PER_MILLION_TOKENS = 4;
const OUTPUT_USD_PER_MILLION_TOKENS = 20;

exports.health = onCall({
  region: REGION,
  timeoutSeconds: 10,
  maxInstances: 1,
  concurrency: 1,
  cors: [
    "https://adrilfahrel101.github.io",
    "http://localhost:5000",
    "http://localhost:8765",
    "http://127.0.0.1:5000",
    "http://127.0.0.1:8765",
  ],
}, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Silakan masuk menggunakan Google terlebih dahulu.");
  }
  return { ready: true, model: MODEL };
});

function validateMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_MESSAGES) {
    throw new HttpsError("invalid-argument", "Pesan tidak valid. Muat ulang percakapan dan coba lagi.");
  }

  let totalChars = 0;
  let previousRole = "assistant";
  const validated = messages.map((message) => {
    if (
      !message ||
      !["user", "assistant"].includes(message.role) ||
      typeof message.content !== "string" ||
      message.content.trim().length === 0 ||
      message.content.length > MAX_INPUT_CHARS
    ) {
      throw new HttpsError("invalid-argument", "Isi pesan kosong atau terlalu panjang.");
    }

    if (message.role === previousRole) {
      throw new HttpsError("invalid-argument", "Urutan percakapan tidak valid. Mulai percakapan baru.");
    }

    previousRole = message.role;
    totalChars += message.content.length;
    return { role: message.role, content: message.content };
  });

  if (validated[0].role !== "user" || validated[validated.length - 1].role !== "user") {
    throw new HttpsError("invalid-argument", "Pesan terakhir harus berasal dari pengguna.");
  }
  if (totalChars > MAX_INPUT_CHARS) {
    throw new HttpsError("invalid-argument", `Total percakapan dibatasi ${MAX_INPUT_CHARS} karakter.`);
  }

  return { messages: validated, totalChars };
}

function getUtcPeriods() {
  const now = new Date();
  const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const day = `${month}-${String(now.getUTCDate()).padStart(2, "0")}`;
  return { month, day };
}

async function reserveUsage(uid, month, day) {
  const monthlyRef = db.collection("claudeUsage").doc(month);
  const dailyRef = db.collection("claudeUserDailyUsage").doc(`${uid}_${day}`);

  await db.runTransaction(async (transaction) => {
    const [monthlySnapshot, dailySnapshot] = await Promise.all([
      transaction.get(monthlyRef),
      transaction.get(dailyRef),
    ]);
    const spent = monthlySnapshot.get("spentUsd") || 0;
    const reserved = monthlySnapshot.get("reservedUsd") || 0;
    const dailyCount = dailySnapshot.get("requestCount") || 0;

    if (dailyCount >= USER_DAILY_REQUEST_LIMIT) {
      throw new HttpsError("resource-exhausted", "Batas 5 pesan per hari tercapai. Silakan coba lagi besok.");
    }
    if (spent + reserved + RESERVED_BUDGET_USD > MONTHLY_ANTHROPIC_BUDGET_USD) {
      throw new HttpsError("resource-exhausted", "Batas anggaran Claude bulan ini tercapai.");
    }

    transaction.set(monthlyRef, {
      reservedUsd: FieldValue.increment(RESERVED_BUDGET_USD),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    transaction.set(dailyRef, {
      requestCount: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  });

  return { monthlyRef };
}

async function releaseReservation(monthlyRef) {
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(monthlyRef);
    const reserved = snapshot.get("reservedUsd") || 0;
    transaction.set(monthlyRef, {
      reservedUsd: Math.max(0, reserved - RESERVED_BUDGET_USD),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  });
}

async function settleUsage(monthlyRef, reservation, inputTokens, outputTokens) {
  const actualUsd =
    (inputTokens * INPUT_USD_PER_MILLION_TOKENS +
      outputTokens * OUTPUT_USD_PER_MILLION_TOKENS) /
    1_000_000;

  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(monthlyRef);
    const spent = snapshot.get("spentUsd") || 0;
    const reserved = snapshot.get("reservedUsd") || 0;
    const updatedSpent = spent + actualUsd;

    transaction.set(monthlyRef, {
      spentUsd: updatedSpent,
      reservedUsd: Math.max(0, reserved - reservation),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    return Math.max(0, MONTHLY_ANTHROPIC_BUDGET_USD - updatedSpent - Math.max(0, reserved - reservation));
  });
}

exports.chat = onCall({
  region: REGION,
  secrets: [anthropicApiKey],
  timeoutSeconds: 60,
  memory: "256MiB",
  maxInstances: 1,
  concurrency: 1,
  cors: [
    "https://adrilfahrel101.github.io",
    "http://localhost:5000",
    "http://localhost:8765",
    "http://127.0.0.1:5000",
    "http://127.0.0.1:8765",
  ],
}, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Silakan masuk menggunakan Google terlebih dahulu.");
  }

  const { messages, totalChars } = validateMessages(request.data && request.data.messages);
  const { month, day } = getUtcPeriods();
  const { monthlyRef } = await reserveUsage(request.auth.uid, month, day);
  let settled = false;
  let providerAcceptedRequest = false;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: AbortSignal.timeout(45_000),
      headers: {
        "content-type": "application/json",
        "x-api-key": anthropicApiKey.value(),
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_OUTPUT_TOKENS,
        system: "Kamu adalah asisten Zenith Studio. Jawab dengan jelas, ringkas, dan dalam bahasa yang dipakai pengguna.",
        messages,
      }),
    });

    providerAcceptedRequest = response.ok;
    if (!response.ok) {
      const providerError = await response.text();
      console.error("Anthropic API returned an error:", response.status, providerError.slice(0, 500));
      throw new HttpsError(
        response.status === 429 ? "resource-exhausted" : "unavailable",
        response.status === 429
          ? "Kuota Claude sedang penuh. Coba lagi nanti."
          : "Claude belum dapat menjawab. Periksa status API atau konfigurasi key.",
      );
    }

    const result = await response.json();
    const reply = Array.isArray(result.content)
      ? result.content.filter((block) => block.type === "text").map((block) => block.text).join("\n").trim()
      : "";
    if (!reply) {
      throw new HttpsError("unavailable", "Claude mengembalikan jawaban kosong. Silakan coba lagi.");
    }

    const usage = result.usage || {};
    const inputTokens = Number.isInteger(usage.input_tokens) ? usage.input_tokens : totalChars * 4;
    const outputTokens = Number.isInteger(usage.output_tokens) ? usage.output_tokens : MAX_OUTPUT_TOKENS;
    const budgetRemainingUsd = await settleUsage(
      monthlyRef,
      RESERVED_BUDGET_USD,
      inputTokens,
      outputTokens,
    );
    settled = true;

    return {
      reply,
      model: MODEL,
      budgetRemainingUsd: Math.round(budgetRemainingUsd * 10000) / 10000,
    };
  } catch (error) {
    if (!settled && !providerAcceptedRequest) {
      try {
        await releaseReservation(monthlyRef);
      } catch (releaseError) {
        console.error("Could not release reserved Claude budget:", releaseError);
      }
    } else if (!settled) {
      console.error("Claude accepted a request but usage could not be settled; keeping the budget reservation.", error);
    }
    if (error instanceof HttpsError) throw error;
    console.error("Claude request failed:", error);
    throw new HttpsError("unavailable", "Permintaan ke Claude gagal. Coba lagi sebentar.");
  }
});
