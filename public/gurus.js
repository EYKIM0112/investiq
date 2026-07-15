// public/gurus.js — 대가들의 포트폴리오 (SEC 13F) 모듈 (독립)
// index.html에서 아래 한 줄로 로드(메인 앱 스크립트 직전):
//   <script type="text/babel" data-presets="react-classic" src="/gurus.js"></script>
// 그리고 App의 <Portfolio /> 를 <PortfolioWithGurus /> 로 교체.
//
// 설계: 전역 렉시컬 충돌 방지 위해 최상위는 전부 function 선언 + gr/Gr 접두어. 훅은 컴포넌트 내부에서 React.xxx.
// 데이터: /api/edgar 프록시 → SEC EDGAR 13F. 표시정책(B) — 티커 매핑 없이 issuer name 그대로.
//   비중(pct)=value/합계. 분기 변동은 최신 vs 직전 분기 보유량(shares) 비교.
//   ※ 미국 상장주식 롱 포지션만, 분기말 기준(최대 45일 지연).

// ===== 대가 명단 (CIK 실측 검증 완료) =====
function grGurus() {
  return [
    { name: "워런 버핏", firm: "Berkshire Hathaway", cik: "1067983", style: "경제적 해자를 가진 우량기업에 장기 집중 투자하는 가치투자의 대명사." },
    { name: "빌 애크먼", firm: "Pershing Square", cik: "1336528", style: "소수 종목에 대규모로 집중 투자하는 행동주의(액티비스트) 투자자." },
    { name: "리 루", firm: "Himalaya Capital", cik: "1709323", style: "멍거가 자금을 맡긴 인물. 미국·중국 우량주에 초집중하는 가치투자." },
    { name: "레이 달리오", firm: "Bridgewater Associates", cik: "1350694", style: "세계 최대 헤지펀드. 거시경제 기반 전천후(All Weather) 분산 투자." },
    { name: "스탠리 드러켄밀러", firm: "Duquesne Family Office", cik: "1536411", style: "거시 흐름을 읽어 기술·성장주를 기민하게 사고파는 톱다운 트레이더." },
    { name: "마이클 버리", firm: "Scion Asset Management", cik: "1649339", style: "'빅쇼트'의 그 인물. 역발상·딥밸류에 대담한 헤지 베팅을 병행." },
    { name: "데이비드 테퍼", firm: "Appaloosa", cik: "1656456", style: "위기 상황에서 과감히 베팅하는 디스트레스트·기술주 투자자." },
    { name: "세스 클라만", firm: "Baupost Group", cik: "1061768", style: "안전마진을 극도로 중시하는 딥밸류. 현금 보유도 마다않는 보수적 스타일." },
    { name: "하워드 막스", firm: "Oaktree Capital", cik: "949509", style: "신용·디스트레스트 채권의 대가. 시장 사이클과 리스크 통제 중심." },
    { name: "조엘 그린블랫", firm: "Gotham Asset Management", cik: "1510387", style: "'마법공식' 창시자. 고ROIC·저평가 종목을 정량적으로 폭넓게 매수." },
    { name: "데이비드 아인혼", firm: "Greenlight Capital", cik: "1079114", style: "롱숏 가치투자. 저평가 매수 + 고평가 공매도, 회계 분석에 강함." },
    { name: "다니엘 러브", firm: "Third Point", cik: "1040273", style: "이벤트 드리븐·행동주의. 실적 촉매가 있는 종목에 집중." },
    { name: "칼 아이칸", firm: "Icahn (개인 명의)", cik: "921669", style: "원조 행동주의 투자자. 저평가 기업 지분 확보 후 경영에 개입." },
    { name: "테리 스미스", firm: "Fundsmith", cik: "1569205", style: "\"좋은 기업을 사서 안 판다\". 고품질 우량주 초장기 보유." },
    { name: "척 아크레", firm: "Akre Capital", cik: "1112520", style: "높은 자본수익률 기업을 소수만 장기 보유하는 '컴파운더' 투자." },
    { name: "모니시 파브라이", firm: "Pabrai (Dalal Street)", cik: "1549575", style: "버핏·멍거 추종. 소수 종목에 초집중하는 '단도(Dhandho)' 가치투자." },
    { name: "프렘 왓사", firm: "Fairfax Financial", cik: "915191", style: "'캐나다의 버핏'. 보험 플로트 기반 역발상 장기 가치투자." },
    { name: "토마스 게이너", firm: "Markel Group", cik: "1096343", style: "보험사 기반 버핏식 우량주 장기 복리 투자." },
  ];
}

// ===== 유틸 =====
function grFmtUsd(v) {
  if (v == null || !isFinite(v)) return "-";
  if (v >= 1e9) return "$" + (v / 1e9).toFixed(2) + "B";
  if (v >= 1e6) return "$" + (v / 1e6).toFixed(1) + "M";
  return "$" + Math.round(v).toLocaleString("en-US");
}
function grFmtShares(n) { return (n == null || !isFinite(n)) ? "-" : Math.round(n).toLocaleString("en-US"); }
function grPct(p) { return (p == null || !isFinite(p)) ? "-" : (p * 100).toFixed(2) + "%"; }

async function grFetchFilings(cik) {
  const r = await fetch("/api/edgar?type=filings&cik=" + encodeURIComponent(cik), { signal: AbortSignal.timeout(20000) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "제출 이력 조회 실패");
  return d;
}
async function grFetchHoldings(cik, accession) {
  const r = await fetch("/api/edgar?type=holdings&cik=" + encodeURIComponent(cik) + "&accession=" + encodeURIComponent(accession), { signal: AbortSignal.timeout(25000) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "보유종목 조회 실패");
  return d;
}

// 분기 변동 태그: 최신 vs 직전분기 보유량(shares, cusip 기준)
function grDiff(cur, prev) {
  const pmap = {};
  if (prev) prev.forEach(h => { pmap[h.cusip] = (pmap[h.cusip] || 0) + (h.shares || 0); });
  return cur.map(h => {
    let tag = null;
    if (prev) {
      const ps = pmap[h.cusip];
      if (ps == null) tag = "new";
      else if (h.shares > ps * 1.0001) tag = "add";
      else if (h.shares < ps * 0.9999) tag = "cut";
    }
    return Object.assign({}, h, { tag });
  });
}
// 전량 청산(직전엔 있었으나 이번엔 없음)
function grSoldOut(cur, prev) {
  if (!prev) return [];
  const cset = {};
  cur.forEach(h => { cset[h.cusip] = true; });
  const seen = {}; const out = [];
  prev.forEach(h => { if (!cset[h.cusip] && !seen[h.cusip]) { seen[h.cusip] = true; out.push(h); } });
  return out.sort((a, b) => b.value - a.value);
}

function grTagMeta(tag) {
  if (tag === "new") return { txt: "신규", color: "#22d3a0", bg: "#22d3a01a" };
  if (tag === "add") return { txt: "추가", color: "#4f6ef7", bg: "#4f6ef71a" };
  if (tag === "cut") return { txt: "축소", color: "#fbbf24", bg: "#fbbf241a" };
  return null;
}

// ===== 보유종목 표시 =====
function GrHoldings(props) {
  const { data, guru } = props;
  const { firmName, latest, rows, soldOut } = data;
  const maxPct = rows.length ? rows[0].pct : 1;
  const card = { background: "#0f0f18", border: "1px solid #1e293b", borderRadius: 12, padding: 14, marginBottom: 12 };
  return (
    <div>
      <div style={card}>
        <div style={{ fontSize: 16, fontWeight: 800, color: "#e8eaf0" }}>{guru.name}</div>
        <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>{firmName || guru.firm}</div>
        <div style={{ fontSize: 12, color: "#64748b", marginTop: 8, lineHeight: 1.5 }}>{guru.style}</div>
        <div style={{ display: "flex", gap: 12, marginTop: 10, fontSize: 11.5, color: "#64748b", flexWrap: "wrap" }}>
          <span>보고 분기 <b style={{ color: "#a8b4f8" }}>{latest.reportDate}</b> (분기말 기준)</span>
          <span>공시일 {latest.filingDate}</span>
          <span>{rows.length}개 종목 · 총 {grFmtUsd(data.cur.total)}</span>
        </div>
      </div>

      <div style={card}>
        <div style={{ display: "grid", gridTemplateColumns: "18px 1fr 62px 66px", gap: 6, fontSize: 10.5, color: "#64748b", paddingBottom: 6, borderBottom: "1px solid #1e293b" }}>
          <span>#</span><span>종목 (issuer)</span><span style={{ textAlign: "right" }}>비중</span><span style={{ textAlign: "right" }}>평가액</span>
        </div>
        {rows.map((h, i) => {
          const tm = grTagMeta(h.tag);
          return (
            <div key={h.cusip + "_" + i} style={{ padding: "8px 0", borderBottom: "1px solid #12121f" }}>
              <div style={{ display: "grid", gridTemplateColumns: "18px 1fr 62px 66px", gap: 6, alignItems: "center", fontSize: 12.5 }}>
                <span style={{ color: "#475569", fontSize: 11 }}>{i + 1}</span>
                <span style={{ color: "#e8eaf0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {h.issuer}{h.putCall ? <span style={{ color: "#f472b6", fontSize: 10 }}> ({h.putCall === "Put" ? "풋" : "콜"})</span> : null}
                  {tm ? <span style={{ marginLeft: 5, fontSize: 9.5, fontWeight: 700, color: tm.color, background: tm.bg, borderRadius: 4, padding: "1px 4px" }}>{tm.txt}</span> : null}
                </span>
                <span style={{ textAlign: "right", color: "#a8b4f8", fontWeight: 700 }}>{grPct(h.pct)}</span>
                <span style={{ textAlign: "right", color: "#cbd5e1" }}>{grFmtUsd(h.value)}</span>
              </div>
              <div style={{ height: 3, background: "#1e293b", borderRadius: 2, marginTop: 5, overflow: "hidden" }}>
                <div style={{ height: "100%", width: (maxPct > 0 ? (h.pct / maxPct) * 100 : 0) + "%", background: "#22d3a0", borderRadius: 2 }}></div>
              </div>
              <div style={{ fontSize: 10, color: "#475569", marginTop: 3 }}>{grFmtShares(h.shares)} 주</div>
            </div>
          );
        })}
      </div>

      {soldOut && soldOut.length > 0 && (
        <div style={card}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#f87171", marginBottom: 8 }}>❌ 전량 청산 (직전 분기 대비) · {soldOut.length}종목</div>
          {soldOut.map((h, i) => (
            <div key={h.cusip + "_s" + i} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "5px 0", borderBottom: "1px solid #12121f" }}>
              <span style={{ color: "#94a3b8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.issuer}</span>
              <span style={{ color: "#475569", whiteSpace: "nowrap", marginLeft: 8 }}>직전 {grFmtUsd(h.value)}</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ fontSize: 10.5, color: "#475569", padding: "0 4px 8px", lineHeight: 1.6 }}>
        · 13F는 미국 상장주식 롱 포지션만 담습니다(현금·채권·해외주식·공매도 제외). 분기말 기준이며 공시까지 최대 45일 지연됩니다.<br />
        · 신규/추가/축소/청산은 직전 분기 대비 보유 주식수 변화이며, 13F 자체에는 개별 거래내역이 없어 분기 스냅샷 비교로 산출한 값입니다.
      </div>
    </div>
  );
}

// ===== 대가 탭 =====
function GurusTab() {
  const { useState } = React;
  const [sel, setSel] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const gurus = grGurus();

  const pick = async (g) => {
    setSel(g); setData(null); setErr(""); setLoading(true);
    try {
      const f = await grFetchFilings(g.cik);
      if (!f.filings || !f.filings.length) throw new Error("13F 제출 내역이 없습니다.");
      const latest = f.filings[0], prev = f.filings[1];
      const cur = await grFetchHoldings(g.cik, latest.accession);
      let prevH = null;
      if (prev) { try { prevH = await grFetchHoldings(g.cik, prev.accession); } catch (e) {} }
      const rows = grDiff(cur.holdings, prevH ? prevH.holdings : null);
      const soldOut = grSoldOut(cur.holdings, prevH ? prevH.holdings : null);
      setData({ firmName: f.name, latest, prev, cur, rows, soldOut });
    } catch (e) {
      setErr(e.message || "조회 실패");
    }
    setLoading(false);
  };

  if (sel) {
    return (
      <div>
        <button onClick={() => { setSel(null); setData(null); setErr(""); }} style={{ background: "none", border: "none", color: "#a8b4f8", fontSize: 13, cursor: "pointer", padding: "4px 0", marginBottom: 8 }}>← 대가 목록으로</button>
        {loading && <div style={{ fontSize: 13, color: "#64748b", padding: 20, textAlign: "center" }}>SEC EDGAR에서 13F 불러오는 중…</div>}
        {err && <div style={{ fontSize: 13, color: "#f87171", background: "#f8717111", border: "1px solid #f8717133", borderRadius: 8, padding: "9px 12px" }}>{err}</div>}
        {data && <GrHoldings data={data} guru={sel} />}
        {/* 종목이 많아도 언제든 목록으로 — 우하단 플로팅 버튼 */}
        <button
          onClick={() => { setSel(null); setData(null); setErr(""); try { window.scrollTo({ top: 0, behavior: "smooth" }); } catch (e) {} }}
          aria-label="대가 목록으로"
          style={{
            position: "fixed", left: 18, bottom: 22, zIndex: 401,
            width: 48, height: 48, borderRadius: 24, border: "none", cursor: "pointer",
            background: "linear-gradient(135deg,#2563eb,#7c3aed)", color: "#fff",
            fontSize: 20, lineHeight: "48px", textAlign: "center", padding: 0,
            boxShadow: "0 4px 14px rgba(0,0,0,0.45)",
          }}
        >←</button>
      </div>
    );
  }

  return (
    <div>
      <div style={{ fontSize: 11.5, color: "#64748b", marginBottom: 12, lineHeight: 1.5 }}>
        SEC 13F 공시 기반 대가들의 미국주식 보유 현황입니다. 분기말 기준이며 참고용입니다.
      </div>
      {gurus.map(g => (
        <div key={g.cik} onClick={() => pick(g)} style={{ background: "#0f0f18", border: "1px solid #1e293b", borderRadius: 12, padding: 14, marginBottom: 10, cursor: "pointer" }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
            <span style={{ fontSize: 14, fontWeight: 800, color: "#e8eaf0" }}>{g.name}</span>
            <span style={{ fontSize: 11, color: "#64748b", marginLeft: 8, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{g.firm}</span>
          </div>
          <div style={{ fontSize: 11.5, color: "#94a3b8", marginTop: 6, lineHeight: 1.5 }}>{g.style}</div>
        </div>
      ))}
    </div>
  );
}

// ===== 포트폴리오 탭 래퍼 (내 포트폴리오 / 대가들의 포트폴리오) =====
function PortfolioWithGurus() {
  const { useState } = React;
  const [sub, setSub] = useState("mine");
  const subBtn = (active) => ({
    flex: 1, padding: "10px 0", borderRadius: 9, fontSize: 13, fontWeight: 700, cursor: "pointer", border: "none",
    background: active ? "#4f6ef7" : "transparent", color: active ? "#fff" : "#94a3b8",
  });
  return (
    <div>
      <div style={{ display: "flex", gap: 6, marginBottom: 14, background: "#0f0f18", padding: 5, borderRadius: 12, border: "1px solid #1e293b" }}>
        <button onClick={() => setSub("mine")} style={subBtn(sub === "mine")}>내 포트폴리오</button>
        <button onClick={() => setSub("gurus")} style={subBtn(sub === "gurus")}>대가들의 포트폴리오</button>
      </div>
      <div style={{ display: sub === "mine" ? "block" : "none" }}><Portfolio /></div>
      <div style={{ display: sub === "gurus" ? "block" : "none" }}>{sub === "gurus" && <GurusTab />}</div>
    </div>
  );
}
