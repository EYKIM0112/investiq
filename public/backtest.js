// public/backtest.js — InvestIQ 백테스트 탭 (독립 모듈)
// index.html에서 아래 한 줄로 로드(메인 앱 스크립트 직전):
//   <script type="text/babel" data-presets="react-classic" src="/backtest.js"></script>
//
// 설계 원칙:
// 1. 전역 렉시컬 스코프는 여러 text/babel 스크립트가 공유 → 최상위 선언은 전부 function 선언 + bt/Bt 접두어.
// 2. 훅은 컴포넌트 함수 안에서 React.useState 등으로 접근(top-level 재선언 금지 — index.html의 const 충돌 방지).
// 3. 자기완결형: 자체 fetch·자체 SVG 차트·마스터 JSON 직접 로드. 모듈 캐시는 window.__bt* 에 보관.
//
// 데이터 정책(실증 확정):
//   국내 ETF  : /api/kis-history adj=0 → 분배금 반영(TR)
//   국내 개별주: /api/kis-history adj=0 → 현금배당 미반영(가격수익률)
//   해외      : /api/yahoo adjclose → 배당 재투자 반영(TR), 과거 월별 KRW=X로 원화 환산
//   조회주기  : 월봉(M) 고정 / 적립: 매월 말 종가 기준
//   배분      : 비중(%) 또는 종목별 금액 직접입력 (거치·적립 각각)

// ===== 유틸 =====
function btKrCodeRe() { return /^\d{4}[0-9A-Z]{2}$/; }
function btIsDomestic(t) { return btKrCodeRe().test(String(t || "").trim().toUpperCase()); }
function btColors() { return ["#22d3a0", "#4f6ef7", "#fbbf24", "#f472b6", "#38bdf8"]; }
function btFmtWon(n) { if (n == null || !isFinite(n)) return "-"; return Math.round(n).toLocaleString("ko-KR") + "원"; }
function btFmtWonShort(n) {
  if (n == null || !isFinite(n)) return "-";
  const a = Math.abs(n);
  if (a >= 1e8) return (n / 1e8).toFixed(2) + "억";
  if (a >= 1e4) return Math.round(n / 1e4).toLocaleString("ko-KR") + "만";
  return Math.round(n).toLocaleString("ko-KR");
}
function btFmtPct(n) { if (n == null || !isFinite(n)) return "-"; return (n >= 0 ? "+" : "") + (n * 100).toFixed(2) + "%"; }
function btTodayYmd() { const d = new Date(Date.now() + 9 * 3600 * 1000); return "" + d.getUTCFullYear() + String(d.getUTCMonth() + 1).padStart(2, "0") + String(d.getUTCDate()).padStart(2, "0"); }
function btCurYear() { return new Date(Date.now() + 9 * 3600 * 1000).getUTCFullYear(); }
function btCurMonth() { return new Date(Date.now() + 9 * 3600 * 1000).getUTCMonth() + 1; }
function btMonthIndex(ym, baseYm) { const [y, m] = ym.split("-").map(Number); const [by, bm] = baseYm.split("-").map(Number); return (y - by) * 12 + (m - bm); }

// ===== 캐시 =====
function btCacheGet(key, maxAgeMs) { try { const o = JSON.parse(localStorage.getItem(key) || "null"); if (o && o.data && Date.now() - o.ts < maxAgeMs) return o.data; } catch (e) {} return null; }
function btCacheSet(key, data) { try { localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data })); } catch (e) {} }

// ===== 마스터(검색·ETF판별) =====
async function btLoadMasterDom() {
  if (window.__btMasterDom) return window.__btMasterDom;
  try {
    const r = await fetch("/kis_master.json", { signal: AbortSignal.timeout(10000) });
    if (!r.ok) return null;
    const d = await r.json();
    const list = [];
    const push = (dict, type) => { if (!dict) return; for (const code in dict) list.push({ code, name: dict[code], type, domestic: true }); };
    push(d.etf, "etf"); push(d.stock, "stock");
    window.__btMasterDom = { list, etf: d.etf || {}, stock: d.stock || {} };
    return window.__btMasterDom;
  } catch (e) { return null; }
}
function btDomType(code) { const m = window.__btMasterDom; if (!m) return null; const c = String(code || "").toUpperCase(); if (m.etf[c]) return "etf"; if (m.stock[c]) return "stock"; return null; }

async function btSearch(q) {
  const out = [];
  const nq = q.replace(/\s+/g, "").toLowerCase();
  if (!nq) return out;
  const dom = await btLoadMasterDom();
  if (dom) {
    const scored = [];
    for (const it of dom.list) {
      const nm = String(it.name).replace(/\s+/g, "").toLowerCase();
      const code = it.code.toLowerCase();
      let score = 0;
      if (nm === nq) score = 100;            // 이름 정확히 일치
      else if (code === nq) score = 95;      // 코드 정확히 일치
      else if (nm.startsWith(nq)) score = 80; // 이름 앞부분 일치
      else if (code.startsWith(nq)) score = 70;
      else if (nm.includes(nq)) score = 40;  // 이름 부분 포함
      else if (code.includes(nq)) score = 20;
      if (score > 0) scored.push({ it, score, nlen: nm.length });
    }
    // 점수 내림차순 → 이름 짧은 순(더 정확) → 가나다순
    scored.sort((a, b) => (b.score - a.score) || (a.nlen - b.nlen) || (a.it.name < b.it.name ? -1 : 1));
    for (let i = 0; i < scored.length && i < 12; i++) out.push(scored[i].it);
  }
  try {
    const r = await fetch("/api/yahoo?type=search&q=" + encodeURIComponent(q), { signal: AbortSignal.timeout(8000) });
    if (r.ok) {
      const d = await r.json();
      const qs = d.quotes || [];
      let cnt = 0;
      for (const x of qs) {
        const sym = x.symbol || "";
        if (!sym || /\.(KS|KQ)$/i.test(sym)) continue;
        const qt = (x.quoteType || "").toUpperCase();
        if (qt !== "EQUITY" && qt !== "ETF") continue;
        out.push({ code: sym, name: x.shortname || x.longname || sym, type: qt.toLowerCase(), domestic: false });
        if (++cnt >= 8) break;
      }
    }
  } catch (e) {}
  return out;
}

// ===== 시세 fetch =====
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
async function btFetchOverseas(ticker) {
  const key = "bt_ovs_" + ticker;
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
async function btFetchFx() {
  const key = "bt_fx_krw";
  const cached = btCacheGet(key, 12 * 3600 * 1000);
  if (cached) return new Map(cached);
  const url = "/api/yahoo?type=chart&ticker=" + encodeURIComponent("KRW=X") + "&interval=1mo&range=max";
  const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error("환율(USD/KRW) 조회 실패");
  const d = await r.json();
  const arr = btParseYahooMonthly(d, false);
  if (!arr.length) throw new Error("환율 데이터 없음");
  const pairs = arr.map(o => [o.ym, o.close]);
  btCacheSet(key, pairs);
  return new Map(pairs);
}

// ===== 엔진 (종목별 거치/적립 금액 기반) =====
// securities: [{ticker, name, domestic, type, lumpAmt, dcaAmt}]  (KRW, 종목별 절대금액)
function btRunEngine(opts) {
  const { securities, seriesKRW, months, mode } = opts;
  const shares = {}, secPrin = {};
  securities.forEach(s => { shares[s.ticker] = 0; secPrin[s.ticker] = 0; });
  let principal = 0;
  const cfAmt = [], cfIdx = [];
  const base = months[0];
  const monthly = [];
  months.forEach((ym, idx) => {
    let monthInvest = 0;
    securities.forEach(s => {
      let iv = 0;
      if (idx === 0) {
        if (mode === "lump" || mode === "both") iv += s.lumpAmt;
        if (mode === "dca") iv += s.dcaAmt;
      } else if (mode === "dca" || mode === "both") {
        iv += s.dcaAmt;
      }
      if (iv > 0) {
        const px = seriesKRW[s.ticker].get(ym);
        if (px > 0) { shares[s.ticker] += iv / px; secPrin[s.ticker] += iv; monthInvest += iv; }
      }
    });
    if (monthInvest > 0) { principal += monthInvest; cfAmt.push(-monthInvest); cfIdx.push(btMonthIndex(ym, base)); }
    let value = 0; const bySec = {};
    securities.forEach(s => { const px = seriesKRW[s.ticker].get(ym); const v = px > 0 ? shares[s.ticker] * px : 0; bySec[s.ticker] = v; value += v; });
    monthly.push({ ym, value, principal, bySec, secPrin: Object.assign({}, secPrin) });
  });
  const last = monthly[monthly.length - 1];
  const irr = btIRR(cfAmt.concat([last.value]), cfIdx.concat([btMonthIndex(last.ym, base)]));
  const totalReturn = principal > 0 ? (last.value - principal) / principal : null;
  return { monthly, finalValue: last.value, principal, totalReturn, irr };
}
function btIRR(amounts, idxs) {
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
function btYearly(monthly) {
  const byYear = new Map();
  monthly.forEach(p => { byYear.set(p.ym.slice(0, 4), p); });
  return Array.from(byYear, ([year, p]) => ({ year, value: p.value, principal: p.principal })).sort((a, b) => (a.year < b.year ? -1 : 1));
}
function btYearlyBySec(monthly, ticker) {
  const byYear = new Map();
  monthly.forEach(p => { byYear.set(p.ym.slice(0, 4), p); });
  return Array.from(byYear, ([year, p]) => {
    const value = p.bySec[ticker] || 0; const prin = p.secPrin[ticker] || 0; const total = p.value || 0;
    return { year, value, principal: prin, weight: total > 0 ? value / total : 0, ret: prin > 0 ? (value - prin) / prin : null };
  }).sort((a, b) => (a.year < b.year ? -1 : 1));
}
function btDividendLabel(s) {
  if (!s.domestic) return { txt: "해외 · 배당 재투자 반영(TR)", color: "#22d3a0" };
  const type = s.type || btDomType(s.ticker);
  if (type === "etf") return { txt: "국내 ETF · 분배금 반영(TR)", color: "#22d3a0" };
  if (type === "stock") return { txt: "국내 개별주 · 현금배당 미반영", color: "#94a3b8" };
  return { txt: "국내 · ETF는 반영·개별주는 미반영", color: "#64748b" };
}

// ===== SVG: 총자산 =====
function BtChart(props) {
  const monthly = props.monthly || [];
  if (monthly.length < 2) return null;
  const W = 700, H = 300, padL = 8, padR = 12, padT = 14, padB = 26;
  const maxV = Math.max.apply(null, monthly.map(p => Math.max(p.value, p.principal))) || 1;
  const n = monthly.length;
  const x = (i) => padL + (i / (n - 1)) * (W - padL - padR);
  const y = (v) => padT + (1 - v / maxV) * (H - padT - padB);
  const path = (sel) => monthly.map((p, i) => (i === 0 ? "M" : "L") + x(i).toFixed(1) + " " + y(sel(p)).toFixed(1)).join(" ");
  const areaPath = path(p => p.value) + " L" + x(n - 1).toFixed(1) + " " + y(0).toFixed(1) + " L" + x(0).toFixed(1) + " " + y(0).toFixed(1) + " Z";
  const ticks = []; for (let k = 0; k <= 4; k++) ticks.push(maxV * (k / 4));
  const yearMarks = []; const seen = {};
  monthly.forEach((p, i) => { const yy = p.ym.slice(0, 4); if (!seen[yy]) { seen[yy] = true; yearMarks.push({ i, label: yy }); } });
  const step = Math.ceil(yearMarks.length / 8);
  const shownYears = yearMarks.filter((_, k) => k % step === 0);
  return (
    <svg viewBox={"0 0 " + W + " " + H} style={{ width: "100%", height: "auto", display: "block" }}>
      <defs>
        <linearGradient id="btArea" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#22d3a0" stopOpacity="0.28" />
          <stop offset="100%" stopColor="#22d3a0" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {ticks.map((v, k) => (
        <g key={k}>
          <line x1={padL} y1={y(v)} x2={W - padR} y2={y(v)} stroke="#1e293b" strokeWidth="1" />
          <text x={padL + 2} y={y(v) - 3} fill="#475569" fontSize="11">{btFmtWonShort(v)}</text>
        </g>
      ))}
      {shownYears.map((m, k) => (<text key={k} x={x(m.i)} y={H - 8} fill="#64748b" fontSize="11" textAnchor="middle">{m.label}</text>))}
      <path d={areaPath} fill="url(#btArea)" />
      <path d={path(p => p.principal)} fill="none" stroke="#64748b" strokeWidth="1.6" strokeDasharray="4 3" />
      <path d={path(p => p.value)} fill="none" stroke="#22d3a0" strokeWidth="2.2" />
    </svg>
  );
}
// ===== SVG: 종목별 멀티라인 =====
function BtMultiChart(props) {
  const series = props.series || [];
  if (!series.length || !series[0].points || series[0].points.length < 2) return null;
  const W = 700, H = 280, padL = 8, padR = 12, padT = 14, padB = 26;
  const n = series[0].points.length;
  let maxV = 0; series.forEach(s => s.points.forEach(p => { if (p.value > maxV) maxV = p.value; }));
  if (maxV <= 0) maxV = 1;
  const x = (i) => padL + (i / (n - 1)) * (W - padL - padR);
  const y = (v) => padT + (1 - v / maxV) * (H - padT - padB);
  const path = (pts) => pts.map((p, i) => (i === 0 ? "M" : "L") + x(i).toFixed(1) + " " + y(p.value).toFixed(1)).join(" ");
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
          <text x={padL + 2} y={y(v) - 3} fill="#475569" fontSize="11">{btFmtWonShort(v)}</text>
        </g>
      ))}
      {shownYears.map((m, k) => (<text key={k} x={x(m.i)} y={H - 8} fill="#64748b" fontSize="11" textAnchor="middle">{m.label}</text>))}
      {series.map((s, si) => (<path key={si} d={path(s.points)} fill="none" stroke={s.color} strokeWidth="2" />))}
    </svg>
  );
}

// ===== 포트폴리오 =====
function btLoadPortfolio() {
  try {
    const p = JSON.parse(localStorage.getItem("portfolio_v1") || "null");
    const hs = (p && p.holdings) || [];
    const seen = {}; const out = [];
    hs.forEach(h => { const t = String(h.ticker || "").trim().toUpperCase(); if (!t || seen[t]) return; seen[t] = true; out.push({ ticker: t, name: h.name || t, domestic: btIsDomestic(t) }); });
    return out;
  } catch (e) { return []; }
}

// ===== 메인 =====
function BacktestTab() {
  const { useState, useMemo, useRef, useEffect } = React;
  const nowY = btCurYear();

  const [secs, setSecs] = useState([]); // [{ticker,name,domestic,type,weight,lumpMan,dcaMan}]
  const [startY, setStartY] = useState(nowY - 5);
  const [startM, setStartM] = useState(1);
  const [endY, setEndY] = useState(nowY);
  const [endM, setEndM] = useState(btCurMonth());
  const [mode, setMode] = useState("lump");       // lump | dca | both (투자 방식)
  const [allocMode, setAllocMode] = useState("weight"); // weight | amount (배분 방식)
  const [lumpMan, setLumpMan] = useState(1000);   // weight모드 총 거치금(만원)
  const [dcaMan, setDcaMan] = useState(50);       // weight모드 총 적립금(만원)
  const [showPicker, setShowPicker] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);

  const [running, setRunning] = useState(false);
  const [err, setErr] = useState("");
  const [warn, setWarn] = useState("");
  const [result, setResult] = useState(null);

  const timer = useRef(null);
  const portfolio = useMemo(() => btLoadPortfolio(), [showPicker]);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const q = query.trim();
    if (q.length < 1) { setResults([]); setSearching(false); return; }
    setSearching(true);
    timer.current = setTimeout(async () => {
      try { const r = await btSearch(q); setResults(r); } catch (e) { setResults([]); }
      setSearching(false);
    }, 300);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [query]);

  const addSec = (s) => {
    setErr("");
    const ticker = String((s && (s.ticker || s.code)) || "").trim().toUpperCase();
    if (!ticker) { setErr("종목 코드를 확인할 수 없어."); return; }
    if (secs.length >= 5) { setErr("종목은 최대 5개까지야."); return; }
    if (secs.some(x => x.ticker === ticker)) { setErr("이미 추가된 종목이야."); return; }
    const domestic = (s && s.domestic != null) ? s.domestic : btIsDomestic(ticker);
    const next = secs.concat([{ ticker, name: (s && s.name) || ticker, domestic, type: (s && s.type) || null, weight: 0, lumpMan: 0, dcaMan: 0 }]);
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
  const switchAlloc = (m) => {
    if (m === "amount") {
      const anyAmt = secs.some(s => (Number(s.lumpMan) || 0) > 0 || (Number(s.dcaMan) || 0) > 0);
      if (!anyAmt && secs.length) {
        setSecs(secs.map(s => Object.assign({}, s, {
          lumpMan: Math.round((Number(lumpMan) || 0) * (Number(s.weight) || 0) / 100),
          dcaMan: Math.round((Number(dcaMan) || 0) * (Number(s.weight) || 0) / 100),
        })));
      }
    }
    setAllocMode(m);
  };

  const weightSum = secs.reduce((s, x) => s + (Number(x.weight) || 0), 0);
  const sumLumpMan = secs.reduce((s, x) => s + (Number(x.lumpMan) || 0), 0);
  const sumDcaMan = secs.reduce((s, x) => s + (Number(x.dcaMan) || 0), 0);
  const needLump = mode === "lump" || mode === "both";
  const needDca = mode === "dca" || mode === "both";

  const run = async () => {
    setErr(""); setWarn(""); setResult(null);
    if (!secs.length) { setErr("종목을 1개 이상 추가해줘."); return; }
    if (secs.some(s => !s.ticker)) { setErr("종목 정보가 올바르지 않아. 해당 종목을 지우고 다시 추가해줘."); return; }
    const reqStart = startY + "-" + String(startM).padStart(2, "0");
    const reqEnd = endY + "-" + String(endM).padStart(2, "0");
    if (reqStart > reqEnd) { setErr("시작 시점이 종료 시점보다 늦어."); return; }

    let engSecs;
    if (allocMode === "weight") {
      if (Math.abs(weightSum - 100) > 0.5) { setErr("비중 합이 100%가 되어야 해 (현재 " + weightSum.toFixed(1) + "%). '균등 배분'을 눌러도 돼."); return; }
      const totalLump = (Number(lumpMan) || 0) * 10000;
      const totalDca = (Number(dcaMan) || 0) * 10000;
      if (needLump && totalLump <= 0) { setErr("거치 금액을 입력해줘."); return; }
      if (needDca && totalDca <= 0) { setErr("적립 금액을 입력해줘."); return; }
      engSecs = secs.map(s => { const w = (Number(s.weight) || 0) / 100; return { ticker: s.ticker, name: s.name, domestic: s.domestic, type: s.type || null, lumpAmt: totalLump * w, dcaAmt: totalDca * w }; });
    } else {
      if (needLump && sumLumpMan <= 0) { setErr("종목별 거치 금액을 입력해줘."); return; }
      if (needDca && sumDcaMan <= 0) { setErr("종목별 적립 금액을 입력해줘."); return; }
      engSecs = secs.map(s => ({ ticker: s.ticker, name: s.name, domestic: s.domestic, type: s.type || null, lumpAmt: (Number(s.lumpMan) || 0) * 10000, dcaAmt: (Number(s.dcaMan) || 0) * 10000 }));
    }

    setRunning(true);
    try {
      const endYmd = btTodayYmd();
      const hasOverseas = secs.some(s => !s.domestic);
      const seriesRaw = {};
      await Promise.all(secs.map(async s => { seriesRaw[s.ticker] = s.domestic ? await btFetchDomestic(s.ticker, endYmd) : await btFetchOverseas(s.ticker); }));
      const fx = hasOverseas ? await btFetchFx() : null;

      const seriesKRW = {};
      secs.forEach(s => {
        const m = new Map();
        seriesRaw[s.ticker].forEach(o => {
          if (o.ym < reqStart || o.ym > reqEnd) return;
          if (s.domestic) m.set(o.ym, o.close);
          else { const rate = fx.get(o.ym); if (rate > 0) m.set(o.ym, o.close * rate); }
        });
        seriesKRW[s.ticker] = m;
      });

      let commonYms = null;
      secs.forEach(s => { const ks = new Set(seriesKRW[s.ticker].keys()); commonYms = commonYms === null ? ks : new Set([...commonYms].filter(y => ks.has(y))); });
      const months = Array.from(commonYms || []).sort();
      if (months.length < 2) { setErr("공통으로 조회되는 월 데이터가 부족해. 종목 상장 시기나 기간을 확인해줘."); setRunning(false); return; }
      if (months[0] > reqStart) setWarn("일부 종목의 데이터 시작이 늦어, 백테스트는 " + months[0] + "부터 시작했어.");

      const eng = btRunEngine({ securities: engSecs, seriesKRW, months, mode });
      setResult({ eng, yearly: btYearly(eng.monthly), secs: engSecs, start: months[0], end: months[months.length - 1], mode });
    } catch (e) {
      setErr(e.message || "백테스트 중 오류가 발생했어.");
    } finally {
      setRunning(false);
    }
  };

  const card = { background: "#0f0f18", border: "1px solid #1e293b", borderRadius: 12, padding: 14, marginBottom: 12 };
  const label = { fontSize: 12, fontWeight: 700, color: "#a8b4f8", marginBottom: 8 };
  const inp = { background: "#0a0a12", border: "1px solid #2a2a48", borderRadius: 8, color: "#e8eaf0", fontSize: 14, padding: "8px 10px", outline: "none" };
  const segBtn = (active) => ({ flex: 1, padding: "9px 0", borderRadius: 8, border: "none", fontSize: 12.5, fontWeight: 700, cursor: "pointer", background: active ? "#4f6ef7" : "#0a0a12", color: active ? "#fff" : "#94a3b8" });
  const miniInp = Object.assign({}, inp, { width: 70, padding: "6px 8px", textAlign: "right", fontSize: 13 });

  return (
    <div>
      {/* 투자 설정 */}
      <div style={card}>
        <div style={label}>투자 방식</div>
        <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
          <button onClick={() => setMode("lump")} style={segBtn(mode === "lump")}>거치식</button>
          <button onClick={() => setMode("dca")} style={segBtn(mode === "dca")}>적립식</button>
          <button onClick={() => setMode("both")} style={segBtn(mode === "both")}>거치+적립</button>
        </div>
        <div style={label}>배분 방식</div>
        <div style={{ display: "flex", gap: 6, marginBottom: allocMode === "weight" ? 12 : 0 }}>
          <button onClick={() => switchAlloc("weight")} style={segBtn(allocMode === "weight")}>비중(%)</button>
          <button onClick={() => switchAlloc("amount")} style={segBtn(allocMode === "amount")}>금액 직접입력</button>
        </div>
        {allocMode === "weight" && (
          <div>
            {needLump && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 13, color: "#94a3b8", width: 92 }}>{mode === "both" ? "초기 거치금(총)" : "거치 금액(총)"}</span>
                <input type="number" value={lumpMan} onChange={e => setLumpMan(e.target.value)} style={Object.assign({}, inp, { flex: 1, textAlign: "right" })} />
                <span style={{ fontSize: 13, color: "#94a3b8" }}>만원</span>
              </div>
            )}
            {needDca && (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 13, color: "#94a3b8", width: 92 }}>매월 적립금(총)</span>
                <input type="number" value={dcaMan} onChange={e => setDcaMan(e.target.value)} style={Object.assign({}, inp, { flex: 1, textAlign: "right" })} />
                <span style={{ fontSize: 13, color: "#94a3b8" }}>만원</span>
              </div>
            )}
            <div style={{ fontSize: 11, color: "#64748b", marginTop: 8 }}>· 총액을 아래 종목별 비중대로 나눠서 투자해.{needDca ? " 적립은 매월 말 종가 기준." : ""}</div>
          </div>
        )}
        {allocMode === "amount" && <div style={{ fontSize: 11, color: "#64748b", marginTop: 8 }}>· 아래 종목별로 금액을 직접 입력해.{needDca ? " 적립은 매월 말 종가 기준." : ""}</div>}
      </div>

      {/* 종목 */}
      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={label}>종목 (최대 5개){allocMode === "weight" ? " · 시작 비중 %" : " · 종목별 금액(만원)"}</div>
          {allocMode === "weight" && secs.length > 0 && <button onClick={equalize} style={Object.assign({}, inp, { padding: "4px 8px", fontSize: 11, cursor: "pointer", color: "#a8b4f8" })}>균등 배분</button>}
        </div>

        {secs.map(s => (
          <div key={s.ticker} style={{ marginBottom: 10, paddingBottom: 10, borderBottom: "1px solid #12121f" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: s.domestic ? "#22d3a0" : "#fbbf24", border: "1px solid " + (s.domestic ? "#22d3a033" : "#fbbf2433"), borderRadius: 5, padding: "2px 5px", whiteSpace: "nowrap" }}>{s.domestic ? "국내" : "해외"}</span>
              <span style={{ flex: 1, fontSize: 13, color: "#e8eaf0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}<span style={{ color: "#475569", fontSize: 11 }}> {s.ticker}</span></span>
              {allocMode === "weight" && <input type="number" value={s.weight} onChange={e => patchSec(s.ticker, { weight: e.target.value })} style={miniInp} />}
              {allocMode === "weight" && <span style={{ fontSize: 12, color: "#64748b" }}>%</span>}
              <button onClick={() => removeSec(s.ticker)} style={{ background: "none", border: "none", color: "#f87171", fontSize: 18, cursor: "pointer", lineHeight: 1 }}>×</button>
            </div>
            {allocMode === "amount" && (needLump || needDca) && (
              <div style={{ display: "flex", gap: 10, marginTop: 8, paddingLeft: 4, flexWrap: "wrap" }}>
                {needLump && (
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 12, color: "#94a3b8" }}>거치</span>
                    <input type="number" value={s.lumpMan} onChange={e => patchSec(s.ticker, { lumpMan: e.target.value })} style={miniInp} />
                    <span style={{ fontSize: 12, color: "#64748b" }}>만</span>
                  </div>
                )}
                {needDca && (
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 12, color: "#94a3b8" }}>적립</span>
                    <input type="number" value={s.dcaMan} onChange={e => patchSec(s.ticker, { dcaMan: e.target.value })} style={miniInp} />
                    <span style={{ fontSize: 12, color: "#64748b" }}>만</span>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}

        {secs.length > 0 && allocMode === "weight" && <div style={{ fontSize: 11, color: Math.abs(weightSum - 100) < 0.5 ? "#22d3a0" : "#fbbf24", margin: "2px 0 10px", textAlign: "right" }}>비중 합 {weightSum.toFixed(1)}%</div>}
        {secs.length > 0 && allocMode === "amount" && (
          <div style={{ fontSize: 11, color: "#94a3b8", margin: "2px 0 10px", textAlign: "right" }}>
            {needLump ? "거치 합 " + sumLumpMan.toLocaleString("ko-KR") + "만원" : ""}{needLump && needDca ? " · " : ""}{needDca ? "월 적립 합 " + sumDcaMan.toLocaleString("ko-KR") + "만원" : ""}
          </div>
        )}

        <button onClick={() => setShowPicker(!showPicker)} style={Object.assign({}, inp, { width: "100%", cursor: "pointer", color: "#a8b4f8", fontWeight: 700, marginBottom: showPicker ? 8 : 10 })}>＋ 내 포트폴리오에서 추가</button>
        {showPicker && (
          <div style={{ maxHeight: 180, overflowY: "auto", border: "1px solid #1e293b", borderRadius: 8, padding: 6, marginBottom: 10 }}>
            {portfolio.length === 0 && <div style={{ fontSize: 12, color: "#64748b", padding: 8 }}>포트폴리오가 비어있어.</div>}
            {portfolio.map(h => (
              <div key={h.ticker} onClick={() => addSec(h)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 8px", borderRadius: 6, cursor: "pointer" }}>
                <span style={{ fontSize: 10, color: h.domestic ? "#22d3a0" : "#fbbf24" }}>{h.domestic ? "국내" : "해외"}</span>
                <span style={{ flex: 1, fontSize: 13, color: "#cbd5e1", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.name}</span>
                <span style={{ fontSize: 11, color: "#475569" }}>{h.ticker}</span>
              </div>
            ))}
          </div>
        )}

        <input placeholder="종목명 또는 코드/티커 검색 (예: 코스피, KODEX 200, AAPL)" value={query} onChange={e => setQuery(e.target.value)} style={Object.assign({}, inp, { width: "100%" })} />
        {(searching || results.length > 0) && query.trim() && (
          <div style={{ maxHeight: 220, overflowY: "auto", border: "1px solid #1e293b", borderRadius: 8, padding: 6, marginTop: 6 }}>
            {searching && <div style={{ fontSize: 12, color: "#64748b", padding: 8 }}>검색 중…</div>}
            {!searching && results.length === 0 && <div style={{ fontSize: 12, color: "#64748b", padding: 8 }}>결과 없음</div>}
            {results.map((it, i) => (
              <div key={it.code + "_" + i} onClick={() => { addSec(it); setQuery(""); setResults([]); }} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px", borderRadius: 6, cursor: "pointer" }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: it.domestic ? "#22d3a0" : "#fbbf24" }}>{it.domestic ? "국내" : "해외"}</span>
                <span style={{ flex: 1, fontSize: 13, color: "#cbd5e1", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.name}</span>
                <span style={{ fontSize: 11, color: "#475569" }}>{it.code}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 기간 */}
      <div style={card}>
        <div style={label}>기간 (월봉 기준)</div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <select value={startY} onChange={e => setStartY(Number(e.target.value))} style={Object.assign({}, inp, { flex: 1, minWidth: 90 })}>
            {Array.from({ length: nowY - 1999 }, (_, i) => nowY - i).map(y => <option key={y} value={y}>{y}년</option>)}
          </select>
          <select value={startM} onChange={e => setStartM(Number(e.target.value))} style={Object.assign({}, inp, { width: 76 })}>
            {Array.from({ length: 12 }, (_, i) => i + 1).map(m => <option key={m} value={m}>{m}월</option>)}
          </select>
          <span style={{ color: "#64748b", fontSize: 14 }}>~</span>
          <select value={endY} onChange={e => setEndY(Number(e.target.value))} style={Object.assign({}, inp, { flex: 1, minWidth: 90 })}>
            {Array.from({ length: nowY - 1999 }, (_, i) => nowY - i).map(y => <option key={y} value={y}>{y}년</option>)}
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
  const { eng, yearly, secs, start, end, mode } = props.result;
  const modeLabel = { lump: "거치식", dca: "적립식", both: "거치+적립" }[mode];
  const colors = btColors();
  const card = { background: "#0f0f18", border: "1px solid #1e293b", borderRadius: 12, padding: 14, marginBottom: 12 };
  const last = eng.monthly[eng.monthly.length - 1];
  const kpi = (title, val, color) => (
    <div style={{ flex: 1, textAlign: "center", padding: "10px 4px" }}>
      <div style={{ fontSize: 10.5, color: "#64748b", marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 14, fontWeight: 800, color: color || "#e8eaf0" }}>{val}</div>
    </div>
  );
  const retColor = eng.totalReturn >= 0 ? "#22d3a0" : "#f87171";
  const secSeries = secs.map((s, i) => ({ name: s.name, color: colors[i % colors.length], points: eng.monthly.map(p => ({ ym: p.ym, value: p.bySec[s.ticker] || 0 })) }));

  return (
    <div>
      <div style={card}>
        <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>{start} ~ {end} · {modeLabel} · {secs.length}종목</div>
        <div style={{ display: "flex", flexWrap: "wrap" }}>
          {kpi("최종 평가액", btFmtWon(eng.finalValue), "#e8eaf0")}
          {kpi("총 투자원금", btFmtWon(eng.principal), "#94a3b8")}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", borderTop: "1px solid #1e293b", marginTop: 4 }}>
          {kpi("총 수익률", btFmtPct(eng.totalReturn), retColor)}
          {kpi("연환산(IRR)", btFmtPct(eng.irr), eng.irr >= 0 ? "#22d3a0" : "#f87171")}
        </div>
        <div style={{ fontSize: 10.5, color: "#475569", marginTop: 6, padding: "0 2px", lineHeight: 1.5 }}>
          · 총수익률은 투자원금 대비 누적(투자 시점 무관), 연환산(IRR)은 투자 시점·기간까지 반영한 연복리 수익률이야. 적립식처럼 돈을 나눠 넣으면 두 값이 다르게 나오는 게 정상이야.
        </div>
      </div>

      <div style={card}>
        <div style={{ display: "flex", gap: 14, marginBottom: 8, fontSize: 11.5 }}>
          <span style={{ color: "#22d3a0" }}>● 평가액(총합)</span>
          <span style={{ color: "#64748b" }}>┄ 투자원금</span>
        </div>
        <BtChart monthly={eng.monthly} />
      </div>

      <div style={card}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#a8b4f8", marginBottom: 10 }}>연도별 자산 변동 (총합)</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1.3fr 1.3fr 1fr", gap: 4, fontSize: 11, color: "#64748b", paddingBottom: 6, borderBottom: "1px solid #1e293b" }}>
          <span>연도</span><span style={{ textAlign: "right" }}>투자원금</span><span style={{ textAlign: "right" }}>평가액</span><span style={{ textAlign: "right" }}>수익률</span>
        </div>
        {yearly.map(row => {
          const ret = row.principal > 0 ? (row.value - row.principal) / row.principal : null;
          return (
            <div key={row.year} style={{ display: "grid", gridTemplateColumns: "1fr 1.3fr 1.3fr 1fr", gap: 4, fontSize: 12.5, padding: "7px 0", borderBottom: "1px solid #12121f" }}>
              <span style={{ color: "#cbd5e1" }}>{row.year}</span>
              <span style={{ textAlign: "right", color: "#94a3b8" }}>{btFmtWonShort(row.principal)}</span>
              <span style={{ textAlign: "right", color: "#e8eaf0", fontWeight: 700 }}>{btFmtWonShort(row.value)}</span>
              <span style={{ textAlign: "right", color: ret >= 0 ? "#22d3a0" : "#f87171" }}>{btFmtPct(ret)}</span>
            </div>
          );
        })}
      </div>

      {secs.length >= 2 && (
        <div style={card}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#a8b4f8", marginBottom: 8 }}>종목별 평가액 비교</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 12px", marginBottom: 8, fontSize: 11 }}>
            {secs.map((s, i) => (<span key={s.ticker} style={{ color: colors[i % colors.length] }}>● {s.name}</span>))}
          </div>
          <BtMultiChart series={secSeries} />
        </div>
      )}

      {secs.map((s, i) => {
        const fv = last.bySec[s.ticker] || 0;
        const fp = last.secPrin[s.ticker] || 0;
        const wt = last.value > 0 ? fv / last.value : 0;
        const ret = fp > 0 ? (fv - fp) / fp : null;
        const rows = btYearlyBySec(eng.monthly, s.ticker);
        const lab = btDividendLabel(s);
        return (
          <div key={s.ticker} style={card}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: colors[i % colors.length], display: "inline-block" }}></span>
              <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: "#e8eaf0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</span>
              <span style={{ fontSize: 11, color: "#475569" }}>{s.ticker}</span>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", marginBottom: 4 }}>
              {kpi("최종 평가액", btFmtWonShort(fv), "#e8eaf0")}
              {kpi("비중", (wt * 100).toFixed(1) + "%", "#a8b4f8")}
              {kpi("수익률", btFmtPct(ret), ret >= 0 ? "#22d3a0" : "#f87171")}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1.3fr 1fr 1fr", gap: 4, fontSize: 10.5, color: "#64748b", paddingBottom: 5, borderBottom: "1px solid #1e293b" }}>
              <span>연도</span><span style={{ textAlign: "right" }}>평가액</span><span style={{ textAlign: "right" }}>비중</span><span style={{ textAlign: "right" }}>수익률</span>
            </div>
            {rows.map(r => (
              <div key={r.year} style={{ display: "grid", gridTemplateColumns: "1fr 1.3fr 1fr 1fr", gap: 4, fontSize: 12, padding: "6px 0", borderBottom: "1px solid #12121f" }}>
                <span style={{ color: "#cbd5e1" }}>{r.year}</span>
                <span style={{ textAlign: "right", color: "#e8eaf0" }}>{btFmtWonShort(r.value)}</span>
                <span style={{ textAlign: "right", color: "#94a3b8" }}>{(r.weight * 100).toFixed(1) + "%"}</span>
                <span style={{ textAlign: "right", color: r.ret >= 0 ? "#22d3a0" : "#f87171" }}>{btFmtPct(r.ret)}</span>
              </div>
            ))}
            <div style={{ fontSize: 11, color: lab.color, marginTop: 8 }}>{lab.txt}</div>
          </div>
        );
      })}

      <div style={{ fontSize: 10.5, color: "#475569", padding: "0 4px 8px", lineHeight: 1.5 }}>
        · 국내 ETF·해외 종목은 배당/분배금이 재투자된 총수익(TR) 기준, 국내 개별주는 현금배당 미반영(가격수익률)이야.
      </div>
    </div>
  );
}
