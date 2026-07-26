// api/fng.js — CNN Fear & Greed Index 프록시 (미국 증시 공포탐욕지수)
// 목적: 브라우저에서 CNN 데이터를 직접 부르면 CORS·헤더 문제로 막히므로 서버리스로 중계.
//
// 엔드포인트:
//   /api/fng                → 현재값 + 과거 비교(전일/1주/1달/1년) + 최근 히스토리
//
// 근거(실측 확인된 공개 구조):
// - CNN 비공식 데이터 URL: https://production.dataviz.cnn.io/index/fearandgreed/graphdata/
//   (개발자 콘솔에서 노출된 공개 JSON. 여러 오픈소스 라이브러리가 동일 사용)
// - 필수 헤더: User-Agent(브라우저 UA) + Accept: application/json. 없으면 CNN이 거부(403/418).
// - 응답 구조:
//     fear_and_greed: { score, rating, timestamp }
//     fear_and_greed_historical: { data: [{ x: msUnix, y: score, rating }] }
//     previous_close / previous_1_week / previous_1_month / previous_1_year (각 score 포함)
//
// 표시 정책: CNN은 미국 S&P500 기반 7개 지표 종합. 우리는 종합 score(0~100)와 rating만 사용.

export const config = { maxDuration: 20 };

const CNN_URL = "https://production.dataviz.cnn.io/index/fearandgreed/graphdata/";

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
};

// score(0~100) → 표준 5단계 rating. CNN 기준 경계(0-25-45-55-75-100)를 따른다.
function ratingOf(score) {
  const s = Number(score);
  if (!Number.isFinite(s)) return null;
  if (s < 25) return "extreme fear";
  if (s < 45) return "fear";
  if (s <= 55) return "neutral";
  if (s <= 75) return "greed";
  return "extreme greed";
}

function pickScore(node) {
  if (!node || typeof node !== "object") return null;
  const v = Number(node.score);
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const r = await fetch(CNN_URL, { headers: HEADERS, signal: AbortSignal.timeout(12000) });
    if (!r.ok) {
      return res.status(502).json({ error: `CNN HTTP ${r.status}` });
    }
    const d = await r.json().catch(() => null);
    if (!d || !d.fear_and_greed) {
      return res.status(502).json({ error: "CNN 응답 형식 예상과 다름" });
    }

    const now = pickScore(d.fear_and_greed);
    const out = {
      score: now,
      rating: (d.fear_and_greed.rating || ratingOf(now) || "").toString().trim() || null,
      timestamp: d.fear_and_greed.timestamp || null,
      previous_close: pickScore(d.previous_close),
      week_ago: pickScore(d.previous_1_week),
      month_ago: pickScore(d.previous_1_month),
      year_ago: pickScore(d.previous_1_year),
      // 최근 30포인트만 잘라서 스파크라인용으로 전달(전체는 과함)
      history: [],
      source: "cnn",
    };

    const hist = d.fear_and_greed_historical && d.fear_and_greed_historical.data;
    if (Array.isArray(hist)) {
      out.history = hist.slice(-30).map((p) => ({
        t: p.x,
        v: Math.round(Number(p.y) * 100) / 100,
      }));
    }

    res.setHeader("Cache-Control", "public, s-maxage=1800, stale-while-revalidate=3600"); // 30분 캐시
    return res.status(200).json(out);
  } catch (e) {
    if (e.name === "TimeoutError" || e.name === "AbortError") {
      return res.status(504).json({ error: "CNN 응답 시간 초과" });
    }
    return res.status(500).json({ error: e.message || "서버 오류" });
  }
}
