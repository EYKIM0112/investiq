// public/sector-edit.js — 보유종목 섹터 수동 지정 UI 모듈
// index.html에서 메인 앱 스크립트 '직전'에 로드:
//   <script type="text/babel" data-presets="react-classic" src="/sector-edit.js"></script>
//
// 설계 원칙(gurus.js/notify.js/sector-map.js와 동일):
//   - 전역 렉시컬 스코프 공유 → 최상위 선언은 전부 function + se/Se 접두어. top-level const/let 금지.
//   - 훅은 컴포넌트 내부에서 React.xxx 로만 사용.
//
// 저장 필드: holding.sector_manual (최종 라벨 문자열, 국가 접두 포함 가능. 예 "반도체" / "미국테크")
//   - 기존 holding.sector 필드는 PRESET 데모 데이터가 구버전 라벨(기술·AI·방산 등)로 쓰고 있어 건드리지 않는다.
//   - classifyOne이 sector_manual을 최우선으로 보고, 없으면 기존 자동 분류(DB→캐스케이드→Yahoo)로 진행.
//
// 목적: Yahoo 프로필 공백(코스닥 중소형주에 흔함) 등으로 "기타"가 된 종목을 사용자가 직접 교정.

// 국가 접두 목록 — index.html COUNTRY_PREFIXES와 동일해야 함(로드 순서 무관하게 자체 보유)
function seCountries() { return ["", "미국", "글로벌", "중국", "일본", "인도"]; }

// 라벨에서 국가 접두 분리 → { country, base }
function seSplitLabel(label) {
  const s = String(label || "");
  const cs = seCountries();
  for (let i = 1; i < cs.length; i++) {
    if (s.startsWith(cs[i])) return { country: cs[i], base: s.slice(cs[i].length) };
  }
  return { country: "", base: s };
}

// base + country → 최종 라벨. 자체완결 섹터는 접두 없음.
function seJoinLabel(base, country) {
  if (!base) return "";
  var selfContained = ["미국빅테크", "가상화폐", "원자재", "채권", "파킹형"];
  if (selfContained.indexOf(base) !== -1) return base;
  return (country || "") + base;
}

// 현재 자동 분류 결과(수동 지정 무시)를 구한다. classifyOne이 없으면 null.
function seAutoLabel(holding) {
  try {
    if (typeof classifyOne !== "function") return null;
    return classifyOne(holding.sector, holding.name, holding.ticker, holding.currency, null);
  } catch (e) {
    return null;
  }
}

// ===== 섹터 지정 UI =====
// props: { holding, value, onChange }
//   value    : 현재 sector_manual 값(없으면 "" 또는 null)
//   onChange : (newLabel|null) => void   ─ null이면 자동 분류로 되돌림
function SeSectorPicker(props) {
  const holding = props.holding || {};
  const value = props.value || "";
  const onChange = props.onChange || function () {};

  const [open, setOpen] = React.useState(false);

  const themes = (typeof SECTOR_THEMES !== "undefined" && SECTOR_THEMES.length)
    ? SECTOR_THEMES
    : ["반도체", "테크", "헬스케어", "금융", "소비재", "기타"];

  const auto = seAutoLabel(holding);
  const effective = value || auto || "기타";
  const isManual = !!value;
  const cur = seSplitLabel(value || "");
  const country = cur.country;
  const base = cur.base;

  const pick = function (b) {
    onChange(seJoinLabel(b, country || ""));
  };
  const pickCountry = function (c) {
    if (!base) return;           // 테마부터 고른 뒤 국가 선택
    onChange(seJoinLabel(base, c));
  };

  const chip = function (label, active, onClick, key) {
    return (
      <button key={key} onClick={onClick} style={{
        padding: "6px 10px", borderRadius: 8, cursor: "pointer",
        border: "1px solid " + (active ? "#4f6ef7" : "#334155"),
        background: active ? "#4f6ef733" : "#0a0a14",
        color: active ? "#a8b4f8" : "#94a3b8",
        fontSize: 12, fontWeight: active ? 700 : 500, whiteSpace: "nowrap",
      }}>{label}</button>
    );
  };

  return (
    <div style={{ background: "#0a0a14", border: "1px solid #1e293b", borderRadius: 10, padding: "12px 14px", marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 13, color: "#64748b", fontWeight: 600 }}>
          섹터
          <span style={{
            marginLeft: 8, fontWeight: 700,
            color: effective === "기타" ? "#f59e0b" : "#22d3a0",
          }}>{effective}</span>
          <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 400, color: isManual ? "#a8b4f8" : "#475569" }}>
            {isManual ? "· 직접 지정" : "· 자동 분류"}
          </span>
        </div>
        <button onClick={function () { setOpen(!open); }} style={{
          fontSize: 12, color: open ? "#ef4444" : "#4f6ef7",
          background: "none", border: "none", cursor: "pointer",
        }}>{open ? "닫기" : "변경"}</button>
      </div>

      {isManual && auto && auto !== effective && (
        <div style={{ fontSize: 11, color: "#475569", marginTop: 6 }}>
          자동 분류 결과: {auto}
        </div>
      )}

      {open && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 11.5, color: "#64748b", marginBottom: 7 }}>테마 선택</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {themes.map(function (t, i) {
              return chip(t, base === t, function () { pick(t); }, "t" + i);
            })}
          </div>

          <div style={{ fontSize: 11.5, color: "#64748b", margin: "12px 0 7px" }}>
            국가 <span style={{ color: "#475569" }}>(선택 · 미국주식 등에만)</span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {seCountries().map(function (c, i) {
              return chip(c === "" ? "없음" : c, country === c, function () { pickCountry(c); }, "c" + i);
            })}
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            <button onClick={function () { onChange(null); setOpen(false); }} style={{
              flex: 1, padding: "9px", borderRadius: 8, border: "1px solid #334155",
              background: "#16162a", color: "#94a3b8", fontSize: 12.5, fontWeight: 700, cursor: "pointer",
            }}>자동 분류로 되돌리기</button>
            <button onClick={function () { setOpen(false); }} style={{
              flex: 1, padding: "9px", borderRadius: 8, border: "1px solid #4f6ef7",
              background: "#4f6ef722", color: "#a8b4f8", fontSize: 12.5, fontWeight: 700, cursor: "pointer",
            }}>완료</button>
          </div>

          <div style={{ fontSize: 10.5, color: "#475569", marginTop: 10, lineHeight: 1.6 }}>
            · 직접 지정한 섹터는 자동 분류(DB·키워드·Yahoo)보다 항상 우선합니다.<br />
            · 원자재·채권·가상화폐·파킹형·미국빅테크는 국가 접두가 붙지 않습니다.
          </div>
        </div>
      )}
    </div>
  );
}
