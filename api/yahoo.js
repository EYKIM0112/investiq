// api/yahoo.js - Yahoo Finance 프록시 (Vercel 서버리스)
// 브라우저 CORS 우회용

export default async function handler(req, res) {
  // CORS 헤더
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const { type, ticker, q, region } = req.query;

  try {
    let url;

    if (type === "chart") {
      // 현재가 조회: /api/yahoo?type=chart&ticker=005930.KS
      if (!ticker) return res.status(400).json({ error: "ticker required" });
      url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=10d`;
    } else if (type === "search") {
      // 종목 검색: /api/yahoo?type=search&q=삼성전자&region=KR
      if (!q) return res.status(400).json({ error: "q required" });
      url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=10&newsCount=0&enableFuzzyQuery=false${region ? `&region=${region}&lang=ko-KR` : ""}`;
    } else {
      return res.status(400).json({ error: "type must be 'chart' or 'search'" });
    }

    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json",
        "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
      },
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: `Yahoo Finance returned ${response.status}` });
    }

    const data = await response.json();
    
    // 캐시: 차트는 5분, 검색은 1분
    const maxAge = type === "chart" ? 300 : 60;
    res.setHeader("Cache-Control", `public, s-maxage=${maxAge}, stale-while-revalidate=${maxAge * 2}`);
    
    return res.status(200).json(data);
  } catch (err) {
    console.error("Yahoo proxy error:", err);
    return res.status(500).json({ error: err.message });
  }
}
