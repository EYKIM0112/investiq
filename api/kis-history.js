// api/kis-history.js — 한국투자증권(KIS) OpenAPI 프록시: 국내 기간별시세(월봉 등) 조회
// 백테스팅용 과거 시세 데이터. 국내주식/ETF 전용.
// 해외(미국)는 기존 api/yahoo.js (type=chart&interval=1mo, type=dividends)로 처리 → 여기엔 없음.
//
// 응답 형태:
//   {
//     code: "005930", period: "M", adjusted: true, currency: "KRW",
//     start: "20050101", end: "20250731", count: 240,
//     candles: [ { date:"20050131", open, high, low, close, volume }, ... ],  // 날짜 오름차순
//     partial: false,   // true면 일부 구간 조회 실패(백테스트 정확도 주의)
//     source: "kis"
//   }
//
// 핵심 근거:
// 1. FID_PERIOD_DIV_CODE=M (월봉), FID_ORG_ADJ_PRC=0 (수정주가 — 분할/증자 보정, 배당 미반영).
//    KIS 공식 샘플(kis_domstk.py) 기본값이 원주가(1)라, 반드시 0을 명시해야 수정주가가 나옴.
// 2. 한 번의 호출당 최대 100건 제한 → 날짜 구간을 100건 미만 윈도우로 잘라 여러 번 호출 후 병합.
//    윈도우 자체를 100건 미만으로 자르므로 KIS의 정렬/절삭 동작에 의존하지 않음(추측 배제).
//
// 필요한 Vercel 환경변수 (kis.js와 동일):
//   KIS_APP_KEY, KIS_APP_SECRET            (필수)
//   SUPABASE_SERVICE_KEY, SUPABASE_URL     (선택 — 접근토큰 캐싱, kis.js와 kis_token 테이블 공유)

export const config = { maxDuration: 30 };

const KIS_BASE = "https://openapi.koreainvestment.com:9443";
const SUPABASE_URL = process.env.SUPABASE_URL || "https://vqmuwmjdzskycxaqostt.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || "";

// 6자리 KRX 코드(앞4 숫자 + 뒤2 영숫자, 우선주 K/L 포함) — kis.js/naver.js/index.html과 동일 규칙
const KR_CODE_RE = /^\d{4}[0-9A-Z]{2}$/;

// period별 윈도우 크기(개월). 각 윈도우가 100건 미만이 되도록 보수적으로 설정.
// 1. M(월봉): 96개월=8년 → 20년치 3콜
// 2. W(주봉): 22개월≈95주
// 3. D(일봉): 4개월≈84영업일 (여유). 백테스트엔 미사용, 유연성용
// 4. Y(년봉): 사실상 한 번에
const WINDOW_MONTHS = { D: 4, W: 22, M: 96, Y: 1152 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- 접근토큰 캐시 (kis.js와 동일 로직: 메모리 → Supabase → 신규발급) ----
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

// 접근토큰 확보: 메모리 → Supabase 캐시(만료 10분 전까지 유효) → 신규 발급
async function getToken(appkey, appsecret) {
  const now = Date.now();
  if (memToken && memExp - now > 10 * 60 * 1000) return memToken;

  const cached = await readCachedToken(10 * 60 * 1000);
  if (cached) {
    memToken = cached;
    memExp = now + 60 * 60 * 1000; // 최소 1시간 신뢰(정확한 만료는 캐시가 관리)
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
    // 발급 실패(예: 1분당 1회 제한) → 만료임박이라도 캐시된 토큰 재사용 시도
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

// ---- 날짜 유틸 (모두 UTC 정오 기준으로 다뤄 타임존 오프바이원 방지) ----

// KST(UTC+9) 기준 오늘 YYYYMMDD
function todayKST() {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(kst.getUTCDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

function isValidYmd(s) {
  return /^\d{8}$/.test(s);
}

function ymdToDate(ymd) {
  const y = Number(ymd.slice(0, 4));
  const m = Number(ymd.slice(4, 6));
  const d = Number(ymd.slice(6, 8));
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
}

function dateToYmd(dt) {
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

// start~end를 monthsPerWindow 개월 단위 [winStart, winEnd] 배열로 분할(오름차순, 겹침 없음)
function buildWindows(startYmd, endYmd, monthsPerWindow) {
  const windows = [];
  const end = ymdToDate(endYmd);
  let cursor = ymdToDate(startYmd);
  let guard = 0;
  while (cursor.getTime() <= end.getTime() && guard < 2000) {
    guard++;
    const winStart = cursor;
    // winEnd = winStart + monthsPerWindow개월 - 1일
    const we = new Date(winStart.getTime());
    we.setUTCMonth(we.getUTCMonth() + monthsPerWindow);
    we.setUTCDate(we.getUTCDate() - 1);
    const winEnd = we.getTime() > end.getTime() ? end : we;
    windows.push([dateToYmd(winStart), dateToYmd(winEnd)]);
    // 다음 윈도우 시작 = winEnd + 1일
    const next = new Date(winEnd.getTime());
    next.setUTCDate(next.getUTCDate() + 1);
    cursor = next;
  }
  return windows;
}

// KIS 기간별시세 한 윈도우 조회 → output2 배열(원본) 반환. rt_cd 실패 시 throw.
async function fetchWindow({ token, appkey, appsecret, code, marketDiv, period, adj, date1, date2 }) {
  const qs = new URLSearchParams({
    FID_COND_MRKT_DIV_CODE: marketDiv,
    FID_INPUT_ISCD: code,
    FID_INPUT_DATE_1: date1,
    FID_INPUT_DATE_2: date2,
    FID_PERIOD_DIV_CODE: period,
    FID_ORG_ADJ_PRC: adj,
  });
  const url = `${KIS_BASE}/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice?${qs.toString()}`;
  const r = await fetch(url, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      authorization: `Bearer ${token}`,
      appkey,
      appsecret,
      tr_id: "FHKST03010100",
      custtype: "P",
    },
    signal: AbortSignal.timeout(10000),
  });
  const d = await r.json().catch(() => ({}));
  // rt_cd "0" = 정상. output2 없거나 rt_cd 실패면 예외 → 상위에서 재시도/실패처리
  if (d.rt_cd !== "0" || !Array.isArray(d.output2)) {
    throw new Error(d.msg1 || `window HTTP ${r.status}`);
  }
  return d.output2;
}

// output2 항목 → 표준 캔들. 유효하지 않으면 null.
// 상장 이전 구간 등은 KIS가 rt_cd 0 + 빈 배열/무효행으로 주므로 여기서 걸러짐.
function toCandle(o) {
  const date = String(o.stck_bsop_date || "").trim();
  const close = Number(o.stck_clpr);
  if (!/^\d{8}$/.test(date) || !Number.isFinite(close) || close <= 0) return null;
  const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  return {
    date,
    open: num(o.stck_oprc),
    high: num(o.stck_hgpr),
    low: num(o.stck_lwpr),
    close,
    volume: num(o.acml_vol),
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

  // ---- 파라미터 파싱 ----
  const code = String(req.query.code || "").trim().toUpperCase();
  if (!KR_CODE_RE.test(code)) {
    return res.status(400).json({ error: "code 필수 (유효한 6자리 국내 코드)" });
  }

  const period = String(req.query.period || "M").trim().toUpperCase();
  if (!["D", "W", "M", "Y"].includes(period)) {
    return res.status(400).json({ error: "period는 D/W/M/Y 중 하나여야 합니다." });
  }

  // adj: "0"=수정주가(기본), "1"=원주가. 명시 안 하면 수정주가.
  const adj = String(req.query.adj ?? "0").trim() === "1" ? "1" : "0";

  const marketDiv = "J"; // 주식/ETF/ETN

  const end = isValidYmd(String(req.query.end || "")) ? String(req.query.end) : todayKST();
  let start;
  if (isValidYmd(String(req.query.start || ""))) {
    start = String(req.query.start);
  } else {
    // 기본: end 기준 20년 전
    const s = ymdToDate(end);
    s.setUTCFullYear(s.getUTCFullYear() - 20);
    start = dateToYmd(s);
  }
  if (ymdToDate(start).getTime() > ymdToDate(end).getTime()) {
    return res.status(400).json({ error: "start가 end보다 이후입니다." });
  }

  // ---- 접근토큰 ----
  let token;
  try {
    token = await getToken(appkey, appsecret);
  } catch (e) {
    return res.status(502).json({ error: "KIS 토큰 발급 실패: " + (e.message || e) });
  }

  // ---- 윈도우 분할 후 순차 조회 → 날짜 기준 병합/중복제거 ----
  const monthsPerWindow = WINDOW_MONTHS[period] || 96;
  const windows = buildWindows(start, end, monthsPerWindow);

  const byDate = new Map();
  let failed = 0;
  for (let i = 0; i < windows.length; i++) {
    const [d1, d2] = windows[i];
    let rows = null;
    for (let attempt = 0; attempt < 2 && rows === null; attempt++) {
      try {
        rows = await fetchWindow({ token, appkey, appsecret, code, marketDiv, period, adj, date1: d1, date2: d2 });
      } catch (e) {
        if (attempt === 1) failed++;
        else await sleep(300); // 1회 재시도 전 짧은 대기
      }
    }
    if (Array.isArray(rows)) {
      for (const o of rows) {
        const c = toCandle(o);
        if (c) byDate.set(c.date, c); // 같은 날짜는 마지막 값으로 덮음(경계 중복 안전)
      }
    }
    if (i < windows.length - 1) await sleep(120); // 배치 간 딜레이(rate-limit 여유)
  }

  const candles = Array.from(byDate.values()).sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0
  );

  if (candles.length === 0) {
    return res.status(502).json({ error: "시세 데이터를 가져오지 못했습니다.", code, partial: failed > 0 });
  }

  res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");
  return res.status(200).json({
    code,
    period,
    adjusted: adj === "0",
    currency: "KRW",
    start,
    end,
    count: candles.length,
    candles,
    partial: failed > 0,
    source: "kis",
  });
}
