// Vercel 서버리스 함수 - Gemini API 프록시
// API 키는 Vercel 환경변수(GEMINI_API_KEY)에만 저장, 클라이언트에 절대 노출 안 됨
// 호출 권한: Supabase 로그인 세션 토큰(JWT)을 검증해 인증된 사용자만 허용

export const config = { maxDuration: 60 };

// Supabase (URL·publishable key는 공개값이라 하드코딩 가능. 원하면 env var로 빼도 됨)
const SUPABASE_URL = "https://vqmuwmjdzskycxaqostt.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_g1nrFhcQzjLO8pirzWiy2g_aT8Ys-Fd";

// 요청의 Bearer 토큰을 Supabase로 검증 → 유효하면 사용자 객체, 아니면 null
async function verifyUser(req) {
  const auth = req.headers.authorization || req.headers.Authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return null;
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return null;
    const u = await r.json();
    return u && u.id ? u : null;
  } catch (e) {
    return null;
  }
}

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // 인증 검증 — 로그인된 사용자만 Gemini 호출 허용
  const user = await verifyUser(req);
  if (!user) return res.status(401).json({ error: "인증이 필요합니다. 다시 로그인해주세요." });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "서버에 API 키가 설정되지 않았습니다." });

  const { model, body, stream } = req.body;
  if (!model || !body) return res.status(400).json({ error: "model, body 필수" });

  const endpoint = stream
    ? `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`
    : `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  try {
    if (stream) {
      // SSE 스트리밍 프록시
      const geminiRes = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(55000), // 55초 타임아웃 (Vercel 60초 제한보다 여유있게)
      });

      if (!geminiRes.ok) {
        const err = await geminiRes.json().catch(() => ({}));
        return res.status(geminiRes.status).json({ error: err.error?.message || `HTTP ${geminiRes.status}` });
      }

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.status(200);

      const reader = geminiRes.body.getReader();
      const decoder = new TextDecoder();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(decoder.decode(value, { stream: true }));
        }
      } finally {
        res.end();
      }
    } else {
      // 일반 요청 (텍스트 or 이미지)
      const geminiRes = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(55000),
      });
      const data = await geminiRes.json();
      res.status(geminiRes.status).json(data);
    }
  } catch (e) {
    if (e.name === "TimeoutError" || e.name === "AbortError") {
      return res.status(504).json({ error: "Gemini 응답 시간 초과. 잠시 후 다시 시도해주세요." });
    }
    return res.status(500).json({ error: e.message || "서버 오류" });
  }
}
