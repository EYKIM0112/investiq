// public/backtest.js — InvestIQ 백테스트 탭 (독립 모듈)
// index.html에서 아래 한 줄로 로드(메인 앱 스크립트 직전):
//   <script type="text/babel" data-presets="react-classic" src="/backtest.js"></script>
//
// 설계 원칙:
// 1. 전역 렉시컬 스코프 공유 → 최상위 선언은 전부 function 선언 + bt/Bt 접두어(index.html과 충돌 방지).
// 2. 훅은 컴포넌트 안에서 React.useState 등으로 접근(top-level 재선언 금지).
// 3. 자기완결형: 자체 fetch·자체 SVG 차트·마스터 JSON 직접 로드. 모듈 캐시는 window.__bt*.
//
// ★ 통화 정책 (v3 — 과거 환율 시계열 전면 폐기):
//   각 종목은 자기 통화로 네이티브 계산 (국내=KRW, 미국=USD, 향후 일본=JPY 등).
//   → 과거 환율을 쓰지 않으므로 야후 과거 환율 오류로 인한 평가액 폭주가 원천 차단됨.
//   투자금도 통화별로 따로 입력(원화 종목엔 원, 달러 종목엔 달러).
//   구간별 평가액·그래프·테이블 = 통화별로 각각 표시.
//   원화 환산은 "최종 합산 평가액"에만 적용, 환율은 백테스트 종료월 1개만 사용.
//
// 데이터 정책(실증 확정):
//   국내 ETF   : /api/kis-history adj=0 → 분배금 반영(TR)
//   국내 개별주 : /api/kis-history adj=0 → 현금배당 미반영(가격수익률)
//   해외       : /api/yahoo adjclose → 배당 재투자 반영(TR)
//   자격검사   : 해외는 KIS 마스터에 있는 종목만 지원(시세는 야후 adjclose 사용)
//   주기       : 월봉 고정 / 적립: 매월 말 종가 기준

// ===== 통화 =====
// 향후 KIS 일본·중국·유럽 마스터 추가 시 여기에 등록만 하면 자동 지원됨.
function btCurMeta(cur) {
  const M = {
    KRW: { symbol: "₩", unit: "만원", unitMul: 10000, fx: null,      digits: 0 },
    USD: { symbol: "$", unit: "달러", unitMul: 1,     fx: "KRW=X",   digits: 2 },
    JPY: { symbol: "¥", unit: "엔",   unitMul: 1,     fx: "JPYKRW=X", digits: 0 },
    CNY: { symbol: "元", unit: "위안", unitMul: 1,    fx: "CNYKRW=X", digits: 2 },
    EUR: { symbol: "€", unit: "유로", unitMul: 1,     fx: "EURKRW=X", digits: 2 },
    HKD: { symbol: "HK$", unit: "홍콩달러", unitMul: 1, fx: "HKDKRW=X", digits: 2 },
  };
  return M[cur] || { symbol: "", unit: cur, unitMul: 1, fx: cur + "KRW=X", digits: 2 };
}

// ===== 유틸 =====
function btKrCodeRe() { return /^\d{4}[0-9A-Z]{2}$/; }
function btIsDomestic(t) { return btKrCodeRe().test(String(t || "").trim().toUpperCase()); }
function btColors() { return ["#22d3a0", "#4f6ef7", "#fbbf24", "#f472b6", "#38bdf8"]; }
function btFmtPct(n) { if (n == null || !isFinite(n)) return "-"; return (n >= 0 ? "+" : "") + (n * 100).toFixed(2) + "%"; }
function btTodayYmd() { const d = new Date(Date.now() + 9 * 3600 * 1000); return "" + d.getUTCFullYear() + String(d.getUTCMonth() + 1).padStart(2, "0") + String(d.getUTCDate()).padStart(2, "0"); }
function btCurYear() { return new Date(Date.now() + 9 * 3600 * 1000).getUTCFullYear(); }
function btCurMonth() { return new Date(Date.now() + 9 * 3600 * 1000).getUTCMonth() + 1; }
function btMonthIndex(ym, baseYm) { const [y, m] = ym.split("-").map(Number); const [by, bm] = baseYm.split("-").map(Number); return (y - by) * 12 + (m - bm); }

// 통화별 금액 표기 (전체)
function btFmtAmt(n, cur) {
  if (n == null || !isFinite(n)) return "-";
  const m = btCurMeta(cur);
  if (cur === "KRW") return Math.round(n).toLocaleString("ko-KR") + "원";
  return m.symbol + n.toLocaleString("en-US", { minimumFractionDigits: m.digits, maximumFractionDigits: m.digits });
}
// 통화별 금액 표기 (축약 — 테이블/축 라벨용)
function btFmtAmtShort(n, cur) {
  if (n == null || !isFinite(n)) return "-";
  const a = Math.abs(n);
  if (cur === "KRW") {
    if (a >= 1e8) return (n / 1e8).toFixed(2) + "억";
    if (a >= 1e4) return Math.round(n / 1e4).toLocaleString("ko-KR") + "만";
    return Math.round(n).toLocaleString("ko-KR");
  }
  const m = btCurMeta(cur);
  if (a >= 1e6) return m.symbol + (n / 1e6).toFixed(2) + "M";
  if (a >= 1e3) return m.symbol + (n / 1e3).toFixed(1) + "K";
  return m.symbol + Math.round(n).toLocaleString("en-US");
}

// ===== 캐시 =====
function btCacheGet(key, maxAgeMs) { try { const o = JSON.parse(localStorage.getItem(key) || "null"); if (o && o.data && Date.now() - o.ts < maxAgeMs) return o.data; } catch (e) {} return null; }
function btCacheSet(key, data) { try { localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data })); } catch (e) {} }

// ===== 마스터 (국내 + 해외/미국) =====
async function btLoadMasterDom() {
  if (window.__btMasterDom) return window.__btMasterDom;
  try {
    const r = await fetch("/kis_master.json", { signal: AbortSignal.timeout(10000) });
    if (!r.ok) return null;
    const d = await r.json();
    const list = [];
    const push = (dict, type) => { if (!dict) return; for (const code in dict) list.push({ code, name: dict[code], type, domestic: true, currency: "KRW" }); };
    push(d.etf, "etf"); push(d.stock, "stock");
    window.__btMasterDom = { list, etf: d.etf || {}, stock: d.stock || {} };
    return window.__btMasterDom;
  } catch (e) { return null; }
}
// 해외 마스터: 현재 미국(kis_master_us.json)만. 향후 다른 나라 마스터는 아래 SOURCES에 추가만 하면 됨.
async function btLoadMasterOvs() {
  if (window.__btMasterOvs) return window.__btMasterOvs;
  const SOURCES = [{ url: "/kis_master_us.json", currency: "USD" }];
  const list = [], byCode = {};
  for (const src of SOURCES) {
    try {
      const r = await fetch(src.url, { signal: AbortSignal.timeout(10000) });
      if (!r.ok) continue;
      const d = await r.json();
      const push = (dict, type) => {
        if (!dict) return;
        for (const code in dict) {
          const it = { code, name: dict[code], type, domestic: false, currency: src.currency };
          list.push(it);
          if (!byCode[code]) byCode[code] = it;
        }
      };
      push(d.etf, "etf"); push(d.stock, "stock");
    } catch (e) {}
  }
  window.__btMasterOvs = { list, byCode };
  return window.__btMasterOvs;
}
function btDomType(code) { const m = window.__btMasterDom; if (!m) return null; const c = String(code || "").toUpperCase(); if (m.etf[c]) return "etf"; if (m.stock[c]) return "stock"; return null; }

// 검색: 국내 마스터 + 해외 마스터(KIS). 관련도 점수 정렬.
async function btSearch(q) {
  const nq = q.replace(/\s+/g, "").toLowerCase();
  if (!nq) return [];
  const score1 = (name, code) => {
    const nm = String(name).replace(/\s+/g, "").toLowerCase();
    const cd = String(code).toLowerCase();
    if (nm === nq) return 100;
    if (cd === nq) return 95;
    if (nm.startsWith(nq)) return 80;
    if (cd.startsWith(nq)) return 70;
    if (nm.includes(nq)) return 40;
    if (cd.includes(nq)) return 20;
    return 0;
  };
  const collect = (list) => {
    const s = [];
    for (const it of list) {
      const sc = score1(it.name, it.code);
      if (sc > 0) s.push({ it, sc, nlen: String(it.name).length });
    }
    s.sort((a, b) => (b.sc - a.sc) || (a.nlen - b.nlen) || (a.it.name < b.it.name ? -1 : 1));
    return s;
  };
  const [dom, ovs] = await Promise.all([btLoadMasterDom(), btLoadMasterOvs()]);
  const out = [];
  if (dom) collect(dom.list).slice(0, 10).forEach(x => out.push(x.it));
  if (ovs) collect(ovs.list).slice(0, 10).forEach(x => out.push(x.it));
  return out;
}

// ===== 시세 =====
async function btFetchDomestic(ticker, endYmd) {
  const key = "bt_dom_" + ticker;
  const cached = btCacheGet(key, 12 * 3600 * 1000);
  if (cached) return cached;
  const url = "/api/kis-history?code=" + encodeURIComponent(ticker) + "&period=M&adj=0&start=19900101&end=" + endYmd;
  const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error("국내 시세 조회 실패: " + ticker);
  const d = await r.json();
  if (!Array.isArray(d.candles) || !d.candles.length) throw new Error("데이터 없음: " + ticker);
  const out = d.candles.filter(c => c && /^\d{8}$/.test(c.date) && c.close > 0).map(c => ({ ym: c.date.slice(0, 4) + "-" + c.date.slice(4, 6), close: c.close }));
  btCacheSet(key, out);
  return out;
}
function btParseYahooMonthly(d, useAdj) {
  const res = d && d.chart && d.chart.result && d.chart.result[0];
  if (!res || !res.timestamp) return [];
  const ts = res.timestamp;
  const ind = res.indicators || {};
  const adj = (ind.adjclose && ind.adjclose[0] && ind.adjclose[0].adjclose) || [];
  const cls = (ind.quote && ind.quote[0] && ind.quote[0].close) || [];
  const m = new Map();
  for (let i = 0; i < ts.length; i++) {
    const px = useAdj ? (adj[i] != null ? adj[i] : cls[i]) : (cls[i] != null ? cls[i] : adj[i]);
    if (px == null || !(px > 0)) continue;
    const dt = new Date(ts[i] * 1000);
    const ym = dt.getUTCFullYear() + "-" + String(dt.getUTCMonth() + 1).padStart(2, "0");
    m.set(ym, px);
  }
  return Array.from(m, ([ym, close]) => ({ ym, close })).sort((a, b) => (a.ym < b.ym ? -1 : 1));
}
// 해외 시세: 야후 adjclose(TR). 네이티브 통화 그대로(환율 미적용).
// ※ 가격 스파이크 필터는 두지 않음 — 실제로 개별주가 단기간 5배 이상 오르는 경우가 있어 정상치를 지울 위험이 큼.
async function btFetchOverseas(ticker) {
  const key = "bt_ovs3_" + ticker;
  const cached = btCacheGet(key, 12 * 3600 * 1000);
  if (cached) return cached;
  const url = "/api/yahoo?type=chart&ticker=" + encodeURIComponent(ticker) + "&interval=1mo&range=max";
  const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error("해외 시세 조회 실패: " + ticker);
  const d = await r.json();
  const out = btParseYahooMonthly(d, true);
  if (!out.length) throw new Error("데이터 없음: " + ticker);
  btCacheSet(key, out);
  return out;
}
// 환율: 백테스트 종료월(targetYm)의 환율 1개만. 과거 시계열은 쓰지 않음.
// 해당 월이 없으면 그 이전 최근값 사용. 비정상값(0 이하)은 제외.
async function btFetchRateAt(cur, targetYm) {
  if (cur === "KRW") return 1;
  const meta = btCurMeta(cur);
  const key = "bt_fx3_" + cur;
  let pairs = btCacheGet(key, 12 * 3600 * 1000);
  if (!pairs) {
    const url = "/api/yahoo?type=chart&ticker=" + encodeURIComponent(meta.fx) + "&interval=1mo&range=max";
    const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error("환율 조회 실패: " + meta.fx);
    const d = await r.json();
    const arr = btParseYahooMonthly(d, false).filter(o => o.close > 0);
    if (!arr.length) throw new Error("환율 데이터 없음: " + meta.fx);
    pairs = arr.map(o => [o.ym, o.close]);
    btCacheSet(key, pairs);
  }
  let best = null;
  for (const [ym, v] of pairs) { if (ym <= targetYm && (!best || ym > best[0])) best = [ym, v]; }
  if (!best) best = pairs[pairs.length - 1];
  return best ? best[1] : null;
}

// ===== 엔진 (통화별 독립 계산) =====
// securities: [{ticker,name,domestic,type,currency,lumpAmt,dcaAmt}] — 금액은 각 통화의 기본단위
// seriesNative: { ticker: Map(ym -> price(네이티브통화)) }
function btRunEngine(opts) {
  const { securities, seriesNative, months, mode } = opts;
  const shares = {}, secPrin = {};
  securities.forEach(s => { shares[s.ticker] = 0; secPrin[s.ticker] = 0; });
  const base = months[0];
  const monthly = [];
  const currencies = Array.from(new Set(securities.map(s => s.currency)));
  const cfByCur = {}; currencies.forEach(c => { cfByCur[c] = { amt: [], idx: [] }; });
  const prinByCur = {}; currencies.forEach(c => { prinByCur[c] = 0; });

  months.forEach((ym, idx) => {
    const investByCur = {}; currencies.forEach(c => { investByCur[c] = 0; });
    securities.forEach(s => {
      let iv = 0;
      if (idx === 0) {
        if (mode === "lump" || mode === "both") iv += s.lumpAmt;
        if (mode === "dca") iv += s.dcaAmt;
      } else if (mode === "dca" || mode === "both") {
        iv += s.dcaAmt;
      }
      if (iv > 0) {
        const px = seriesNative[s.ticker].get(ym);
        if (px > 0) { shares[s.ticker] += iv / px; secPrin[s.ticker] += iv; investByCur[s.currency] += iv; }
      }
    });
    currencies.forEach(c => {
      if (investByCur[c] > 0) { prinByCur[c] += investByCur[c]; cfByCur[c].amt.push(-investByCur[c]); cfByCur[c].idx.push(btMonthIndex(ym, base)); }
    });
    const bySec = {}; const valByCur = {}; currencies.forEach(c => { valByCur[c] = 0; });
    securities.forEach(s => {
      const px = seriesNative[s.ticker].get(ym);
      const v = px > 0 ? shares[s.ticker] * px : 0;
      bySec[s.ticker] = v; valByCur[s.currency] += v;
    });
    const px = {};
    securities.forEach(s => { const v = seriesNative[s.ticker].get(ym); px[s.ticker] = v > 0 ? v : 0; });
    monthly.push({ ym, bySec, valByCur, px, prinByCur: Object.assign({}, prinByCur), secPrin: Object.assign({}, secPrin) });
  });

  const last = monthly[monthly.length - 1];
  const byCur = currencies.map(c => {
    const value = last.valByCur[c] || 0;
    const principal = last.prinByCur[c] || 0;
    const irr = btIRR(cfByCur[c].amt.concat([value]), cfByCur[c].idx.concat([btMonthIndex(last.ym, base)]));
    return { currency: c, value, principal, totalReturn: principal > 0 ? (value - principal) / principal : null, irr };
  });
  return { monthly, byCur, currencies };
}
function btIRR(amounts, idxs) {
  if (!amounts.length) return null;
  const npv = (rm) => amounts.reduce((s, a, i) => s + a / Math.pow(1 + rm, idxs[i]), 0);
  let lo = -0.99, hi = 1.0;
  let flo = npv(lo), fhi = npv(hi);
  if (flo * fhi > 0) { hi = 10; fhi = npv(hi); if (flo * fhi > 0) return null; }
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2; const fm = npv(mid);
    if (!isFinite(fm)) return null;
    if (Math.abs(fm) < 1e-4) { lo = mid; hi = mid; break; }
    if (flo * fm < 0) { hi = mid; fhi = fm; } else { lo = mid; flo = fm; }
  }
  const rm = (lo + hi) / 2;
  return Math.pow(1 + rm, 12) - 1;
}
// 통화별 연도별 집계
function btYearlyByCur(monthly, cur) {
  const byYear = new Map();
  monthly.forEach(p => { byYear.set(p.ym.slice(0, 4), p); });
  return Array.from(byYear, ([year, p]) => {
    const value = p.valByCur[cur] || 0, principal = p.prinByCur[cur] || 0;
    return { year, value, principal, ret: principal > 0 ? (value - principal) / principal : null };
  }).sort((a, b) => (a.year < b.year ? -1 : 1));
}
// 종목별 연도별 집계.
// 비중은 "전 종목 원화환산 총액" 기준(통화 통합) — rates는 종료월 환율 1개(통화별).
function btYearlyBySec(monthly, s, secs, rates) {
  const byYear = new Map();
  monthly.forEach(p => { byYear.set(p.ym.slice(0, 4), p); });
  return Array.from(byYear, ([year, p]) => {
    const value = p.bySec[s.ticker] || 0;
    const prin = p.secPrin[s.ticker] || 0;
    const rt = rates[s.currency];
    const krwVal = rt > 0 ? value * rt : null;
    const krwTotal = btKrwTotalAt(p, secs, rates);
    return {
      year, value, principal: prin,
      weight: (krwTotal > 0 && krwVal != null) ? krwVal / krwTotal : null,
      ret: prin > 0 ? (value - prin) / prin : null,
    };
  }).sort((a, b) => (a.year < b.year ? -1 : 1));
}
// 특정 시점의 전 종목 원화환산 총 평가액(종료월 환율 사용)
function btKrwTotalAt(p, secs, rates) {
  let t = 0;
  for (const s of secs) {
    const rt = rates[s.currency];
    if (!(rt > 0)) return 0;
    t += (p.bySec[s.ticker] || 0) * rt;
  }
  return t;
}
// 전 종목 통합 수익률 지수(시작=100). 통화가 달라도 성장배수는 비교 가능.
function btIndexSeries(monthly, secs) {
  return secs.map(s => {
    const first = monthly.find(p => (p.px && p.px[s.ticker] > 0));
    const basePx = first && first.px ? first.px[s.ticker] : null;
    return {
      name: s.name,
      points: monthly.map(p => ({ ym: p.ym, value: (basePx > 0 && p.px && p.px[s.ticker] > 0) ? (p.px[s.ticker] / basePx) * 100 : null })),
    };
  });
}
function btDividendLabel(s) {
  if (!s.domestic) return { txt: "해외 · 배당 재투자 반영(TR)", color: "#22d3a0" };
  const type = s.type || btDomType(s.ticker);
  if (type === "etf") return { txt: "국내 ETF · 분배금 반영(TR)", color: "#22d3a0" };
  if (type === "stock") return { txt: "국내 개별주 · 현금배당 미반영", color: "#94a3b8" };
  return { txt: "국내 · ETF는 반영·개별주는 미반영", color: "#64748b" };
}

// ===== SVG: 통화별 총자산(평가액 vs 원금) =====
function BtChart(props) {
  const pts = props.points || [];   // [{ym, value, principal}]
  const cur = props.currency;
  if (pts.length < 2) return null;
  const W = 700, H = 300, padL = 8, padR = 12, padT = 14, padB = 26;
  const maxV = Math.max.apply(null, pts.map(p => Math.max(p.value, p.principal))) || 1;
  const n = pts.length;
  const x = (i) => padL + (i / (n - 1)) * (W - padL - padR);
  const y = (v) => padT + (1 - v / maxV) * (H - padT - padB);
  const path = (sel) => pts.map((p, i) => (i === 0 ? "M" : "L") + x(i).toFixed(1) + " " + y(sel(p)).toFixed(1)).join(" ");
  const areaPath = path(p => p.value) + " L" + x(n - 1).toFixed(1) + " " + y(0).toFixed(1) + " L" + x(0).toFixed(1) + " " + y(0).toFixed(1) + " Z";
  const ticks = []; for (let k = 0; k <= 4; k++) ticks.push(maxV * (k / 4));
  const yearMarks = []; const seen = {};
  pts.forEach((p, i) => { const yy = p.ym.slice(0, 4); if (!seen[yy]) { seen[yy] = true; yearMarks.push({ i, label: yy }); } });
  const step = Math.ceil(yearMarks.length / 8);
  const shownYears = yearMarks.filter((_, k) => k % step === 0);
  const gid = "btArea_" + cur;
  return (
    <svg viewBox={"0 0 " + W + " " + H} style={{ width: "100%", height: "auto", display: "block" }}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#22d3a0" stopOpacity="0.28" />
          <stop offset="100%" stopColor="#22d3a0" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {ticks.map((v, k) => (
        <g key={k}>
          <line x1={padL} y1={y(v)} x2={W - padR} y2={y(v)} stroke="#1e293b" strokeWidth="1" />
          <text x={padL + 2} y={y(v) - 3} fill="#475569" fontSize="11">{btFmtAmtShort(v, cur)}</text>
        </g>
      ))}
      {shownYears.map((m, k) => (<text key={k} x={x(m.i)} y={H - 8} fill="#64748b" fontSize="11" textAnchor="middle">{m.label}</text>))}
      <path d={areaPath} fill={"url(#" + gid + ")"} />
      <path d={path(p => p.principal)} fill="none" stroke="#64748b" strokeWidth="1.6" strokeDasharray="4 3" />
      <path d={path(p => p.value)} fill="none" stroke="#22d3a0" strokeWidth="2.2" />
    </svg>
  );
}
// ===== SVG: 종목별 멀티라인(같은 통화끼리) =====
function BtMultiChart(props) {
  const series = props.series || [];
  const cur = props.currency;
  if (!series.length || !series[0].points || series[0].points.length < 2) return null;
  const W = 700, H = 280, padL = 8, padR = 12, padT = 14, padB = 26;
  const n = series[0].points.length;
  let maxV = 0; series.forEach(s => s.points.forEach(p => { if (p.value > maxV) maxV = p.value; }));
  if (maxV <= 0) maxV = 1;
  const x = (i) => padL + (i / (n - 1)) * (W - padL - padR);
  const y = (v) => padT + (1 - v / maxV) * (H - padT - padB);
  const path = (p2) => p2.map((p, i) => (i === 0 ? "M" : "L") + x(i).toFixed(1) + " " + y(p.value).toFixed(1)).join(" ");
  const ticks = []; for (let k = 0; k <= 4; k++) ticks.push(maxV * (k / 4));
  const yearMarks = []; const seen = {};
  series[0].points.forEach((p, i) => { const yy = p.ym.slice(0, 4); if (!seen[yy]) { seen[yy] = true; yearMarks.push({ i, label: yy }); } });
  const step = Math.ceil(yearMarks.length / 8);
  const shownYears = yearMarks.filter((_, k) => k % step === 0);
  return (
    <svg viewBox={"0 0 " + W + " " + H} style={{ width: "100%", height: "auto", display: "block" }}>
      {ticks.map((v, k) => (
        <g key={k}>
          <line x1={padL} y1={y(v)} x2={W - padR} y2={y(v)} stroke="#1e293b" strokeWidth="1" />
          <text x={padL + 2} y={y(v) - 3} fill="#475569" fontSize="11">{btFmtAmtShort(v, cur)}</text>
        </g>
      ))}
      {shownYears.map((m, k) => (<text key={k} x={x(m.i)} y={H - 8} fill="#64748b" fontSize="11" textAnchor="middle">{m.label}</text>))}
      {series.map((s, si) => (<path key={si} d={path(s.points)} fill="none" stroke={s.color} strokeWidth="2" />))}
    </svg>
  );
}

// ===== SVG: 통합 수익률 지수(시작=100) — 통화 무관 비교 =====
function BtIndexChart(props) {
  const series = (props.series || []).filter(s => s.points.some(p => p.value != null));
  if (!series.length) return null;
  const pts0 = series[0].points;
  const n = pts0.length;
  if (n < 2) return null;
  const W = 700, H = 280, padL = 8, padR = 12, padT = 14, padB = 26;
  let maxV = 0;
  series.forEach(s => s.points.forEach(p => { if (p.value != null && p.value > maxV) maxV = p.value; }));
  if (maxV <= 0) maxV = 100;
  const x = (i) => padL + (i / (n - 1)) * (W - padL - padR);
  const y = (v) => padT + (1 - v / maxV) * (H - padT - padB);
  const path = (pts) => {
    let d = "", started = false;
    pts.forEach((p, i) => {
      if (p.value == null) return;
      d += (started ? "L" : "M") + x(i).toFixed(1) + " " + y(p.value).toFixed(1) + " ";
      started = true;
    });
    return d.trim();
  };
  const ticks = []; for (let k = 0; k <= 4; k++) ticks.push(maxV * (k / 4));
  const yearMarks = []; const seen = {};
  pts0.forEach((p, i) => { const yy = p.ym.slice(0, 4); if (!seen[yy]) { seen[yy] = true; yearMarks.push({ i, label: yy }); } });
  const step = Math.ceil(yearMarks.length / 8);
  const shownYears = yearMarks.filter((_, k) => k % step === 0);
  return (
    <svg viewBox={"0 0 " + W + " " + H} style={{ width: "100%", height: "auto", display: "block" }}>
      {ticks.map((v, k) => (
        <g key={k}>
          <line x1={padL} y1={y(v)} x2={W - padR} y2={y(v)} stroke="#1e293b" strokeWidth="1" />
          <text x={padL + 2} y={y(v) - 3} fill="#475569" fontSize="11">{Math.round(v).toLocaleString("ko-KR")}</text>
        </g>
      ))}
      {maxV >= 100 && <line x1={padL} y1={y(100)} x2={W - padR} y2={y(100)} stroke="#475569" strokeWidth="1" strokeDasharray="3 3" />}
      {shownYears.map((m, k) => (<text key={k} x={x(m.i)} y={H - 8} fill="#64748b" fontSize="11" textAnchor="middle">{m.label}</text>))}
      {series.map((s, si) => (<path key={si} d={path(s.points)} fill="none" stroke={s.color} strokeWidth="2" />))}
    </svg>
  );
}

// ===== 포트폴리오 (마스터로 통화·자격 판정) =====
async function btLoadPortfolio() {
  try {
    const p = JSON.parse(localStorage.getItem("portfolio_v1") || "null");
    const hs = (p && p.holdings) || [];
    const ovs = await btLoadMasterOvs();
    const seen = {}; const out = [];
    hs.forEach(h => {
      const t = String(h.ticker || "").trim().toUpperCase();
      if (!t || seen[t]) return;
      seen[t] = true;
      if (btIsDomestic(t)) { out.push({ code: t, name: h.name || t, domestic: true, currency: "KRW", type: btDomType(t) }); return; }
      const m = ovs && ovs.byCode[t];
      if (m) out.push({ code: t, name: m.name || h.name || t, domestic: false, currency: m.currency, type: m.type });
      // KIS 마스터에 없는 해외종목은 백테스트 미지원 → 목록에서 제외
    });
    return out;
  } catch (e) { return []; }
}

// ===== 메인 =====
function BacktestTab() {
  const { useState, useMemo, useRef, useEffect } = React;
  const nowY = btCurYear();

  const [secs, setSecs] = useState([]); // [{ticker,name,domestic,type,currency,weight,lumpAmt,dcaAmt}]
  const [startY, setStartY] = useState(nowY - 5);
  const [startM, setStartM] = useState(1);
  const [endY, setEndY] = useState(nowY);
  const [endM, setEndM] = useState(btCurMonth());
  const [mode, setMode] = useState("lump");
  const [allocMode, setAllocMode] = useState("weight");
  const [lumpTotal, setLumpTotal] = useState(1000); // 비중모드: 총 거치금(해당 통화 단위)
  const [dcaTotal, setDcaTotal] = useState(50);     // 비중모드: 총 적립금
  const [showPicker, setShowPicker] = useState(false);
  const [portfolio, setPortfolio] = useState([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);

  const [running, setRunning] = useState(false);
  const [err, setErr] = useState("");
  const [warn, setWarn] = useState("");
  const [result, setResult] = useState(null);

  const timer = useRef(null);

  useEffect(() => { btLoadMasterDom(); btLoadMasterOvs(); }, []);
  useEffect(() => { if (showPicker) btLoadPortfolio().then(setPortfolio); }, [showPicker]);
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const q = query.trim();
    if (!q) { setResults([]); setSearching(false); return; }
    setSearching(true);
    timer.current = setTimeout(async () => {
      try { setResults(await btSearch(q)); } catch (e) { setResults([]); }
      setSearching(false);
    }, 300);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [query]);

  const currencies = useMemo(() => Array.from(new Set(secs.map(s => s.currency))), [secs]);
  const isMixed = currencies.length > 1;
  // 통화가 섞이면 총액을 나눌 기준이 없으므로 금액 직접입력만 허용
  const effAlloc = isMixed ? "amount" : allocMode;
  const needLump = mode === "lump" || mode === "both";
  const needDca = mode === "dca" || mode === "both";

  const addSec = (s) => {
    setErr("");
    const ticker = String((s && (s.ticker || s.code)) || "").trim().toUpperCase();
    if (!ticker) { setErr("종목 코드를 확인할 수 없습니다."); return; }
    if (secs.length >= 5) { setErr("종목은 최대 5개까지 선택 가능합니다."); return; }
    if (secs.some(x => x.ticker === ticker)) { setErr("이미 추가된 종목입니다."); return; }
    const domestic = (s && s.domestic != null) ? s.domestic : btIsDomestic(ticker);
    const currency = (s && s.currency) || (domestic ? "KRW" : null);
    if (!currency) { setErr("이 종목은 KIS 마스터에 없어 백테스트를 지원하지 않습니다."); return; }
    const next = secs.concat([{ ticker, name: (s && s.name) || ticker, domestic, type: (s && s.type) || null, currency, weight: 0, lumpAmt: 0, dcaAmt: 0 }]);
    const w = Math.round((100 / next.length) * 10) / 10;
    setSecs(next.map((x, i) => Object.assign({}, x, { weight: i === next.length - 1 ? Math.round((100 - w * (next.length - 1)) * 10) / 10 : w })));
  };
  const removeSec = (t) => setSecs(secs.filter(x => x.ticker !== t));
  const patchSec = (t, patch) => setSecs(secs.map(x => x.ticker === t ? Object.assign({}, x, patch) : x));
  const equalize = () => {
    if (!secs.length) return;
    const w = Math.round((100 / secs.length) * 10) / 10;
    setSecs(secs.map((x, i) => Object.assign({}, x, { weight: i === secs.length - 1 ? Math.round((100 - w * (secs.length - 1)) * 10) / 10 : w })));
  };

  const weightSum = secs.reduce((s, x) => s + (Number(x.weight) || 0), 0);
  const singleCur = currencies.length === 1 ? currencies[0] : null;
  const singleMeta = singleCur ? btCurMeta(singleCur) : null;

  const run = async () => {
    setErr(""); setWarn(""); setResult(null);
    if (!secs.length) { setErr("종목을 1개 이상 추가해주세요."); return; }
    const reqStart = startY + "-" + String(startM).padStart(2, "0");
    const reqEnd = endY + "-" + String(endM).padStart(2, "0");
    if (reqStart > reqEnd) { setErr("시작 시점이 종료 시점보다 늦습니다."); return; }
    if ((endY - startY) * 12 + (endM - startM) > 360) { setErr("백테스트 기간은 최대 30년까지 가능합니다."); return; }

    // 종목별 투자금 확정 (각 통화의 기본단위)
    let engSecs;
    if (effAlloc === "weight" && singleCur) {
      if (Math.abs(weightSum - 100) > 0.5) { setErr("비중 합이 100%가 되어야 합니다. (현재 " + weightSum.toFixed(1) + "%)"); return; }
      const mul = singleMeta.unitMul;
      const tl = (Number(lumpTotal) || 0) * mul;
      const td = (Number(dcaTotal) || 0) * mul;
      if (needLump && tl <= 0) { setErr("거치 금액을 입력해주세요."); return; }
      if (needDca && td <= 0) { setErr("적립 금액을 입력해주세요."); return; }
      engSecs = secs.map(s => { const w = (Number(s.weight) || 0) / 100; return { ticker: s.ticker, name: s.name, domestic: s.domestic, type: s.type, currency: s.currency, lumpAmt: tl * w, dcaAmt: td * w }; });
    } else {
      engSecs = secs.map(s => {
        const mul = btCurMeta(s.currency).unitMul;
        return { ticker: s.ticker, name: s.name, domestic: s.domestic, type: s.type, currency: s.currency, lumpAmt: (Number(s.lumpAmt) || 0) * mul, dcaAmt: (Number(s.dcaAmt) || 0) * mul };
      });
      const sumL = engSecs.reduce((a, s) => a + s.lumpAmt, 0);
      const sumD = engSecs.reduce((a, s) => a + s.dcaAmt, 0);
      if (needLump && sumL <= 0) { setErr("종목별 거치 금액을 입력해주세요."); return; }
      if (needDca && sumD <= 0) { setErr("종목별 적립 금액을 입력해주세요."); return; }
    }

    setRunning(true);
    try {
      const endYmd = btTodayYmd();
      const raw = {};
      await Promise.all(secs.map(async s => { raw[s.ticker] = s.domestic ? await btFetchDomestic(s.ticker, endYmd) : await btFetchOverseas(s.ticker); }));

      // 네이티브 통화 그대로 (환율 미적용)
      const seriesNative = {};
      secs.forEach(s => {
        const m = new Map();
        raw[s.ticker].forEach(o => { if (o.ym >= reqStart && o.ym <= reqEnd) m.set(o.ym, o.close); });
        seriesNative[s.ticker] = m;
      });

      let common = null;
      secs.forEach(s => { const ks = new Set(seriesNative[s.ticker].keys()); common = common === null ? ks : new Set([...common].filter(y => ks.has(y))); });
      const months = Array.from(common || []).sort();
      if (months.length < 2) { setErr("공통으로 조회되는 월 데이터가 부족합니다. 종목 상장 시기나 기간을 확인해주세요."); setRunning(false); return; }
      if (months[0] > reqStart) setWarn("일부 종목의 데이터 시작이 늦어, 백테스트는 " + months[0] + "부터 시작했습니다.");

      const eng = btRunEngine({ securities: engSecs, seriesNative, months, mode });
      const endYm = months[months.length - 1];

      // 원화 환산: 종료월 환율 1개만 사용
      const rates = {};
      for (const c of eng.currencies) {
        try { rates[c] = await btFetchRateAt(c, endYm); } catch (e) { rates[c] = null; }
      }
      let krwValue = 0, krwPrincipal = 0, fxOk = true;
      eng.byCur.forEach(b => {
        const rt = rates[b.currency];
        if (rt > 0) { krwValue += b.value * rt; krwPrincipal += b.principal * rt; }
        else fxOk = false;
      });

      setResult({ eng, secs: engSecs, start: months[0], end: endYm, mode, rates, krwValue, krwPrincipal, fxOk });
    } catch (e) {
      setErr(e.message || "백테스트 중 오류가 발생했습니다.");
    } finally {
      setRunning(false);
    }
  };

  const card = { background: "#0f0f18", border: "1px solid #1e293b", borderRadius: 12, padding: 14, marginBottom: 12 };
  const label = { fontSize: 12, fontWeight: 700, color: "#a8b4f8", marginBottom: 8 };
  const inp = { background: "#0a0a12", border: "1px solid #2a2a48", borderRadius: 8, color: "#e8eaf0", fontSize: 14, padding: "8px 10px", outline: "none" };
  const segBtn = (active, dis) => ({ flex: 1, padding: "9px 0", borderRadius: 8, border: "none", fontSize: 12.5, fontWeight: 700, cursor: dis ? "not-allowed" : "pointer", background: active ? "#4f6ef7" : "#0a0a12", color: active ? "#fff" : (dis ? "#475569" : "#94a3b8") });
  const miniInp = Object.assign({}, inp, { width: 78, padding: "6px 8px", textAlign: "right", fontSize: 13 });

  return (
    <div>
      <div style={card}>
        <div style={label}>투자 방식</div>
        <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
          <button onClick={() => setMode("lump")} style={segBtn(mode === "lump")}>거치식</button>
          <button onClick={() => setMode("dca")} style={segBtn(mode === "dca")}>적립식</button>
          <button onClick={() => setMode("both")} style={segBtn(mode === "both")}>거치+적립</button>
        </div>
        <div style={label}>배분 방식</div>
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={() => !isMixed && setAllocMode("weight")} disabled={isMixed} style={segBtn(effAlloc === "weight", isMixed)}>비중(%)</button>
          <button onClick={() => setAllocMode("amount")} style={segBtn(effAlloc === "amount")}>금액 직접입력</button>
        </div>
        {isMixed && <div style={{ fontSize: 11, color: "#fbbf24", marginTop: 8 }}>· 통화가 다른 종목이 섞여 있을 경우 비중(%) 배분은 사용 불가합니다. 통화별로 투자 금액을 직접 입력 해주세요.</div>}
        {effAlloc === "weight" && singleCur && (
          <div style={{ marginTop: 12 }}>
            {needLump && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 13, color: "#94a3b8", width: 96 }}>{mode === "both" ? "초기 거치금(총)" : "거치 금액(총)"}</span>
                <input type="number" value={lumpTotal} onChange={e => setLumpTotal(e.target.value)} style={Object.assign({}, inp, { flex: 1, textAlign: "right" })} />
                <span style={{ fontSize: 13, color: "#94a3b8", width: 34 }}>{singleMeta.unit}</span>
              </div>
            )}
            {needDca && (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 13, color: "#94a3b8", width: 96 }}>매월 적립금(총)</span>
                <input type="number" value={dcaTotal} onChange={e => setDcaTotal(e.target.value)} style={Object.assign({}, inp, { flex: 1, textAlign: "right" })} />
                <span style={{ fontSize: 13, color: "#94a3b8", width: 34 }}>{singleMeta.unit}</span>
              </div>
            )}
            <div style={{ fontSize: 11, color: "#64748b", marginTop: 8 }}>· 총액을 종목별 비중대로 나누어 투자합니다.{needDca ? " 적립은 매월 말 종가 기준." : ""}</div>
          </div>
        )}
        {effAlloc === "amount" && <div style={{ fontSize: 11, color: "#64748b", marginTop: 8 }}>· 종목별로 각 통화 단위의 금액을 직접 입력합니다.{needDca ? " 적립은 매월 말 종가 기준." : ""}</div>}
      </div>

      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={label}>종목 (최대 5개){effAlloc === "weight" ? " · 시작 비중 %" : " · 종목별 금액"}</div>
          {effAlloc === "weight" && secs.length > 0 && <button onClick={equalize} style={Object.assign({}, inp, { padding: "4px 8px", fontSize: 11, cursor: "pointer", color: "#a8b4f8" })}>균등 배분</button>}
        </div>

        {secs.map(s => {
          const meta = btCurMeta(s.currency);
          return (
            <div key={s.ticker} style={{ marginBottom: 10, paddingBottom: 10, borderBottom: "1px solid #12121f" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: s.domestic ? "#22d3a0" : "#fbbf24", border: "1px solid " + (s.domestic ? "#22d3a033" : "#fbbf2433"), borderRadius: 5, padding: "2px 5px", whiteSpace: "nowrap" }}>{s.currency}</span>
                <span style={{ flex: 1, fontSize: 13, color: "#e8eaf0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}<span style={{ color: "#475569", fontSize: 11 }}> {s.ticker}</span></span>
                {effAlloc === "weight" && <input type="number" value={s.weight} onChange={e => patchSec(s.ticker, { weight: e.target.value })} style={miniInp} />}
                {effAlloc === "weight" && <span style={{ fontSize: 12, color: "#64748b" }}>%</span>}
                <button onClick={() => removeSec(s.ticker)} style={{ background: "none", border: "none", color: "#f87171", fontSize: 18, cursor: "pointer", lineHeight: 1 }}>×</button>
              </div>
              {effAlloc === "amount" && (needLump || needDca) && (
                <div style={{ display: "flex", gap: 10, marginTop: 8, paddingLeft: 4, flexWrap: "wrap" }}>
                  {needLump && (
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 12, color: "#94a3b8" }}>거치</span>
                      <input type="number" value={s.lumpAmt} onChange={e => patchSec(s.ticker, { lumpAmt: e.target.value })} style={miniInp} />
                      <span style={{ fontSize: 12, color: "#64748b" }}>{meta.unit}</span>
                    </div>
                  )}
                  {needDca && (
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 12, color: "#94a3b8" }}>적립</span>
                      <input type="number" value={s.dcaAmt} onChange={e => patchSec(s.ticker, { dcaAmt: e.target.value })} style={miniInp} />
                      <span style={{ fontSize: 12, color: "#64748b" }}>{meta.unit}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {secs.length > 0 && effAlloc === "weight" && <div style={{ fontSize: 11, color: Math.abs(weightSum - 100) < 0.5 ? "#22d3a0" : "#fbbf24", margin: "2px 0 10px", textAlign: "right" }}>비중 합 {weightSum.toFixed(1)}%</div>}

        <button onClick={() => setShowPicker(!showPicker)} style={Object.assign({}, inp, { width: "100%", cursor: "pointer", color: "#a8b4f8", fontWeight: 700, marginBottom: showPicker ? 8 : 10 })}>＋ 내 포트폴리오에서 추가</button>
        {showPicker && (
          <div style={{ maxHeight: 180, overflowY: "auto", border: "1px solid #1e293b", borderRadius: 8, padding: 6, marginBottom: 10 }}>
            {portfolio.length === 0 && <div style={{ fontSize: 12, color: "#64748b", padding: 8 }}>백테스트 가능한 종목이 없습니다. (KIS 마스터 기준)</div>}
            {portfolio.map(h => (
              <div key={h.code} onClick={() => addSec(h)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 8px", borderRadius: 6, cursor: "pointer" }}>
                <span style={{ fontSize: 10, color: h.domestic ? "#22d3a0" : "#fbbf24" }}>{h.currency}</span>
                <span style={{ flex: 1, fontSize: 13, color: "#cbd5e1", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.name}</span>
                <span style={{ fontSize: 11, color: "#475569" }}>{h.code}</span>
              </div>
            ))}
          </div>
        )}

        <input placeholder="종목명 또는 코드/티커 검색 (예: 삼성전자, KODEX 200, QQQ)" value={query} onChange={e => setQuery(e.target.value)} style={Object.assign({}, inp, { width: "100%" })} />
        {(searching || results.length > 0) && query.trim() && (
          <div style={{ maxHeight: 240, overflowY: "auto", border: "1px solid #1e293b", borderRadius: 8, padding: 6, marginTop: 6 }}>
            {searching && <div style={{ fontSize: 12, color: "#64748b", padding: 8 }}>검색 중…</div>}
            {!searching && results.length === 0 && <div style={{ fontSize: 12, color: "#64748b", padding: 8 }}>결과 없음</div>}
            {results.map((it, i) => (
              <div key={it.code + "_" + i} onClick={() => { addSec(it); setQuery(""); setResults([]); }} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px", borderRadius: 6, cursor: "pointer" }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: it.domestic ? "#22d3a0" : "#fbbf24" }}>{it.currency}</span>
                <span style={{ flex: 1, fontSize: 13, color: "#cbd5e1", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.name}</span>
                <span style={{ fontSize: 11, color: "#475569" }}>{it.code}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={card}>
        <div style={label}>기간 (월봉 기준 · 최대 30년)</div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <select value={startY} onChange={e => setStartY(Number(e.target.value))} style={Object.assign({}, inp, { flex: 1, minWidth: 90 })}>
            {Array.from({ length: nowY - 1994 }, (_, i) => nowY - i).map(y => <option key={y} value={y}>{y}년</option>)}
          </select>
          <select value={startM} onChange={e => setStartM(Number(e.target.value))} style={Object.assign({}, inp, { width: 76 })}>
            {Array.from({ length: 12 }, (_, i) => i + 1).map(m => <option key={m} value={m}>{m}월</option>)}
          </select>
          <span style={{ color: "#64748b", fontSize: 14 }}>~</span>
          <select value={endY} onChange={e => setEndY(Number(e.target.value))} style={Object.assign({}, inp, { flex: 1, minWidth: 90 })}>
            {Array.from({ length: nowY - 1994 }, (_, i) => nowY - i).map(y => <option key={y} value={y}>{y}년</option>)}
          </select>
          <select value={endM} onChange={e => setEndM(Number(e.target.value))} style={Object.assign({}, inp, { width: 76 })}>
            {Array.from({ length: 12 }, (_, i) => i + 1).map(m => <option key={m} value={m}>{m}월</option>)}
          </select>
        </div>
      </div>

      {err && <div style={{ fontSize: 13, color: "#f87171", background: "#f8717111", border: "1px solid #f8717133", borderRadius: 8, padding: "9px 12px", marginBottom: 12 }}>{err}</div>}
      <button onClick={run} disabled={running} style={{ width: "100%", padding: 13, borderRadius: 10, border: "none", background: running ? "#334155" : "linear-gradient(135deg,#2563eb,#7c3aed)", color: "#fff", fontSize: 15, fontWeight: 700, cursor: running ? "default" : "pointer", marginBottom: 14 }}>
        {running ? "계산 중…" : "백테스트 실행"}
      </button>
      {warn && <div style={{ fontSize: 12.5, color: "#fbbf24", background: "#fbbf2411", border: "1px solid #fbbf2433", borderRadius: 8, padding: "9px 12px", marginBottom: 12 }}>{warn}</div>}
      {result && <BtResult result={result} />}
    </div>
  );
}

// ===== 결과 =====
function BtResult(props) {
  const { eng, secs, start, end, mode, rates, krwValue, krwPrincipal, fxOk } = props.result;
  const modeLabel = { lump: "거치식", dca: "적립식", both: "거치+적립" }[mode];
  const colors = btColors();
  const card = { background: "#0f0f18", border: "1px solid #1e293b", borderRadius: 12, padding: 14, marginBottom: 12 };
  const secHead = { fontSize: 13, fontWeight: 800, color: "#e8eaf0", margin: "18px 4px 8px" };
  const last = eng.monthly[eng.monthly.length - 1];
  const kpi = (title, val, color) => (
    <div style={{ flex: 1, textAlign: "center", padding: "10px 4px" }}>
      <div style={{ fontSize: 10.5, color: "#64748b", marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 14, fontWeight: 800, color: color || "#e8eaf0" }}>{val}</div>
    </div>
  );
  const krwRet = krwPrincipal > 0 ? (krwValue - krwPrincipal) / krwPrincipal : null;
  const colorOf = (t) => colors[secs.findIndex(x => x.ticker === t) % colors.length];
  const idxSeries = btIndexSeries(eng.monthly, secs).map(s => {
    const sec = secs.find(x => x.name === s.name) || {};
    return Object.assign({}, s, { color: colorOf(sec.ticker) });
  });
  const krwTotalLast = btKrwTotalAt(last, secs, rates);

  return (
    <div>
      {/* ── 최종 합산(원화 환산) ── */}
      <div style={card}>
        <div style={{ fontSize: 12, color: "#64748b", marginBottom: 6 }}>{start} ~ {end} · {modeLabel} · {secs.length}종목</div>
        <div style={{ fontSize: 11.5, fontWeight: 700, color: "#a8b4f8", marginBottom: 2 }}>최종 합산 (원화 환산)</div>
        <div style={{ display: "flex", flexWrap: "wrap" }}>
          {kpi("합산 평가액", fxOk ? btFmtAmt(krwValue, "KRW") : "-", "#e8eaf0")}
          {kpi("합산 원금", fxOk ? btFmtAmt(krwPrincipal, "KRW") : "-", "#94a3b8")}
        </div>
        <div style={{ display: "flex", borderTop: "1px solid #1e293b", marginTop: 4 }}>
          {kpi("총 수익률", fxOk ? btFmtPct(krwRet) : "-", krwRet >= 0 ? "#22d3a0" : "#f87171")}
        </div>
        {!fxOk && <div style={{ fontSize: 11, color: "#fbbf24", marginTop: 4 }}>· 일부 통화의 환율을 가져오지 못해 합산이 불가능합니다.</div>}
        <div style={{ fontSize: 10.5, color: "#475569", marginTop: 6, lineHeight: 1.5 }}>
          · 각 종목은 자기 통화로 계산되고(환율 변동 미반영), 원화 환산에는 종료월({end}) 환율만 사용했습니다.
          {eng.currencies.filter(c => c !== "KRW").map(c => (rates[c] > 0 ? " · " + c + "/KRW " + Math.round(rates[c]).toLocaleString("ko-KR") : "")).join("")}
        </div>
      </div>

      {/* ── 그래프 영역 ── */}
      {/* 그래프 1 — 통화별 평가액 추이 */}
      {eng.byCur.map(b => {
        const cur = b.currency;
        const curSecs = secs.filter(s => s.currency === cur);
        const pts = eng.monthly.map(p => ({ ym: p.ym, value: p.valByCur[cur] || 0, principal: p.prinByCur[cur] || 0 }));
        return (
          <div key={"g_" + cur}>
            <div style={secHead}>
              {cur === "KRW" ? "국내 (원화)" : "해외 (" + cur + ")"} <span style={{ fontSize: 11, color: "#64748b", fontWeight: 500 }}>· {curSecs.length}종목 · 자산 추이</span>
            </div>
            <div style={card}>
              <div style={{ display: "flex", flexWrap: "wrap" }}>
                {kpi("평가액", btFmtAmt(b.value, cur), "#e8eaf0")}
                {kpi("투자원금", btFmtAmt(b.principal, cur), "#94a3b8")}
              </div>
              <div style={{ display: "flex", borderTop: "1px solid #1e293b", marginTop: 4, marginBottom: 10 }}>
                {kpi("총 수익률", btFmtPct(b.totalReturn), b.totalReturn >= 0 ? "#22d3a0" : "#f87171")}
                {kpi("연환산(IRR)", btFmtPct(b.irr), b.irr >= 0 ? "#22d3a0" : "#f87171")}
              </div>
              <div style={{ display: "flex", gap: 14, marginBottom: 8, fontSize: 11.5 }}>
                <span style={{ color: "#22d3a0" }}>● 평가액</span>
                <span style={{ color: "#64748b" }}>┄ 투자원금</span>
              </div>
              <BtChart points={pts} currency={cur} />
            </div>
          </div>
        );
      })}

      {/* 그래프 2 — 종목별 평가액 추이, 통화별 */}
      {eng.byCur.map(b => {
        const cur = b.currency;
        const curSecs = secs.filter(s => s.currency === cur);
        if (curSecs.length < 2) return null;
        const series = curSecs.map(s => ({ name: s.name, color: colorOf(s.ticker), points: eng.monthly.map(p => ({ ym: p.ym, value: p.bySec[s.ticker] || 0 })) }));
        return (
          <div key={"m_" + cur} style={card}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#a8b4f8", marginBottom: 8 }}>종목별 평가액 추이 ({cur})</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 12px", marginBottom: 8, fontSize: 11 }}>
              {curSecs.map(s => (<span key={s.ticker} style={{ color: colorOf(s.ticker) }}>● {s.name}</span>))}
            </div>
            <BtMultiChart series={series} currency={cur} />
          </div>
        );
      })}

      {/* 그래프 3 — 전 종목 통합 수익률 지수, 통화 무관 */}
      {secs.length >= 2 && (
        <div style={card}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#a8b4f8", marginBottom: 4 }}>전 종목 수익률 비교 (시작=100)</div>
          <div style={{ fontSize: 10.5, color: "#475569", marginBottom: 8 }}>· 통화가 달라도 성장 배수는 비교 가능합니다. 시작 시점 대비 몇 배가 됐는지를 보여줍니다.</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 12px", marginBottom: 8, fontSize: 11 }}>
            {secs.map(s => (<span key={s.ticker} style={{ color: colorOf(s.ticker) }}>● {s.name} <span style={{ color: "#475569" }}>({s.currency})</span></span>))}
          </div>
          <BtIndexChart series={idxSeries} />
        </div>
      )}

      {/* ── 연도별 자산 변동 (통화별 총합) ── */}
      {eng.byCur.map(b => {
        const cur = b.currency;
        const yearly = btYearlyByCur(eng.monthly, cur);
        return (
          <div key={"y_" + cur} style={card}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#a8b4f8", marginBottom: 10 }}>연도별 자산 변동 · {cur === "KRW" ? "국내(원화)" : "해외(" + cur + ")"}</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1.3fr 1.3fr 1fr", gap: 4, fontSize: 11, color: "#64748b", paddingBottom: 6, borderBottom: "1px solid #1e293b" }}>
              <span>연도</span><span style={{ textAlign: "right" }}>투자원금</span><span style={{ textAlign: "right" }}>평가액</span><span style={{ textAlign: "right" }}>수익률</span>
            </div>
            {yearly.map(r => (
              <div key={r.year} style={{ display: "grid", gridTemplateColumns: "1fr 1.3fr 1.3fr 1fr", gap: 4, fontSize: 12.5, padding: "7px 0", borderBottom: "1px solid #12121f" }}>
                <span style={{ color: "#cbd5e1" }}>{r.year}</span>
                <span style={{ textAlign: "right", color: "#94a3b8" }}>{btFmtAmtShort(r.principal, cur)}</span>
                <span style={{ textAlign: "right", color: "#e8eaf0", fontWeight: 700 }}>{btFmtAmtShort(r.value, cur)}</span>
                <span style={{ textAlign: "right", color: r.ret >= 0 ? "#22d3a0" : "#f87171" }}>{btFmtPct(r.ret)}</span>
              </div>
            ))}
          </div>
        );
      })}

      {/* ── 종목별 상세 (비중=전체 원화환산 기준) ── */}
      <div style={secHead}>종목별 상세 <span style={{ fontSize: 11, color: "#64748b", fontWeight: 500 }}>· 비중은 전 종목 원화환산 기준</span></div>
      {secs.map(s => {
        const cur = s.currency;
        const fv = last.bySec[s.ticker] || 0;
        const fp = last.secPrin[s.ticker] || 0;
        const rt = rates[cur];
        const wt = (krwTotalLast > 0 && rt > 0) ? (fv * rt) / krwTotalLast : null;
        const ret = fp > 0 ? (fv - fp) / fp : null;
        const rows = btYearlyBySec(eng.monthly, s, secs, rates);
        const lab = btDividendLabel(s);
        return (
          <div key={s.ticker} style={card}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: colorOf(s.ticker), display: "inline-block" }}></span>
              <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: "#e8eaf0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</span>
              <span style={{ fontSize: 10, color: "#64748b" }}>{cur}</span>
              <span style={{ fontSize: 11, color: "#475569" }}>{s.ticker}</span>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", marginBottom: 4 }}>
              {kpi("최종 평가액", btFmtAmtShort(fv, cur), "#e8eaf0")}
              {kpi("비중(원화)", wt != null ? (wt * 100).toFixed(1) + "%" : "-", "#a8b4f8")}
              {kpi("수익률", btFmtPct(ret), ret >= 0 ? "#22d3a0" : "#f87171")}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1.3fr 1fr 1fr", gap: 4, fontSize: 10.5, color: "#64748b", paddingBottom: 5, borderBottom: "1px solid #1e293b" }}>
              <span>연도</span><span style={{ textAlign: "right" }}>평가액</span><span style={{ textAlign: "right" }}>비중</span><span style={{ textAlign: "right" }}>수익률</span>
            </div>
            {rows.map(r => (
              <div key={r.year} style={{ display: "grid", gridTemplateColumns: "1fr 1.3fr 1fr 1fr", gap: 4, fontSize: 12, padding: "6px 0", borderBottom: "1px solid #12121f" }}>
                <span style={{ color: "#cbd5e1" }}>{r.year}</span>
                <span style={{ textAlign: "right", color: "#e8eaf0" }}>{btFmtAmtShort(r.value, cur)}</span>
                <span style={{ textAlign: "right", color: "#94a3b8" }}>{r.weight != null ? (r.weight * 100).toFixed(1) + "%" : "-"}</span>
                <span style={{ textAlign: "right", color: r.ret >= 0 ? "#22d3a0" : "#f87171" }}>{btFmtPct(r.ret)}</span>
              </div>
            ))}
            <div style={{ fontSize: 11, color: lab.color, marginTop: 8 }}>{lab.txt}</div>
          </div>
        );
      })}

      <div style={{ fontSize: 10.5, color: "#475569", padding: "0 4px 8px", lineHeight: 1.6 }}>
        · 국내 ETF·해외 종목은 배당/분배금이 재투자된 총수익(TR) 기준, 국내 개별주는 현금배당 미반영(가격수익률) 기준.<br />
        · 종목별 비중은 전 종목을 원화로 환산한 총액 기준(종료월 환율 사용).
      </div>
    </div>
  );
}
