// api/fng.js — CNN Fear & Greed Index 프록시 (미국 증시 공포탐욕지수)
// 목적: 브라우저에서 CNN 데이터를 직접 부르면 CORS·헤더 문제로 막히므로 서버리스로 중계.
//
// 엔드포인트:
//   /api/fng   → 현재값 + 과거 비교(전일/1주/1달/1년) + 스파크라인용 히스토리
//
// 근거(실측):
// - CNN 공개 JSON: https://production.dataviz.cnn.io/index/fearandgreed/graphdata/
//   필수 헤더: User-Agent(브라우저) + Accept. 없으면 거부.
// - 응답: fear_and_greed:{score,rating,timestamp},
//         fear_and_greed_historical:{data:[{x:msUnix, y:score, rating}]}
// - 실측 확인: previous_close/previous_1_week 등 상위 키는 현재 null로 옴 →
//   과거 비교값은 상위 키에 의존하지 않고 historical.data에서 직접 계산한다(더 견고).
// - rating 밴드(CNN 공식): <25 extreme fear / <45 fear / <55 neutral / <75 greed / >=75 extreme greed

export const config = { maxDuration: 20 };

const CNN_URL = "https://production.dataviz.cnn.io/index/fearandgreed/graphdata/";

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
};

function ratingOf(score) {
  const s = Number(score);
  if (!Number.isFinite(s)) return null;
  if (s < 25) return "extreme fear";
  if (s < 45) return "fear";
  if (s < 55) return "neutral";
  if (s < 75) return "greed";
  return "extreme greed";
}

const round2 = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v) * 100) / 100 : null);

// data(오름차순, [{x:ms,y}]) 에서 'targetMs 이전 중 가장 가까운' 값을 찾는다.
function valueAtOrBefore(data, targetMs) {
  let best = null;
  for (const p of data) {
    if (p.x <= targetMs) best = p;
    else break;
  }
  return best ? round2(best.y) : null;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const r = await fetch(CNN_URL, { headers: HEADERS, signal: AbortSignal.timeout(12000) });
    if (!r.ok) return res.status(502).json({ error: "CNN HTTP " + r.status });

    const d = await r.json().catch(() => null);
    if (!d || !d.fear_and_greed) return res.status(502).json({ error: "CNN 응답 형식 예상과 다름" });

    const now = round2(d.fear_and_greed.score);
    const data = (d.fear_and_greed_historical && Array.isArray(d.fear_and_greed_historical.data))
      ? d.fear_and_greed_historical.data.filter((p) => p && Number.isFinite(p.x) && Number.isFinite(Number(p.y)))
      : [];

    const lastMs = data.length ? data[data.length - 1].x : Date.now();
    const DAY = 86400000;

    // 과거 비교: 상위 키가 있으면 우선 쓰고(향후 CNN이 복구할 수도 있음), 없으면 history로 역산.
    const topClose = d.previous_close && round2(d.previous_close.score);
    const topWeek = d.previous_1_week && round2(d.previous_1_week.score);
    const topMonth = d.previous_1_month && round2(d.previous_1_month.score);
    const topYear = d.previous_1_year && round2(d.previous_1_year.score);

    const out = {
      score: now,
      rating: (d.fear_and_greed.rating || ratingOf(now) || "").toString().trim() || null,
      timestamp: d.fear_and_greed.timestamp || null,
      previous_close: topClose != null ? topClose : (data.length >= 2 ? round2(data[data.length - 2].y) : null),
      week_ago: topWeek != null ? topWeek : valueAtOrBefore(data, lastMs - 7 * DAY),
      month_ago: topMonth != null ? topMonth : valueAtOrBefore(data, lastMs - 30 * DAY),
      year_ago: topYear != null ? topYear : valueAtOrBefore(data, lastMs - 365 * DAY),
      // 스파크라인용: 최근 ~3개월(약 90일)만, 최대 60포인트로 솎아서 전달
      history: [],
      source: "cnn",
    };

    if (data.length) {
      const cutoff = lastMs - 92 * DAY;
      let recent = data.filter((p) => p.x >= cutoff);
      if (recent.length > 60) {
        const step = Math.ceil(recent.length / 60);
        recent = recent.filter((_, i) => i % step === 0 || i === recent.length - 1);
      }
      out.history = recent.map((p) => ({ t: p.x, v: round2(p.y) }));
    }

    res.setHeader("Cache-Control", "public, s-maxage=1800, stale-while-revalidate=3600");
    return res.status(200).json(out);
  } catch (e) {
    if (e.name === "TimeoutError" || e.name === "AbortError") {
      return res.status(504).json({ error: "CNN 응답 시간 초과" });
    }
    return res.status(500).json({ error: e.message || "서버 오류" });
  }
}
