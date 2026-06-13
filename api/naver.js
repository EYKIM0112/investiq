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

    const BASE_HDRS = {
      "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Referer":         "https://finance.naver.com/",
      "Accept-Language": "ko-KR,ko;q=0.9",
    };

    // 1차: finance.naver.com/search/searchList.nhn — HTML 스크래핑
    // ac.finance.naver.com(차단)과 다른 경로, 일반 HTML 페이지라 차단 가능성 낮음
    try {
      const url = `https://finance.naver.com/search/searchList.nhn?query=${encodeURIComponent(q)}`;
      const r = await fetch(url, {
        headers: { ...BASE_HDRS, "Accept": "text/html,application/xhtml+xml" },
        signal: AbortSignal.timeout(8000),
      });
      if (r.ok) {
        const html = await r.text();
        // <a href="/item/main.naver?code=475080">KODEX 코리아밸류업</a>
        const matches = [...html.matchAll(/href="\/item\/main\.naver\?code=(\d{6})"[^>]*>([^<]{2,50})<\/a>/g)];
        if (matches.length > 0) {
          const seen = new Set();
          const items = [];
          for (const m of matches) {
            const code = m[1], name = m[2].trim();
            if (!seen.has(code) && name.length >= 2 && !/^[0-9,]+$/.test(name)) {
              seen.add(code);
              // HTML 앞뒤 500자에서 코스닥 여부 확인
              const idx = html.indexOf(`code=${code}`);
              const ctx = idx >= 0 ? html.slice(Math.max(0,idx-200), idx+300) : "";
              const isKosdaq = ctx.includes("코스닥") || ctx.includes("KOSDAQ");
              items.push({ code, name, isKosdaq });
            }
          }
          if (items.length > 0) {
            const quotes = items.slice(0, 10).map(item => ({
              symbol:    item.code + (item.isKosdaq ? ".KQ" : ".KS"),
              longname:  item.name,
              shortname: item.name,
              quoteType: isETF(item.name) ? "ETF" : "EQUITY",
              exchDisp:  item.isKosdaq ? "KOSDAQ" : "KOSPI",
              exchange:  item.isKosdaq ? "KQ" : "KS",
            }));
            console.warn(`[search] naver-html 성공: ${quotes.length}건`);
            res.setHeader("Cache-Control", "public, s-maxage=60");
            return res.status(200).json({ quotes, source: "naver-html" });
          }
          console.warn(`[search] naver-html: match ${matches.length}건이지만 유효 결과 없음`);
        } else {
          console.warn(`[search] naver-html: 매칭 없음. snippet=${html.slice(0,300)}`);
        }
      } else {
        console.warn(`[search] naver-html HTTP ${r.status}`);
      }
    } catch (e) {
      console.warn(`[search] naver-html 실패: ${e.message}`);
    }

    // 2차: 다음(카카오) 금융
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

    // 최후 수단: Gemini + Google Search
    // process.env.GEMINI_API_KEY는 이미 Vercel에 설정됨
    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey) {
      try {
        const prompt = `한국 주식시장 종목 검색: "${q}"\n이 검색어와 일치하는 KRX(한국거래소) 상장 종목을 찾아줘.\n반드시 JSON 배열만 출력 (다른 텍스트, 마크다운 없이):\n[{"code":"6자리종목코드","name":"정확한한국어종목명","market":"KOSPI 또는 KOSDAQ"}]\n최대 6개.`;
        const gRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              tools: [{ "google_search": {} }],
              generationConfig: { temperature: 0.1, maxOutputTokens: 512 },
            }),
            signal: AbortSignal.timeout(12000),
          }
        );
        if (gRes.ok) {
          const gd = await gRes.json();
          const text = gd.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("") || "";
          const jsonMatch = text.match(/\[[\s\S]*?\]/);
          if (jsonMatch) {
            const items = JSON.parse(jsonMatch[0]);
            const quotes = items
              .filter(i => i.code && /^\d{6}$/.test(String(i.code)))
              .map(i => {
                const isKosdaq = String(i.market || "").includes("KOSDAQ");
                return {
                  symbol:    String(i.code) + (isKosdaq ? ".KQ" : ".KS"),
                  longname:  i.name || "",
                  shortname: i.name || "",
                  quoteType: isETF(i.name || "") ? "ETF" : "EQUITY",
                  exchDisp:  isKosdaq ? "KOSDAQ" : "KOSPI",
                  exchange:  isKosdaq ? "KQ" : "KS",
                };
              });
            if (quotes.length > 0) {
              console.warn(`[search] gemini 성공: ${quotes.length}건`);
              res.setHeader("Cache-Control", "no-store");
              return res.status(200).json({ quotes, source: "gemini" });
            }
          }
          console.warn(`[search] gemini 응답 파싱 실패. text=${text.slice(0,200)}`);
        } else {
          console.warn(`[search] gemini HTTP ${gRes.status}`);
        }
      } catch (e) {
        console.warn(`[search] gemini 실패: ${e.message}`);
      }
    }

    console.warn(`[search] 전체 실패 — quotes:[]`);
    res.setHeader("Cache-Control", "no-store");
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

  // ── [D] 지수 조회 (type=index) ───────────────────────────
  // 용도: 야후 meta.previousClose가 한국·아시아 지수에서 부정확 → 네이버로 대체.
  // 호출: ?type=index&code=KOSPI            (단일)
  //       ?type=index&code=KOSPI,KOSDAQ     (복수)
  //       ?type=index&code=KOSPI&debug=1    (원시 응답 _debug에 같이 반환 — 필드명 확정용)
  // 해외지수도 네이버 고유 심볼만 알면 같은 경로로 동작 (예: .IXIC, NII@NI225 — 미확정).
  // 응답: { results: { KOSPI: { value:Number, changeRate:Number|null, weekChange:Number|null } } }
  //   value      = 현재가
  //   changeRate = 일간 등락률(%)  ← basic API가 직접 제공
  //   weekChange = 주간 등락률(%)  ← price 이력(5거래일 전 종가) 대비 계산
  if (type === "index") {
    const code = req.query.code;
    if (!code) return res.status(400).json({ error: "code required (예: KOSPI)" });
    const debug = req.query.debug === "1";
    const idxList = code.split(",").map(c => c.trim()).filter(Boolean).slice(0, 12);

    const IDX_HDRS = {
      "User-Agent":      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      "Referer":         "https://m.stock.naver.com/",
      "Accept":          "application/json",
      "Accept-Language": "ko-KR,ko;q=0.9",
    };

    const idxResults = {};
    const rawDump    = {};

    await Promise.allSettled(idxList.map(async (idxCode, i) => {
      // 네이버 지수 응답은 closePrice 등이 "8,123.62" 처럼 쉼표 포함 문자열 → 쉼표 제거 후 Number
      const num = (v) => Number(String(v ?? "").replace(/,/g, "")) || 0;
      const enc = encodeURIComponent(idxCode);
      // 국내지수: m.stock.naver.com/api/index/{KOSPI|KOSDAQ}
      // 해외지수: api.stock.naver.com/index/{로이터코드 예 .IXIC} (필드명은 국내와 동일)
      // → 둘 다 시도해 먼저 되는 경로 사용
      const tryFetch = async (paths) => {
        for (const url of paths) {
          try {
            const r = await fetch(url, { headers: IDX_HDRS, signal: AbortSignal.timeout(7000) });
            if (r.ok) { const d = await r.json(); return { d, url }; }
            console.warn(`[index] ${idxCode} HTTP ${r.status} ${url}`);
          } catch (e) { console.warn(`[index] ${idxCode} ${e.message} ${url}`); }
        }
        return null;
      };

      // 1. basic — 현재가 + 일간 등락률 (확정 필드: closePrice, fluctuationsRatio)
      let cur = 0, rate = null;
      const basicRes = await tryFetch([
        `https://m.stock.naver.com/api/index/${enc}/basic`,
        `https://api.stock.naver.com/index/${enc}/basic`,
      ]);
      if (basicRes) {
        const d = basicRes.d;
        if (debug || i === 0) console.warn(`[index-debug] ${idxCode} basic(${basicRes.url}): ${JSON.stringify(d).slice(0, 700)}`);
        if (debug) rawDump[idxCode] = { basicUrl: basicRes.url, basic: d };
        cur = num(d.closePrice);
        // fluctuationsRatio는 부호 포함 문자열("-4.52"). 값이 있으면 그대로, 없으면 null
        rate = (d.fluctuationsRatio != null && d.fluctuationsRatio !== "") ? num(d.fluctuationsRatio) : null;
      }

      // 2. price — 5거래일 전(=1주일 전) 종가 대비 주간 등락률.
      // 응답은 최신순 배열: index 0=당일, index 5=5거래일 전(같은 요일 1주 전).
      let weekChange = null;
      const priceRes = await tryFetch([
        `https://m.stock.naver.com/api/index/${enc}/price?pageSize=7&page=1`,
        `https://api.stock.naver.com/index/${enc}/price?pageSize=7&page=1`,
      ]);
      if (priceRes) {
        const d = priceRes.d;
        if (debug || i === 0) console.warn(`[index-debug] ${idxCode} price(${priceRes.url}): ${JSON.stringify(d).slice(0, 700)}`);
        if (debug) rawDump[idxCode] = { ...(rawDump[idxCode] || {}), priceUrl: priceRes.url, price: d };
        const arr = Array.isArray(d) ? d : (d.priceList || d.prices || d.list || []);
        const closes = arr.map(x => num(x.closePrice)).filter(v => v > 0);
        if (closes.length >= 2 && cur > 0) {
          const weekAgo = closes.length > 5 ? closes[5] : closes[closes.length - 1];
          if (weekAgo > 0) weekChange = Number(((cur - weekAgo) / weekAgo * 100).toFixed(2));
        }
      }

      if (cur > 0) idxResults[idxCode] = { value: cur, changeRate: rate, weekChange };
    }));

    console.warn(`[index] 최종 결과: ${JSON.stringify(idxResults)}`);
    res.setHeader("Cache-Control", debug ? "no-store" : "public, s-maxage=180, stale-while-revalidate=300");
    const out = { results: idxResults };
    if (debug) out._debug = rawDump;
    return res.status(200).json(out);
  }

  // ── [E] 시장지표 조회 (type=marketindex) ─────────────────
  // 환율·금은 지수가 아니라 finance.naver.com/marketindex (응답이 HTML 표) → 파싱.
  // 호출: ?type=marketindex&code=FX_USDKRW,CMDT_GC  (+&debug=1)
  //   FX_   → exchangeDailyQuote (매매기준율)
  //   CMDT_ → worldDailyQuote (fdtc=2, 종가)
  // 파싱: 각 행에서 "날짜(YYYY.MM.DD) 뒤 첫 숫자" = 종가 (소수 유무 무관, td 클래스명 비의존).
  // 응답: { results: { FX_USDKRW:{value,changeRate,weekChange}, CMDT_GC:{...} } }
  if (type === "marketindex") {
    const code = req.query.code;
    if (!code) return res.status(400).json({ error: "code required (예: FX_USDKRW)" });
    const debug = req.query.debug === "1";
    const miList = code.split(",").map(c => c.trim()).filter(Boolean).slice(0, 8);

    const MI_HDRS = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Referer":    "https://finance.naver.com/marketindex/",
      "Accept":     "text/html,application/xhtml+xml,*/*",
    };
    const buildUrl = (c) => {
      if (c.startsWith("FX_"))   return `https://finance.naver.com/marketindex/exchangeDailyQuote.naver?marketindexCd=${encodeURIComponent(c)}&page=1`;
      if (c.startsWith("CMDT_")) return `https://finance.naver.com/marketindex/worldDailyQuote.naver?marketindexCd=${encodeURIComponent(c)}&fdtc=2&page=1`;
      return null;
    };

    const miResults = {};
    const rawDump   = {};

    await Promise.allSettled(miList.map(async (c, i) => {
      const url = buildUrl(c);
      if (!url) { console.warn(`[marketindex] ${c} 알 수 없는 코드(FX_/CMDT_ 접두 필요)`); return; }
      try {
        const r = await fetch(url, { headers: MI_HDRS, signal: AbortSignal.timeout(7000) });
        if (!r.ok) { console.warn(`[marketindex] ${c} HTTP ${r.status}`); return; }
        const html = await r.text();
        if (debug || i === 0) console.warn(`[marketindex-debug] ${c}: ${html.replace(/\s+/g, " ").slice(0, 400)}`);
        if (debug) rawDump[c] = html.replace(/\s+/g, " ").slice(0, 1500);
        // 행마다 날짜 뒤 첫 숫자 추출 (FX=매매기준율, CMDT=종가). 소수 유무 무관 → 정수 값도 안전. 최신순 배열.
        const closes = [];
        for (const row of html.split(/<tr[\s>]/i)) {
          const plain = row.replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/gi, " ");
          const dm = plain.match(/\d{4}\.\d{2}\.\d{2}/);
          if (!dm) continue;
          const after = plain.slice(plain.indexOf(dm[0]) + dm[0].length);
          const nm = after.match(/\d[\d,]*(?:\.\d+)?/);
          if (!nm) continue;
          const v = Number(nm[0].replace(/,/g, ""));
          if (v > 0) closes.push(v);
        }
        if (closes.length >= 1) {
          const cur     = closes[0];
          const prev    = closes[1] || 0;
          const weekAgo = closes.length > 5 ? closes[5] : closes[closes.length - 1];
          const changeRate = prev > 0 ? Number(((cur - prev) / prev * 100).toFixed(2)) : null;
          const weekChange = (closes.length >= 2 && weekAgo > 0) ? Number(((cur - weekAgo) / weekAgo * 100).toFixed(2)) : null;
          miResults[c] = { value: cur, changeRate, weekChange };
        }
      } catch (e) {
        console.warn(`[marketindex] ${c} 오류: ${e.message}`);
      }
    }));

    console.warn(`[marketindex] 최종: ${JSON.stringify(miResults)}`);
    res.setHeader("Cache-Control", debug ? "no-store" : "public, s-maxage=300, stale-while-revalidate=600");
    const out2 = { results: miResults };
    if (debug) out2._debug = rawDump;
    return res.status(200).json(out2);
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
