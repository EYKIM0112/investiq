// api/kis-sector.js — 한국투자증권(KIS) OpenAPI 프록시: 국내 종목의 '업종명' 조회
// 목적: 개별주 섹터 자동분류를 위한 원천 데이터 확보(실측용).
//   KIS 현재가 단일조회 응답의 bstp_kor_isnm(업종 한글명, 예: "전기.전자")을 사용.
//
// 엔드포인트:
//   /api/kis-sector?codes=005930                       → 1종목
//   /api/kis-sector?codes=005930,000660,000270         → 여러 종목(쉼표구분, 최대 40)
//
// 응답 형태:
//   {
//     results: {
//       "005930": { name:"삼성전자", sector:"전기.전자", market:"KOSPI200",
//                   capCls:"...", price: 71000 }
//     },
//     failed: ["..."],          // 조회 실패한 코드
//     count: 1,
//     source: "kis"
//   }
//
// 근거:
// - TR_ID FHKST01010100, GET /uapi/domestic-stock/v1/quotations/inquire-price
//   Query: FID_COND_MRKT_DIV_CODE=J (주식/ETF/ETN), FID_INPUT_ISCD=6자리코드
// - 응답 output: bstp_kor_isnm(업종 한글명), rprs_mrkt_kor_name(대표시장명),
//   hts_kor_isnm(종목명), stck_prpr(현재가), mrkt_warn_cls_code 등
// - 이 TR은 1건씩만 조회 가능 → 여러 종목은 순차 호출(rate-limit 고려해 딜레이).
//   ※ ETF/ETN도 코드로는 조회되지만 업종명이 의미 없을 수 있음 → 개별주 위주로 사용.
//
// 필요한 Vercel 환경변수 (kis.js와 동일):
//   KIS_APP_KEY, KIS_APP_SECRET            (필수)
//   SUPABASE_SERVICE_KEY, SUPABASE_URL     (선택 — 접근토큰 캐싱, kis_token 테이블 공유)

export const config = { maxDuration: 30 };

const KIS_BASE = "https://openapi.koreainvestment.com:9443";
const SUPABASE_URL = process.env.SUPABASE_URL || "https://vqmuwmjdzskycxaqostt.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || "";

// 6자리 KRX 코드(앞4 숫자 + 뒤2 영숫자, 우선주 K/L 포함) — kis.js/kis-history.js/naver.js/index.html과 동일 규칙
const KR_CODE_RE = /^\d{4}[0-9A-Z]{2}$/;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- 접근토큰 캐시 (kis.js와 동일 로직: 메모리 → Supabase → 신규발급, kis_token 테이블 공유) ----
let memToken = null;
let memExp = 0;

async function readCachedToken(bufferMs) {
  if (!SERVICE_KEY) return null;
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/kis_token?id=eq.default&select=access_token,expires_at`,
      { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }, signal: AbortSignal.timeout(6000) }
    );
    if (!r.ok) return null;
    const rows = await r.json();
    const row = rows && rows[0];
    if (!row || !row.access_token || !row.expires_at) return null;
    if (new Date(row.expires_at).getTime() - Date.now() < bufferMs) return null;
    return row.access_token;
  } catch (e) {
    return null;
  }
}

async function writeCachedToken(token, expiresAtISO) {
  if (!SERVICE_KEY) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/kis_token`, {
      method: "POST",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify({ id: "default", access_token: token, expires_at: expiresAtISO }),
      signal: AbortSignal.timeout(6000),
    });
  } catch (e) {}
}

async function getToken(appkey, appsecret) {
  const now = Date.now();
  if (memToken && memExp - now > 10 * 60 * 1000) return memToken;

  const cached = await readCachedToken(10 * 60 * 1000);
  if (cached) {
    memToken = cached;
    memExp = now + 60 * 60 * 1000;
    return cached;
  }

  const r = await fetch(`${KIS_BASE}/oauth2/tokenP`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ grant_type: "client_credentials", appkey, appsecret }),
    signal: AbortSignal.timeout(10000),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) {
    const loose = await readCachedToken(0);
    if (loose) return loose;
    throw new Error(d.error_description || d.msg1 || `token HTTP ${r.status}`);
  }
  const ms = d.expires_in ? Number(d.expires_in) * 1000 : 24 * 60 * 60 * 1000;
  memToken = d.access_token;
  memExp = now + ms;
  await writeCachedToken(d.access_token, new Date(memExp).toISOString());
  return d.access_token;
}

// 현재가 단일조회 1건 → { name, sector, market, capCls, price } | null
async function fetchOne({ token, appkey, appsecret, code }) {
  const qs = new URLSearchParams({
    FID_COND_MRKT_DIV_CODE: "J",
    FID_INPUT_ISCD: code,
  });
  const url = `${KIS_BASE}/uapi/domestic-stock/v1/quotations/inquire-price?${qs.toString()}`;
  const r = await fetch(url, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      authorization: `Bearer ${token}`,
      appkey,
      appsecret,
      tr_id: "FHKST01010100",
      custtype: "P",
    },
    signal: AbortSignal.timeout(10000),
  });
  const d = await r.json().catch(() => ({}));
  if (d.rt_cd !== "0" || !d.output) return null;

  const o = d.output;
  const sector = String(o.bstp_kor_isnm || "").trim();
  const name = String(o.hts_kor_isnm || "").trim();
  const price = Number(o.stck_prpr);

  // 업종명이 비어있으면 분류 원천으로 못 씀 → null 취급하되 나머지는 반환
  return {
    name: name || null,
    sector: sector || null,
    market: String(o.rprs_mrkt_kor_name || "").trim() || null, // 대표시장(KOSPI200/KOSDAQ 등)
    capCls: String(o.hts_avls || "").trim() || null,           // 시가총액(참고용, 억원 단위 문자열)
    price: Number.isFinite(price) ? price : null,
  };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  const appkey = process.env.KIS_APP_KEY;
  const appsecret = process.env.KIS_APP_SECRET;
  if (!appkey || !appsecret) {
    return res.status(500).json({ error: "서버에 KIS_APP_KEY/KIS_APP_SECRET가 설정되지 않았습니다." });
  }

  const raw = String(req.query.codes || req.query.code || "").trim();
  if (!raw) return res.status(400).json({ error: "codes 필수 (쉼표구분 6자리 코드)" });

  const codeList = raw
    .split(",")
    .map((c) => c.trim().toUpperCase())
    .filter((c) => KR_CODE_RE.test(c))
    .slice(0, 40); // 단건 TR 순차호출이라 상한 보수적으로
  if (codeList.length === 0) return res.status(400).json({ error: "유효한 코드 없음" });

  let token;
  try {
    token = await getToken(appkey, appsecret);
  } catch (e) {
    return res.status(502).json({ error: "KIS 토큰 발급 실패: " + (e.message || e) });
  }

  const results = {};
  const failed = [];
  for (let i = 0; i < codeList.length; i++) {
    const code = codeList[i];
    let row = null;
    for (let attempt = 0; attempt < 2 && row === null; attempt++) {
      try {
        row = await fetchOne({ token, appkey, appsecret, code });
      } catch (e) {
        if (attempt === 0) await sleep(250);
      }
    }
    if (row) results[code] = row;
    else failed.push(code);
    if (i < codeList.length - 1) await sleep(120); // rate-limit 여유
  }

  res.setHeader("Cache-Control", "public, s-maxage=86400, stale-while-revalidate=604800");
  return res.status(200).json({
    results,
    failed,
    count: Object.keys(results).length,
    source: "kis",
  });
}
