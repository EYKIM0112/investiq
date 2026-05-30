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

    const ETF_BRANDS = ["KODEX","TIGER","ACE","RISE","PLUS","KBSTAR","ARIRANG","HANARO","TIMEFOLIO","SOL","SMART","TREX","KOSEF","KTOP","TIME"];
    const isETF = (name) => ETF_BRANDS.some(b => name.toUpperCase().startsWith(b));

    // ── [1차] 다음(카카오) 금융 ──────────────────────────────
    // 서버사이드에서 Referer 헤더 설정 가능 → 한국어 종목명 반환
    try {
      const url = `https://finance.daum.net/api/search/symbols?q=${encodeURIComponent(q)}&types[]=STOCK&types[]=ETF&perPage=10`;
      const r = await fetch(url, {
        headers: {
          "Referer":         "https://finance.daum.net",
          "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          "Accept":          "application/json, text/plain, */*",
          "Accept-Language": "ko-KR,ko;q=0.9",
        },
        signal: AbortSignal.timeout(8000),
      });
      if (r.ok) {
        const data = await r.json();
        const items = data.data || [];
        if (items.length > 0) {
          const quotes = items.map(item => {
            // symbolCode 예: "A475080" (KOSPI) → 앞 알파벳 제거
            const code    = (item.symbolCode || item.code || "").replace(/^[A-Za-z]/, "");
            const name    = item.name || "";
            const market  = (item.market || "KOSPI").toUpperCase();
            const isKosdaq = market.includes("KOSDAQ");
            return {
              symbol:    code.length === 6 ? code + (isKosdaq ? ".KQ" : ".KS") : "",
              longname:  name,
              shortname: name,
              quoteType: item.type === "ETF" || isETF(name) ? "ETF" : "EQUITY",
              exchDisp:  market,
              exchange:  isKosdaq ? "KQ" : "KS",
            };
          }).filter(x => x.symbol.length >= 9); // "000000.KS" = 9자
          if (quotes.length > 0) {
            console.log(`[daum search] ${quotes.length}건 성공`);
            res.setHeader("Cache-Control", "public, s-maxage=60");
            return res.status(200).json({ quotes, source: "daum" });
          }
        }
      }
    } catch (e) {
      console.warn("[daum search]", e.message);
    }

    // ── [2차] 네이버 모바일 주식검색 ────────────────────────
    // m.stock.naver.com은 현재가 조회에서 이미 동작 확인된 도메인
    try {
      // 모바일 UA + 두 엔드포인트 순차 시도
      const mobileHeaders = {
        "Referer":         "https://m.stock.naver.com",
        "User-Agent":      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
        "Accept":          "application/json",
        "Accept-Language": "ko-KR,ko;q=0.9",
      };
      const naverUrls = [
        `https://m.stock.naver.com/api/stock/search?keyword=${encodeURIComponent(q)}&target=itx,etf`,
        `https://m.stock.naver.com/api/search/all?query=${encodeURIComponent(q)}&type=STOCK,ETF`,
      ];
      for (const url of naverUrls) {
        try {
          const r = await fetch(url, { headers: mobileHeaders, signal: AbortSignal.timeout(7000) });
          if (!r.ok) continue;
          const data = await r.json();
          const stocks = data.stocks || data.result?.assets || data.list || [];
          if (stocks.length > 0) {
            const quotes = stocks.slice(0, 10).map(item => {
              const code     = item.itemCode || item.code || "";
              const name     = item.itemName || item.name || "";
              const exCode   = (item.stockExchangeType?.code || item.exchange || "").toUpperCase();
              const isKosdaq = exCode === "KOE" || exCode.includes("KOSDAQ");
              return {
                symbol:    code.length === 6 ? code + (isKosdaq ? ".KQ" : ".KS") : "",
                longname:  name,
                shortname: name,
                quoteType: isETF(name) ? "ETF" : "EQUITY",
                exchDisp:  isKosdaq ? "KOSDAQ" : "KOSPI",
                exchange:  isKosdaq ? "KQ" : "KS",
              };
            }).filter(x => x.symbol.length >= 9);
            if (quotes.length > 0) {
              console.log(`[naver mobile search] ${quotes.length}건 성공 (${url.includes("all") ? "all" : "stock/search"})`);
              res.setHeader("Cache-Control", "public, s-maxage=60");
              return res.status(200).json({ quotes, source: "naver-mobile" });
            }
          }
        } catch (e) {}
      }
    } catch (e) {
      console.warn("[naver mobile search]", e.message);
    }

    // ── [3차] 네이버 AC (기존 / IP 차단 시 실패) ────────────
    try {
      const url = `https://ac.finance.naver.com/ac?q=${encodeURIComponent(q)}&q_enc=UTF-8&t_koreng=1&st=111&r_lt=111&r_format=json`;
      const r = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Referer":    "https://finance.naver.com/",
          "Accept":     "application/json, text/javascript, */*",
        },
        signal: AbortSignal.timeout(5000),
      });
      if (r.ok) {
        const data = await r.json();
        const items = data.items || [];
        if (items.length > 0) {
          const quotes = items.slice(0, 10).map(item => {
            const name   = item[0] || "";
            const code   = item[1] || "";
            const market = item[2] || "1";
            return {
              symbol:    code + (market === "2" ? ".KQ" : ".KS"),
              longname:  name,
              shortname: name,
              quoteType: isETF(name) ? "ETF" : "EQUITY",
              exchDisp:  market === "2" ? "KOSDAQ" : "KOSPI",
              exchange:  market === "2" ? "KQ" : "KS",
            };
          }).filter(x => x.symbol.length > 3);
          if (quotes.length > 0) {
            console.log(`[naver AC search] ${quotes.length}건 성공`);
            res.setHeader("Cache-Control", "public, s-maxage=60");
            return res.status(200).json({ quotes, source: "naver-ac" });
          }
        }
      }
    } catch (e) {
      console.warn("[naver AC]", e.message);
    }

    return res.status(200).json({ quotes: [] });
  }

  // ── 한국어 종목명 조회 (type=names) ─────────────────────────
  // Yahoo 검색 결과의 코드로 Naver에서 한국어명만 가져옴
  // m.stock.naver.com/api/stock/{code}/basic 은 현재가 조회에서 이미 동작 확인됨
  if (type === "names") {
    if (!codes) return res.status(400).json({ error: "codes required" });
    const codeList = codes.split(",").map(c => c.trim()).filter(c => /^\d{6}$/.test(c)).slice(0, 10);
    const names = {};

    await Promise.allSettled(codeList.map(async (code) => {
      try {
        const r = await fetch(`https://m.stock.naver.com/api/stock/${code}/basic`, {
          headers: {
            "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15",
            "Referer": "https://m.stock.naver.com/",
            "Accept": "application/json",
          },
        });
        if (r.ok) {
          const d = await r.json();
          // stockName, itemName, name 순으로 시도
          const name = d.stockName || d.itemName || d.name
            || d.stockItemTotalInfos?.find(x => x.key === "종목명")?.value
            || null;
          if (name) names[code] = name;
        }
      } catch (e) {}
    }));

    return res.status(200).json({ names });
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
    // [1차] api.finance.naver.com itemSummary
    try {
      const r = await fetch(`https://api.finance.naver.com/service/itemSummary.nhn?itemcode=${code}`, { headers: HEADERS });
      if (r.ok) {
        const data = await r.json();
        const price = Number(data.now);
        if (price > 0) { results[code] = { currentPrice: price, changeRate: Number(data.rate) || 0 }; return; }
      }
    } catch (e) {}

    // [2차] m.stock.naver.com basic API
    try {
      const r = await fetch(`https://m.stock.naver.com/api/stock/${code}/basic`, {
        headers: { ...HEADERS, "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15" },
      });
      if (r.ok) {
        const data = await r.json();
        const price = Number(data.closePrice || data.localTradedAt);
        if (price > 0) { results[code] = { currentPrice: price, changeRate: Number(data.fluctuationsRatio) || 0 }; return; }
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

    // [3차] fchart API
    try {
      const r = await fetch(`https://fchart.stock.naver.com/sise.nhn?symbol=${code}&timeframe=day&count=2&requestType=0`, { headers: HEADERS });
      if (r.ok) {
        const text = await r.text();
        const matches = [...text.matchAll(/\|(\d{8})\|[\d]+\|[\d]+\|[\d]+\|([\d]+)\|/g)];
        if (matches.length >= 1) {
          const latest = matches[matches.length - 1];
          const prev   = matches.length >= 2 ? matches[matches.length - 2] : null;
          const price  = Number(latest[2]);
          const prevP  = prev ? Number(prev[2]) : price;
          const rate   = prevP > 0 ? (price - prevP) / prevP * 100 : 0;
          if (price > 0) { results[code] = { currentPrice: price, changeRate: parseFloat(rate.toFixed(2)) }; return; }
        }
      }
    } catch (e) {}
  }));

  res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
  return res.status(200).json({ results });
}
