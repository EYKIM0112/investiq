// api/kis.js — 한국투자증권(KIS) OpenAPI 프록시 (Vercel 서버리스)
// 국내주식/ETF 현재가 조회. 응답 형태는 naver.js(codes 경로)와 동일:
//   { results: { "코드": { currentPrice, changeRate } }, source: "kis" }
//
// 필요한 Vercel 환경변수:
//   KIS_APP_KEY, KIS_APP_SECRET            (필수 — 실전계좌 appkey/secret)
//   SUPABASE_SERVICE_KEY                   (선택 — 있으면 접근토큰을 Supabase에 캐싱해 발급 rate-limit 회피)
//   SUPABASE_URL                           (선택 — 미설정 시 아래 기본값 사용)
//
// 토큰 캐시가 없으면(SERVICE_KEY 미설정) 메모리 캐시만 사용 → 첫 테스트는 KIS 키 2개만으로 동작.
// 운영 시엔 Supabase에 kis_token 테이블 만들고 SERVICE_KEY 추가 권장(콜드스타트 간 토큰 공유).

export const config = { maxDuration: 30 };

const KIS_BASE = "https://openapi.koreainvestment.com:9443";
const SUPABASE_URL = process.env.SUPABASE_URL || "https://vqmuwmjdzskycxaqostt.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || "";

const KR_CODE_RE = /^\d{4}[0-9A-Z]{2}$/; // 6자리 KRX 코드(앞4자리 숫자+뒤2자리 영숫자, 우선주 K/L 등 포함) — index.html/naver.js와 동일 규칙

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 웜 인스턴스용 메모리 캐시(보조)
let memToken = null;
let memExp = 0;

// ---- Supabase 토큰 캐시 (테이블: kis_token(id text pk, access_token text, expires_at timestamptz)) ----
// bufferMs: 만료가 now+bufferMs 이후여야 유효로 간주
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

  // 신규 발급 (client_credentials)
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

// 등락률에 부호 적용: prdy_vrss_sign 1·2=상승, 3=보합, 4·5=하락
function signedRate(rateStr, signStr) {
  const v = Number(rateStr);
  if (!Number.isFinite(v)) return null;
  if (signStr === "4" || signStr === "5") return -Math.abs(v);
  return Math.abs(v);
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

  const { codes } = req.query;
  if (!codes) return res.status(400).json({ error: "codes 필수 (쉼표구분 6자리 코드)" });

  const codeList = codes
    .split(",")
    .map((c) => c.trim().toUpperCase())
    .filter((c) => KR_CODE_RE.test(c))
    .slice(0, 50);
  if (codeList.length === 0) return res.status(400).json({ error: "유효한 코드 없음" });

  let token;
  try {
    token = await getToken(appkey, appsecret);
  } catch (e) {
    return res.status(502).json({ error: "KIS 토큰 발급 실패: " + (e.message || e) });
  }

  // 관심종목(멀티종목) 시세조회 — 한 번에 최대 30종목 (tr_id FHKST11300006, 실전 전용)
  // 응답 output[] 각 항목: inter_shrn_iscd(코드), inter2_prpr(현재가), prdy_ctrt(등락률),
  //                        prdy_vrss_sign(부호), inter_kor_isnm(종목명)
  const results = {};
  for (let i = 0; i < codeList.length; i += 30) {
    const chunk = codeList.slice(i, i + 30);
    const qs = [];
    chunk.forEach((code, idx) => {
      const n = idx + 1;
      qs.push(`FID_COND_MRKT_DIV_CODE_${n}=J`);
      qs.push(`FID_INPUT_ISCD_${n}=${encodeURIComponent(code)}`);
    });
    try {
      const url = `${KIS_BASE}/uapi/domestic-stock/v1/quotations/intstock-multprice?${qs.join("&")}`;
      const r = await fetch(url, {
        headers: {
          "content-type": "application/json; charset=utf-8",
          authorization: `Bearer ${token}`,
          appkey,
          appsecret,
          tr_id: "FHKST11300006",
          custtype: "P",
        },
        signal: AbortSignal.timeout(10000),
      });
      const d = await r.json().catch(() => ({}));
      if (d.rt_cd === "0" && Array.isArray(d.output)) {
        for (const o of d.output) {
          const code = String(o.inter_shrn_iscd || "").trim().toUpperCase();
          if (!code || o.inter2_prpr == null || o.inter2_prpr === "") continue;
          results[code] = {
            currentPrice: Number(o.inter2_prpr),
            changeRate: signedRate(o.prdy_ctrt, o.prdy_vrss_sign),
            name: String(o.inter_kor_isnm || "").trim() || null,
          };
        }
      }
      if (i + 30 < codeList.length) await sleep(150); // 배치 간 딜레이
    } catch (e) {
      // 배치 실패는 건너뜀 (해당 종목들은 앱 레벨 fallback으로 처리)
    }
  }

  res.setHeader("Cache-Control", "public, s-maxage=30, stale-while-revalidate=60");
  return res.status(200).json({ results, source: "kis" });
}
