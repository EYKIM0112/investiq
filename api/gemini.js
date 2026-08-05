// Vercel 서버리스 함수 - Gemini API 프록시
// API 키는 Vercel 환경변수(GEMINI_API_KEY)에만 저장, 클라이언트에 절대 노출 안 됨
// 호출 권한: Supabase 로그인 세션 토큰(JWT)을 검증해 인증된 사용자만 허용
// v3.5.1+: 일일 사용 한도 서버 강제(인사이트 탭별·AI 조언). 관리자 무제한. 토글은 Supabase app_config.

export const config = { maxDuration: 60 };

// Supabase (URL·publishable key는 공개값이라 하드코딩 가능. 원하면 env var로 빼도 됨)
const SUPABASE_URL = "https://vqmuwmjdzskycxaqostt.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_g1nrFhcQzjLO8pirzWiy2g_aT8Ys-Fd";

// 무제한(관리자) 이메일 — 소문자로 비교. 추가하려면 배열에 이메일만 넣으면 됨.
const ADMIN_EMAILS = ["ilikeom@naver.com"];

// purpose → 제한 대상 feature 매핑. 여기서 null이면 무제한(가격조회·분류후속·재시도 등).
// 재시도(:retry)·자유입력 답변후속(advice_ans)은 카운트 제외 — 논리적 1행동은 첫 통과 때 이미 1회 카운트됨.
function limitedFeature(purpose) {
  if (!purpose || typeof purpose !== "string") return null;
  if (purpose.includes(":retry") || purpose === "advice_ans" || purpose === "advice_retry") return null;
  if (purpose === "advice") return "advice";               // AI 조언: 자유입력 1질문
  if (purpose === "advice_quick") return "advice_quick";   // AI 조언: 빠른 질문(프리셋) 1질문 — 별도 한도
  if (purpose.startsWith("insight:")) return purpose;      // 인사이트 탭별 (insight:kr 등)
  return null;
}

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

// 일일 한도 확인+증가 (Supabase RPC, 원자적). 반환: { blocked, used, limit } 또는 null(통과)
// 토글 OFF·무제한 feature·오류(fail-open) 시엔 통과(null 반환).
async function checkUsageLimit(req, feature) {
  try {
    const auth = req.headers.authorization || req.headers.Authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/check_and_increment_usage`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ p_feature: feature }),
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return null; // RPC 실패 → fail-open(서비스 중단 방지)
    const gate = await r.json().catch(() => null);
    if (gate && gate.allowed === false && gate.reason === "limit") {
      return { blocked: true, used: gate.used, limit: gate.limit };
    }
    return null; // 허용/무제한/토글off
  } catch (e) {
    return null; // fail-open
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

  const { model, body, stream, purpose } = req.body;
  if (!model || !body) return res.status(400).json({ error: "model, body 필수" });

  // ── 일일 사용 한도(서버 강제) ──
  // 관리자는 무제한. 제한 대상 feature만 확인. purpose 없으면 무제한(기존 동작 그대로).
  const feature = limitedFeature(purpose);
  const isAdmin = !!(user.email && ADMIN_EMAILS.includes(String(user.email).toLowerCase()));
  if (feature && !isAdmin) {
    const gate = await checkUsageLimit(req, feature);
    if (gate && gate.blocked) {
      return res.status(429).json({
        rate_limited: true,
        feature,
        used: gate.used,
        limit: gate.limit,
        error: `오늘 사용 한도(${gate.limit}회)에 도달했어요. 내일 다시 이용할 수 있어요.`,
      });
    }
  }

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
