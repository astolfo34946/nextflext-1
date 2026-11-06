import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";

const PORT = process.env.PORT || 8000;
const UPSTREAM_URL =
  process.env.UPSTREAM_URL || "https://www.vaultedkeys.shop/api/redeem";
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS || "*";

const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "10kb" }));

// ---------- CORS ----------
const origins =
  ALLOWED_ORIGINS === "*"
    ? "*"
    : ALLOWED_ORIGINS.split(",").map((o) => o.trim());
app.use(cors({ origin: origins, methods: ["GET", "POST", "OPTIONS"] }));

// ---------- Rate limit ----------
app.use(
  "/api/redeem",
  rateLimit({
    windowMs: 60 * 1000,
    max: Number(process.env.RATE_LIMIT_PER_MIN || 5),
    standardHeaders: true,
    legacyHeaders: false,
    message: { detail: "Too many attempts, wait a minute." },
  })
);

// ---------- Validation ----------
const KEY_RE = /^NF-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

// ---------- Routes ----------
app.get("/", (_req, res) =>
  res.json({ ok: true, service: "redeem-proxy", time: Date.now() })
);

app.get("/health", (_req, res) =>
  res.json({ status: "ok", time: Date.now() })
);

app.post("/api/redeem", async (req, res) => {
  const { code } = req.body ?? {};
  if (!code) return res.status(400).json({ detail: "Enter your key." });

  const normalized = String(code).trim().toUpperCase();
  if (!KEY_RE.test(normalized)) {
    return res
      .status(422)
      .json({ detail: "Invalid format. Expected NF-XXXX-XXXX-XXXX" });
  }

  try {
    const upstream = await fetch(UPSTREAM_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
          "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Origin: "https://www.vaultedkeys.shop",
        Referer: "https://www.vaultedkeys.shop/",
      },
      body: JSON.stringify({ code: normalized }),
      signal: AbortSignal.timeout(20_000),
    });

    let data;
    try {
      data = await upstream.json();
    } catch {
      return res
        .status(502)
        .json({ detail: `Upstream non-JSON (HTTP ${upstream.status})` });
    }

    if (upstream.status >= 400 || data.result === "bad_request") {
      return res
        .status(400)
        .json({ detail: data.error ?? "Redeem failed" });
    }

    return res.status(200).json(data);
  } catch (err) {
    const msg =
      err.name === "TimeoutError" ? "Upstream timeout" : err.message;
    return res.status(502).json({ detail: `Upstream error: ${msg}` });
  }
});

app.use((_req, res) => res.status(404).json({ detail: "Not found" }));

app.listen(PORT, () => {
  console.log(`🚀 Redeem proxy listening on :${PORT}`);
  console.log(`   Health:  GET  /health`);
  console.log(`   Redeem:  POST /api/redeem`);
});
