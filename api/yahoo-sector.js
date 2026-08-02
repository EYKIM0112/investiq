// api/yahoo-sector.js — Yahoo Finance quoteSummary 프록시: 종목/ETF의 섹터·산업 조회 (실측용)
// 목적: 개별주(국내·해외) 섹터 자동분류 원천 확보. GICS 기반 sector/industry 사용.
//
// 엔드포인트:
//   /api/yahoo-sector?tickers=AAPL                          → 1종목
//   /api/yahoo-sector?tickers=AAPL,NVDA,005930.KS,SPY       → 여러 종목(쉼표구분, 최대 20)
//
// 응답 형태:
//   {
//     results: {
//       "AAPL": { type:"EQUITY", name:"Apple Inc.", sector:"Technology",
//                 industry:"Consumer Electronics", country:"United States",
//                 fundCategory:null, sectorWeights:null },
//       "SPY":  { type:"ETF", name:"SPDR S&P 500", sector:null, industry:null,
//                 fundCategory:"Large Blend",
//                 sectorWeights:{ technology:0.31, financial_services:0.13, ... } }
//     },
//     failed: [...], count: n, crumbUsed: true|false, source:"yahoo"
//   }
//
// 근거/설계:
// - v10 quoteSummary 모듈: assetProfile(sector/industry/country), quoteType(종목종류/이름),
//   fundProfile(categoryName — 펀드/ETF), topHoldings(sectorWeightings — ETF 섹터비중)
// - chart 엔드포인트와 달리 quoteSummary는 쿠키+crumb를 요구할 수 있음 →
//   ① crumb 없이 1차 시도 ② 실패 시 fc.yahoo.com에서 쿠키 획득 → /v1/test/getcrumb로 crumb 발급 후 재시도
//   (crumb 필요 여부는 실측으로 확인. 응답의 crumbUsed로 판별 가능)
// - 국내 종목은 접미사 필요: KOSPI=.KS, KOSDAQ=.KQ (예: 005930.KS, 247540.KQ)

export const config = { maxDuration: 30 };

const Y_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
};

const MODULES = "assetProfile,quoteType,fundProfile,topHoldings,price";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 웜 인스턴스 캐시 (쿠키·crumb는 재사용 가능)
let memCookie = null;
let memCrumb = null;

// fc.yahoo.com → Set-Cookie 획득 → getcrumb 로 crumb 발급
async function ensureCrumb() {
  if (memCookie && memCrumb) return { cookie: memCookie, crumb: memCrumb };
  try {
    const r1 = await fetch("https://fc.yahoo.com", {
      headers: Y_HEADERS,
      redirect: "manual",
      signal: AbortSignal.timeout(8000),
    });
    // Set-Cookie 헤더에서 쿠키 추출 (여러 개일 수 있어 getSetCookie 우선)
    let raw = [];
    if (typeof r1.headers.getSetCookie === "function") raw = r1.headers.getSetCookie();
    else {
      const sc = r1.headers.get("set-cookie");
      if (sc) raw = [sc];
    }
    const cookie = raw.map((c) => String(c).split(";")[0]).filter(Boolean).join("; ");
    if (!cookie) return null;

    const r2 = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
      headers: Object.assign({}, Y_HEADERS, { cookie }),
      signal: AbortSignal.timeout(8000),
    });
    if (!r2.ok) return null;
    const crumb = (await r2.text()).trim();
    if (!crumb || crumb.length > 32) return null;

    memCookie = cookie;
    memCrumb = crumb;
    return { cookie, crumb };
  } catch (e) {
    return null;
  }
}

// quoteSummary 1건 호출. auth=null이면 crumb 없이 시도.
async function callSummary(symbol, auth) {
  const qs = new URLSearchParams({ modules: MODULES });
  if (auth && auth.crumb) qs.set("crumb", auth.crumb);
  const headers = auth && auth.cookie ? Object.assign({}, Y_HEADERS, { cookie: auth.cookie }) : Y_HEADERS;

  const hosts = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"];
  for (const host of hosts) {
    try {
      const url = `https://${host}/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?${qs.toString()}`;
      const r = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
      if (r.status === 401 || r.status === 403) return { needAuth: true };
      if (!r.ok) continue;
      const d = await r.json().catch(() => null);
      if (!d) continue;
      const err = d.quoteSummary && d.quoteSummary.error;
      if (err) {
        const msg = String(err.description || err.code || "");
        if (/crumb|invalid cookie|unauthorized/i.test(msg)) return { needAuth: true };
        continue;
      }
      const res = d.quoteSummary && d.quoteSummary.result;
      if (Array.isArray(res) && res[0]) return { data: res[0] };
    } catch (e) {}
  }
  return null;
}

// topHoldings.sectorWeightings [{technology:0.31}, ...] → {technology:0.31, ...}
function flattenWeights(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const out = {};
  for (const o of arr) {
    if (!o || typeof o !== "object") continue;
    for (const k of Object.keys(o)) {
      const v = o[k];
      const num = typeof v === "object" && v !== null ? Number(v.raw) : Number(v);
      if (Number.isFinite(num) && num > 0) out[k] = num;
    }
  }
  return Object.keys(out).length ? out : null;
}

function shape(d) {
  const ap = d.assetProfile || {};
  const qt = d.quoteType || {};
  const fp = d.fundProfile || {};
  const th = d.topHoldings || {};
  const pr = d.price || {};
  return {
    type: String(qt.quoteType || "").trim() || null,       // EQUITY / ETF / MUTUALFUND
    name: String(qt.longName || qt.shortName || "").trim() || null,
    sector: String(ap.sector || "").trim() || null,        // GICS 기반 11섹터 (개별주)
    industry: String(ap.industry || "").trim() || null,    // 세부 산업
    country: String(ap.country || "").trim() || null,
    currency: String(pr.currency || "").trim() || null,    // 거래 통화(미지원 국가 필터용)
    fundCategory: String(fp.categoryName || "").trim() || null, // ETF/펀드 카테고리
    sectorWeights: flattenWeights(th.sectorWeightings),         // ETF 섹터 비중
  };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const raw = String(req.query.tickers || req.query.ticker || "").trim();
  if (!raw) return res.status(400).json({ error: "tickers 필수 (쉼표구분)" });

  const list = raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 20);
  if (list.length === 0) return res.status(400).json({ error: "유효한 티커 없음" });

  const results = {};
  const failed = [];
  let auth = null;        // 필요해지면 발급
  let crumbUsed = false;

  for (let i = 0; i < list.length; i++) {
    const sym = list[i];
    let out = await callSummary(sym, auth);

    // crumb 필요 판정 시 1회 발급 후 재시도
    if (out && out.needAuth) {
      if (!auth) auth = await ensureCrumb();
      if (auth) {
        crumbUsed = true;
        out = await callSummary(sym, auth);
      }
    }

    if (out && out.data) results[sym] = shape(out.data);
    else failed.push(sym);

    if (i < list.length - 1) await sleep(150);
  }

  res.setHeader("Cache-Control", "public, s-maxage=86400, stale-while-revalidate=604800");
  return res.status(200).json({
    results,
    failed,
    count: Object.keys(results).length,
    crumbUsed,
    source: "yahoo",
  });
}
