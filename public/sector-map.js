// public/sector-map.js — Yahoo(GICS 계열) sector/industry → InvestIQ 섹터 매핑 모듈
// index.html에서 메인 앱 스크립트 '직전'에 로드:
//   <script type="text/babel" data-presets="react-classic" src="/sector-map.js"></script>
//
// 설계 원칙(gurus.js/notify.js와 동일):
//   - 전역 렉시컬 스코프 공유 → 최상위 선언은 전부 function + sm/Sm 접두어. top-level const/let 금지.
//
// 적용 범위: 개별주(전 세계 공통). ETF는 기존 이름 키워드 분류를 계속 사용 —
//   실측 결과 국내 ETF는 Yahoo가 fundCategory/sectorWeights를 주지 않고(069500.KS·458730.KS 확인),
//   미국 ETF도 fundCategory가 "Large Blend" 같은 스타일 분류라 테마 분류로 못 씀.
//
// 3단 폴백 구조 (문자열 완전일치 의존을 피해 라벨 변경에 견디도록 설계):
//   ① 종목 단위 예외(smExceptions)  — 티커 기준. 복합기업 등 industry로 못 가르는 소수 케이스
//   ② industry 키워드 부분일치       — 우선순위 캐스케이드. 목록 순서가 곧 우선순위
//   ※ AI전력·인프라 = 전력/유틸리티 + 통신망 인프라(통신사). 통신장비 제조는 테크.
//
//   ③ sector 폴백(11개)             — 실측 확정: Technology / Consumer Cyclical / Financial Services /
//                                     Energy / Industrials / Healthcare / Basic Materials /
//                                     Communication Services / Utilities / Real Estate / Consumer Defensive
//   → 전부 실패 시에만 "기타"
//
// 반환 섹터는 국가 접두어 없는 기본 섹터명(STOCK_SECTOR_DB 관행과 동일).

// ===== 티커 정규화: "005930.KS" → "005930", 대문자화 =====
function smNormTicker(t) {
  return String(t || "").trim().toUpperCase().replace(/\.(KS|KQ|T|L|HK|SS|SZ|DE|PA|AS|TO|AX)$/i, "");
}

// ===== ① 종목 단위 예외 =====
// industry만으로는 갈라지지 않는 복합기업/특수 케이스. 기존 STOCK_SECTOR_DB 관행에 맞춤.
//
// ※ 등록 원칙(중요): 여기엔 **Yahoo가 "틀리게" 분류한 종목만** 넣는다.
//   Yahoo에 프로필이 아예 없는 종목(sector/industry 모두 null)은 넣지 않고 그대로 "기타"로 둔다.
//   실측(2026-07-19): 코스닥 중소형주는 프로필 공백이 흔함(표본 15건 중 8건). 이걸 수동으로 메우면
//   목록이 무한히 늘어나고, KIS 업종으로 자동 폴백하면 오분류가 더 심하다(반도체 소부장이
//   의료·정밀기기/비금속/기계·장비로 흩어져 헬스케어·원자재·산업재로 잘못 감).
//   → "모르는 것은 기타"가 잘못된 섹터보다 낫다는 원칙.
function smExceptions() {
  return {
    // 한국 — 복합기업/2차전지 소재
    "005930": "반도체",             // 삼성전자: Yahoo=Consumer Electronics(가전) → 반도체
    "247540": "2차전지·전기차",      // 에코프로비엠: Yahoo=Electrical Equipment & Parts
    "005490": "2차전지·전기차",      // POSCO홀딩스: Yahoo=Steel (기존 DB 관행 유지)
    "003670": "2차전지·전기차",      // 포스코퓨처엠
    "373220": "2차전지·전기차",      // LG에너지솔루션
    "006400": "2차전지·전기차",      // 삼성SDI
    "010130": "화학·소재",           // 고려아연: Yahoo=Other Industrial Metals (기존 DB 관행 유지)
    "454910": "AI·로보틱스",         // 두산로보틱스: Yahoo=Specialty Industrial Machinery
    "277810": "AI·로보틱스",         // 레인보우로보틱스
    "034020": "원전",               // 두산에너빌리티
    "052690": "원전",               // 한전기술
    "010120": "AI전력·인프라",       // LS ELECTRIC (전력기기)
    "042700": "반도체",             // 한미반도체 (Yahoo=기계·장비 계열)
    "240810": "반도체",             // 원익IPS
    "028260": "지주사",             // 삼성물산
    "034730": "지주사",             // SK
    "003550": "지주사",             // LG
    "001040": "지주사",             // CJ
    "004990": "지주사",             // 롯데지주
    "267250": "지주사",             // HD현대

    // 미국 — 기존 DB 관행 유지
    "TSLA": "2차전지·전기차",
    "RIVN": "2차전지·전기차",
    "LCID": "2차전지·전기차",
    "CAT": "산업재·건설",           // 캐터필러(중장비) — 기존 AI전력·인프라에서 이동
    "DE": "산업재·건설",            // 디어
    "ETN": "AI전력·인프라",          // 이턴(전력설비) — Yahoo=Industrial Machinery
    "GEV": "AI전력·인프라",          // GE베르노바(발전설비)
    "PWR": "AI전력·인프라",          // 콴타서비시스 — Yahoo=Engineering & Construction이나 전력망 건설
  };
}

// ===== ② industry 키워드 규칙 (순서 = 우선순위) =====
// [키워드(소문자), 섹터]. industry 문자열에 키워드가 포함되면 매칭.
// 앞선 규칙이 먼저 적용되므로, 더 구체적인 것을 위에 둘 것.
function smIndustryRules() {
  return [
    // --- 반도체 (가장 먼저: "semiconductor equipment"도 함께 잡힘) ---
    ["semiconductor", "반도체"],

    // --- 원전 / 신재생 (에너지·유틸리티보다 먼저) ---
    ["uranium", "원전"],
    ["solar", "친환경·그린"],
    ["renewable", "친환경·그린"],

    // --- 조선·방산·우주항공 ---
    ["aerospace", "조선·방산·우주항공"],
    ["defense", "조선·방산·우주항공"],

    // --- 해운·물류 (marine shipping 이 airlines보다 먼저) ---
    ["marine shipping", "해운·물류"],
    ["integrated freight", "해운·물류"],
    ["trucking", "해운·물류"],
    ["railroad", "해운·물류"],

    // --- 여행·호텔 ---
    ["airline", "여행·호텔"],
    ["airport", "여행·호텔"],
    ["lodging", "여행·호텔"],
    ["resorts & casinos", "여행·호텔"],
    ["gambling", "여행·호텔"],
    ["travel", "여행·호텔"],
    ["leisure", "여행·호텔"],

    // --- 자동차 ---
    ["auto manufacturers", "자동차"],
    ["auto parts", "자동차"],
    ["auto & truck dealer", "자동차"],
    ["recreational vehicles", "자동차"],

    // --- 통신망 인프라 (통신사. 단 통신'장비'(시스코·아리스타)는 아래 테크로) ---
    ["telecom", "AI전력·인프라"],

    // --- 유틸리티 분기 (gas는 에너지, 나머지 전력은 AI전력·인프라) ---
    ["utilities—regulated gas", "에너지"],
    ["utilities - regulated gas", "에너지"],
    ["regulated gas", "에너지"],
    ["utilities", "AI전력·인프라"],

    // --- 에너지 ---
    ["oil & gas", "에너지"],
    ["coal", "에너지"],
    ["thermal coal", "에너지"],

    // --- 헬스케어 ---
    ["biotechnology", "헬스케어"],
    ["drug manufacturer", "헬스케어"],
    ["pharmaceutical", "헬스케어"],
    ["medical", "헬스케어"],
    ["healthcare", "헬스케어"],
    ["health information", "헬스케어"],
    ["diagnostics & research", "헬스케어"],

    // --- 금융 ---
    ["bank", "금융"],
    ["insurance", "금융"],
    ["capital markets", "금융"],
    ["asset management", "금융"],
    ["credit services", "금융"],
    ["financial data", "금융"],
    ["financial conglomerates", "금융"],
    ["mortgage", "금융"],

    // --- 부동산 ---
    ["reit", "REITs"],
    ["real estate", "REITs"],

    // --- 엔터·미디어 (게임 포함 — 기존 DB 관행: 크래프톤/넷마블=엔터·미디어) ---
    ["electronic gaming", "엔터·미디어"],
    ["entertainment", "엔터·미디어"],
    ["broadcasting", "엔터·미디어"],
    ["advertising", "엔터·미디어"],
    ["publishing", "엔터·미디어"],

    // --- 테크 (통신 포함) ---
    ["software", "테크"],
    ["information technology services", "테크"],
    ["internet content", "테크"],
    ["communication equipment", "테크"],
    ["computer hardware", "테크"],
    ["consumer electronics", "테크"],
    ["electronic components", "테크"],
    ["electronics & computer distribution", "테크"],
    ["scientific & technical instruments", "테크"],

    // --- 산업재·건설 ---
    ["engineering & construction", "산업재·건설"],
    ["building products", "산업재·건설"],
    ["construction machinery", "산업재·건설"],
    ["farm & heavy", "산업재·건설"],
    ["industrial machinery", "산업재·건설"],
    ["industrial distribution", "산업재·건설"],
    ["metal fabrication", "산업재·건설"],
    ["tools & accessories", "산업재·건설"],
    ["electrical equipment", "산업재·건설"],
    ["waste management", "산업재·건설"],
    ["security & protection", "산업재·건설"],
    ["staffing", "산업재·건설"],
    ["consulting services", "산업재·건설"],
    ["rental & leasing", "산업재·건설"],
    ["business equipment", "산업재·건설"],
    ["infrastructure operations", "산업재·건설"],

    // --- 화학·소재 ---
    ["chemical", "화학·소재"],

    // --- 원자재 ---
    ["steel", "원자재"],
    ["copper", "원자재"],
    ["aluminum", "원자재"],
    ["gold", "원자재"],
    ["silver", "원자재"],
    ["metals & mining", "원자재"],
    ["precious metals", "원자재"],
    ["agricultural inputs", "원자재"],
    ["lumber", "원자재"],
    ["paper & paper", "원자재"],
    ["building materials", "원자재"],

    // --- 소비재 ---
    ["beverages", "소비재"],
    ["packaged foods", "소비재"],
    ["farm products", "소비재"],
    ["confectioners", "소비재"],
    ["tobacco", "소비재"],
    ["household", "소비재"],
    ["personal products", "소비재"],
    ["grocery", "소비재"],
    ["discount stores", "소비재"],
    ["food distribution", "소비재"],
    ["restaurants", "소비재"],
    ["apparel", "소비재"],
    ["footwear", "소비재"],
    ["luxury goods", "소비재"],
    ["textile", "소비재"],
    ["retail", "소비재"],
    ["furnishings", "소비재"],
    ["packaging & containers", "소비재"],
    ["education", "소비재"],

    // --- 지주사 / 기타 ---
    ["conglomerates", "지주사"],
    ["shell companies", "기타"],
  ];
}

// ===== ③ sector(11개) 폴백 =====
function smSectorFallback() {
  return {
    "technology": "테크",
    "communication services": "엔터·미디어",
    "financial services": "금융",
    "financial": "금융",
    "healthcare": "헬스케어",
    "energy": "에너지",
    "basic materials": "원자재",
    "industrials": "산업재·건설",
    "consumer cyclical": "소비재",
    "consumer defensive": "소비재",
    "utilities": "AI전력·인프라",
    "real estate": "REITs",
  };
}

// ===== 메인: Yahoo 응답 → InvestIQ 섹터 =====
// 인자: { ticker, industry, sector }  (name은 선택, 로깅용)
// 반환: 섹터 문자열 (매칭 실패 시 "기타")
function smSectorFromYahoo(info) {
  const o = info || {};
  const tk = smNormTicker(o.ticker);
  const industry = String(o.industry || "").toLowerCase();
  const sector = String(o.sector || "").toLowerCase().trim();

  // ① 종목 단위 예외
  const exc = smExceptions();
  if (tk && exc[tk]) return exc[tk];

  // ② industry 키워드 (순서대로 첫 매칭 채택)
  if (industry) {
    const rules = smIndustryRules();
    for (let i = 0; i < rules.length; i++) {
      if (industry.indexOf(rules[i][0]) !== -1) return rules[i][1];
    }
  }

  // ③ sector 폴백
  if (sector) {
    const fb = smSectorFallback();
    if (fb[sector]) return fb[sector];
    // 부분일치 한 번 더(라벨 표기 변형 대비)
    const keys = Object.keys(fb);
    for (let i = 0; i < keys.length; i++) {
      if (sector.indexOf(keys[i]) !== -1) return fb[keys[i]];
    }
  }

  return "기타";
}

// ===== 프록시 호출 헬퍼 =====
// 국내 6자리 코드 판별 (kis.js/index.html과 동일 규칙)
function smIsKrCode(t) {
  return /^\d{4}[0-9A-Z]{2}$/.test(String(t || "").trim().toUpperCase());
}

// KIS 티커 → Yahoo 티커 표기 변환.
// KIS는 클래스주/우선주를 슬래시로 쓰지만(BRK/B, BF/B — 미국 개별주 462종=6.9%),
// Yahoo는 하이픈을 쓴다(BRK-B). 변환 안 하면 해당 종목 조회가 전부 실패.
function smToYahooTicker(t) {
  return String(t || "").trim().toUpperCase().replace(/\//g, "-");
}

// Yahoo 조회 1회. { results, failed } 반환 (실패 시 빈 값)
async function smCallYahoo(symbols) {
  if (!symbols || symbols.length === 0) return { results: {}, failed: [] };
  try {
    const r = await fetch("/api/yahoo-sector?tickers=" + encodeURIComponent(symbols.join(",")), {
      signal: AbortSignal.timeout(25000),
    });
    const d = await r.json().catch(function () { return {}; });
    if (!r.ok || !d.results) return { results: {}, failed: symbols.slice() };
    return { results: d.results, failed: Array.isArray(d.failed) ? d.failed : [] };
  } catch (e) {
    return { results: {}, failed: symbols.slice() };
  }
}

// 티커 배열 → { 원본티커: 섹터 }. 신규 종목 등록/미분류 보충 시 1회만 호출 권장.
// 국내 코드는 KOSPI(.KS) 우선 시도 → 실패분만 KOSDAQ(.KQ) 재시도 (티커만으론 시장 구분 불가).
// ETF/펀드는 제외(기존 이름 키워드 분류가 담당).
async function smFetchSectors(tickers) {
  const src = (tickers || []).map(function (t) { return String(t || "").trim(); }).filter(Boolean);
  if (src.length === 0) return {};

  const out = {};
  const symToOrig = {};   // 조회심볼 → 원본티커
  const pass1 = [];
  const krOrig = [];      // 국내 코드 원본 목록(2차 재시도용)

  src.slice(0, 20).forEach(function (t) {
    if (smIsKrCode(t)) {
      const sym = t.toUpperCase() + ".KS";
      symToOrig[sym] = t;
      pass1.push(sym);
      krOrig.push(t);
    } else {
      const sym = smToYahooTicker(t);
      symToOrig[sym] = t;
      pass1.push(sym);
    }
  });

  function absorb(results) {
    Object.keys(results || {}).forEach(function (sym) {
      const v = results[sym] || {};
      const orig = symToOrig[sym] || sym;
      if (out[orig]) return;
      if (v.type === "ETF" || v.type === "MUTUALFUND") return; // ETF는 이름 키워드 분류 사용
      if (!v.industry && !v.sector) return;                    // 정보 없으면 스킵(LLM에 넘김)
      out[orig] = smSectorFromYahoo({ ticker: orig, industry: v.industry, sector: v.sector });
    });
  }

  const r1 = await smCallYahoo(pass1);
  absorb(r1.results);

  // 국내 코드 중 .KS로 못 찾은 것 → .KQ 재시도
  const retry = [];
  krOrig.forEach(function (t) {
    if (!out[t]) {
      const sym = t.toUpperCase() + ".KQ";
      symToOrig[sym] = t;
      retry.push(sym);
    }
  });
  if (retry.length > 0) {
    const r2 = await smCallYahoo(retry);
    absorb(r2.results);
  }

  return out;
}
