// api/naver.js — 네이버 금융 프록시 (검색 + 한국어명 조회 + 현재가)

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { codes, type, q } = req.query;

  // ── [A] 한국 종목 검색 (type=search) ─────────────────────
  if (type === "search") {
    if (!q) return res.status(400).json({ error: "q required" });

    const ETF_BRANDS = ["KODEX","TIGER","ACE","RISE","PLUS","KBSTAR","ARIRANG","HANARO","TIMEFOLIO","SOL","SMART","TREX","KOSEF","KTOP","TIME"];
    const isETF = (name) => ETF_BRANDS.some(b => name.toUpperCase().startsWith(b));

    // 1차: 다음(카카오) 금융
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
            const code     = (item.symbolCode || item.code || "").replace(/^[A-Za-z]/, "");
            const name     = item.name || "";
            const market   = (item.market || "KOSPI").toUpperCase();
            const isKosdaq = market.includes("KOSDAQ");
            return {
              symbol:    code.length === 6 ? code + (isKosdaq ? ".KQ" : ".KS") : "",
              longname:  name,
              shortname: name,
              quoteType: item.type === "ETF" || isETF(name) ? "ETF" : "EQUITY",
              exchDisp:  market,
              exchange:  isKosdaq ? "KQ" : "KS",
            };
          }).filter(x => x.symbol.length >= 9);
          if (quotes.length > 0) {
            console.warn(`[search] daum 성공: ${quotes.length}건`);
            res.setHeader("Cache-Control", "public, s-maxage=60");
            return res.status(200).json({ quotes, source: "daum" });
          }
        }
      }
    } catch (e) {
      console.warn(`[search] daum 실패: ${e.message}`);
    }

    // 2차: 네이버 모바일 검색
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
            console.warn(`[search] naver-mobile 성공: ${quotes.length}건`);
            res.setHeader("Cache-Control", "public, s-maxage=60");
            return res.status(200).json({ quotes, source: "naver-mobile" });
          }
        }
      } catch (e) {
        console.warn(`[search] naver-mobile 실패 (${url.includes("all")?"all":"search"}): ${e.message}`);
      }
    }

    // 3차: 네이버 AC
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
            const name = item[0] || "", code = item[1] || "", market = item[2] || "1";
            return {
              symbol:    code + (market === "2" ? ".KQ" : ".KS"),
              longname:  name,
              shortname: name,
              quoteType: isETF(name) ? "ETF" : "EQUITY",
              exchDisp:  market === "2" ? "KOSDAQ" : "KOSPI",
              exchange:  market === "2" ? "KQ" : "KS",
            };
          }).filter(x => x.symbol.length >= 9);
          if (quotes.length > 0) {
            console.warn(`[search] naver-ac 성공: ${quotes.length}건`);
            res.setHeader("Cache-Control", "public, s-maxage=60");
            return res.status(200).json({ quotes, source: "naver-ac" });
          }
        }
      }
    } catch (e) {
      console.warn(`[search] naver-ac 실패: ${e.message}`);
    }

    console.warn(`[search] 전체 실패 — quotes:[]`);
    return res.status(200).json({ quotes: [] });
  }

  // ── [B] 한국어 종목명 조회 (type=names) ──────────────────
  // Yahoo 검색으로 받은 영어명을 한국어로 교체하는 용도
  if (type === "names") {
    if (!codes) return res.status(400).json({ error: "codes required" });
    const codeList = codes.split(",").map(c => c.trim()).filter(c => /^\d{6}$/.test(c)).slice(0, 10);
    if (!codeList.length) return res.status(200).json({ names: {} });

    const names = {};
    const BASE_HEADERS = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Referer":    "https://finance.naver.com/",
      "Accept-Language": "ko-KR,ko;q=0.9",
    };

    await Promise.allSettled(codeList.map(async (code, idx) => {

      // 1차: api.finance.naver.com/service/itemSummary — 가격조회에서 이미 작동 확인됨
      try {
        const r = await fetch(`https://api.finance.naver.com/service/itemSummary.nhn?itemcode=${code}`, {
          headers: { ...BASE_HEADERS, "Accept": "application/json, text/javascript, */*" },
          signal: AbortSignal.timeout(4000),
        });
        if (r.ok) {
          const d = await r.json();
          // 첫 번째 코드의 전체 응답을 warn으로 기록 → Vercel 로그에 필드명 보임
          if (idx === 0) console.warn(`[names-debug] itemSummary raw: ${JSON.stringify(d)}`);
          const name = d.hname || d.itemname || d.stockName || d.name || d.korName;
          if (name) {
            console.warn(`[names] ${code} ✅ itemSummary → "${name}"`);
            names[code] = name;
            return;
          }
          console.warn(`[names] ${code} itemSummary 응답 있지만 이름 없음`);
        } else {
          console.warn(`[names] ${code} itemSummary HTTP ${r.status}`);
        }
      } catch (e) {
        console.warn(`[names] ${code} itemSummary 오류: ${e.message}`);
      }

      // 2차: m.stock.naver.com/api/stock/{code}/basic — 가격조회에서 이미 작동 확인됨
      try {
        const r = await fetch(`https://m.stock.naver.com/api/stock/${code}/basic`, {
          headers: {
            "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15",
            "Referer":    "https://m.stock.naver.com/",
            "Accept":     "application/json",
          },
          signal: AbortSignal.timeout(4000),
        });
        if (r.ok) {
          const d = await r.json();
          if (idx === 0) console.warn(`[names-debug] basic raw: ${JSON.stringify(d).slice(0, 500)}`);
          const direct = d.stockName || d.itemName || d.hname || d.name;
          if (direct) {
            console.warn(`[names] ${code} ✅ basic → "${direct}"`);
            names[code] = direct;
            return;
          }
          // stockItemTotalInfos 배열 탐색
          const infos = d.stockItemTotalInfos || [];
          const nameEntry = infos.find(x => x.key?.includes("명"));
          if (nameEntry?.value) {
            console.warn(`[names] ${code} ✅ basic infos → "${nameEntry.value}"`);
            names[code] = nameEntry.value;
            return;
          }
          console.warn(`[names] ${code} basic 응답 있지만 이름 없음. keys=${Object.keys(d).join(",")}`);
        } else {
          console.warn(`[names] ${code} basic HTTP ${r.status}`);
        }
      } catch (e) {
        console.warn(`[names] ${code} basic 오류: ${e.message}`);
      }

      // 3차: finance.naver.com HTML title 파싱
      try {
        const r = await fetch(`https://finance.naver.com/item/main.naver?code=${code}`, {
          headers: { ...BASE_HEADERS, "Accept": "text/html,application/xhtml+xml" },
          signal: AbortSignal.timeout(5000),
        });
        if (r.ok) {
          const html = await r.text();
          // <title>KODEX 소비재 주식 - 네이버 금융</title>
          const m = html.match(/<title[^>]*>([^<]+?)\s+주식/);
          if (m?.[1]?.trim()) {
            console.warn(`[names] ${code} ✅ HTML → "${m[1].trim()}"`);
            names[code] = m[1].trim();
            return;
          }
          console.warn(`[names] ${code} HTML 매칭 실패. snippet=${html.slice(0, 300)}`);
        } else {
          console.warn(`[names] ${code} HTML HTTP ${r.status}`);
        }
      } catch (e) {
        console.warn(`[names] ${code} HTML 오류: ${e.message}`);
      }
    }));

    console.warn(`[names] 최종 결과: ${JSON.stringify(names)}`);
    return res.status(200).json({ names });
  }

  // ── [C] 현재가 조회 (codes=...) ──────────────────────────
  if (!codes) return res.status(400).json({ error: "codes or type=search required" });

  const codeList = codes.split(",")
    .map(c => c.trim())
    .filter(c => /^\d{6}$/.test(c));
  if (!codeList.length) return res.status(400).json({ error: "invalid codes" });

  const HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Referer":    "https://finance.naver.com/",
    "Accept":     "application/json, text/javascript, */*",
  };

  const results = {};

  await Promise.allSettled(codeList.map(async (code) => {
    // 1차: api.finance.naver.com itemSummary
    try {
      const r = await fetch(`https://api.finance.naver.com/service/itemSummary.nhn?itemcode=${code}`, { headers: HEADERS });
      if (r.ok) {
        const data = await r.json();
        const price = Number(data.now);
        if (price > 0) { results[code] = { currentPrice: price, changeRate: Number(data.rate) || 0 }; return; }
      }
    } catch (e) {}

    // 2차: m.stock.naver.com basic API
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

    // 3차: fchart API
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
