// api/kis-dividend.js — 한국투자증권(KIS) OpenAPI 프록시: 국내주식/ETF 배당일정 조회
// 배당 캘린더용. 예탁원정보(배당일정) = 국내주식-145, TR_ID HHKDB669102C0.
// 해외(미국 등) 배당은 기존 api/yahoo.js (type=dividends)로 처리 → 여기엔 없음.
//
// 엔드포인트:
//   /api/kis-dividend?code=005930                       → 최근 1년 배당
//   /api/kis-dividend?code=069500&from=20230101&to=20241231
//
// 응답 형태(야후 type=dividends와 최대한 유사하게 표준화):
//   {
//     code: "005930", from: "20240101", to: "20250101", currency: "KRW",
//     dividends: [
//       { recordDate:"20240326", payDate:"20240416"|null, perShare: 600,
//         cashRate: 12.0, kind:"결산", stkKind:"보통", name:"삼성전자" }, ...
//     ],   // recordDate 오름차순
//     source: "kis"
//   }
//
// 근거(2026-07 KIS 공식문서 실측):
// - Query: CTS(공백), GB1(0=배당전체/1=결산/2=중간), F_DT~T_DT(YYYYMMDD), SHT_CD(종목코드/공백=전체), HIGH_GB(공백)
// - output1[] 필드: record_date(기준일), per_sto_divi_amt(주당현금배당, 0패딩 문자열),
//   divi_rate(현금배당률%), divi_pay_dt(배당금지급일 "YYYY/MM/DD"|""), divi_kind, stk_kind, isin_name
// - per_sto_divi_amt 원 단위 확인: 액면 5000 × divi_rate 12% = 600원.
//
// 필요한 Vercel 환경변수 (kis.js와 동일):
//   KIS_APP_KEY, KIS_APP_SECRET            (필수)
//   SUPABASE_SERVICE_KEY, SUPABASE_URL     (선택 — 접근토큰 캐싱, kis.js와 kis_token 테이블 공유)

export const config = { maxDuration: 30 };

const KIS_BASE = "https://openapi.koreainvestment.com:9443";
const SUPABASE_URL = process.env.SUPABASE_URL || "https://vqmuwmjdzskycxaqostt.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || "";

// 6자리 KRX 코드(앞4 숫자 + 뒤2 영숫자, 우선주 K/L 포함) — kis.js/kis-history.js/naver.js/index.html과 동일 규칙
const KR_CODE_RE = /^\d{4}[0-9A-Z]{2}$/;

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

// ---- 날짜 유틸 ----
function todayKST() {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(kst.getUTCDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}
function isValidYmd(s) { return /^\d{8}$/.test(s); }
function oneYearBefore(ymd) {
  const y = Number(ymd.slice(0, 4)) - 1;
  return `${y}${ymd.slice(4)}`;
}

// "YYYY/MM/DD" 또는 "YYYYMMDD" → "YYYYMMDD" (빈값/무효 → null)
function normYmd(s) {
  const v = String(s || "").replace(/\D/g, "");
  return /^\d{8}$/.test(v) ? v : null;
}

// output1 항목 → 표준 배당 레코드. 무효면 null.
function toDiv(o, fallbackName) {
  const recordDate = normYmd(o.record_date);
  if (!recordDate) return null;
  const perShare = Number(String(o.per_sto_divi_amt || "0").replace(/[^0-9.]/g, ""));
  const cashRate = Number(String(o.divi_rate || "").replace(/[^0-9.\-]/g, ""));
  return {
    recordDate,
    payDate: normYmd(o.divi_pay_dt),                 // 실제 배당금 지급일(없으면 null)
    perShare: Number.isFinite(perShare) ? perShare : 0,
    cashRate: Number.isFinite(cashRate) ? cashRate : null,
    kind: String(o.divi_kind || "").trim() || null,  // 결산 / 중간 등
    stkKind: String(o.stk_kind || "").trim() || null, // 보통 / 우선
    name: String(o.isin_name || "").trim() || fallbackName || null,
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

  const code = String(req.query.code || "").trim().toUpperCase();
  if (!KR_CODE_RE.test(code)) {
    return res.status(400).json({ error: "code 필수 (유효한 6자리 국내 코드)" });
  }

  const to = isValidYmd(String(req.query.to || "")) ? String(req.query.to) : todayKST();
  const from = isValidYmd(String(req.query.from || "")) ? String(req.query.from) : oneYearBefore(to);

  let token;
  try {
    token = await getToken(appkey, appsecret);
  } catch (e) {
    return res.status(502).json({ error: "KIS 토큰 발급 실패: " + (e.message || e) });
  }

  // 예탁원정보(배당일정) 조회
  const qs = new URLSearchParams({
    CTS: "",
    GB1: "0",          // 0=배당전체
    F_DT: from,
    T_DT: to,
    SHT_CD: code,      // 특정종목. ※ 6자리 코드 그대로 — 실측으로 확정 필요
    HIGH_GB: "",
  });
  const url = `${KIS_BASE}/uapi/domestic-stock/v1/quotations/ksdinfo/dividend?${qs.toString()}`;

  try {
    const r = await fetch(url, {
      headers: {
        "content-type": "application/json; charset=utf-8",
        authorization: `Bearer ${token}`,
        appkey,
        appsecret,
        tr_id: "HHKDB669102C0",
        custtype: "P",
      },
      signal: AbortSignal.timeout(10000),
    });
    const d = await r.json().catch(() => ({}));

    if (d.rt_cd !== "0" || !Array.isArray(d.output1)) {
      return res.status(502).json({
        error: d.msg1 || `배당 조회 실패 (HTTP ${r.status})`,
        rt_cd: d.rt_cd ?? null,
        code,
      });
    }

    const dividends = d.output1
      .map((o) => toDiv(o))
      .filter(Boolean)
      .sort((a, b) => (a.recordDate < b.recordDate ? -1 : a.recordDate > b.recordDate ? 1 : 0));

    res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");
    return res.status(200).json({
      code,
      from,
      to,
      currency: "KRW",
      dividends,
      source: "kis",
    });
  } catch (e) {
    if (e.name === "TimeoutError" || e.name === "AbortError") {
      return res.status(504).json({ error: "KIS 응답 시간 초과", code });
    }
    return res.status(502).json({ error: e.message || "KIS 배당 조회 실패", code });
  }
}
