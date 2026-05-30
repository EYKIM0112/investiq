// api/naver.js - 네이버 금융 현재가 + 종목 검색 프록시 (Vercel 서버리스)

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { codes, type, q } = req.query;

  // ── 한국 종목 검색 ────────────────────────────────────────
  if (type === "search") {
    if (!q) return res.status(400).json({ error: "q required" });
    const ETF_BRANDS = ["KODEX","TIGER","ACE","RISE","PLUS","KBSTAR","ARIRANG","HANARO","TIMEFOLIO","SOL","SMART","TREX","KOSEF","KTOP"];
    try {
      const url = `https://ac.finance.naver.com/ac?q=${encodeURIComponent(q)}&q_enc=UTF-8&t_koreng=1&st=111&r_lt=111&r_format=json`;
      const r = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Referer": "https://finance.naver.com/",
          "Accept": "application/json, text/javascript, */*",
        },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      // items: [[name, code, marketType, ...], ...]  marketType: "1"=KOSPI, "2"=KOSDAQ
      const quotes = (data.items || []).slice(0, 8).map(item => {
        const name   = item[0] || "";
        const code   = item[1] || "";
        const market = item[2] || "1";
        const suffix = market === "2" ? ".KQ" : ".KS";
        const symbol = code + suffix;
        const upper  = name.toUpperCase();
        const isETF  = ETF_BRANDS.some(b => upper.startsWith(b));
        return {
          symbol,
          longname:  name,
          shortname: name,
          quoteType: isETF ? "ETF" : "EQUITY",
          exchDisp:  market === "2" ? "KOSDAQ" : "KOSPI",
          exchange:  market === "2" ? "KQ"     : "KS",
        };
      }).filter(item => item.symbol.length > 3);
      res.setHeader("Cache-Control", "public, s-maxage=60");
      return res.status(200).json({ quotes });
    } catch (e) {
      return res.status(500).json({ error: e.message, quotes: [] });
    }
  }

  // ── 현재가 조회 ───────────────────────────────────────────
  if (!codes) return res.status(400).json({ error: "codes or type=search required" });

  const codeList = codes.split(",")
    .map(c => c.trim())
    .filter(c => /^\d{6}$/.test(c));
  if (!codeList.length) return res.status(400).json({ error: "invalid codes" });

  const HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Referer": "https://finance.naver.com/",
    "Accept": "application/json, text/javascript, */*",
  };

  const results = {};

  await Promise.allSettled(codeList.map(async (code) => {
    // [1차] api.finance.naver.com itemSummary - 가장 심플한 JSON
    try {
      const url = `https://api.finance.naver.com/service/itemSummary.nhn?itemcode=${code}`;
      const r = await fetch(url, { headers: HEADERS });
      if (r.ok) {
        const data = await r.json();
        const price = Number(data.now);
        if (price > 0) {
          results[code] = { currentPrice: price, changeRate: Number(data.rate) || 0 };
          return;
        }
      }
    } catch (e) {}

    // [2차] m.stock.naver.com basic API
    try {
      const url = `https://m.stock.naver.com/api/stock/${code}/basic`;
      const r = await fetch(url, {
        headers: { ...HEADERS, "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15" },
      });
      if (r.ok) {
        const data = await r.json();
        const price = Number(data.closePrice || data.localTradedAt);
        if (price > 0) {
          results[code] = { currentPrice: price, changeRate: Number(data.fluctuationsRatio) || 0 };
          return;
        }
        const infos = data.stockItemTotalInfos || [];
        const pi = infos.find(x => ["현재가","시세"].includes(x.key));
        if (pi) {
          const p = parseInt(String(pi.value || "").replace(/[^0-9]/g, ""));
          if (p > 0) {
            const ri = infos.find(x => x.key === "등락률");
            results[code] = { currentPrice: p, changeRate: ri ? parseFloat(String(ri.value).replace(/[^0-9.-]/g, "")) : 0 };
            return;
          }
        }
      }
    } catch (e) {}

    // [3차] fchart (시세 차트 API) - 마지막 종가
    try {
      const url = `https://fchart.stock.naver.com/sise.nhn?symbol=${code}&timeframe=day&count=2&requestType=0`;
      const r = await fetch(url, { headers: HEADERS });
      if (r.ok) {
        const text = await r.text();
        const matches = [...text.matchAll(/\|(\d{8})\|[\d]+\|[\d]+\|[\d]+\|([\d]+)\|/g)];
        if (matches.length >= 1) {
          const latest = matches[matches.length - 1];
          const prev   = matches.length >= 2 ? matches[matches.length - 2] : null;
          const price  = Number(latest[2]);
          const prevP  = prev ? Number(prev[2]) : price;
          const rate   = prevP > 0 ? (price - prevP) / prevP * 100 : 0;
          if (price > 0) {
            results[code] = { currentPrice: price, changeRate: parseFloat(rate.toFixed(2)) };
            return;
          }
        }
      }
    } catch (e) {}
  }));

  res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
  return res.status(200).json({ results });
}
