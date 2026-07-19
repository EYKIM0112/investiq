// api/yahoo.js - Yahoo Finance 프록시 (Vercel 서버리스)
// 브라우저 CORS 우회용

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  const { type, ticker, q, region } = req.query;

  const HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
    "Referer": "https://finance.yahoo.com/",
  };

  try {
    if (type === "chart") {
      if (!ticker) return res.status(400).json({ error: "ticker required" });

      // 기본 10d/1d, 필요 시 range/interval 지정 가능 (벤치마크 등 장기 조회용)
      const chartRange = req.query.range || "10d";
      const chartInterval = req.query.interval || "1d";

      // query1, query2 순서로 시도
      const hosts = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"];
      let data = null;
      for (const host of hosts) {
        try {
          const url = `https://${host}/v8/finance/chart/${encodeURIComponent(ticker)}?interval=${encodeURIComponent(chartInterval)}&range=${encodeURIComponent(chartRange)}`;
          const r = await fetch(url, { headers: HEADERS });
          if (r.ok) { data = await r.json(); break; }
        } catch(e) {}
      }
      if (!data) return res.status(502).json({ error: "Yahoo Finance unavailable" });

      res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
      return res.status(200).json(data);

    } else if (type === "dividends") {
      // 과거 분배금(배당) 이력 — events=div 로 실제 지급 날짜+금액 반환
      if (!ticker) return res.status(400).json({ error: "ticker required" });

      const rangeParam = req.query.range || "3y"; // 기본 3년 이력
      const hosts = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"];
      let data = null;
      for (const host of hosts) {
        try {
          const url = `https://${host}/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=${encodeURIComponent(rangeParam)}&events=div`;
          const r = await fetch(url, { headers: HEADERS });
          if (r.ok) { data = await r.json(); break; }
        } catch(e) {}
      }
      if (!data) return res.status(502).json({ error: "Yahoo Finance unavailable" });

      // 분배금 이벤트만 추출해서 가공 (원본 chart는 용량이 커서 필요한 것만)
      const result = data.chart?.result?.[0];
      const divEvents = result?.events?.dividends || {};
      const meta = result?.meta || {};
      const dividends = Object.values(divEvents)
        .map(d => ({ date: d.date, amount: d.amount }))   // date=unix초, amount=주당 분배금
        .filter(d => d.date && d.amount > 0)
        .sort((a, b) => a.date - b.date);

      res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=7200");
      return res.status(200).json({
        ticker,
        currency: meta.currency || null,
        currentPrice: meta.regularMarketPrice || null,
        dividends,
      });

    } else if (type === "search") {
      if (!q) return res.status(400).json({ error: "q required" });

      const regionParam = region ? `&region=${region}&lang=ko-KR` : "";
      const runSearch = async (term) => {
        try {
          const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(term)}&quotesCount=10&newsCount=0&enableFuzzyQuery=false${regionParam}`;
          const rr = await fetch(url, { headers: HEADERS });
          if (!rr.ok) return null;
          return await rr.json();
        } catch (e) {
          return null;
        }
      };

      // 클래스주 티커 표기 보정 — 국내 증권사/KIS는 BRK/B·BRK.B로 쓰지만 Yahoo는 BRK-B를 쓴다.
      // 해외 거래소 접미사(BP.L·7203.T 등)와 충돌하지 않도록 점(.) 변환은 클래스 표기 A/B/C/K에만 적용.
      const orig = String(q).trim();
      const alt = orig.toUpperCase()
        .replace(/\//g, "-")
        .replace(/^([A-Z]{1,5})\.([ABCK])$/, "$1-$2");

      let data;
      if (alt !== orig.toUpperCase()) {
        // 표기 보정이 필요한 검색어 → 원본·보정본을 함께 조회하고 병합(보정본 우선).
        // 조건부 재시도로는 원본이 엉뚱한 결과를 1건이라도 주면 보정이 건너뛰어져 실패한다.
        const [dOrig, dAlt] = await Promise.all([runSearch(orig), runSearch(alt)]);
        const merged = [];
        const seen = new Set();
        for (const d of [dAlt, dOrig]) {
          for (const it of (d && Array.isArray(d.quotes) ? d.quotes : [])) {
            const key = String(it.symbol || "").toUpperCase();
            if (!key || seen.has(key)) continue;
            seen.add(key);
            merged.push(it);
          }
        }
        data = { ...(dAlt || dOrig || {}), quotes: merged, _altQuery: alt };
      } else {
        data = await runSearch(orig);
      }

      if (!data) return res.status(502).json({ error: "Yahoo search unavailable" });

      res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=120");
      return res.status(200).json(data);

    } else {
      return res.status(400).json({ error: "type must be 'chart', 'dividends', or 'search'" });
    }
  } catch (err) {
    console.error("Yahoo proxy error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
