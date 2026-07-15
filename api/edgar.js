// api/edgar.js — SEC EDGAR 13F 프록시 (Vercel 서버리스)
// 대가(기관투자가)들의 13F-HR 보유종목 조회. 브라우저 CORS 우회 + SEC 필수 User-Agent 부착용.
//
// 데이터 소스: SEC EDGAR 공식 API (무료·키 불필요)
//   1. https://data.sec.gov/submissions/CIK##########.json      → 13F-HR 제출 이력
//   2. https://www.sec.gov/Archives/edgar/data/{cik}/{acc}/index.json → filing 내 파일 목록
//   3. 그중 information table XML → 종목별 보유내역(issuer/value/shares)
//
// 엔드포인트:
//   /api/edgar?type=filings&cik=1067983                      → { name, cik, filings:[{accession,reportDate,filingDate,form}] }
//   /api/edgar?type=holdings&cik=1067983&accession=0000...   → { holdings:[{issuer,cls,cusip,value,shares,shType,putCall,pct}], total, count, unitScaled }
//
// 표시 정책(B안): CUSIP→티커 매핑 없이 issuer name 그대로. 비중(pct)은 value/합계라 단위와 무관하게 정확.
//
// ※ SEC 요구: User-Agent에 식별 정보(가능하면 실제 연락 이메일). 아래 UA를 본인 것으로 바꿔도 됨.
//    없거나 형식이 이상하면 SEC가 403을 줄 수 있음.

export const config = { maxDuration: 30 };

const UA = "InvestIQ Research Tool contact@investiq.app"; // ← 가능하면 본인 이메일로 교체
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function cik10(cik) { return String(cik).replace(/\D/g, "").padStart(10, "0"); }
function cikNum(cik) { return String(cik).replace(/\D/g, "").replace(/^0+/, "") || "0"; }

async function secFetch(url) {
  return fetch(url, {
    headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate", "Accept": "application/json, text/plain, */*" },
    signal: AbortSignal.timeout(15000),
  });
}

// 13F-HR 제출 이력 (분기별 최신본만 — 수정본 13F-HR/A 중복 제거)
async function getFilings(cik) {
  const r = await secFetch("https://data.sec.gov/submissions/CIK" + cik10(cik) + ".json");
  if (!r.ok) throw new Error("submissions 조회 실패 (" + r.status + ")");
  const d = await r.json();
  const rec = (d.filings && d.filings.recent) || {};
  const forms = rec.form || [], accs = rec.accessionNumber || [], rpts = rec.reportDate || [], fdates = rec.filingDate || [];
  const byQ = {};
  for (let i = 0; i < forms.length; i++) {
    if (forms[i] !== "13F-HR" && forms[i] !== "13F-HR/A") continue;
    const q = rpts[i] || "";
    const f = { accession: accs[i], reportDate: q, filingDate: fdates[i] || "", form: forms[i] };
    if (!byQ[q] || f.filingDate > byQ[q].filingDate) byQ[q] = f; // 같은 분기면 가장 최근 제출(수정본)
  }
  const filings = Object.values(byQ).sort((a, b) => (a.reportDate < b.reportDate ? 1 : -1));
  return { name: d.name || null, cik: cik10(cik), filings };
}

function grab(block, tag) {
  const m = block.match(new RegExp("<(?:\\w+:)?" + tag + ">\\s*([\\s\\S]*?)\\s*</(?:\\w+:)?" + tag + ">"));
  return m ? m[1].trim() : null;
}

// information table XML 파싱 → 보유내역
function parseInfoTable(xml) {
  const parts = xml.split(/<\/(?:\w+:)?infoTable>/);
  const holdings = [];
  let total = 0;
  for (let raw of parts) {
    const s = raw.search(/<(?:\w+:)?infoTable[>\s]/);
    if (s < 0) continue;
    const b = raw.slice(s);
    const issuer = grab(b, "nameOfIssuer");
    if (!issuer) continue;
    const value = Number((grab(b, "value") || "0").replace(/,/g, ""));
    const sshBlock = (b.match(/<(?:\w+:)?shrsOrPrnAmt>[\s\S]*?<\/(?:\w+:)?shrsOrPrnAmt>/) || [""])[0];
    const shares = Number((grab(sshBlock, "sshPrnamt") || "0").replace(/,/g, ""));
    holdings.push({
      issuer,
      cls: grab(b, "titleOfClass"),
      cusip: grab(b, "cusip"),
      value: Number.isFinite(value) ? value : 0,
      shares: Number.isFinite(shares) ? shares : 0,
      shType: grab(sshBlock, "sshPrnamtType"),
      putCall: grab(b, "putCall"),
    });
    total += Number.isFinite(value) ? value : 0;
  }
  // 값 단위 자동감지: 2023년 이후는 달러, 이전은 천달러 단위. 합이 비정상적으로 작으면(×1000) 보정.
  // (13F 제출 기준이 미국주식 1억 달러 이상이므로 달러 표기면 합이 최소 ~1e8. 1e7 미만이면 천달러 표기로 간주.)
  let unitScaled = false;
  if (total > 0 && total < 1e7) { holdings.forEach(h => { h.value *= 1000; }); total *= 1000; unitScaled = true; }
  holdings.forEach(h => { h.pct = total > 0 ? h.value / total : 0; });
  holdings.sort((a, b) => b.value - a.value);
  return { holdings, total, count: holdings.length, unitScaled };
}

// filing 폴더에서 infoTable XML 찾아 파싱
async function getHoldings(cik, accession) {
  const accNoDash = String(accession).replace(/[^0-9]/g, "");
  const base = "https://www.sec.gov/Archives/edgar/data/" + cikNum(cik) + "/" + accNoDash;
  const idx = await secFetch(base + "/index.json");
  if (!idx.ok) throw new Error("filing index 조회 실패 (" + idx.status + ")");
  const ij = await idx.json();
  const items = (ij.directory && ij.directory.item) || [];
  // primary_doc.xml(표지) 제외한 xml 후보들
  const xmls = items.map(it => it.name).filter(n => /\.xml$/i.test(n) && !/primary_doc\.xml$/i.test(n));
  // 후보가 애매하면 primary_doc.xml도 마지막에 시도
  items.map(it => it.name).filter(n => /primary_doc\.xml$/i.test(n)).forEach(n => xmls.push(n));

  for (let i = 0; i < xmls.length; i++) {
    const rr = await secFetch(base + "/" + xmls[i]);
    if (!rr.ok) { await sleep(120); continue; }
    const t = await rr.text();
    if (/<(?:\w+:)?infoTable[>\s]/.test(t)) return parseInfoTable(t);
    await sleep(120); // SEC rate-limit 여유
  }
  throw new Error("infoTable XML을 찾지 못했습니다.");
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { type, cik, accession } = req.query;
  if (!cik) return res.status(400).json({ error: "cik 필수" });

  try {
    if (type === "filings") {
      const d = await getFilings(cik);
      res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");
      return res.status(200).json(d);
    } else if (type === "holdings") {
      if (!accession) return res.status(400).json({ error: "accession 필수" });
      const d = await getHoldings(cik, accession);
      res.setHeader("Cache-Control", "public, s-maxage=86400, stale-while-revalidate=604800");
      return res.status(200).json(d);
    }
    return res.status(400).json({ error: "type은 filings 또는 holdings 여야 합니다." });
  } catch (e) {
    if (e.name === "TimeoutError" || e.name === "AbortError") return res.status(504).json({ error: "SEC 응답 시간 초과" });
    return res.status(502).json({ error: e.message || "EDGAR 조회 실패" });
  }
}
