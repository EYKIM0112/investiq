// public/notify.js — 알림·리마인더 모듈 (v1: 배당 지급일 알림만)
// index.html에서 메인 앱 스크립트 '직전'에 아래 한 줄로 로드:
//   <script type="text/babel" data-presets="react-classic" src="/notify.js"></script>
// 그리고 헤더에 <NtBell goTab={setTab} /> 를 삽입(새로고침 버튼 옆).
//
// 설계 원칙(gurus.js와 동일):
//   - 전역 렉시컬 스코프 공유 → 최상위 선언은 전부 function + nt/Nt 접두어. top-level const/let 금지.
//   - 훅은 컴포넌트 내부에서 React.xxx 로만 사용.
//
// 데이터 근거(추측 없음):
//   배당 탭이 저장한 캐시(localStorage "investiq_dividend_cache_v1")만 읽음. 추가 API 호출 없음.
//   캐시 항목 s = { name, shares, freq, annualTotal(KRW환산), months[](지급월 0~11),
//                   payDay(대표 지급일자, 중앙값 or null), currency, source, ... }
//   → 배당 탭 달력이 이미 쓰는 months + payDay 패턴 그대로 사용해 "다음 예상 지급일"을 산출.
//   → payDate 확정 미래일은 원천(KIS 예탁원)에서 미제공이라, 과거 이력 기반 '예상치'임을 UI에 명시.
//
// 표시 정책: 지급일자가 확정된 종목의 "다음 예상 지급일 D-7 이내"만 노출(뱃지 = 미확인 개수).

// ===== 상수(함수로 노출 — top-level const 금지 규칙 준수) =====
function ntDivCacheKey() { return "investiq_dividend_cache_v1"; }   // 배당 탭 캐시 (index.html DIV_CACHE_KEY와 동일)
function ntSeenKey() { return "investiq_notify_seen_dividend_v1"; } // 이미 확인한 임박 알림 표시(뱃지 중복 방지)
function ntImminentDays() { return 7; }   // 알림 노출·뱃지 대상: 지급일자 확정 + D-7 이내

// ===== localStorage 유틸 =====
function ntLoadDivCache() {
  try { return JSON.parse(localStorage.getItem(ntDivCacheKey()) || "null"); } catch (e) { return null; }
}
function ntLoadSeen() {
  try { return JSON.parse(localStorage.getItem(ntSeenKey()) || "{}") || {}; } catch (e) { return {}; }
}
function ntSaveSeen(obj) {
  try { localStorage.setItem(ntSeenKey(), JSON.stringify(obj || {})); } catch (e) {}
}

// ===== 날짜 유틸 (모두 로컬 자정 기준) =====
function ntStartOfToday() {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}
function ntYmd(dt) {
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const d = String(dt.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}
function ntDiffDays(target, base) {
  return Math.round((target.getTime() - base.getTime()) / 86400000);
}

// 캐시 항목 s → { date:Date, dayKnown:bool } | null : 오늘 이후 가장 가까운 예상 지급일
function ntNextPayDate(s, fromToday) {
  if (!s || !Array.isArray(s.months) || s.months.length === 0) return null;
  const dayKnown = !!(s.payDay && s.payDay >= 1 && s.payDay <= 31);
  const day = dayKnown ? s.payDay : 15; // 일자 미정이면 정렬용으로 중순 가정
  const today = fromToday || ntStartOfToday();
  let best = null;
  // 올해/내년의 각 지급월 후보 중 오늘 이후 가장 이른 날짜
  for (let addY = 0; addY <= 1; addY++) {
    for (const m of s.months) {
      if (m == null || m < 0 || m > 11) continue;
      const y = today.getFullYear() + addY;
      const lastDay = new Date(y, m + 1, 0).getDate(); // 그 달 말일
      const d = Math.min(day, lastDay);
      const cand = new Date(y, m, d);
      if (cand.getTime() >= today.getTime()) {
        if (!best || cand.getTime() < best.getTime()) best = cand;
      }
    }
  }
  return best ? { date: best, dayKnown } : null;
}

// 회당 예상 배당금(KRW). 배당 탭 monthlyTotals와 동일 로직: annualTotal / months.length
function ntPerPaymentKRW(s) {
  if (!s || !(s.annualTotal > 0) || !Array.isArray(s.months) || s.months.length === 0) return 0;
  return s.annualTotal / s.months.length;
}

// 오래된 seen 키 정리(45일 지난 것 제거) — 무한 증가 방지. 키 형식 "name::YYYYMMDD"
function ntPruneSeen(seen, today) {
  const out = {};
  const cutoff = new Date(today.getTime() - 45 * 86400000);
  Object.keys(seen || {}).forEach((k) => {
    const ymd = k.slice(-8);
    if (/^\d{8}$/.test(ymd)) {
      const dt = new Date(Number(ymd.slice(0, 4)), Number(ymd.slice(4, 6)) - 1, Number(ymd.slice(6, 8)));
      if (dt.getTime() >= cutoff.getTime()) out[k] = true;
    }
  });
  return out;
}

// 알림 계산: 캐시 → { hasCache, ts, imminent[] }
// imminent: 지급일자 확정 + 0<=D<=7 (노출·뱃지 대상). 그 외(먼 미래·일자 미정)는 노출 안 함.
function ntComputeAlerts() {
  const cache = ntLoadDivCache();
  const hasCache = !!(cache && Array.isArray(cache.data));
  if (!hasCache) return { hasCache: false, ts: null, imminent: [] };

  const today = ntStartOfToday();
  const imminent = [];

  cache.data.forEach((s) => {
    const nx = ntNextPayDate(s, today);
    if (!nx || !nx.dayKnown) return;             // 지급일자 미확정 → 7일 이내 단정 불가 → 제외
    const dday = ntDiffDays(nx.date, today);
    if (dday < 0 || dday > ntImminentDays()) return; // 7일 이내만
    imminent.push({
      name: s.name,
      date: nx.date,
      ymd: ntYmd(nx.date),
      dday,
      dayKnown: true,
      amountKRW: ntPerPaymentKRW(s),
      freq: s.freq || null,
      currency: s.currency || "KRW",
      source: s.source || null,
      key: `${s.name}::${ntYmd(nx.date)}`,
    });
  });

  imminent.sort((a, b) => a.date - b.date);
  return { hasCache: true, ts: cache.ts || null, imminent };
}

// ===== 표시 유틸 =====
function ntFmtWon(n) {
  if (n == null || !isFinite(n) || n <= 0) return "-";
  return "₩" + Math.round(n).toLocaleString("ko-KR");
}
function ntDdayLabel(dday) {
  if (dday === 0) return "오늘";
  if (dday === 1) return "내일";
  return "D-" + dday;
}
function ntDateLabel(dt) {
  return `${dt.getMonth() + 1}/${dt.getDate()}`;
}
function ntFmtTs(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// ===== 알림 벨 + 패널 =====
function NtBell(props) {
  const goTab = props && props.goTab ? props.goTab : null;
  const [open, setOpen] = React.useState(false);
  const [alerts, setAlerts] = React.useState(function () { return ntComputeAlerts(); });
  const [seen, setSeen] = React.useState(function () { return ntLoadSeen(); });

  // 앱 진입/재활성화 시 재계산 (백그라운드 푸시 대신 '앱 열 때 체크' 방식)
  React.useEffect(function () {
    const recompute = function () { setAlerts(ntComputeAlerts()); setSeen(ntLoadSeen()); };
    recompute();
    const onFocus = function () { recompute(); };
    const onVis = function () { if (!document.hidden) recompute(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);
    return function () {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  // 뱃지 = 아직 확인 안 한 '임박' 알림 수
  const unseenCount = alerts.imminent.filter(function (a) { return !seen[a.key]; }).length;

  const openPanel = function () {
    setOpen(true);
    // 패널 열면 현재 임박 알림을 '확인'으로 표시 → 뱃지 해제 (다음 지급 회차는 새 키라 다시 알림)
    const today = ntStartOfToday();
    const next = ntPruneSeen({ ...seen }, today);
    alerts.imminent.forEach(function (a) { next[a.key] = true; });
    ntSaveSeen(next);
    setSeen(next);
  };
  const closePanel = function () { setOpen(false); };

  const goDividend = function () {
    closePanel();
    if (goTab) goTab("dividend");
  };

  // ---- 벨 버튼(새로고침 버튼과 톤 통일) ----
  const bellBtn = (
    <button
      onClick={function () { open ? closePanel() : openPanel(); }}
      aria-label="알림"
      style={{
        position: "relative", background: "transparent",
        color: "#94a3b8", border: "1px solid #2d3748",
        borderRadius: 8, padding: "7px 11px",
        cursor: "pointer", fontWeight: 500, fontSize: 14, lineHeight: 1,
      }}
    >
      🔔
      {unseenCount > 0 && (
        <span style={{
          position: "absolute", top: -6, right: -6, minWidth: 17, height: 17,
          padding: "0 4px", borderRadius: 9, background: "#ef4444", color: "#fff",
          fontSize: 10, fontWeight: 800, lineHeight: "17px", textAlign: "center",
          boxShadow: "0 0 0 2px #0a0a0f",
        }}>{unseenCount > 9 ? "9+" : unseenCount}</span>
      )}
    </button>
  );

  if (!open) return bellBtn;

  // ---- 패널 ----
  const card = { background: "#0f0f18", border: "1px solid #1e293b", borderRadius: 12, padding: 12, marginBottom: 10 };
  const rowBase = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "9px 0", borderBottom: "1px solid #12121f", cursor: "pointer" };

  const renderRow = function (a) {
    return (
      <div key={a.key} onClick={goDividend} style={rowBase}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#e8eaf0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</div>
          <div style={{ fontSize: 10.5, color: "#64748b", marginTop: 2 }}>
            {ntDateLabel(a.date)} 예상{a.freq ? " · " + a.freq : ""}{a.currency === "USD" ? " · 환산" : ""}
          </div>
        </div>
        <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: a.dday <= 1 ? "#22d3a0" : "#a8b4f8" }}>{ntDdayLabel(a.dday)}</div>
          <div style={{ fontSize: 11, color: "#cbd5e1", marginTop: 2 }}>{ntFmtWon(a.amountKRW)}</div>
        </div>
      </div>
    );
  };

  return (
    <>
      {bellBtn}
      {/* 배경 클릭 시 닫힘 */}
      <div onClick={closePanel} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 500 }}></div>
      {/* 패널 (480 컬럼 안에서 상단 고정) */}
      <div style={{
        position: "fixed", top: 62, left: 0, right: 0, margin: "0 auto",
        maxWidth: 452, width: "calc(100% - 28px)", zIndex: 501,
        background: "#0a0a0f", border: "1px solid #22d3a044", borderRadius: 16,
        boxShadow: "0 12px 40px rgba(0,0,0,0.6)", padding: 14,
        maxHeight: "75vh", overflowY: "auto",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: "#f0f0ff" }}>🔔 알림</div>
          <button onClick={closePanel} style={{ background: "none", border: "none", color: "#64748b", fontSize: 18, cursor: "pointer", padding: "0 4px", lineHeight: 1 }}>✕</button>
        </div>

        {!alerts.hasCache && (
          <div style={{ ...card, textAlign: "center" }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>📅</div>
            <div style={{ fontSize: 13, color: "#94a3b8", lineHeight: 1.6 }}>
              배당 데이터가 아직 없습니다.<br />배당 탭에서 먼저 배당을 조회해 주세요.
            </div>
            <button onClick={goDividend} style={{ marginTop: 12, background: "#22d3a022", border: "1px solid #22d3a055", color: "#22d3a0", borderRadius: 9, padding: "9px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
              배당 탭으로 이동
            </button>
          </div>
        )}

        {alerts.hasCache && alerts.imminent.length === 0 && (
          <div style={{ ...card, textAlign: "center" }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>✅</div>
            <div style={{ fontSize: 13, color: "#94a3b8", lineHeight: 1.6 }}>
              {ntImminentDays()}일 이내 예상 배당 지급이 없습니다.
            </div>
          </div>
        )}

        {alerts.hasCache && alerts.imminent.length > 0 && (
          <div style={card}>
            <div style={{ fontSize: 12, fontWeight: 800, color: "#22d3a0", marginBottom: 4 }}>💰 곧 지급 예정 (D-{ntImminentDays()} 이내)</div>
            {alerts.imminent.map(function (a) { return renderRow(a); })}
          </div>
        )}

        <div style={{ fontSize: 10.5, color: "#475569", padding: "2px 2px 0", lineHeight: 1.6 }}>
          · 지급일은 과거 배당 이력(지급월·지급일자) 기반 <b style={{ color: "#64748b" }}>예상치</b>이며 실제와 다를 수 있습니다.<br />
          · 금액은 회당 예상 배당금(세전, 외화는 원화 환산)입니다. 항목을 누르면 배당 탭으로 이동합니다.
          {alerts.ts ? <><br />· 배당 데이터 기준: {ntFmtTs(alerts.ts)}</> : null}
        </div>
      </div>
    </>
  );
}
