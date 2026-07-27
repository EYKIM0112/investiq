// api/fng-kr.js — [임시 프로브] KRX 인증 헤더 이름을 실제로 찾는 진단용
// /api/fng-kr?probe=1 로 여러 헤더 후보를 순차 시도해서 어느 것이 200을 주는지 반환.
export const config = { maxDuration: 30 };

var KRX_URL = "https://data-dbg.krx.co.kr/svc/apis/idx/drvprod_dd_trd";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();

  var authKey = (process.env.KRX_AUTH_KEY || "").trim();
  if (!authKey) return res.status(500).json({ error: "no key" });

  if (!(req.query && req.query.probe === "1")) {
    return res.status(200).json({ hint: "add ?probe=1 to run diagnostics" });
  }

  var basDd = "20260724";
  // 헤더 이름 후보들
  var headerCandidates = [
    { AUTH_KEY: authKey },
    { authKey: authKey },
    { auth_key: authKey },
    { apiKey: authKey },
    { "api-key": authKey },
    { Authorization: authKey },
    { Authorization: "Bearer " + authKey },
  ];

  var results = [];
  for (var i = 0; i < headerCandidates.length; i++) {
    var h = headerCandidates[i];
    var name = Object.keys(h)[0] + (h[Object.keys(h)[0]].indexOf("Bearer") === 0 ? " (Bearer)" : "");
    try {
      var r = await fetch(KRX_URL + "?basDd=" + basDd, { headers: h, signal: AbortSignal.timeout(8000) });
      var txt = await r.text();
      var okBody = txt.indexOf("OutBlock_1") !== -1;
      results.push({ header: name, status: r.status, hasData: okBody, bodyHead: txt.slice(0, 80) });
      if (r.status === 200 && okBody) break; // 성공 찾으면 중단
    } catch (e) {
      results.push({ header: name, error: e.name || e.message });
    }
  }

  return res.status(200).json({ keyLen: authKey.length, results: results });
}
