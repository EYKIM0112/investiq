// Vercel 서버리스 함수 - Gemini API 프록시
// API 키는 Vercel 환경변수(GEMINI_API_KEY)에만 저장, 클라이언트에 절대 노출 안 됨

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

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
