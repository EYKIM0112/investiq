// public/backtest.js — InvestIQ 백테스트 탭 (독립 모듈)
// index.html에서 아래 한 줄로 로드(메인 앱 스크립트 직전):
//   <script type="text/babel" data-presets="react-classic" src="/backtest.js"></script>
//
// 설계 원칙:
// 1. 전역 렉시컬 스코프는 여러 text/babel 스크립트가 공유 → 최상위 선언은 전부 function 선언 + bt/Bt 접두어(충돌 방지).
// 2. 훅은 컴포넌트 함수 안에서 React.useState 등으로 접근(top-level 재선언 금지).
// 3. 자기완결형: 자체 fetch(/api/kis-history·/api/yahoo), 자체 SVG 차트, 포폴은 localStorage에서 직접 읽음.
//
// 데이터 정책(실증 확정):
//   국내 ETF  : /api/kis-history adj=0 → 분배금 반영(TR)
//   국내 개별주: /api/kis-history adj=0 → 현금배당 미반영(가격수익률)
//   해외      : /api/yahoo adjclose → 배당 재투자 반영(TR), 과거 월별 KRW=X로 원화 환산
//   조회주기  : 월봉(M) 고정 / 적립: 매월 말 종가 기준

// ===== 유틸 =====
function btKrCodeRe() { return /^\d{4}[0-9A-Z]{2}$/; }
function btIsDomestic(t) { return btKrCodeRe().test(String(t || "").trim().toUpperCase()); }

function btFmtWon(n) {
  if (n == null || !isFinite(n)) return "-";
  return Math.round(n).toLocaleString("ko-KR") + "원";
}
function btFmtWonShort(n) {
  if (n == null || !isFinite(n)) return "-";
  const a = Math.abs(n);
  if (a >= 1e8) return (n / 1e8).toFixed(2) + "억";
  if (a >= 1e4) return Math.round(n / 1e4).toLocaleString("ko-KR") + "만";
  return Math.round(n).toLocaleString("ko-KR");
}
function btFmtPct(n) {
  if (n == null || !isFinite(n)) return "-";
  return (n >= 0 ? "+" : "") + (n * 100).toFixed(2) + "%";
}

function btTodayYmd() {
  const d = new Date(Date.now() + 9 * 3600 * 1000); // KST
  return "" + d.getUTCFullYear() + String(d.getUTCMonth() + 1).padStart(2, "0") + String(d.getUTCDate()).padStart(2, "0");
}
function btCurYM() {
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0");
}
function btYmToStartYmd(ym) { const [y, m] = ym.split("-"); return y + m + "01"; }
function btMonthIndex(ym, baseYm) {
  const [y, m] = ym.split("-").map(Number);
  const [by, bm] = baseYm.split("-").map(Number);
  return (y - by) * 12 + (m - bm);
}

// ===== 시세 fetch =====
function btCacheGet(key, maxAgeMs) {
  try {
    const o = JSON.parse(localStorage.getItem(key) || "null");
    if (o && o.data && Date.now() - o.ts < maxAgeMs) return o.data;
  } catch (e) {}
  return null;
}
function btCacheSet(key, data) {
  try { localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data })); } catch (e) {}
}

// 국내 월봉(수정주가). 반환: [{ym, close}] 오름차순
async function btFetchDomestic(ticker, endYmd) {
  const key = "bt_dom_" + ticker;
  const cached = btCacheGet(key, 12 * 3600 * 1000);
  if (cached) return cached;
  const url = "/api/kis-history?code=" + encodeURIComponent(ticker) + "&period=M&adj=0&start=19900101&end=" + endYmd;
  const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error("국내 시세 조회 실패: " + ticker);
  const d = await r.json();
  if (!Array.isArray(d.candles) || !d.candles.length) throw new Error("데이터 없음: " + ticker);
  const out = d.candles
    .filter(c => c && /^\d{8}$/.test(c.date) && c.close > 0)
    .map(c => ({ ym: c.date.slice(0, 4) + "-" + c.date.slice(4, 6), close: c.close }));
  btCacheSet(key, out);
  return out;
}

// 야후 월봉 파싱 공통. useAdj=true면 adjclose(배당 반영), false면 close(환율용)
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
    m.set(ym, px); // 같은 월 중복 시 마지막 값
  }
  return Array.from(m, ([ym, close]) => ({ ym, close })).sort((a, b) => (a.ym < b.ym ? -1 : 1));
}

// 해외 월봉(adjclose=TR). 반환: [{ym, close(USD)}]
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

// 과거 월별 USD/KRW. 반환: Map(ym -> rate)
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

// ===== 백테스트 엔진 =====
// securities: [{ticker, name, weight(0~1), domestic}]
// seriesKRW: { ticker: Map(ym -> priceKRW) }
// months: 평가에 쓸 ym 배열(오름차순, 전 종목 공통)
// mode: "lump" | "dca" | "both"
function btRunEngine(opts) {
  const { securities, seriesKRW, months, mode, lumpAmount, dcaAmount } = opts;
  const shares = {};
  securities.forEach(s => { shares[s.ticker] = 0; });
  let principal = 0;
  const cfAmt = [];
  const cfIdx = [];
  const base = months[0];
  const monthly = [];

  months.forEach((ym, idx) => {
    let invest = 0;
    if (idx === 0) {
      if (mode === "lump" || mode === "both") invest += lumpAmount;
      if (mode === "dca") invest += dcaAmount; // 적립식은 첫 달부터 적립
    } else if (mode === "dca" || mode === "both") {
      invest += dcaAmount; // 매월 말 적립
    }
    if (invest > 0) {
      securities.forEach(s => {
        const px = seriesKRW[s.ticker].get(ym);
        if (px > 0) shares[s.ticker] += (invest * s.weight) / px;
      });
      principal += invest;
      cfAmt.push(-invest);
      cfIdx.push(btMonthIndex(ym, base));
    }
    let value = 0;
    securities.forEach(s => {
      const px = seriesKRW[s.ticker].get(ym);
      if (px > 0) value += shares[s.ticker] * px;
    });
    monthly.push({ ym, value, principal });
  });

  const last = monthly[monthly.length - 1];
  // IRR(연환산): 각 매수는 유출(-), 마지막 평가액은 유입(+)
  const amounts = cfAmt.concat([last.value]);
  const idxs = cfIdx.concat([btMonthIndex(last.ym, base)]);
  const irr = btIRR(amounts, idxs);

  const totalReturn = principal > 0 ? (last.value - principal) / principal : null;
  return { monthly, finalValue: last.value, principal, totalReturn, irr };
}

// IRR: NPV(월수익률)=0을 이분법으로. 반환: 연환산 수익률(없으면 null)
function btIRR(amounts, idxs) {
  const npv = (rm) => amounts.reduce((s, a, i) => s + a / Math.pow(1 + rm, idxs[i]), 0);
  let lo = -0.99, hi = 1.0;
  let flo = npv(lo), fhi = npv(hi);
  if (flo * fhi > 0) { hi = 10; fhi = npv(hi); if (flo * fhi > 0) return null; }
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fm = npv(mid);
    if (!isFinite(fm)) return null;
    if (Math.abs(fm) < 1e-4) { lo = mid; hi = mid; break; }
    if (flo * fm < 0) { hi = mid; fhi = fm; } else { lo = mid; flo = fm; }
  }
  const rm = (lo + hi) / 2;
  return Math.pow(1 + rm, 12) - 1;
}

// 연도별 집계: 각 연도의 마지막 월 스냅샷
function btYearly(monthly) {
  const byYear = new Map();
  monthly.forEach(p => { byYear.set(p.ym.slice(0, 4), p); });
  return Array.from(byYear, ([year, p]) => ({ year, value: p.value, principal: p.principal }))
    .sort((a, b) => (a.year < b.year ? -1 : 1));
}

// ===== SVG 차트 (평가액 vs 투자원금) =====
function BtChart(props) {
  const monthly = props.monthly || [];
  if (monthly.length < 2) return null;
  const W = 700, H = 300, padL = 8, padR = 12, padT = 14, padB = 26;
  const maxV = Math.max.apply(null, monthly.map(p => Math.max(p.value, p.principal))) || 1;
  const minV = 0;
  const n = monthly.length;
  const x = (i) => padL + (i / (n - 1)) * (W - padL - padR);
  const y = (v) => padT + (1 - (v - minV) / (maxV - minV)) * (H - padT - padB);
  const path = (sel) => monthly.map((p, i) => (i === 0 ? "M" : "L") + x(i).toFixed(1) + " " + y(sel(p)).toFixed(1)).join(" ");
  const areaPath = path(p => p.value) +
    " L" + x(n - 1).toFixed(1) + " " + y(minV).toFixed(1) +
    " L" + x(0).toFixed(1) + " " + y(minV).toFixed(1) + " Z";

  // Y 그리드 4구간
  const ticks = [];
  for (let k = 0; k <= 4; k++) { const v = minV + (maxV - minV) * (k / 4); ticks.push(v); }
  // X 연도 라벨(각 연도 첫 등장 지점)
  const yearMarks = [];
  const seen = {};
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
      {shownYears.map((m, k) => (
        <text key={k} x={x(m.i)} y={H - 8} fill="#64748b" fontSize="11" textAnchor="middle">{m.label}</text>
      ))}
      <path d={areaPath} fill="url(#btArea)" />
      <path d={path(p => p.principal)} fill="none" stroke="#64748b" strokeWidth="1.6" strokeDasharray="4 3" />
      <path d={path(p => p.value)} fill="none" stroke="#22d3a0" strokeWidth="2.2" />
    </svg>
  );
}

// ===== 종목 선택: 포트폴리오 읽기 =====
function btLoadPortfolio() {
  try {
    const p = JSON.parse(localStorage.getItem("portfolio_v1") || "null");
    const hs = (p && p.holdings) || [];
    const seen = {};
    const out = [];
    hs.forEach(h => {
      const t = String(h.ticker || "").trim().toUpperCase();
      if (!t || seen[t]) return;
      seen[t] = true;
      out.push({ ticker: t, name: h.name || t, domestic: btIsDomestic(t) });
    });
    return out;
  } catch (e) { return []; }
}

// ===== 메인 컴포넌트 =====
function BacktestTab() {
  const { useState, useMemo } = React;

  const nowY = new Date().getUTCFullYear();
  const [secs, setSecs] = useState([]); // [{ticker,name,domestic,weight}]
  const [startY, setStartY] = useState(nowY - 5);
  const [startM, setStartM] = useState(1);
  const [mode, setMode] = useState("lump"); // lump | dca | both
  const [lumpMan, setLumpMan] = useState(1000); // 만원
  const [dcaMan, setDcaMan] = useState(50); // 만원
  const [showPicker, setShowPicker] = useState(false);
  const [manualCode, setManualCode] = useState("");
  const [manualName, setManualName] = useState("");

  const [running, setRunning] = useState(false);
  const [err, setErr] = useState("");
  const [warn, setWarn] = useState("");
  const [result, setResult] = useState(null);

  const portfolio = useMemo(() => btLoadPortfolio(), [showPicker]);

  const addSec = (s) => {
    setErr("");
    if (secs.length >= 5) { setErr("종목은 최대 5개까지야."); return; }
    if (secs.some(x => x.ticker === s.ticker)) { setErr("이미 추가된 종목이야."); return; }
    const next = [...secs, { ...s, weight: 0 }];
    // 균등 배분 자동 세팅
    const w = Math.round((100 / next.length) * 10) / 10;
    next.forEach((x, i) => { x.weight = i === next.length - 1 ? Math.round((100 - w * (next.length - 1)) * 10) / 10 : w; });
    setSecs(next);
  };
  const removeSec = (t) => setSecs(secs.filter(x => x.ticker !== t));
  const setWeight = (t, v) => setSecs(secs.map(x => x.ticker === t ? { ...x, weight: v } : x));
  const equalize = () => {
    if (!secs.length) return;
    const w = Math.round((100 / secs.length) * 10) / 10;
    setSecs(secs.map((x, i) => ({ ...x, weight: i === secs.length - 1 ? Math.round((100 - w * (secs.length - 1)) * 10) / 10 : w })));
  };
  const addManual = () => {
    const t = manualCode.trim().toUpperCase();
    if (!t) return;
    addSec({ ticker: t, name: manualName.trim() || t, domestic: btIsDomestic(t) });
    setManualCode(""); setManualName("");
  };

  const weightSum = secs.reduce((s, x) => s + (Number(x.weight) || 0), 0);

  const run = async () => {
    setErr(""); setWarn(""); setResult(null);
    if (!secs.length) { setErr("종목을 1개 이상 추가해줘."); return; }
    if (Math.abs(weightSum - 100) > 0.5) { setErr("비중 합이 100%가 되어야 해 (현재 " + weightSum.toFixed(1) + "%). '균등 배분'을 눌러도 돼."); return; }
    const lumpAmount = (Number(lumpMan) || 0) * 10000;
    const dcaAmount = (Number(dcaMan) || 0) * 10000;
    if ((mode === "lump" || mode === "both") && lumpAmount <= 0) { setErr("거치 금액을 입력해줘."); return; }
    if ((mode === "dca" || mode === "both") && dcaAmount <= 0) { setErr("적립 금액을 입력해줘."); return; }

    setRunning(true);
    try {
      const reqStart = startY + "-" + String(startM).padStart(2, "0");
      const endYmd = btTodayYmd();
      const hasOverseas = secs.some(s => !s.domestic);

      // 시세 병렬 조회
      const seriesRaw = {};
      await Promise.all(secs.map(async s => {
        seriesRaw[s.ticker] = s.domestic ? await btFetchDomestic(s.ticker, endYmd) : await btFetchOverseas(s.ticker);
      }));
      const fx = hasOverseas ? await btFetchFx() : null;

      // 원화 시세맵 구성
      const seriesKRW = {};
      secs.forEach(s => {
        const m = new Map();
        seriesRaw[s.ticker].forEach(o => {
          if (o.ym < reqStart) return;
          if (s.domestic) { m.set(o.ym, o.close); }
          else { const rate = fx.get(o.ym); if (rate > 0) m.set(o.ym, o.close * rate); }
        });
        seriesKRW[s.ticker] = m;
      });

      // 전 종목 공통 월(교집합)
      let commonYms = null;
      secs.forEach(s => {
        const ks = new Set(seriesKRW[s.ticker].keys());
        commonYms = commonYms === null ? ks : new Set([...commonYms].filter(y => ks.has(y)));
      });
      const months = Array.from(commonYms || []).sort();
      if (months.length < 2) { setErr("공통으로 조회되는 월 데이터가 부족해. 종목 상장 시기나 시작 연도를 확인해줘."); setRunning(false); return; }

      if (months[0] > reqStart) {
        setWarn("일부 종목의 데이터 시작이 늦어, 백테스트는 " + months[0] + "부터 시작했어.");
      }

      const eng = btRunEngine({ securities: secs.map(s => ({ ticker: s.ticker, name: s.name, weight: (Number(s.weight) || 0) / 100, domestic: s.domestic })), seriesKRW, months, mode, lumpAmount, dcaAmount });
      setResult({ eng, yearly: btYearly(eng.monthly), secs: secs.slice(), start: months[0], end: months[months.length - 1], mode });
    } catch (e) {
      setErr(e.message || "백테스트 중 오류가 발생했어.");
    } finally {
      setRunning(false);
    }
  };

  // ---- 스타일 ----
  const card = { background: "#0f0f18", border: "1px solid #1e293b", borderRadius: 12, padding: 14, marginBottom: 12 };
  const label = { fontSize: 12, fontWeight: 700, color: "#a8b4f8", marginBottom: 8 };
  const inp = { background: "#0a0a12", border: "1px solid #2a2a48", borderRadius: 8, color: "#e8eaf0", fontSize: 14, padding: "8px 10px", outline: "none" };
  const modeBtn = (active) => ({ flex: 1, padding: "9px 0", borderRadius: 8, border: "none", fontSize: 12.5, fontWeight: 700, cursor: "pointer", background: active ? "#4f6ef7" : "#0a0a12", color: active ? "#fff" : "#94a3b8" });

  return (
    <div>
      {/* 종목 선택 */}
      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div style={label}>종목 (최대 5개) · 시작 비중 %</div>
          {secs.length > 0 && <button onClick={equalize} style={{ ...inp, padding: "4px 8px", fontSize: 11, cursor: "pointer", color: "#a8b4f8" }}>균등 배분</button>}
        </div>

        {secs.map(s => (
          <div key={s.ticker} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: s.domestic ? "#22d3a0" : "#fbbf24", border: "1px solid " + (s.domestic ? "#22d3a033" : "#fbbf2433"), borderRadius: 5, padding: "2px 5px", whiteSpace: "nowrap" }}>{s.domestic ? "국내" : "해외"}</span>
            <span style={{ flex: 1, fontSize: 13, color: "#e8eaf0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}<span style={{ color: "#475569", fontSize: 11 }}> {s.ticker}</span></span>
            <input type="number" value={s.weight} onChange={e => setWeight(s.ticker, e.target.value)} style={{ ...inp, width: 62, padding: "6px 8px", textAlign: "right" }} />
            <button onClick={() => removeSec(s.ticker)} style={{ background: "none", border: "none", color: "#f87171", fontSize: 18, cursor: "pointer", lineHeight: 1 }}>×</button>
          </div>
        ))}

        <div style={{ fontSize: 11, color: weightSum === 100 ? "#22d3a0" : "#fbbf24", margin: "6px 0 10px", textAlign: "right" }}>비중 합 {weightSum.toFixed(1)}%</div>

        <button onClick={() => setShowPicker(!showPicker)} style={{ ...inp, width: "100%", cursor: "pointer", color: "#a8b4f8", fontWeight: 700, marginBottom: showPicker ? 8 : 0 }}>＋ 내 포트폴리오에서 추가</button>
        {showPicker && (
          <div style={{ maxHeight: 180, overflowY: "auto", border: "1px solid #1e293b", borderRadius: 8, padding: 6, marginBottom: 8 }}>
            {portfolio.length === 0 && <div style={{ fontSize: 12, color: "#64748b", padding: 8 }}>포트폴리오가 비어있어.</div>}
            {portfolio.map(h => (
              <div key={h.ticker} onClick={() => addSec(h)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 8px", borderRadius: 6, cursor: "pointer" }} onMouseDown={e => e.currentTarget.style.background = "#1e293b"} onMouseUp={e => e.currentTarget.style.background = "transparent"}>
                <span style={{ fontSize: 10, color: h.domestic ? "#22d3a0" : "#fbbf24" }}>{h.domestic ? "국내" : "해외"}</span>
                <span style={{ flex: 1, fontSize: 13, color: "#cbd5e1", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.name}</span>
                <span style={{ fontSize: 11, color: "#475569" }}>{h.ticker}</span>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
          <input placeholder="코드/티커 직접입력" value={manualCode} onChange={e => setManualCode(e.target.value)} style={{ ...inp, width: 130 }} />
          <input placeholder="이름(선택)" value={manualName} onChange={e => setManualName(e.target.value)} style={{ ...inp, flex: 1 }} />
          <button onClick={addManual} style={{ ...inp, cursor: "pointer", color: "#a8b4f8", fontWeight: 700 }}>추가</button>
        </div>
      </div>

      {/* 기간 */}
      <div style={card}>
        <div style={label}>기간 (월봉 기준 · 종료는 현재까지)</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <select value={startY} onChange={e => setStartY(Number(e.target.value))} style={{ ...inp, flex: 1 }}>
            {Array.from({ length: nowY - 1999 }, (_, i) => nowY - i).map(y => <option key={y} value={y}>{y}년</option>)}
          </select>
          <select value={startM} onChange={e => setStartM(Number(e.target.value))} style={{ ...inp, width: 90 }}>
            {Array.from({ length: 12 }, (_, i) => i + 1).map(m => <option key={m} value={m}>{m}월</option>)}
          </select>
          <span style={{ color: "#64748b", fontSize: 13 }}>~ 현재</span>
        </div>
      </div>

      {/* 방식 */}
      <div style={card}>
        <div style={label}>투자 방식</div>
        <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
          <button onClick={() => setMode("lump")} style={modeBtn(mode === "lump")}>거치식</button>
          <button onClick={() => setMode("dca")} style={modeBtn(mode === "dca")}>적립식</button>
          <button onClick={() => setMode("both")} style={modeBtn(mode === "both")}>거치+적립</button>
        </div>
        {(mode === "lump" || mode === "both") && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 13, color: "#94a3b8", width: 92 }}>{mode === "both" ? "초기 거치금" : "거치 금액"}</span>
            <input type="number" value={lumpMan} onChange={e => setLumpMan(e.target.value)} style={{ ...inp, flex: 1, textAlign: "right" }} />
            <span style={{ fontSize: 13, color: "#94a3b8" }}>만원</span>
          </div>
        )}
        {(mode === "dca" || mode === "both") && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 13, color: "#94a3b8", width: 92 }}>매월 적립금</span>
            <input type="number" value={dcaMan} onChange={e => setDcaMan(e.target.value)} style={{ ...inp, flex: 1, textAlign: "right" }} />
            <span style={{ fontSize: 13, color: "#94a3b8" }}>만원</span>
          </div>
        )}
        {(mode === "dca" || mode === "both") && <div style={{ fontSize: 11, color: "#64748b", marginTop: 8 }}>· 적립은 매월 말 종가 기준으로 매수돼(월봉).</div>}
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

// ===== 결과 표시 =====
function BtResult(props) {
  const { eng, yearly, secs, start, end, mode } = props.result;
  const modeLabel = { lump: "거치식", dca: "적립식", both: "거치+적립" }[mode];
  const card = { background: "#0f0f18", border: "1px solid #1e293b", borderRadius: 12, padding: 14, marginBottom: 12 };
  const kpi = (title, val, color) => (
    <div style={{ flex: 1, textAlign: "center", padding: "10px 4px" }}>
      <div style={{ fontSize: 10.5, color: "#64748b", marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 14, fontWeight: 800, color: color || "#e8eaf0" }}>{val}</div>
    </div>
  );
  const retColor = eng.totalReturn >= 0 ? "#22d3a0" : "#f87171";

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
      </div>

      <div style={card}>
        <div style={{ display: "flex", gap: 14, marginBottom: 8, fontSize: 11.5 }}>
          <span style={{ color: "#22d3a0" }}>● 평가액</span>
          <span style={{ color: "#64748b" }}>┄ 투자원금</span>
        </div>
        <BtChart monthly={eng.monthly} />
      </div>

      <div style={card}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#a8b4f8", marginBottom: 10 }}>연도별 자산 변동</div>
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

      <div style={card}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#a8b4f8", marginBottom: 8 }}>배당 반영 여부(종목별)</div>
        {secs.map(s => {
          return (
            <div key={s.ticker} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "4px 0", color: "#94a3b8" }}>
              <span>{s.name}</span>
              <span style={{ color: s.domestic ? "#64748b" : "#22d3a0" }}>{s.domestic ? "국내 — ETF는 분배금 반영·개별주는 미반영" : "해외 — 배당 재투자 반영"}</span>
            </div>
          );
        })}
        <div style={{ fontSize: 10.5, color: "#475569", marginTop: 8, lineHeight: 1.5 }}>
          · 국내 ETF와 해외 종목은 배당/분배금이 재투자된 총수익(TR) 기준이야. 국내 개별주는 현금배당이 반영되지 않은 가격수익률이라 실제보다 낮게 나올 수 있어.
        </div>
      </div>
    </div>
  );
}
