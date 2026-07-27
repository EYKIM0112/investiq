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
//   ※ 한국(KRX VKOSPI)은 프록시 준비되면 kind="kr"로 연결 예정. 지금은 미국만.
//
// 디자인: CNN Fear&Greed 스타일 — 얇은 도넛 게이지 + 허브에서 뻗는 바늘 + 아래 점수.
//   등급 라벨은 Title Case(Extreme Fear/Fear/Neutral/Greed/Extreme Greed),
//   비교 항목 제목은 한글(전일/1주 전/1달 전). 좌 게이지 / 우 비교지표 가로 배치.

// 0~100 → 5단계 등급 (CNN 공식 밴드: <25 / <45 / <55 / <75 / >=75)
function fgBand(score) {
  var s = Number(score);
  if (!isFinite(s)) return { key: "na", label: "N/A", color: "#64748b" };
  if (s < 25) return { key: "extreme-fear", label: "Extreme Fear", color: "#e5453b" };
  if (s < 45) return { key: "fear", label: "Fear", color: "#f0883e" };
  if (s < 55) return { key: "neutral", label: "Neutral", color: "#e8c14a" };
  if (s < 75) return { key: "greed", label: "Greed", color: "#8cc152" };
  return { key: "extreme-greed", label: "Extreme Greed", color: "#3aa856" };
}

// 점수(0~100) → 각도(0점=180°왼쪽, 100점=0°오른쪽)
function fgScoreToAngle(score) {
  var s = Math.max(0, Math.min(100, Number(score) || 0));
  return 180 - (s / 100) * 180;
}

// 극좌표 → SVG 좌표
function fgPolar(cx, cy, r, angleDeg) {
  var a = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.cos(a), y: cy - r * Math.sin(a) };
}

// 반원 호 path (각도 감소 방향, sweep=1)
function fgArcPath(cx, cy, r, startAngle, endAngle) {
  var s = fgPolar(cx, cy, r, startAngle);
  var e = fgPolar(cx, cy, r, endAngle);
  var large = Math.abs(startAngle - endAngle) > 180 ? 1 : 0;
  return "M " + s.x.toFixed(2) + " " + s.y.toFixed(2) +
         " A " + r + " " + r + " 0 " + large + " 1 " + e.x.toFixed(2) + " " + e.y.toFixed(2);
}

// 샤프한 삼각형 바늘 path (허브에서 끝점까지, 밑변 넓고 끝 뾰족)
function fgNeedlePath(cx, cy, angleDeg, length, baseHalf) {
  var tip = fgPolar(cx, cy, length, angleDeg);
  var b1 = fgPolar(cx, cy, baseHalf, angleDeg + 90);
  var b2 = fgPolar(cx, cy, baseHalf, angleDeg - 90);
  return "M " + b1.x.toFixed(2) + " " + b1.y.toFixed(2) +
         " L " + tip.x.toFixed(2) + " " + tip.y.toFixed(2) +
         " L " + b2.x.toFixed(2) + " " + b2.y.toFixed(2) + " Z";
}

// 반원 게이지 SVG — 그라데이션 링 + 샤프 바늘(링 밖까지) + 링 바깥 배지
function FgGaugeSvg(props) {
  var score = props.score;
  var band = fgBand(score);
  var hasScore = score != null && isFinite(Number(score));
  var W = 220, H = 140, cx = 110, cy = 112, r = 72, sw = 10;   // 배지가 링 밖으로 나가도 안 잘리는 여유
  var na = fgScoreToAngle(score);
  var ringOuter = r + sw / 2;
  var badgeR = 11;
  var needleLen = ringOuter + badgeR + 3;          // 바늘을 링 외경보다 길게
  var badge = fgPolar(cx, cy, needleLen, na);       // 배지 = 바늘 끝(링 바깥)
  var gid = "fgGrad_" + (props.uid || "us");

  return (
    <svg width="100%" viewBox={"0 0 " + W + " " + H} style={{ display: "block", maxWidth: 230 }}>
      <defs>
        <linearGradient id={gid} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#e5453b" />
          <stop offset="28%" stopColor="#f0883e" />
          <stop offset="50%" stopColor="#e8c14a" />
          <stop offset="72%" stopColor="#8cc152" />
          <stop offset="100%" stopColor="#3aa856" />
        </linearGradient>
      </defs>
      {/* 그라데이션 링 */}
      <path d={fgArcPath(cx, cy, r, 180, 0)} fill="none" stroke={"url(#" + gid + ")"} strokeWidth={sw} strokeLinecap="round" />
      {/* 눈금 0 / 100 */}
      <text x={fgPolar(cx, cy, r, 180).x} y={cy + 16} fontSize="9" fill="#475569" textAnchor="middle">0</text>
      <text x={fgPolar(cx, cy, r, 0).x} y={cy + 16} fontSize="9" fill="#475569" textAnchor="middle">100</text>
      {/* 샤프 바늘(링 밖까지) + 허브 + 링 바깥 배지 */}
      {hasScore && (
        <g>
          <path d={fgNeedlePath(cx, cy, na, needleLen - badgeR + 2, 4.5)} fill="#f8fafc" />
          <circle cx={cx} cy={cy} r="6" fill="#f8fafc" />
          <circle cx={cx} cy={cy} r="2.6" fill="#0a0a14" />
          <circle cx={badge.x.toFixed(2)} cy={badge.y.toFixed(2)} r={badgeR} fill={band.color} />
          <text x={badge.x.toFixed(2)} y={badge.y.toFixed(2)} fontSize="12" fontWeight="700" fill="#fff"
            textAnchor="middle" dominantBaseline="central">{Math.round(Number(score))}</text>
        </g>
      )}
    </svg>
  );
}

// 과거 비교 한 줄: 제목(한글) + 등급(영어 축약) + 값 배지
function FgCompareRow(props) {
  var label = props.label;
  var value = props.value;
  var has = value != null && isFinite(Number(value));
  var band = fgBand(value);
  // 게이지 옆 좁은 공간용 짧은 등급 라벨
  var shortLabel = band.label.replace("Extreme ", "Ext. ");
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 0" }}>
      <span style={{ fontSize: 11.5, color: "#64748b" }}>{label}</span>
      {has ? (
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 10, color: band.color, fontWeight: 700, letterSpacing: 0.3 }}>{shortLabel}</span>
          <span style={{
            minWidth: 26, textAlign: "center", fontSize: 11.5, fontWeight: 800,
            color: "#0a0a14", background: band.color, borderRadius: 10, padding: "1px 7px",
          }}>{Math.round(Number(value))}</span>
        </span>
      ) : (
        <span style={{ fontSize: 11, color: "#475569" }}>—</span>
      )}
    </div>
  );
}

// 미국(CNN) 게이지 카드
function FgGauge(props) {
  var meta = { title: "미국 공포·탐욕", flag: "🇺🇸", note: "CNN Fear & Greed", api: "/api/fng" };

  var stateHook = React.useState({ loading: true, data: null, err: null });
  var st = stateHook[0], setSt = stateHook[1];

  React.useEffect(function () {
    var alive = true;
    fetch(meta.api)
      .then(function (r) { return r.ok ? r.json() : r.json().then(function (j) { throw new Error(j.error || ("HTTP " + r.status)); }); })
      .then(function (j) { if (alive) setSt({ loading: false, data: j, err: null }); })
      .catch(function (e) { if (alive) setSt({ loading: false, data: null, err: e.message || "불러오기 실패" }); });
    return function () { alive = false; };
  }, []);

  var data = st.data;
  var band = data ? fgBand(data.score) : fgBand(null);

  return (
    <div style={{
      background: "#0d0d18", border: "1px solid #1e293b", borderRadius: 14,
      padding: "14px 16px", flex: "1 1 300px", minWidth: 290,
    }}>
      {/* 헤더 */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0" }}>
          <span style={{ marginRight: 6 }}>{meta.flag}</span>{meta.title}
        </div>
        <div style={{ fontSize: 10, color: "#475569" }}>{meta.note}</div>
      </div>

      {st.loading && (
        <div style={{ textAlign: "center", padding: "40px 0", color: "#64748b", fontSize: 13 }}>불러오는 중…</div>
      )}

      {st.err && !st.loading && (
        <div style={{ textAlign: "center", padding: "34px 12px", color: "#64748b", fontSize: 12.5, lineHeight: 1.6 }}>
          지금은 표시할 수 없어요
          <div style={{ fontSize: 11, color: "#475569", marginTop: 4 }}>{st.err}</div>
        </div>
      )}

      {data && !st.loading && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          {/* 좌: 게이지 */}
          <div style={{ flex: "1 1 190px", minWidth: 180 }}>
            <FgGaugeSvg score={data.score} uid="us" />
            <div style={{ textAlign: "center", marginTop: 2 }}>
              <span style={{ fontSize: 15, fontWeight: 800, color: band.color, letterSpacing: 0.3 }}>{band.label}</span>
            </div>
          </div>
          {/* 우: 비교 지표 */}
          <div style={{ flex: "1 1 130px", minWidth: 130 }}>
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

// ── 한국(VKOSPI) 전용 ──────────────────────────────────────────
// 미국(CNN)과 다름: 등급 라벨 없음(색+숫자+참조점만), 색 방향 반대(낮음=안정 초록 → 높음=위험 빨강).
// 눈금은 VKOSPI 절대값 0~max(기본 100). VKOSPI엔 공식 등급 구간이 없어 Fear/Greed 단어를 붙이지 않는다.

function krColorOf(v) {
  var s = Number(v);
  if (!isFinite(s)) return "#64748b";
  if (s < 20) return "#3aa856";
  if (s < 30) return "#8cc152";
  if (s < 45) return "#e8c14a";
  if (s < 65) return "#f0883e";
  return "#e5453b";
}

// VKOSPI 게이지 SVG (값→각도는 0~max 선형, 색은 위험도 그라데이션 좌초록→우빨강)
function FgKrGaugeSvg(props) {
  var v = props.vkospi;
  var max = props.max || 100;
  var has = v != null && isFinite(Number(v));
  var W = 220, H = 140, cx = 110, cy = 112, r = 72, sw = 10;
  var pct = Math.max(0, Math.min(1, (Number(v) || 0) / max));
  var na = 180 - pct * 180;                          // 0=왼쪽(안정), max=오른쪽(위험)
  var ringOuter = r + sw / 2, badgeR = 12;
  var needleLen = ringOuter + badgeR + 3;
  var badge = fgPolar(cx, cy, needleLen, na);
  var col = krColorOf(v);
  var gid = "fgKrGrad";

  return (
    <svg width="100%" viewBox={"0 0 " + W + " " + H} style={{ display: "block", maxWidth: 230 }}>
      <defs>
        {/* 좌(안정)초록 → 우(위험)빨강 : 미국과 반대 방향 */}
        <linearGradient id={gid} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#3aa856" />
          <stop offset="30%" stopColor="#8cc152" />
          <stop offset="52%" stopColor="#e8c14a" />
          <stop offset="74%" stopColor="#f0883e" />
          <stop offset="100%" stopColor="#e5453b" />
        </linearGradient>
      </defs>
      <path d={fgArcPath(cx, cy, r, 180, 0)} fill="none" stroke={"url(#" + gid + ")"} strokeWidth={sw} strokeLinecap="round" />
      {/* 눈금 0 / max */}
      <text x={fgPolar(cx, cy, r, 180).x} y={cy + 16} fontSize="9" fill="#475569" textAnchor="middle">0</text>
      <text x={fgPolar(cx, cy, r, 0).x} y={cy + 16} fontSize="9" fill="#475569" textAnchor="middle">{max}</text>
      {has && (
        <g>
          <path d={fgNeedlePath(cx, cy, na, needleLen - badgeR + 2, 4.5)} fill="#f8fafc" />
          <circle cx={cx} cy={cy} r="6" fill="#f8fafc" />
          <circle cx={cx} cy={cy} r="2.6" fill="#0a0a14" />
          <circle cx={badge.x.toFixed(2)} cy={badge.y.toFixed(2)} r={badgeR} fill={col} />
          <text x={badge.x.toFixed(2)} y={badge.y.toFixed(2)} fontSize="11" fontWeight="700" fill="#fff"
            textAnchor="middle" dominantBaseline="central">{Math.round(Number(v))}</text>
        </g>
      )}
    </svg>
  );
}

// 한국 VKOSPI 카드
function FgKrGauge() {
  var stateHook = React.useState({ loading: true, data: null, err: null });
  var st = stateHook[0], setSt = stateHook[1];

  React.useEffect(function () {
    var alive = true;
    fetch("/api/fng-kr")
      .then(function (r) { return r.ok ? r.json() : r.json().then(function (j) { throw new Error(j.error || ("HTTP " + r.status)); }); })
      .then(function (j) { if (alive) setSt({ loading: false, data: j, err: null }); })
      .catch(function (e) { if (alive) setSt({ loading: false, data: null, err: e.message || "불러오기 실패" }); });
    return function () { alive = false; };
  }, []);

  var d = st.data;

  return (
    <div style={{ background: "#0d0d18", border: "1px solid #1e293b", borderRadius: 14, padding: "14px 16px", flex: "1 1 300px", minWidth: 290 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0" }}>
          <span style={{ marginRight: 6 }}>🇰🇷</span>한국 변동성(VKOSPI)
        </div>
        <div style={{ fontSize: 10, color: "#475569" }}>KRX 코스피200 변동성지수</div>
      </div>

      {st.loading && (
        <div style={{ textAlign: "center", padding: "40px 0", color: "#64748b", fontSize: 13 }}>불러오는 중…</div>
      )}

      {st.err && !st.loading && (
        <div style={{ textAlign: "center", padding: "34px 12px", color: "#64748b", fontSize: 12.5, lineHeight: 1.6 }}>
          지금은 표시할 수 없어요
          <div style={{ fontSize: 11, color: "#475569", marginTop: 4 }}>{st.err}</div>
        </div>
      )}

      {d && !st.loading && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          {/* 좌: 게이지 */}
          <div style={{ flex: "1 1 190px", minWidth: 180 }}>
            <FgKrGaugeSvg vkospi={d.vkospi} max={d.max || 100} />
            <div style={{ textAlign: "center", marginTop: 2 }}>
              <span style={{ fontSize: 20, fontWeight: 800, color: krColorOf(d.vkospi) }}>{d.vkospi}</span>
              <span style={{ fontSize: 11, color: "#475569", marginLeft: 6 }}>VKOSPI</span>
            </div>
          </div>
          {/* 우: 참조점 (등급 단어 대신 위치 감각 제공) */}
          <div style={{ flex: "1 1 130px", minWidth: 130, fontSize: 11.5, color: "#64748b", lineHeight: 1.9 }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>평시 범위</span>
              <span style={{ color: "#94a3b8", fontWeight: 600 }}>{(d.ref && d.ref.normalLow) || 15}~{(d.ref && d.ref.normalHigh) || 20}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>역대 최고</span>
              <span style={{ color: "#94a3b8", fontWeight: 600 }}>{(d.ref && d.ref.allTimeHigh) || 95}</span>
            </div>
            <div style={{ fontSize: 10, color: "#475569", marginTop: 6, paddingTop: 6, borderTop: "1px solid #16213a" }}>
              값이 높을수록 시장 변동성·불안이 큼. {d.basDd ? d.basDd.slice(0, 4) + "." + d.basDd.slice(4, 6) + "." + d.basDd.slice(6, 8) + " 기준" : ""}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// 패널: kind = "both"(종합) | "us" | "kr"
function FgGaugePanel(props) {
  var kind = props.kind || "both";
  var items = kind === "both" ? ["us", "kr"] : [kind];
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
      {items.map(function (k) {
        return k === "kr" ? <FgKrGauge key="kr" /> : <FgGauge key="us" kind="us" />;
      })}
    </div>
  );
}
