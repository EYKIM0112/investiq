// api/fng-kr.js — KRX 코스피200 변동성지수(VKOSPI) 프록시 (한국 시장 변동성/공포)
// 목적: 브라우저에서 KRX Open API를 직접 부르면 인증키 노출·CORS 문제 → 서버리스로 중계.
//   VKOSPI는 "높을수록 공포"인 절대값 지수. 상대 정규화 없이 실제 수치를 그대로 전달한다
//   (자체 가공 지수가 아니라 KRX 공식 VKOSPI 그대로 — 등급만 통용 해석 기준으로 부여).
//
// 엔드포인트:
//   /api/fng-kr   → { vkospi, band, basDd, source }
//
// 근거(실측):
// - KRX 파생상품지수 시세정보: GET https://data-dbg.krx.co.kr/svc/apis/idx/drvprod_dd_trd
//   요청: basDd(YYYYMMDD), 헤더 AUTH_KEY 에 인증키.
//   응답: { OutBlock_1: [{ BAS_DD, IDX_CLSS, IDX_NM, CLSPRC_IDX, ... }] }
//   VKOSPI 는 IDX_NM === "코스피 200 변동성지수" (실측 확인).
// - 하루치만 주므로 휴장일(주말·공휴일)엔 빈 배열 → 최근 영업일까지 최대 7일 역방향 재시도.
// - 등급 경계(절대값): 증권가 통용 해석 + 평시범위. 50~60=시스템리스크 전조, 70~80=패닉.
//
// Vercel 환경변수: KRX_AUTH_KEY (필수)

export const config = { maxDuration: 20 };

var KRX_URL = "https://data-dbg.krx.co.kr/svc/apis/idx/drvprod_dd_trd";
var VKOSPI_NAME = "코스피 200 변동성지수";

// VKOSPI 절대값 → 게이지 색(위험도). 등급 '단어'는 붙이지 않는다.
// VKOSPI엔 CNN 같은 공식 등급 구간이 없으므로, Fear/Greed 라벨을 임의로 부여하지 않고
// 숫자·색·참조점(평시/역대최고)만 전달한다. 색은 낮음(안정)=초록 → 높음(위험)=빨강.
function krColor(v) {
  var s = Number(v);
  if (!isFinite(s)) return "#64748b";
  if (s < 20) return "#3aa856";   // 평시 안정권
  if (s < 30) return "#8cc152";
  if (s < 45) return "#e8c14a";
  if (s < 65) return "#f0883e";
  return "#e5453b";               // 역대급 고변동
}

function ymd(d) {
  var y = d.getFullYear();
  var m = ("0" + (d.getMonth() + 1)).slice(-2);
  var day = ("0" + d.getDate()).slice(-2);
  return "" + y + m + day;
}

async function fetchDay(basDd, authKey) {
  var r = await fetch(KRX_URL + "?basDd=" + basDd, {
    headers: { AUTH_KEY: authKey },
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) return { httpError: r.status };
  var d = await r.json().catch(function () { return null; });
  if (!d || !Array.isArray(d.OutBlock_1)) return { empty: true };
  if (d.OutBlock_1.length === 0) return { empty: true };
  // VKOSPI 행 찾기
  var row = null;
  for (var i = 0; i < d.OutBlock_1.length; i++) {
    var nm = String(d.OutBlock_1[i].IDX_NM || "").trim();
    if (nm === VKOSPI_NAME) { row = d.OutBlock_1[i]; break; }
  }
  if (!row) return { noVkospi: true };
  var v = parseFloat(String(row.CLSPRC_IDX).replace(/,/g, ""));
  if (!isFinite(v)) return { empty: true };
  return { vkospi: v, basDd: String(row.BAS_DD || basDd) };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  var authKey = process.env.KRX_AUTH_KEY;
  if (!authKey) return res.status(500).json({ error: "서버에 KRX_AUTH_KEY가 설정되지 않았습니다." });

  // ── 임시 디버그: /api/fng-kr?debug=1 로 키 상태만 안전 확인 (값 노출 안 함) ──
  if (req.query && req.query.debug === "1") {
    var raw = process.env.KRX_AUTH_KEY || "";
    return res.status(200).json({
      exists: !!raw,
      length: raw.length,
      trimmedLength: raw.trim().length,
      hasWhitespace: raw !== raw.trim(),
      head3: raw.slice(0, 3),
      tail3: raw.slice(-3),
    });
  }

  try {
    // 오늘부터 뒤로 최대 7일 — 휴장일 건너뛰고 최근 영업일 찾기
    var today = new Date();
    var last = null;
    for (var back = 0; back < 8; back++) {
      var d = new Date(today.getTime() - back * 86400000);
      var wd = d.getDay();
      if (wd === 0 || wd === 6) continue;        // 주말 스킵(호출 절약)
      var out = await fetchDay(ymd(d), authKey);
      if (out.httpError) return res.status(502).json({ error: "KRX HTTP " + out.httpError });
      if (out.vkospi != null) { last = out; break; }
      // empty/noVkospi 면 전날 재시도
    }
    if (!last) return res.status(502).json({ error: "최근 영업일 VKOSPI를 찾지 못했습니다." });

    res.setHeader("Cache-Control", "public, s-maxage=1800, stale-while-revalidate=7200");
    return res.status(200).json({
      vkospi: Math.round(last.vkospi * 100) / 100,
      color: krColor(last.vkospi),
      basDd: last.basDd,
      // 참조점(사용자가 지금 수치의 위치를 스스로 가늠하도록). 등급 단어는 붙이지 않음.
      ref: { normalLow: 15, normalHigh: 20, allTimeHigh: 95, allTimeHighDate: "2026-06" },
      max: 100,
      source: "krx",
    });
  } catch (e) {
    if (e.name === "TimeoutError" || e.name === "AbortError") {
      return res.status(504).json({ error: "KRX 응답 시간 초과" });
    }
    return res.status(500).json({ error: e.message || "서버 오류" });
  }
}
