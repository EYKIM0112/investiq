// public/fng.js — 공포탐욕지수(Fear & Greed) 반원 게이지 위젯 모듈
// index.html에서 메인 앱 스크립트 '직전'에 로드:
//   <script type="text/babel" data-presets="react-classic" src="/fng.js"></script>
//
// 설계 원칙(gurus.js/notify.js/sector-map.js/sector-edit.js와 동일):
//   - 전역 렉시컬 스코프 공유 → 최상위 선언은 전부 function + fg/Fg 접두어. top-level const/let 금지.
//   - 훅은 컴포넌트 내부에서 React.xxx 로만 사용.
//
// 데이터 소스: /api/fng (CNN 미국 공포탐욕지수 프록시)
//   응답: { score, rating, previous_close, week_ago, month_ago, year_ago, history:[{t,v}], source }
//   ※ 한국(KRX VKOSPI)은 프록시 준비되면 FgGauge에 kind="kr"로 연결 예정. 지금은 미국만.
//
// 표시: 반원 게이지 + 바늘 + 중앙 점수/등급 + 과거 비교(전일/1주/1달/1년).

// 0~100 → 5단계 등급 라벨/색 (CNN 공식 밴드: <25 / <45 / <55 / <75 / >=75)
function fgBand(score) {
  var s = Number(score);
  if (!isFinite(s)) return { key: "na", label: "데이터 없음", ko: "—", color: "#64748b" };
  if (s < 25) return { key: "extreme-fear", label: "Extreme Fear", ko: "극단적 공포", color: "#e5342b" };
  if (s < 45) return { key: "fear", label: "Fear", ko: "공포", color: "#f97316" };
  if (s < 55) return { key: "neutral", label: "Neutral", ko: "중립", color: "#eab308" };
  if (s < 75) return { key: "greed", label: "Greed", ko: "탐욕", color: "#84cc16" };
  return { key: "extreme-greed", label: "Extreme Greed", ko: "극단적 탐욕", color: "#22c55e" };
}

// 게이지 색 구간(좌 공포=빨강 → 우 탐욕=초록). 반원 180도에 5구간.
function fgArcSegments() {
  return [
    { from: 0, to: 25, color: "#e5342b" },
    { from: 25, to: 45, color: "#f97316" },
    { from: 45, to: 55, color: "#eab308" },
    { from: 55, to: 75, color: "#84cc16" },
    { from: 75, to: 100, color: "#22c55e" },
  ];
}

// 점수(0~100) → 반원 각도(180도=왼쪽 끝 공포, 0도=오른쪽 끝 탐욕). SVG는 좌→우.
// 좌측(공포)이 180°, 우측(탐욕)이 0°가 되도록 매핑.
function fgScoreToAngle(score) {
  var s = Math.max(0, Math.min(100, Number(score) || 0));
  return 180 - (s / 100) * 180; // 0점→180°, 100점→0°
}

// 극좌표 → SVG 좌표 (cx,cy 중심, r 반지름, angleDeg는 표준 수학각도)
function fgPolar(cx, cy, r, angleDeg) {
  var a = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.cos(a), y: cy - r * Math.sin(a) };
}

// 반원 호 path (startAngle→endAngle, 각도 감소 방향)
function fgArcPath(cx, cy, r, startAngle, endAngle) {
  var s = fgPolar(cx, cy, r, startAngle);
  var e = fgPolar(cx, cy, r, endAngle);
  var largeArc = Math.abs(startAngle - endAngle) > 180 ? 1 : 0;
  // sweep=1 (시계방향, 각도 감소)
  return "M " + s.x.toFixed(2) + " " + s.y.toFixed(2) +
         " A " + r + " " + r + " 0 " + largeArc + " 1 " + e.x.toFixed(2) + " " + e.y.toFixed(2);
}

// 과거 비교 한 칸
function FgCompareRow(props) {
  var label = props.label;
  var value = props.value;
  var has = value != null && isFinite(Number(value));
  var band = fgBand(value);
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "5px 0" }}>
      <span style={{ fontSize: 12, color: "#64748b" }}>{label}</span>
      {has ? (
        <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <span style={{ fontSize: 12, color: band.color, fontWeight: 600 }}>{band.ko}</span>
          <span style={{
            minWidth: 30, textAlign: "center", fontSize: 12.5, fontWeight: 700,
            color: "#0a0a14", background: band.color, borderRadius: 11, padding: "2px 8px",
          }}>{Math.round(Number(value))}</span>
        </span>
      ) : (
        <span style={{ fontSize: 12, color: "#475569" }}>—</span>
      )}
    </div>
  );
}

// 반원 게이지 SVG (점수 하나 그림)
function FgGaugeSvg(props) {
  var score = props.score;
  var band = fgBand(score);
  var W = 240, H = 150, cx = W / 2, cy = 130, r = 96, sw = 18;
  var segs = fgArcSegments();
  var needleAngle = fgScoreToAngle(score);
  var tip = fgPolar(cx, cy, r - sw - 6, needleAngle);
  var hasScore = score != null && isFinite(Number(score));

  return (
    <svg width="100%" viewBox={"0 0 " + W + " " + H} style={{ display: "block", maxWidth: 300, margin: "0 auto" }}>
      {/* 배경 트랙 */}
      <path d={fgArcPath(cx, cy, r, 180, 0)} fill="none" stroke="#1e293b" strokeWidth={sw} strokeLinecap="round" />
      {/* 색 구간 */}
      {segs.map(function (seg, i) {
        return (
          <path key={i}
            d={fgArcPath(cx, cy, r, fgScoreToAngle(seg.from), fgScoreToAngle(seg.to))}
            fill="none" stroke={seg.color} strokeWidth={sw}
            strokeLinecap={i === 0 || i === segs.length - 1 ? "round" : "butt"}
            opacity={0.9} />
        );
      })}
      {/* 눈금 라벨 */}
      <text x={fgPolar(cx, cy, r + 2, 180).x - 2} y={cy + 6} fontSize="10" fill="#64748b" textAnchor="middle">0</text>
      <text x={cx} y={cy - r - 6} fontSize="10" fill="#64748b" textAnchor="middle">50</text>
      <text x={fgPolar(cx, cy, r + 2, 0).x + 2} y={cy + 6} fontSize="10" fill="#64748b" textAnchor="middle">100</text>
      {/* 바늘 */}
      {hasScore && (
        <g>
          <line x1={cx} y1={cy} x2={tip.x.toFixed(2)} y2={tip.y.toFixed(2)}
            stroke={band.color} strokeWidth="3.5" strokeLinecap="round" />
          <circle cx={cx} cy={cy} r="8" fill={band.color} />
          <circle cx={cx} cy={cy} r="3.5" fill="#0a0a14" />
        </g>
      )}
      {/* 중앙 점수 */}
      <text x={cx} y={cy - 34} fontSize="34" fontWeight="800" fill={hasScore ? band.color : "#475569"} textAnchor="middle">
        {hasScore ? Math.round(Number(score)) : "—"}
      </text>
    </svg>
  );
}

// 메인 카드: kind = "us" | "kr"
// props: { kind }
function FgGauge(props) {
  var kind = props.kind || "us";
  var meta = kind === "kr"
    ? { title: "한국 공포·탐욕", flag: "🇰🇷", note: "KRX VKOSPI 기반", api: "/api/fng-kr" }
    : { title: "미국 공포·탐욕", flag: "🇺🇸", note: "CNN Fear & Greed", api: "/api/fng" };

  var stateHook = React.useState({ loading: true, data: null, err: null });
  var st = stateHook[0], setSt = stateHook[1];

  React.useEffect(function () {
    var alive = true;
    setSt({ loading: true, data: null, err: null });
    fetch(meta.api)
      .then(function (r) { return r.ok ? r.json() : r.json().then(function (j) { throw new Error(j.error || ("HTTP " + r.status)); }); })
      .then(function (j) { if (alive) setSt({ loading: false, data: j, err: null }); })
      .catch(function (e) { if (alive) setSt({ loading: false, data: null, err: e.message || "불러오기 실패" }); });
    return function () { alive = false; };
  }, [meta.api]);

  var data = st.data;
  var band = data ? fgBand(data.score) : fgBand(null);

  return (
    <div style={{
      background: "#0a0a14", border: "1px solid #1e293b", borderRadius: 14,
      padding: "16px 16px 14px", flex: "1 1 260px", minWidth: 260,
    }}>
      {/* 헤더 */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: "#e2e8f0" }}>
          <span style={{ marginRight: 6 }}>{meta.flag}</span>{meta.title}
        </div>
        <div style={{ fontSize: 10.5, color: "#475569" }}>{meta.note}</div>
      </div>

      {st.loading && (
        <div style={{ textAlign: "center", padding: "44px 0", color: "#64748b", fontSize: 13 }}>불러오는 중…</div>
      )}

      {st.err && !st.loading && (
        <div style={{ textAlign: "center", padding: "38px 12px", color: "#64748b", fontSize: 12.5, lineHeight: 1.6 }}>
          {kind === "kr" ? "준비 중입니다" : "지금은 표시할 수 없어요"}
          <div style={{ fontSize: 11, color: "#475569", marginTop: 4 }}>{kind === "kr" ? "KRX 연동 예정" : st.err}</div>
        </div>
      )}

      {data && !st.loading && (
        <div>
          <FgGaugeSvg score={data.score} />
          <div style={{ textAlign: "center", marginTop: -6, marginBottom: 10 }}>
            <span style={{ fontSize: 16, fontWeight: 800, color: band.color, letterSpacing: 0.5 }}>{band.ko}</span>
            <span style={{ fontSize: 12, color: "#475569", marginLeft: 8 }}>{band.label}</span>
          </div>
          <div style={{ borderTop: "1px solid #16213a", paddingTop: 8 }}>
            <FgCompareRow label="전일" value={data.previous_close} />
            <FgCompareRow label="1주 전" value={data.week_ago} />
            <FgCompareRow label="1달 전" value={data.month_ago} />
            {data.year_ago != null && <FgCompareRow label="1년 전" value={data.year_ago} />}
          </div>
        </div>
      )}
    </div>
  );
}

// 종합탭용: 미국+한국 나란히 (한국은 프록시 준비 전이라 에러→"준비 중" 표시)
// props: { kind } — "both"(종합) | "us"(미국탭) | "kr"(한국탭)
function FgGaugePanel(props) {
  var kind = props.kind || "both";
  var items = kind === "both" ? ["us", "kr"] : [kind];
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
      {items.map(function (k) { return <FgGauge key={k} kind={k} />; })}
    </div>
  );
}
