import React, { useState, useCallback, useEffect } from "react";

const STORAGE_KEY = "portfolio_v1";
const GEMINI_MODEL = "gemini-2.5-flash";

const SECTOR_COLORS = {
  "기술": "#00d4ff", "반도체": "#7c3aed", "AI": "#f59e0b",
  "에너지": "#10b981", "금융": "#3b82f6", "헬스케어": "#ec4899",
  "소비재": "#f97316", "부동산": "#84cc16", "방산": "#ef4444",
  "기타": "#6b7280",
};

function getSectorColor(sector) {
  for (const [key, color] of Object.entries(SECTOR_COLORS)) {
    if (sector?.includes(key)) return color;
  }
  return SECTOR_COLORS["기타"];
}

// ── API ──────────────────────────────────────────────────────────────────────
function getApiKey() {
  return localStorage.getItem("investiq_api_key") || "";
}

// ── Gemini API 공통 호출 ──────────────────────────────────────────────────────
async function callGemini({ system, user, maxTokens = 2000, useSearch = false }) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("API 키가 설정되지 않았습니다. 설정 탭에서 Gemini API 키를 입력해주세요.");

  const contents = [];
  if (system) contents.push({ role: "user", parts: [{ text: `[시스템 지시]
${system}

[사용자 질문]
${user}` }] });
  else contents.push({ role: "user", parts: [{ text: user }] });

  const body = {
    contents,
    generationConfig: { maxOutputTokens: maxTokens, temperature: 0.7 },
  };

  if (useSearch) {
    body.tools = [{ googleSearch: {} }];
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("") || "";
}

async function callGeminiWithImage({ system, user, imageBase64, mediaType, maxTokens = 2000 }) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("API 키가 설정되지 않았습니다. 설정 탭에서 Gemini API 키를 입력해주세요.");

  const parts = [];
  if (system) parts.push({ text: `[시스템 지시]
${system}

` });
  parts.push({ inlineData: { mimeType: mediaType, data: imageBase64 } });
  parts.push({ text: user });

  const body = {
    contents: [{ role: "user", parts }],
    generationConfig: { maxOutputTokens: maxTokens, temperature: 0.3 },
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("") || "";
}

// 기존 함수명 호환성 유지 (내부에서 Gemini 호출)
async function callClaude({ system, user, maxTokens = 1000 }) {
  return callGemini({ system, user, maxTokens, useSearch: false });
}
async function callClaudeWithSearch({ system, user, maxTokens = 2000 }) {
  return callGemini({ system, user, maxTokens, useSearch: true });
}
async function callClaudeWithImage({ system, user, imageBase64, mediaType, maxTokens = 1500 }) {
  return callGeminiWithImage({ system, user, imageBase64, mediaType, maxTokens });
}

// ── Storage ───────────────────────────────────────────────────────────────────
const PRESET_PORTFOLIO = {
  uploadedAt:"2026-05-16T00:00:00.000Z", updatedAt:"2026-05-16T00:00:00.000Z",
  account_type:"혼합", broker:"삼성/미래에셋/한투/메리츠/신한",
  holdings:[
    {account:"삼성 개인연금",name:"KODEX 증권",ticker:"266410",shares:50,avg_price:22897,currency:"KRW",sector:"금융",current_price:null},
    {account:"삼성 개인연금",name:"TIGER 구리실물",ticker:"139230",shares:230,avg_price:16126,currency:"KRW",sector:"에너지",current_price:null},
    {account:"삼성 개인연금",name:"TIGER 코스닥150",ticker:"232080",shares:300,avg_price:18688,currency:"KRW",sector:"기술",current_price:null},
    {account:"삼성 개인연금",name:"ACE 미국S&P500",ticker:"360750",shares:40,avg_price:22570,currency:"KRW",sector:"기술",current_price:null},
    {account:"삼성 개인연금",name:"RISE 미국나스닥100",ticker:"133690",shares:18,avg_price:21854,currency:"KRW",sector:"기술",current_price:null},
    {account:"삼성 개인연금",name:"TIGER 미국필라반도체나스닥",ticker:"381180",shares:15,avg_price:46134,currency:"KRW",sector:"반도체",current_price:null},
    {account:"삼성 개인연금",name:"TIME 코스피액티브",ticker:"439870",shares:70,avg_price:14987,currency:"KRW",sector:"기술",current_price:null},
    {account:"삼성 개인연금",name:"KODEX AI반도체TOP2플러스",ticker:"483150",shares:206,avg_price:24658,currency:"KRW",sector:"반도체",current_price:null},
    {account:"삼성 개인연금",name:"ACE KRX금현물",ticker:"411060",shares:50,avg_price:15590,currency:"KRW",sector:"에너지",current_price:null},
    {account:"삼성 개인연금",name:"RISE 2차전지액티브",ticker:"473450",shares:92,avg_price:7722,currency:"KRW",sector:"에너지",current_price:null},
    {account:"삼성 개인연금",name:"TIME 미국나스닥100액티브",ticker:"441680",shares:20,avg_price:27500,currency:"KRW",sector:"기술",current_price:null},
    {account:"삼성 개인연금",name:"ACE 원자력TOP10",ticker:"442320",shares:50,avg_price:67476,currency:"KRW",sector:"에너지",current_price:null},
    {account:"삼성 개인연금",name:"KODEX 로벗액티브",ticker:"411540",shares:50,avg_price:15556,currency:"KRW",sector:"기술",current_price:null},
    {account:"삼성 개인연금",name:"PLUS K방산",ticker:"494670",shares:20,avg_price:67230,currency:"KRW",sector:"방산",current_price:null},
    {account:"삼성 개인연금",name:"TIME 글로벌AI인공지능액티브",ticker:"448530",shares:20,avg_price:35648,currency:"KRW",sector:"AI",current_price:null},
    {account:"삼성 개인연금",name:"TIGER 미국배당다우존스",ticker:"458730",shares:13,avg_price:13965,currency:"KRW",sector:"금융",current_price:null},
    {account:"삼성 개인연금",name:"TIGER 글로벌AI&로보틱스",ticker:"441640",shares:30,avg_price:19873,currency:"KRW",sector:"AI",current_price:null},
    {account:"삼성 개인연금",name:"TIME K바이오액티브",ticker:"452340",shares:17,avg_price:18300,currency:"KRW",sector:"헬스케어",current_price:null},
    {account:"삼성 개인연금",name:"ACE 미국빅테크TOP7Plus",ticker:"459580",shares:200,avg_price:25975,currency:"KRW",sector:"기술",current_price:null},
    {account:"삼성 개인연금",name:"KODEX 미국AI전력핵심인프라",ticker:"472050",shares:120,avg_price:27775,currency:"KRW",sector:"AI",current_price:null},
    {account:"삼성 개인연금",name:"KODEX AI전력핵심설비",ticker:"476290",shares:60,avg_price:61205,currency:"KRW",sector:"AI",current_price:null},
    {account:"삼성 개인연금",name:"TIGER 조선TOP10",ticker:"481040",shares:25,avg_price:14700,currency:"KRW",sector:"기타",current_price:null},
    {account:"삼성 개인연금",name:"KODEX 코리아밸류업",ticker:"475080",shares:223,avg_price:22952,currency:"KRW",sector:"기타",current_price:null},
    {account:"삼성 개인연금",name:"TIGER 미국우주테크",ticker:"449980",shares:449,avg_price:10434,currency:"KRW",sector:"기술",current_price:null},
    {account:"삼성 개인연금",name:"ACE 글로벌반도체TOP4Plus",ticker:"480350",shares:30,avg_price:59300,currency:"KRW",sector:"반도체",current_price:null},
    {account:"삼성 DC",name:"TIME 차이나AI테크액티브",ticker:"448540",shares:30,avg_price:13419,currency:"KRW",sector:"AI",current_price:null},
    {account:"삼성 DC",name:"RISE 삼성전자SK하이닉스채권혼합50",ticker:"480540",shares:59,avg_price:10470,currency:"KRW",sector:"반도체",current_price:null},
    {account:"삼성 DC",name:"TIGER 미국우주테크",ticker:"449980",shares:10,avg_price:10392,currency:"KRW",sector:"기술",current_price:null},
    {account:"삼성 DC",name:"KODEX 증권",ticker:"266410",shares:50,avg_price:22897,currency:"KRW",sector:"금융",current_price:null},
    {account:"삼성 DC",name:"TIGER 구리실물",ticker:"139230",shares:119,avg_price:16700,currency:"KRW",sector:"에너지",current_price:null},
    {account:"삼성 DC",name:"TIGER 코스닥150",ticker:"232080",shares:90,avg_price:17623,currency:"KRW",sector:"기술",current_price:null},
    {account:"삼성 DC",name:"ACE 미국S&P500",ticker:"360750",shares:40,avg_price:16769,currency:"KRW",sector:"기술",current_price:null},
    {account:"삼성 DC",name:"ACE 미국나스닥100",ticker:"133690",shares:18,avg_price:21854,currency:"KRW",sector:"기술",current_price:null},
    {account:"삼성 DC",name:"TIME 코스피액티브",ticker:"439870",shares:30,avg_price:15484,currency:"KRW",sector:"기술",current_price:null},
    {account:"삼성 DC",name:"KODEX AI반도체TOP2플러스",ticker:"483150",shares:100,avg_price:14718,currency:"KRW",sector:"반도체",current_price:null},
    {account:"삼성 DC",name:"ACE KRX금현물",ticker:"411060",shares:47,avg_price:13887,currency:"KRW",sector:"에너지",current_price:null},
    {account:"삼성 DC",name:"RISE 2차전지액티브",ticker:"473450",shares:92,avg_price:7722,currency:"KRW",sector:"에너지",current_price:null},
    {account:"삼성 DC",name:"TIME 미국나스닥100액티브",ticker:"441680",shares:20,avg_price:27500,currency:"KRW",sector:"기술",current_price:null},
    {account:"삼성 DC",name:"ACE 원자력TOP10",ticker:"442320",shares:15,avg_price:40820,currency:"KRW",sector:"에너지",current_price:null},
    {account:"삼성 DC",name:"KODEX 로벗액티브",ticker:"411540",shares:47,avg_price:27666,currency:"KRW",sector:"기술",current_price:null},
    {account:"삼성 DC",name:"KODEX 삼성전자채권혼합",ticker:"441700",shares:100,avg_price:14118,currency:"KRW",sector:"금융",current_price:null},
    {account:"삼성 DC",name:"RISE 삼성그룹Top3채권혼합",ticker:"480550",shares:110,avg_price:10470,currency:"KRW",sector:"금융",current_price:null},
    {account:"삼성 DC",name:"PLUS K방산",ticker:"494670",shares:17,avg_price:36630,currency:"KRW",sector:"방산",current_price:null},
    {account:"삼성 DC",name:"TIME 글로벌AI인공지능액티브",ticker:"448530",shares:20,avg_price:35648,currency:"KRW",sector:"AI",current_price:null},
    {account:"삼성 DC",name:"TIGER 미국배당다우존스",ticker:"458730",shares:13,avg_price:13965,currency:"KRW",sector:"금융",current_price:null},
    {account:"삼성 DC",name:"ACE 미국빅테크TOP7Plus",ticker:"459580",shares:200,avg_price:25975,currency:"KRW",sector:"기술",current_price:null},
    {account:"삼성 DC",name:"TIGER 미국테크Top10채권혼합",ticker:"476150",shares:34,avg_price:14714,currency:"KRW",sector:"기술",current_price:null},
    {account:"삼성 DC",name:"KODEX 미국서학개미",ticker:"411500",shares:30,avg_price:27810,currency:"KRW",sector:"기술",current_price:null},
    {account:"삼성 DC",name:"KODEX 미국AI전력핵심인프라",ticker:"472050",shares:30,avg_price:27810,currency:"KRW",sector:"AI",current_price:null},
    {account:"삼성 DC",name:"KODEX AI전력핵심설비",ticker:"476290",shares:7,avg_price:58769,currency:"KRW",sector:"AI",current_price:null},
    {account:"삼성 DC",name:"SOL 미국배당미국채혼합50",ticker:"476140",shares:7,avg_price:58769,currency:"KRW",sector:"금융",current_price:null},
    {account:"삼성 DC",name:"TIGER 조선TOP10",ticker:"481040",shares:25,avg_price:14700,currency:"KRW",sector:"기타",current_price:null},
    {account:"삼성 DC",name:"KODEX 코리아밸류업",ticker:"475080",shares:152,avg_price:30460,currency:"KRW",sector:"기타",current_price:null},
    {account:"미래에셋 개인연금",name:"TIME 차이나AI테크액티브",ticker:"448540",shares:50,avg_price:13419,currency:"KRW",sector:"AI",current_price:null},
    {account:"미래에셋 개인연금",name:"TIGER 미국우주테크",ticker:"449980",shares:10,avg_price:10392,currency:"KRW",sector:"기술",current_price:null},
    {account:"미래에셋 개인연금",name:"TIGER 미국나스닥100",ticker:"133690",shares:10,avg_price:8175,currency:"KRW",sector:"기술",current_price:null},
    {account:"미래에셋 개인연금",name:"TIGER 구리실물",ticker:"139230",shares:119,avg_price:16700,currency:"KRW",sector:"에너지",current_price:null},
    {account:"미래에셋 개인연금",name:"TIGER 코스닥150",ticker:"232080",shares:90,avg_price:17623,currency:"KRW",sector:"기술",current_price:null},
    {account:"미래에셋 개인연금",name:"ACE 미국S&P500",ticker:"360750",shares:40,avg_price:16769,currency:"KRW",sector:"기술",current_price:null},
    {account:"미래에셋 개인연금",name:"TIGER 미국테크TOP10 INDXX",ticker:"381180",shares:47,avg_price:27666,currency:"KRW",sector:"기술",current_price:null},
    {account:"미래에셋 개인연금",name:"TIGER 미국필라반도체나스닥",ticker:"381180",shares:15,avg_price:46134,currency:"KRW",sector:"반도체",current_price:null},
    {account:"미래에셋 개인연금",name:"TIME 코스피액티브",ticker:"439870",shares:70,avg_price:14987,currency:"KRW",sector:"기술",current_price:null},
    {account:"미래에셋 개인연금",name:"KODEX AI반도체TOP2플러스",ticker:"483150",shares:100,avg_price:14718,currency:"KRW",sector:"반도체",current_price:null},
    {account:"미래에셋 개인연금",name:"RISE 2차전지액티브",ticker:"473450",shares:92,avg_price:7722,currency:"KRW",sector:"에너지",current_price:null},
    {account:"미래에셋 개인연금",name:"ACE 원자력TOP10",ticker:"442320",shares:15,avg_price:40820,currency:"KRW",sector:"에너지",current_price:null},
    {account:"미래에셋 개인연금",name:"PLUS K방산",ticker:"494670",shares:17,avg_price:36630,currency:"KRW",sector:"방산",current_price:null},
    {account:"미래에셋 개인연금",name:"TIME 글로벌AI인공지능액티브",ticker:"448530",shares:20,avg_price:35648,currency:"KRW",sector:"AI",current_price:null},
    {account:"미래에셋 개인연금",name:"TIGER 미국배당다우존스",ticker:"458730",shares:13,avg_price:13965,currency:"KRW",sector:"금융",current_price:null},
    {account:"미래에셋 개인연금",name:"KODEX 미국AI전력핵심인프라",ticker:"472050",shares:60,avg_price:27835,currency:"KRW",sector:"AI",current_price:null},
    {account:"미래에셋 개인연금",name:"KODEX AI전력핵심설비",ticker:"476290",shares:20,avg_price:39265,currency:"KRW",sector:"AI",current_price:null},
    {account:"미래에셋 개인연금",name:"TIGER 조선TOP10",ticker:"481040",shares:25,avg_price:14700,currency:"KRW",sector:"기타",current_price:null},
    {account:"미래에셋 개인연금",name:"KODEX 코리아밸류업",ticker:"475080",shares:181,avg_price:22952,currency:"KRW",sector:"기타",current_price:null},
    {account:"미래에셋 IRP",name:"TIME 차이나AI테크액티브",ticker:"448540",shares:30,avg_price:13419,currency:"KRW",sector:"AI",current_price:null},
    {account:"미래에셋 IRP",name:"RISE 삼성전자SK하이닉스채권혼합50",ticker:"480540",shares:59,avg_price:10470,currency:"KRW",sector:"반도체",current_price:null},
    {account:"미래에셋 IRP",name:"TIGER 코스닥150",ticker:"232080",shares:90,avg_price:17623,currency:"KRW",sector:"기술",current_price:null},
    {account:"미래에셋 IRP",name:"RISE 미국나스닥100",ticker:"133690",shares:18,avg_price:21854,currency:"KRW",sector:"기술",current_price:null},
    {account:"미래에셋 IRP",name:"KODEX 미국S&P500",ticker:"379800",shares:20,avg_price:22570,currency:"KRW",sector:"기술",current_price:null},
    {account:"미래에셋 IRP",name:"TIGER 미국테크TOP10 INDXX",ticker:"381180",shares:47,avg_price:27666,currency:"KRW",sector:"기술",current_price:null},
    {account:"미래에셋 IRP",name:"TIME 코스피액티브",ticker:"439870",shares:30,avg_price:15484,currency:"KRW",sector:"기술",current_price:null},
    {account:"미래에셋 IRP",name:"TIGER 미국테크Top10채권혼합",ticker:"476150",shares:34,avg_price:14714,currency:"KRW",sector:"기술",current_price:null},
    {account:"미래에셋 IRP",name:"KODEX 미국AI전력핵심인프라",ticker:"472050",shares:30,avg_price:27810,currency:"KRW",sector:"AI",current_price:null},
    {account:"미래에셋 IRP",name:"KODEX AI전력핵심설비",ticker:"476290",shares:7,avg_price:58769,currency:"KRW",sector:"AI",current_price:null},
    {account:"미래에셋 IRP",name:"SOL 미국배당미국채혼합50",ticker:"476140",shares:7,avg_price:58769,currency:"KRW",sector:"금융",current_price:null},
    {account:"한투 IRP",name:"TIME 코스피액티브",ticker:"439870",shares:25,avg_price:13290,currency:"KRW",sector:"기술",current_price:null},
    {account:"한투 IRP",name:"TIME 미국나스닥100액티브",ticker:"441680",shares:20,avg_price:32220,currency:"KRW",sector:"기술",current_price:null},
    {account:"한투 IRP",name:"TIME 차이나AI테크액티브",ticker:"448540",shares:15,avg_price:15930,currency:"KRW",sector:"AI",current_price:null},
    {account:"한투 IRP",name:"TIGER 미국우주테크",ticker:"449980",shares:60,avg_price:10392,currency:"KRW",sector:"기술",current_price:null},
    {account:"한투 IRP",name:"RISE 삼성전자SK하이닉스채권혼합50",ticker:"480540",shares:110,avg_price:10470,currency:"KRW",sector:"반도체",current_price:null},
    {account:"한투 IRP",name:"TIGER 코스닥150",ticker:"232080",shares:40,avg_price:17910,currency:"KRW",sector:"기술",current_price:null},
    {account:"한투 IRP",name:"TIGER 미국테크TOP10채권혼합",ticker:"476150",shares:55,avg_price:14720,currency:"KRW",sector:"기술",current_price:null},
    {account:"한투 IRP",name:"ACE 미국빅테크TOP7Plus",ticker:"459580",shares:49,avg_price:26060,currency:"KRW",sector:"기술",current_price:null},
    {account:"한투 IRP",name:"KODEX 미국AI전력핵심인프라",ticker:"472050",shares:10,avg_price:27780,currency:"KRW",sector:"AI",current_price:null},
    {account:"메리츠 일반",name:"TIGER 코스닥150",ticker:"232080",shares:300,avg_price:18688,currency:"KRW",sector:"기술",current_price:null},
    {account:"메리츠 일반",name:"TIGER 미국우주테크",ticker:"449980",shares:449,avg_price:10434,currency:"KRW",sector:"기술",current_price:null},
    {account:"메리츠 일반",name:"TIGER 구리실물",ticker:"139230",shares:230,avg_price:16126,currency:"KRW",sector:"에너지",current_price:null},
    {account:"메리츠 일반",name:"PLUS K방산",ticker:"494670",shares:20,avg_price:67230,currency:"KRW",sector:"방산",current_price:null},
    {account:"메리츠 일반",name:"KODEX 코리아밸류업",ticker:"475080",shares:223,avg_price:22952,currency:"KRW",sector:"기타",current_price:null},
    {account:"메리츠 일반",name:"KODEX 증권",ticker:"266410",shares:50,avg_price:22897,currency:"KRW",sector:"금융",current_price:null},
    {account:"메리츠 일반",name:"KODEX 미국AI전력핵심인프라",ticker:"472050",shares:120,avg_price:27775,currency:"KRW",sector:"AI",current_price:null},
    {account:"메리츠 일반",name:"KODEX AI전력핵심설비",ticker:"476290",shares:60,avg_price:61205,currency:"KRW",sector:"AI",current_price:null},
    {account:"메리츠 일반",name:"KODEX AI반도체TOP2플러스",ticker:"483150",shares:206,avg_price:24658,currency:"KRW",sector:"반도체",current_price:null},
    {account:"메리츠 일반",name:"ACE 원자력TOP10",ticker:"442320",shares:50,avg_price:67476,currency:"KRW",sector:"에너지",current_price:null},
    {account:"메리츠 일반",name:"ACE 미국빅테크TOP7Plus",ticker:"459580",shares:200,avg_price:25975,currency:"KRW",sector:"기술",current_price:null},
    {account:"메리츠 일반",name:"ACE 글로벌반도체TOP4Plus",ticker:"480350",shares:30,avg_price:59300,currency:"KRW",sector:"반도체",current_price:null},
    {account:"신한 일반",name:"삼성전자(현금)",ticker:"005930",shares:30,avg_price:143795,currency:"KRW",sector:"반도체",current_price:null},
    {account:"신한 일반",name:"삼성전자(RSA)",ticker:"005930",shares:160,avg_price:143795,currency:"KRW",sector:"반도체",current_price:null},
  ],
};

function loadPortfolio() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    return stored || PRESET_PORTFOLIO;
  } catch { return PRESET_PORTFOLIO; }
}
function savePortfolio(p) {
  if (p === null) localStorage.removeItem(STORAGE_KEY);
  else localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
}


// ── UI 공통 ───────────────────────────────────────────────────────────────────
function Spinner({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ animation: "spin 1s linear infinite", display: "block" }}>
      <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray="31.4" strokeDashoffset="10" />
    </svg>
  );
}

function Badge({ children, color }) {
  return (
    <span style={{
      background: color + "22", color, border: `1px solid ${color}44`,
      borderRadius: 4, padding: "2px 8px", fontSize: 11, fontWeight: 700, letterSpacing: 1,
    }}>
      {children}
    </span>
  );
}

// ── 시장 인사이트 탭 ──────────────────────────────────────────────────────────
const MARKET_TABS = [
  { id:"kr",          label:"🇰🇷 한국",    color:"#0ea5e9" },
  { id:"us",          label:"🇺🇸 미국",    color:"#7c3aed" },
  { id:"commodities", label:"🛢️ 원자재",  color:"#f59e0b" },
  { id:"asia",        label:"🌏 아시아",   color:"#10b981" },
  { id:"crypto",      label:"💰 가상화폐", color:"#f97316" },
  { id:"europe",      label:"🇪🇺 유럽",   color:"#ec4899" },
];

const MARKET_PROMPTS = {
  kr: (d) => `오늘(${d}) 한국 주식시장 분석. 각 배열 최대 3개 항목, reason은 1문장으로 간결하게. 순수 JSON만:
{"summary":"2문장 요약","strong":[{"name":"섹터명","reason":"1문장근거","score":80,"leaders":["종목1","종목2"]}],"rebound":[{"name":"섹터명","reason":"1문장근거","leaders":["종목1"]}],"weakening":[{"name":"섹터명","reason":"1문장근거"}],"events":["이벤트1","이벤트2"],"risks":["리스크1","리스크2"]}`,

  us: (d) => `오늘(${d}) 미국 주식시장 분석. 각 배열 최대 3개 항목, reason은 1문장으로 간결하게. 순수 JSON만:
{"summary":"2문장 요약","strong":[{"name":"섹터명","reason":"1문장근거","score":80,"leaders":["종목1","종목2"]}],"rebound":[{"name":"섹터명","reason":"1문장근거","leaders":["종목1"]}],"weakening":[{"name":"섹터명","reason":"1문장근거"}],"events":["이벤트1","이벤트2"],"risks":["리스크1","리스크2"]}`,

  commodities: (d) => `오늘(${d}) 글로벌 원자재 시장 분석. 아래 규칙을 따라줘:
1) 시장 규모 기준 상위 10개 원자재를 순위대로 나열 (금>원유>철광석>천연가스>구리>은>알루미늄>아연>니켈>옥수수 순이 일반적이나 최신 시장 규모 기준으로 정렬)
2) 규모가 작더라도 현재 급등·급락·핫한 원자재가 있으면 hot_pick으로 별도 추가
3) reason과 outlook은 각 1문장으로 간결하게
순수 JSON만:
{"summary":"2문장 요약","items":[{"rank":1,"name":"원자재명","price":"현재가(단위포함)","change_pct":"등락%","trend":"up/down/sideways","reason":"1문장근거","outlook":"1문장전망"}],"hot_picks":[{"name":"원자재명","reason":"왜 핫한지 1문장","change_pct":"등락%"}],"drivers":["주요동인1","주요동인2"],"risks":["리스크1"]}`,

  asia: (d) => `오늘(${d}) 일본·중국·인도 주식시장 분석. 국가별 strong/weak 각 2개, reason 1문장. 순수 JSON만:
{"summary":"2문장 요약","markets":[{"country":"국가명","index_change":"등락%","strong":[{"name":"섹터","reason":"1문장","leaders":["종목1"]}],"weak":[{"name":"섹터","reason":"1문장"}],"outlook":"1문장전망"}],"events":["이벤트1","이벤트2"]}`,

  crypto: (d) => `오늘(${d}) 가상화폐 시장 분석. majors 최대 5개, hot_sectors 최대 3개, reason 1문장. 순수 JSON만:
{"summary":"2문장 요약","majors":[{"name":"코인","price":"현재가","change_24h":"24h%","trend":"up/down/sideways","comment":"1문장"}],"hot_sectors":[{"name":"섹터","reason":"1문장","leaders":["코인1","코인2"]}],"events":["이벤트1"],"risks":["리스크1"]}`,

  europe: (d) => `오늘(${d}) 유럽 주요시장(DAX,FTSE,CAC40) 섹터 분석. strong/weak 각 3개, reason 1문장. 순수 JSON만:
{"summary":"2문장 요약","strong":[{"name":"섹터","country":"국가","reason":"1문장","leaders":["종목1"]}],"weak":[{"name":"섹터","reason":"1문장"}],"events":["이벤트1","이벤트2"],"risks":["리스크1"]}`,
};

function MarketInsight() {
  const [activeTab, setActiveTab] = useState("kr");
  const [results, setResults]     = useState({}); // { tabId: data }
  const [loading, setLoading]     = useState(null); // tabId or null
  const [errors, setErrors]       = useState({});
  const [updatedAt, setUpdatedAt] = useState({});

  const fetchTab = async (tabId) => {
    setLoading(tabId);
    setErrors(e => ({ ...e, [tabId]: "" }));
    try {
      const today = new Date().toLocaleDateString("ko-KR");
      const prompt = MARKET_PROMPTS[tabId](today);
      const text = await callClaudeWithSearch({
        maxTokens: 4000,
        system: "You are a global investment analyst. Search the web for latest info and return ONLY valid JSON. No markdown, no code blocks, no explanation text before or after. Start your response with { and end with }. Limit each array to max 3 items. Be concise.",
        user: prompt,
      });
      // Gemini/Claude 모두 대응하는 강화된 JSON 파싱
      let parsed;
      try {
        // 1단계: 마크다운 코드블록 제거
        let clean = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
        
        // 2단계: JSON 객체 추출 (앞뒤 텍스트 제거)
        const jsonMatch = clean.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error("No JSON found");
        clean = jsonMatch[0];
        
        // 3단계: 직접 파싱 시도
        try { parsed = JSON.parse(clean); }
        catch {
          // 4단계: 잘린 JSON 복구 시도
          const suffixes = ["}", "]}", "}]}", "}]}}"];
          for (const suffix of suffixes) {
            try { parsed = JSON.parse(clean + suffix); break; } catch {}
          }
          // 5단계: 마지막 완전한 필드까지만 잘라서 복구
          if (!parsed) {
            const lastComma = clean.lastIndexOf(",");
            if (lastComma > 0) {
              const trimmed = clean.slice(0, lastComma);
              const suffixes2 = ["}", "]}", "}]}", "}]}}"];
              for (const suffix of suffixes2) {
                try { parsed = JSON.parse(trimmed + suffix); break; } catch {}
              }
            }
          }
          if (!parsed) parsed = { summary: clean.slice(0, 800), _raw: true };
        }
      } catch(parseErr) {
        parsed = { summary: text.slice(0, 800), _raw: true };
      }
      setResults(r => ({ ...r, [tabId]: parsed }));
      setUpdatedAt(u => ({ ...u, [tabId]: new Date() }));
    } catch(e) {
      setErrors(er => ({ ...er, [tabId]: "분석 실패: " + e.message }));
    }
    setLoading(null);
  };

  const tab    = MARKET_TABS.find(t => t.id === activeTab);
  const data   = results[activeTab];
  const err    = errors[activeTab];
  const isLoad = loading === activeTab;
  const upAt   = updatedAt[activeTab];

  const Section = ({ title, color, children }) => (
    <div style={{ background:"#0f172a", border:`1px solid #1e293b`, borderRadius:12, padding:18, marginBottom:14 }}>
      <div style={{ fontSize:10, color, fontWeight:700, marginBottom:12, letterSpacing:2 }}>{title}</div>
      {children}
    </div>
  );

  const SectorCard = ({ item, showScore }) => (
    <div style={{ marginBottom:14 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:4 }}>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <span style={{ fontSize:14, fontWeight:700, color: getSectorColor(item.name) }}>{item.name}</span>
          {item.leaders?.length > 0 && (
            <span style={{ fontSize:10, color:"#475569" }}>{item.leaders.slice(0,2).join(" · ")}</span>
          )}
        </div>
        {showScore && item.score && <span style={{ fontSize:11, color:"#10b981", fontWeight:700 }}>{item.score}/100</span>}
      </div>
      {showScore && item.score && (
        <div style={{ background:"#1e293b", borderRadius:4, height:4, marginBottom:6 }}>
          <div style={{ width:`${item.score}%`, height:4, borderRadius:4, background: getSectorColor(item.name) }} />
        </div>
      )}
      <div style={{ fontSize:12, color:"#64748b" }}>{item.reason}</div>
    </div>
  );

  const renderKrUs = (d) => (
    <>
      <Section title="MARKET SUMMARY" color="#0ea5e9">
        <div style={{ color:"#e2e8f0", lineHeight:1.7, fontSize:14 }}>{d.summary}</div>
      </Section>
      {d.strong?.length > 0 && (
        <Section title="🔥 모멘텀 강한 섹터 (자금 유입 중)" color="#10b981">
          {d.strong.map((s,i) => <SectorCard key={i} item={s} showScore />)}
        </Section>
      )}
      {d.rebound?.length > 0 && (
        <Section title="📈 반등 시작 섹터 (바닥권 신호)" color="#f59e0b">
          {d.rebound.map((s,i) => <SectorCard key={i} item={s} />)}
        </Section>
      )}
      {d.weakening?.length > 0 && (
        <Section title="📉 모멘텀 약화 섹터 (주의)" color="#ef4444">
          {d.weakening.map((s,i) => <SectorCard key={i} item={s} />)}
        </Section>
      )}
      {d.events?.length > 0 && (
        <Section title="주요 이벤트" color="#f59e0b">
          {d.events.map((e,i) => <div key={i} style={{ fontSize:13, color:"#cbd5e1", marginBottom:6 }}>• {e}</div>)}
        </Section>
      )}
      {d.risks?.length > 0 && (
        <div style={{ background:"#1a0a0a", border:"1px solid #ef444433", borderRadius:12, padding:18 }}>
          <div style={{ fontSize:10, color:"#ef4444", fontWeight:700, marginBottom:10, letterSpacing:2 }}>⚠️ 리스크</div>
          {d.risks.map((r,i) => <div key={i} style={{ fontSize:13, color:"#fca5a5", marginBottom:6 }}>• {r}</div>)}
        </div>
      )}
    </>
  );

  const renderCommodities = (d) => (
    <>
      <Section title="COMMODITY SUMMARY" color="#f59e0b">
        <div style={{ color:"#e2e8f0", lineHeight:1.7, fontSize:14 }}>{d.summary}</div>
      </Section>
      <Section title="원자재별 현황 (시장규모 순위)" color="#f59e0b">
        {d.items?.map((item,i) => (
          <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", padding:"10px 0", borderBottom:"1px solid #1e293b" }}>
            <div style={{ flex:1 }}>
              <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4 }}>
                <span style={{ fontSize:11, color:"#475569", fontWeight:700, minWidth:20 }}>#{item.rank||i+1}</span>
                <span style={{ fontWeight:700, color:"#e2e8f0", fontSize:14 }}>{item.name}</span>
                <Badge color={item.trend==="up"?"#10b981":item.trend==="down"?"#ef4444":"#64748b"}>
                  {item.trend==="up"?"▲":item.trend==="down"?"▼":"→"} {item.change_pct}
                </Badge>
              </div>
              <div style={{ fontSize:11, color:"#64748b", paddingLeft:28 }}>{item.reason}</div>
              <div style={{ fontSize:11, color:"#475569", marginTop:2, paddingLeft:28 }}>전망: {item.outlook}</div>
            </div>
            <div style={{ textAlign:"right", fontSize:13, fontWeight:700, color:"#e2e8f0", minWidth:80 }}>{item.price}</div>
          </div>
        ))}
      </Section>
      {d.hot_picks?.length > 0 && (
        <Section title="🔥 주목 원자재 (급등·급락·핫픽)" color="#f97316">
          {d.hot_picks.map((h,i) => (
            <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", padding:"8px 0", borderBottom:"1px solid #1e293b" }}>
              <div style={{ flex:1 }}>
                <div style={{ fontWeight:700, color:"#e2e8f0", fontSize:14, marginBottom:3 }}>{h.name}</div>
                <div style={{ fontSize:12, color:"#64748b" }}>{h.reason}</div>
              </div>
              <div style={{ fontSize:13, fontWeight:700, color: parseFloat(h.change_pct) >= 0 ? "#10b981" : "#ef4444", minWidth:60, textAlign:"right" }}>
                {h.change_pct}
              </div>
            </div>
          ))}
        </Section>
      )}
      {d.drivers?.length > 0 && (
        <Section title="주요 동인" color="#0ea5e9">
          {d.drivers.map((e,i) => <div key={i} style={{ fontSize:13, color:"#cbd5e1", marginBottom:6 }}>• {e}</div>)}
        </Section>
      )}
    </>
  );

  const renderAsia = (d) => (
    <>
      <Section title="ASIA SUMMARY" color="#10b981">
        <div style={{ color:"#e2e8f0", lineHeight:1.7, fontSize:14 }}>{d.summary}</div>
      </Section>
      {d.markets?.map((mkt,i) => (
        <Section key={i} title={`${mkt.country} ${mkt.index_change||""}`} color="#10b981">
          {mkt.strong?.length > 0 && (
            <div style={{ marginBottom:12 }}>
              <div style={{ fontSize:10, color:"#10b981", marginBottom:8 }}>▲ 강한 섹터</div>
              {mkt.strong.map((s,j) => <SectorCard key={j} item={s} />)}
            </div>
          )}
          {mkt.weak?.length > 0 && (
            <div>
              <div style={{ fontSize:10, color:"#ef4444", marginBottom:8 }}>▼ 약한 섹터</div>
              {mkt.weak.map((s,j) => <div key={j} style={{ fontSize:13, color:"#64748b", marginBottom:4 }}>• {s.name}: {s.reason}</div>)}
            </div>
          )}
          <div style={{ fontSize:12, color:"#475569", marginTop:8 }}>전망: {mkt.outlook}</div>
        </Section>
      ))}
    </>
  );

  const renderCrypto = (d) => (
    <>
      <Section title="CRYPTO SUMMARY" color="#f97316">
        <div style={{ color:"#e2e8f0", lineHeight:1.7, fontSize:14 }}>{d.summary}</div>
      </Section>
      <Section title="메이저 코인" color="#f97316">
        {d.majors?.map((c,i) => (
          <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"10px 0", borderBottom:"1px solid #1e293b" }}>
            <div>
              <div style={{ fontWeight:700, color:"#e2e8f0", fontSize:14 }}>{c.name}</div>
              <div style={{ fontSize:11, color:"#64748b" }}>{c.comment}</div>
            </div>
            <div style={{ textAlign:"right" }}>
              <div style={{ fontWeight:700, color:"#e2e8f0", fontSize:13 }}>{c.price}</div>
              <div style={{ fontSize:11, color: c.trend==="up"?"#10b981":"#ef4444" }}>{c.change_24h} (24h)</div>
            </div>
          </div>
        ))}
      </Section>
      {d.hot_sectors?.length > 0 && (
        <Section title="🔥 핫한 섹터" color="#f59e0b">
          {d.hot_sectors.map((s,i) => <SectorCard key={i} item={s} />)}
        </Section>
      )}
      {d.risks?.length > 0 && (
        <div style={{ background:"#1a0a0a", border:"1px solid #ef444433", borderRadius:12, padding:18 }}>
          <div style={{ fontSize:10, color:"#ef4444", fontWeight:700, marginBottom:10, letterSpacing:2 }}>⚠️ 리스크</div>
          {d.risks.map((r,i) => <div key={i} style={{ fontSize:13, color:"#fca5a5", marginBottom:6 }}>• {r}</div>)}
        </div>
      )}
    </>
  );

  const renderEurope = (d) => (
    <>
      <Section title="EUROPE SUMMARY" color="#ec4899">
        <div style={{ color:"#e2e8f0", lineHeight:1.7, fontSize:14 }}>{d.summary}</div>
      </Section>
      {d.strong?.length > 0 && (
        <Section title="▲ 강한 섹터" color="#10b981">
          {d.strong.map((s,i) => <SectorCard key={i} item={{...s, reason: `[${s.country}] ${s.reason}`}} />)}
        </Section>
      )}
      {d.weak?.length > 0 && (
        <Section title="▼ 약한 섹터" color="#ef4444">
          {d.weak.map((s,i) => <div key={i} style={{ fontSize:13, color:"#64748b", marginBottom:6 }}>• {s.name}: {s.reason}</div>)}
        </Section>
      )}
      {d.events?.length > 0 && (
        <Section title="주요 이벤트" color="#f59e0b">
          {d.events.map((e,i) => <div key={i} style={{ fontSize:13, color:"#cbd5e1", marginBottom:6 }}>• {e}</div>)}
        </Section>
      )}
    </>
  );

  const renderData = (tabId, d) => {
    if (d._raw) return <div style={{ color:"#94a3b8", fontSize:13, lineHeight:1.7 }}>{d.summary}</div>;
    if (tabId==="kr" || tabId==="us") return renderKrUs(d);
    if (tabId==="commodities")        return renderCommodities(d);
    if (tabId==="asia")               return renderAsia(d);
    if (tabId==="crypto")             return renderCrypto(d);
    if (tabId==="europe")             return renderEurope(d);
    return null;
  };

  return (
    <div style={{ padding:"0 4px" }}>
      {/* 마켓 탭 */}
      <div style={{ display:"flex", gap:6, marginBottom:16, overflowX:"auto", paddingBottom:4 }}>
        {MARKET_TABS.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)} style={{
            padding:"7px 12px", borderRadius:20, flexShrink:0,
            border:`1px solid ${activeTab===t.id ? t.color : "#334155"}`,
            background: activeTab===t.id ? t.color+"22" : "transparent",
            color: activeTab===t.id ? t.color : "#64748b",
            fontSize:11, fontWeight: activeTab===t.id ? 700 : 400, cursor:"pointer",
          }}>{t.label}</button>
        ))}
      </div>

      {/* 헤더 */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
        <div style={{ fontSize:11, color:"#64748b" }}>
          {upAt ? `업데이트: ${upAt.toLocaleTimeString("ko-KR")}` : "버튼을 눌러 분석 시작"}
        </div>
        <button onClick={() => fetchTab(activeTab)} disabled={!!loading} style={{
          background: tab.color, color:"#fff", border:"none", borderRadius:8,
          padding:"8px 16px", cursor: loading ? "not-allowed" : "pointer",
          fontWeight:700, fontSize:12, display:"flex", alignItems:"center", gap:6,
          opacity: loading ? 0.7 : 1,
        }}>
          {isLoad ? <Spinner size={13}/> : "↻"} {isLoad ? "분석 중..." : "분석 시작"}
        </button>
      </div>

      {/* 초기 안내 */}
      {!isLoad && !data && !err && (
        <div style={{ textAlign:"center", padding:"50px 20px" }}>
          <div style={{ fontSize:44, marginBottom:14 }}>
            {tab.id==="kr"?"🇰🇷":tab.id==="us"?"🇺🇸":tab.id==="commodities"?"🛢️":tab.id==="asia"?"🌏":tab.id==="crypto"?"💰":"🇪🇺"}
          </div>
          <div style={{ fontSize:14, fontWeight:700, color:"#94a3b8", marginBottom:8 }}>{tab.label} 분석</div>
          <div style={{ fontSize:12, color:"#475569" }}>분석 시작 버튼을 눌러주세요</div>
        </div>
      )}

      {/* 로딩 */}
      {isLoad && (
        <div style={{ textAlign:"center", padding:"50px 20px" }}>
          <Spinner size={34}/>
          <div style={{ marginTop:14, fontSize:13, color:"#64748b" }}>웹 검색 중... 최신 데이터 수집 중</div>
        </div>
      )}

      {/* 에러 */}
      {err && !isLoad && (
        <div style={{ background:"#1a0a0a", border:"1px solid #ef444433", borderRadius:12, padding:16, color:"#fca5a5", fontSize:13 }}>
          ⚠️ {err}
        </div>
      )}

      {/* 결과 */}
      {data && !isLoad && renderData(activeTab, data)}
    </div>
  );
}


// ── 직접입력 모달 ─────────────────────────────────────────────────────────────
const ACCOUNTS = ["국내계좌", "해외계좌", "ISA", "연금저축", "IRP", "기타"];
const SECTORS  = ["기술","반도체","AI","에너지","금융","헬스케어","소비재","방산","부동산","기타"];

function ManualInputModal({ onClose, onAdd }) {
  const [account, setAccount]           = useState("국내계좌");
  const [customAccount, setCustomAccount] = useState("");
  const [name, setName]                 = useState("");
  const [ticker, setTicker]             = useState("");
  const [avgPrice, setAvgPrice]         = useState("");
  const [shares, setShares]             = useState("");
  const [currency, setCurrency]         = useState("KRW");
  const [sector, setSector]             = useState("기타");

  const handleAdd = () => {
    if (!name || !avgPrice || !shares) { alert("종목명, 평균단가, 수량은 필수입니다."); return; }
    onAdd({
      ticker: ticker || name,
      name,
      shares: parseFloat(shares),
      avg_price: parseFloat(String(avgPrice).replace(/,/g, "")),
      currency,
      sector,
      account: account === "기타" ? (customAccount || "기타") : account,
      current_price: null,
    });
    setName(""); setTicker(""); setAvgPrice(""); setShares("");
  };

  const Field = ({ label, value, onChange, inputMode = "text" }) => (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>{label}</div>
      <input
        inputMode={inputMode}
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{
          width: "100%", background: "#020617", border: "1px solid #334155",
          borderRadius: 8, padding: "11px 12px", color: "#e2e8f0", fontSize: 14, outline: "none",
        }}
      />
    </div>
  );

  return (
    <div style={{ position: "fixed", inset: 0, background: "#000b", zIndex: 300, display: "flex", alignItems: "flex-end" }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div style={{ width: "100%", maxWidth: 480, margin: "0 auto", background: "#0f172a", borderRadius: "20px 20px 0 0", padding: "24px 20px 48px", maxHeight: "88vh", overflowY: "auto", border: "1px solid #1e293b" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#e2e8f0" }}>종목 직접 입력</div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#64748b", fontSize: 22, cursor: "pointer", lineHeight: 1 }}>✕</button>
        </div>

        <div style={{ fontSize: 11, color: "#64748b", marginBottom: 6 }}>계좌 선택</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
          {ACCOUNTS.map(a => (
            <button key={a} onClick={() => setAccount(a)} style={{
              padding: "6px 12px", borderRadius: 20,
              border: `1px solid ${account === a ? "#0ea5e9" : "#334155"}`,
              background: account === a ? "#0ea5e922" : "transparent",
              color: account === a ? "#0ea5e9" : "#94a3b8", fontSize: 12, cursor: "pointer", fontWeight: account === a ? 700 : 400,
            }}>{a}</button>
          ))}
        </div>
        {account === "기타" && (
          <input placeholder="계좌명 직접 입력" value={customAccount} onChange={e => setCustomAccount(e.target.value)}
            style={{ width: "100%", background: "#020617", border: "1px solid #334155", borderRadius: 8, padding: "10px 12px", color: "#e2e8f0", fontSize: 14, outline: "none", marginBottom: 10 }} />
        )}

        <div style={{ fontSize: 11, color: "#64748b", marginBottom: 6 }}>통화</div>
        <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
          {["KRW","USD","JPY","EUR"].map(c => (
            <button key={c} onClick={() => setCurrency(c)} style={{
              flex: 1, padding: "8px 0", borderRadius: 8,
              border: `1px solid ${currency === c ? "#10b981" : "#334155"}`,
              background: currency === c ? "#10b98122" : "transparent",
              color: currency === c ? "#10b981" : "#94a3b8", fontSize: 12, cursor: "pointer", fontWeight: currency === c ? 700 : 400,
            }}>{c}</button>
          ))}
        </div>

        <Field label="종목명 *" value={name} onChange={setName} />
        <Field label="종목코드 (선택)" value={ticker} onChange={setTicker} />
        <Field label="매수 평균단가 *" value={avgPrice} onChange={setAvgPrice} inputMode="decimal" />
        <Field label="보유 수량 *" value={shares} onChange={setShares} inputMode="decimal" />

        <div style={{ fontSize: 11, color: "#64748b", marginBottom: 6, marginTop: 4 }}>섹터</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 22 }}>
          {SECTORS.map(s => (
            <button key={s} onClick={() => setSector(s)} style={{
              padding: "5px 11px", borderRadius: 16,
              border: `1px solid ${sector === s ? getSectorColor(s) : "#334155"}`,
              background: sector === s ? getSectorColor(s) + "22" : "transparent",
              color: sector === s ? getSectorColor(s) : "#94a3b8", fontSize: 11, cursor: "pointer",
            }}>{s}</button>
          ))}
        </div>

        <button onClick={handleAdd} style={{
          width: "100%", padding: "14px", borderRadius: 10,
          background: "linear-gradient(135deg,#0ea5e9,#7c3aed)",
          color: "#fff", border: "none", fontWeight: 700, fontSize: 15, cursor: "pointer",
        }}>+ 종목 추가</button>
      </div>
    </div>
  );
}

// ── 포트폴리오 탭 ─────────────────────────────────────────────────────────────
function Portfolio() {
  const [portfolio, setPortfolio] = useState(loadPortfolio);
  const [uploading, setUploading]   = useState(false);
  const [uploadMsg, setUploadMsg]   = useState("");
  const [updating, setUpdating]     = useState(false);
  const [dragOver, setDragOver]     = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [showAddPanel, setShowAddPanel] = useState(false);

  // 이미지 → Claude Vision
  const analyzeImage = async (file) => {
    setUploadMsg("AI가 계좌 이미지 분석 중...");
    const base64 = await new Promise((res, rej) => {
      const r = new FileReader(); r.onload = () => res(r.result.split(",")[1]); r.onerror = rej; r.readAsDataURL(file);
    });
    const text = await callClaudeWithImage({
      maxTokens: 2000,
      system: `주식 계좌 스크린샷에서 종목 정보를 추출하여 순수 JSON만 반환. 마크다운 없이.
{"holdings":[{"ticker":"코드","name":"종목명","shares":수량,"avg_price":평균단가,"currency":"KRW또는USD","sector":"섹터"}],"account_type":"국내/해외/혼합","broker":"증권사"}`,
      imageBase64: base64, mediaType: file.type,
      user: "이 계좌 스크린샷에서 모든 보유 종목(코드, 종목명, 수량, 평균단가)을 추출해줘. JSON만.",
    });
    return JSON.parse(text.replace(/```json|```/g, "").trim());
  };

  // 엑셀/CSV → Claude
  const analyzeSpreadsheet = async (file) => {
    setUploadMsg("스프레드시트 파싱 중...");
    let textContent = "";
    if (file.name.endsWith(".csv")) {
      textContent = await file.text();
    } else {
      const ab = await file.arrayBuffer();
      const bytes = new Uint8Array(ab);
      let bin = ""; bytes.forEach(b => bin += String.fromCharCode(b));
      const b64 = btoa(bin);
      textContent = await callClaude({
        maxTokens: 2000,
        system: "엑셀 파일 파서. base64 xlsx를 CSV 텍스트로만 변환 반환.",
        user: `이 base64 xlsx를 CSV로 변환:\n${b64.slice(0, 8000)}`,
      });
    }
    setUploadMsg("종목 데이터 인식 중...");
    const text = await callClaude({
      maxTokens: 2000,
      system: `포트폴리오 CSV/텍스트에서 종목 추출 후 순수 JSON만.
{"holdings":[{"ticker":"코드","name":"종목명","shares":수량,"avg_price":평균단가,"currency":"KRW","sector":"섹터"}],"account_type":"","broker":""}`,
      user: `종목 정보 추출:\n\n${textContent.slice(0, 6000)}`,
    });
    return JSON.parse(text.replace(/```json|```/g, "").trim());
  };

  // 공통 파일 처리
  const processFile = async (file, addToExisting = false) => {
    if (!file) return;
    setUploading(true);
    setUploadMsg("파일 확인 중...");
    try {
      const ext = file.name.split(".").pop().toLowerCase();
      let parsed;
      if (["jpg","jpeg","png","webp","gif","heic"].includes(ext) || file.type.startsWith("image/")) {
        parsed = await analyzeImage(file);
      } else if (["xlsx","xls","csv"].includes(ext)) {
        parsed = await analyzeSpreadsheet(file);
      } else {
        throw new Error("이미지, xlsx, csv 파일만 지원합니다.");
      }
      const newHoldings = parsed.holdings.map(h => ({ ...h, current_price: null }));
      const base = addToExisting && portfolio ? portfolio : { ...parsed, uploadedAt: new Date().toISOString() };
      const updated = {
        ...base,
        updatedAt: new Date().toISOString(),
        holdings: addToExisting && portfolio ? [...portfolio.holdings, ...newHoldings] : newHoldings,
      };
      savePortfolio(updated);
      setPortfolio(updated);
      setShowAddPanel(false);
    } catch (e) { alert("분석 실패: " + e.message); }
    setUploading(false);
    setUploadMsg("");
  };

  // 파일 change 핸들러
  const onFileChange = (e, addToExisting) => {
    const f = e.target.files?.[0];
    e.target.value = "";          // 같은 파일 재선택 허용
    if (f) processFile(f, addToExisting);
  };

  // 직접 입력 추가
  const addManualHolding = (h) => {
    const updated = portfolio
      ? { ...portfolio, holdings: [...portfolio.holdings, h], updatedAt: new Date().toISOString() }
      : { holdings: [h], account_type: "혼합", broker: h.account || "", uploadedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    savePortfolio(updated);
    setPortfolio(updated);
  };

  // 종목 삭제
  const removeHolding = (idx) => {
    const updated = { ...portfolio, holdings: portfolio.holdings.filter((_, i) => i !== idx) };
    savePortfolio(updated);
    setPortfolio(updated);
  };

  // 현재가 업데이트
  const updatePrices = async () => {
    if (!portfolio) return;
    setUpdating(true);
    try {
      const tickers = portfolio.holdings.map(h => `${h.ticker || h.name}(${h.currency || "KRW"})`).join(", ");
      const text = await callClaudeWithSearch({
        maxTokens: 1500,
        system: `주식 현재가 검색 후 JSON만. {"prices":[{"ticker":"","current_price":0,"change_pct":0}]}`,
        user: `다음 종목 현재가 검색: ${tickers}. JSON만 반환.`,
      });
      const { prices } = JSON.parse(text.replace(/```json|```/g, "").trim());
      const updated = {
        ...portfolio, updatedAt: new Date().toISOString(),
        holdings: portfolio.holdings.map(h => {
          const p = prices.find(x => x.ticker === h.ticker || x.ticker === h.name);
          return p ? { ...h, current_price: p.current_price, change_pct: p.change_pct } : h;
        }),
      };
      savePortfolio(updated); setPortfolio(updated);
    } catch (e) { alert("가격 업데이트 실패: " + e.message); }
    setUpdating(false);
  };

  const [viewMode, setViewMode] = useState("all"); // "all" | 계좌명

  // 계좌 목록
  const accounts = portfolio ? [...new Set(portfolio.holdings.map(h => h.account).filter(Boolean))] : [];

  // 현재 뷰에 따른 종목 필터
  const visibleHoldings = portfolio
    ? (viewMode === "all" ? portfolio.holdings : portfolio.holdings.filter(h => h.account === viewMode))
    : [];

  const totalCost  = visibleHoldings.reduce((s, h) => s + (h.shares||0)*(h.avg_price||0), 0);
  const totalValue = visibleHoldings.reduce((s, h) => s + (h.shares||0)*(h.current_price||h.avg_price||0), 0);
  const totalReturn = totalCost > 0 ? ((totalValue - totalCost) / totalCost) * 100 : 0;

  // 업로드 패널 — label+input을 항상 DOM에 렌더링 (모바일 sandbox 대응)
  const UploadPanel = ({ addToExisting = false }) => {
    const imgId  = addToExisting ? "file-img-add"  : "file-img-new";
    const xlsId  = addToExisting ? "file-xls-add"  : "file-xls-new";
    return (
      <div>
        {/* 숨김 input — label과 id로 연결, 항상 DOM에 존재 */}
        <input
          id={imgId} type="file" accept="image/*"
          style={{ position: "absolute", width: 1, height: 1, opacity: 0, overflow: "hidden" }}
          onChange={e => onFileChange(e, addToExisting)}
        />
        <input
          id={xlsId} type="file" accept=".xlsx,.xls,.csv"
          style={{ position: "absolute", width: 1, height: 1, opacity: 0, overflow: "hidden" }}
          onChange={e => onFileChange(e, addToExisting)}
        />

        {uploading ? (
          <div style={{ textAlign: "center", padding: "36px 20px", background: "#0a0f1a", borderRadius: 14, border: "1px solid #1e293b" }}>
            <Spinner size={34} />
            <div style={{ marginTop: 14, color: "#0ea5e9", fontWeight: 700, fontSize: 14 }}>{uploadMsg}</div>
          </div>
        ) : (
          <div>
            {/* 드래그앤드롭 — PC용 */}
            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => { e.preventDefault(); setDragOver(false); processFile(e.dataTransfer.files[0], addToExisting); }}
              style={{
                border: `2px dashed ${dragOver ? "#0ea5e9" : "#1e293b"}`,
                borderRadius: 12, padding: "20px 16px", textAlign: "center",
                background: dragOver ? "#0ea5e911" : "#0a0f1a", marginBottom: 12, transition: "all 0.2s",
              }}
            >
              <div style={{ fontSize: 26, marginBottom: 5 }}>📂</div>
              <div style={{ fontSize: 12, color: "#475569" }}>PC: 파일을 여기로 드래그</div>
              <div style={{ fontSize: 11, color: "#334155", marginTop: 2 }}>이미지 · xlsx · csv</div>
            </div>

            {/* label 버튼 — htmlFor로 input 직접 연결 (모바일에서 가장 확실) */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
              <label
                htmlFor={imgId}
                style={{
                  padding: "14px 8px", borderRadius: 12, cursor: "pointer",
                  background: "linear-gradient(135deg,#0ea5e9,#0369a1)", color: "#fff",
                  fontWeight: 700, fontSize: 13, display: "flex", flexDirection: "column",
                  alignItems: "center", gap: 6, userSelect: "none",
                }}
              >
                <span style={{ fontSize: 24 }}>📱</span>
                <span>갤러리 / 스크린샷</span>
              </label>
              <label
                htmlFor={xlsId}
                style={{
                  padding: "14px 8px", borderRadius: 12, cursor: "pointer",
                  background: "linear-gradient(135deg,#10b981,#059669)", color: "#fff",
                  fontWeight: 700, fontSize: 13, display: "flex", flexDirection: "column",
                  alignItems: "center", gap: 6, userSelect: "none",
                }}
              >
                <span style={{ fontSize: 24 }}>📊</span>
                <span>엑셀 / CSV</span>
              </label>
            </div>

            <button
              onClick={() => { setShowManual(true); setShowAddPanel(false); }}
              style={{
                width: "100%", padding: "13px", borderRadius: 12, cursor: "pointer",
                background: "#1e293b", color: "#e2e8f0", border: "1px solid #334155",
                fontWeight: 700, fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              }}
            >
              ✏️ 직접 입력
            </button>
            {addToExisting && (
              <button onClick={() => setShowAddPanel(false)} style={{ width: "100%", marginTop: 8, padding: "10px", background: "none", border: "none", color: "#64748b", fontSize: 13, cursor: "pointer" }}>
                취소
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ padding: "0 4px" }}>
      {showManual && (
        <ManualInputModal onClose={() => setShowManual(false)} onAdd={h => { addManualHolding(h); setShowManual(false); }} />
      )}

      {/* 포폴 없음 → 초기 등록 */}
      {!portfolio ? (
        <div>
          <div style={{ textAlign: "center", marginBottom: 20 }}>
            <div style={{ fontSize: 40, marginBottom: 8 }}>💼</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#e2e8f0", marginBottom: 4 }}>포트폴리오 등록</div>
            <div style={{ fontSize: 12, color: "#64748b" }}>스크린샷, 엑셀, 직접입력 중 편한 방법으로 추가하세요</div>
          </div>
          <UploadPanel addToExisting={false} />
        </div>
      ) : (
        <div>
          {/* 계좌 탭 */}
          <div style={{ display: "flex", gap: 6, marginBottom: 12, overflowX: "auto", paddingBottom: 4 }}>
            <button onClick={() => setViewMode("all")} style={{
              padding: "6px 12px", borderRadius: 20, border: `1px solid ${viewMode === "all" ? "#7c3aed" : "#334155"}`,
              background: viewMode === "all" ? "#7c3aed22" : "transparent",
              color: viewMode === "all" ? "#a78bfa" : "#64748b",
              fontSize: 11, fontWeight: viewMode === "all" ? 700 : 400, cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0,
            }}>전체</button>
            {accounts.map(acc => (
              <button key={acc} onClick={() => setViewMode(acc)} style={{
                padding: "6px 12px", borderRadius: 20, border: `1px solid ${viewMode === acc ? "#0ea5e9" : "#334155"}`,
                background: viewMode === acc ? "#0ea5e922" : "transparent",
                color: viewMode === acc ? "#0ea5e9" : "#64748b",
                fontSize: 11, fontWeight: viewMode === acc ? 700 : 400, cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0,
              }}>{acc}</button>
            ))}
          </div>

          {/* 요약 카드 */}
          <div style={{ background: "linear-gradient(135deg,#0f172a,#1e1b4b)", border: "1px solid #312e81", borderRadius: 16, padding: 18, marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
              <div>
                <div style={{ fontSize: 10, color: "#7c3aed", fontWeight: 700, letterSpacing: 2, marginBottom: 3 }}>
                  {viewMode === "all" ? "전체 포트폴리오" : viewMode}
                </div>
                <div style={{ fontSize: 11, color: "#475569" }}>{new Date(portfolio.updatedAt).toLocaleString("ko-KR")}</div>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={updatePrices} disabled={updating} style={{ background: "#1e293b", color: "#e2e8f0", border: "1px solid #334155", borderRadius: 8, padding: "6px 10px", cursor: "pointer", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", gap: 4 }}>
                  {updating ? <Spinner size={11} /> : "↻"} 가격
                </button>
                <button onClick={() => { savePortfolio(null); setPortfolio(null); }} style={{ background: "#1e293b", color: "#ef4444", border: "1px solid #ef444433", borderRadius: 8, padding: "6px 10px", cursor: "pointer", fontSize: 11 }}>초기화</button>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
              {[
                { label: "총 매입", value: totalCost >= 100000000 ? `₩${(totalCost/100000000).toFixed(1)}억` : `₩${Math.round(totalCost/10000)}만`, color: "#94a3b8" },
                { label: "평가금액", value: totalValue >= 100000000 ? `₩${(totalValue/100000000).toFixed(1)}억` : `₩${Math.round(totalValue/10000)}만`, color: "#e2e8f0" },
                { label: "수익률", value: `${totalReturn >= 0 ? "+" : ""}${totalReturn.toFixed(2)}%`, color: totalReturn >= 0 ? "#10b981" : "#ef4444" },
              ].map((m, i) => (
                <div key={i} style={{ textAlign: "center", background: "#0f172a55", borderRadius: 8, padding: "10px 4px" }}>
                  <div style={{ fontSize: 9, color: "#64748b", marginBottom: 3 }}>{m.label}</div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: m.color }}>{m.value}</div>
                </div>
              ))}
            </div>
          </div>

          {/* 섹터 분포 */}
          <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 12, padding: 16, marginBottom: 14 }}>
            <div style={{ fontSize: 10, color: "#f59e0b", fontWeight: 700, marginBottom: 12, letterSpacing: 2 }}>섹터 분포</div>
            {Object.entries(
              visibleHoldings.reduce((acc, h) => {
                const s = h.sector || "기타";
                acc[s] = (acc[s] || 0) + (h.shares||0)*(h.current_price||h.avg_price||0);
                return acc;
              }, {})
            ).sort((a,b) => b[1]-a[1]).map(([sector, val]) => {
              const pct = totalValue > 0 ? (val/totalValue)*100 : 0;
              return (
                <div key={sector} style={{ marginBottom: 9 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3, fontSize: 12 }}>
                    <span style={{ color: getSectorColor(sector), fontWeight: 600 }}>{sector}</span>
                    <span style={{ color: "#94a3b8" }}>{pct.toFixed(1)}%</span>
                  </div>
                  <div style={{ background: "#1e293b", borderRadius: 4, height: 5 }}>
                    <div style={{ width: `${pct}%`, height: 5, borderRadius: 4, background: getSectorColor(sector) }} />
                  </div>
                </div>
              );
            })}
          </div>

          {/* 종목 목록 */}
          <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 12, overflow: "hidden", marginBottom: 14 }}>
            <div style={{ padding: "13px 16px", borderBottom: "1px solid #1e293b" }}>
              <span style={{ fontSize: 10, color: "#0ea5e9", fontWeight: 700, letterSpacing: 2 }}>보유 종목 ({visibleHoldings.length})</span>
            </div>
            {visibleHoldings.map((h, i) => {
              const cost  = (h.shares||0)*(h.avg_price||0);
              const value = (h.shares||0)*(h.current_price||h.avg_price||0);
              const ret   = cost > 0 ? ((value-cost)/cost)*100 : 0;
              return (
                <div key={i} style={{ padding: "12px 16px", borderBottom: "1px solid #0f1929", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                      <span style={{ fontWeight: 700, color: "#e2e8f0", fontSize: 14 }}>{h.name}</span>
                      {h.account && <span style={{ fontSize: 10, color: "#475569", background: "#1e293b", padding: "1px 5px", borderRadius: 3 }}>{h.account}</span>}
                    </div>
                    <div style={{ fontSize: 11, color: "#64748b" }}>
                      {h.ticker && h.ticker !== h.name ? h.ticker + " · " : ""}{h.shares}주 · 평단 {(h.avg_price||0).toLocaleString()}{h.currency === "USD" ? "$" : "₩"}
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ textAlign: "right" }}>
                      {h.current_price ? (
                        <>
                          <div style={{ fontWeight: 700, color: "#e2e8f0", fontSize: 13 }}>{h.current_price.toLocaleString()}</div>
                          <div style={{ fontSize: 12, color: ret >= 0 ? "#10b981" : "#ef4444", fontWeight: 700 }}>{ret >= 0 ? "+" : ""}{ret.toFixed(2)}%</div>
                        </>
                      ) : (
                        <div style={{ fontSize: 11, color: "#334155" }}>미조회</div>
                      )}
                    </div>
                    <button onClick={() => removeHolding(i)} style={{ background: "none", border: "none", color: "#334155", fontSize: 18, cursor: "pointer", padding: "4px", lineHeight: 1 }}>✕</button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* 종목 추가 — hidden input + label 방식 */}
          <input id="add-img" type="file" accept="image/*"
            style={{ position: "absolute", width: 1, height: 1, opacity: 0, overflow: "hidden" }}
            onChange={e => onFileChange(e, true)} />
          <input id="add-xls" type="file" accept=".xlsx,.xls,.csv"
            style={{ position: "absolute", width: 1, height: 1, opacity: 0, overflow: "hidden" }}
            onChange={e => onFileChange(e, true)} />

          {uploading ? (
            <div style={{ textAlign: "center", padding: "28px", background: "#0a0f1a", borderRadius: 12, border: "1px solid #1e293b" }}>
              <Spinner size={28} />
              <div style={{ marginTop: 12, color: "#0ea5e9", fontWeight: 700, fontSize: 13 }}>{uploadMsg}</div>
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              <label htmlFor="add-img" style={{ padding: "10px 6px", borderRadius: 10, background: "#0ea5e922", border: "1px solid #0ea5e944", color: "#0ea5e9", fontWeight: 700, fontSize: 11, cursor: "pointer", textAlign: "center", userSelect: "none" }}>📱 스크린샷</label>
              <label htmlFor="add-xls" style={{ padding: "10px 6px", borderRadius: 10, background: "#10b98122", border: "1px solid #10b98144", color: "#10b981", fontWeight: 700, fontSize: 11, cursor: "pointer", textAlign: "center", userSelect: "none" }}>📊 엑셀/CSV</label>
              <button onClick={() => setShowManual(true)} style={{ padding: "10px 6px", borderRadius: 10, background: "#7c3aed22", border: "1px solid #7c3aed44", color: "#a78bfa", fontWeight: 700, fontSize: 11, cursor: "pointer" }}>✏️ 직접입력</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── AI 조언 탭 ────────────────────────────────────────────────────────────────
function Advisor() {
  const [loading, setLoading]       = useState(false);
  const [question, setQuestion]     = useState("");
  const [chatHistory, setChatHistory] = useState([]);
  const portfolio = loadPortfolio();

  const getAdvice = async (q) => {
    if (!q) return;
    setLoading(true);
    try {
      const portfolioStr = portfolio
        ? portfolio.holdings.map(h => `${h.name}(${h.ticker}) ${h.shares}주 평단${h.avg_price}`).join(", ")
        : "포트폴리오 정보 없음";
      const text = await callClaudeWithSearch({
        maxTokens: 2000,
        system: `전문 투자 어드바이저. 포트폴리오와 현재 시장 상황을 종합하여 한국어로 구체적 조언 제공. 웹 검색으로 최신 정보 수집 후 조언.
⚠️ 면책: 참고용이며 투자 손실 책임은 투자자 본인에게 있음.`,
        user: `[포트폴리오] ${portfolioStr}\n\n[질문] ${q}`,
      });
      setChatHistory(prev => [...prev, { role: "user", content: q }, { role: "ai", content: text }]);
      setQuestion("");
    } catch (e) {
      setChatHistory(prev => [...prev, { role: "ai", content: "오류: " + e.message }]);
    }
    setLoading(false);
  };

  const quickActions = ["내 포폴 리밸런싱 방향 조언해줘", "현재 모멘텀 섹터에 내 포폴 노출도가 충분한가?", "지금 추가 매수하기 좋은 종목 추천해줘", "내 포폴의 리스크 분석해줘"];

  return (
    <div style={{ padding: "0 4px" }}>
      {!portfolio && (
        <div style={{ background: "#1a0a0a", border: "1px solid #ef444433", borderRadius: 12, padding: 14, marginBottom: 16, fontSize: 13, color: "#fca5a5" }}>
          ⚠️ 포트폴리오 탭에서 계좌를 등록하면 더 정확한 맞춤 조언을 받을 수 있어요
        </div>
      )}

      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 10, color: "#64748b", marginBottom: 8, fontWeight: 700, letterSpacing: 1 }}>빠른 질문</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
          {quickActions.map((q, i) => (
            <button key={i} onClick={() => getAdvice(q)} disabled={loading} style={{ background: "#1e293b", color: "#94a3b8", border: "1px solid #334155", borderRadius: 20, padding: "6px 14px", cursor: "pointer", fontSize: 12 }}>
              {q}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        <input
          value={question}
          onChange={e => setQuestion(e.target.value)}
          onKeyDown={e => e.key === "Enter" && !e.shiftKey && getAdvice(question)}
          placeholder="투자 관련 질문을 입력하세요..."
          style={{ flex: 1, background: "#0f172a", border: "1px solid #334155", borderRadius: 10, padding: "11px 14px", color: "#e2e8f0", fontSize: 14, outline: "none" }}
        />
        <button onClick={() => getAdvice(question)} disabled={loading || !question} style={{ background: "#7c3aed", color: "#fff", border: "none", borderRadius: 10, padding: "11px 18px", cursor: "pointer", fontWeight: 700, opacity: loading || !question ? 0.5 : 1 }}>
          {loading ? <Spinner size={16} /> : "전송"}
        </button>
      </div>

      {chatHistory.length === 0 && !loading && (
        <div style={{ textAlign: "center", padding: "50px 20px", color: "#475569" }}>
          <div style={{ fontSize: 44, marginBottom: 12 }}>🤖</div>
          <div style={{ fontSize: 14 }}>AI 투자 어드바이저에게 질문해보세요</div>
          <div style={{ fontSize: 12, marginTop: 6 }}>실시간 웹 검색으로 최신 시장 정보를 반영합니다</div>
        </div>
      )}

      {loading && (
        <div style={{ textAlign: "center", padding: "20px", color: "#64748b", fontSize: 13 }}>
          <Spinner size={22} />
          <div style={{ marginTop: 10 }}>시장 정보 검색 중...</div>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {[...chatHistory].reverse().map((msg, i) => (
          <div key={i} style={{
            background: msg.role === "user" ? "#1e293b" : "#0f172a",
            border: `1px solid ${msg.role === "user" ? "#334155" : "#1e293b"}`,
            borderRadius: 12, padding: 16,
            borderLeft: msg.role === "ai" ? "3px solid #7c3aed" : "none",
          }}>
            <div style={{ fontSize: 10, color: msg.role === "user" ? "#64748b" : "#7c3aed", fontWeight: 700, marginBottom: 7, letterSpacing: 1 }}>
              {msg.role === "user" ? "나의 질문" : "AI 어드바이저"}
            </div>
            <div style={{ color: "#cbd5e1", fontSize: 13, lineHeight: 1.8, whiteSpace: "pre-wrap" }}>{msg.content}</div>
          </div>
        ))}
      </div>
    </div>
  );
}


// ── 설정 탭 ───────────────────────────────────────────────────────────────────
function Settings() {
  const [apiKey, setApiKey] = useState(localStorage.getItem("investiq_api_key") || "");
  const [saved, setSaved] = useState(false);
  const [showKey, setShowKey] = useState(false);

  const handleSave = () => {
    localStorage.setItem("investiq_api_key", apiKey.trim());
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleClear = () => {
    localStorage.removeItem("investiq_api_key");
    setApiKey("");
  };

  const maskedKey = apiKey ? apiKey.slice(0, 8) + "•".repeat(Math.max(0, apiKey.length - 12)) + apiKey.slice(-4) : "";

  return (
    <div style={{ padding: "0 4px" }}>
      {/* API 키 설정 */}
      <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 14, padding: 20, marginBottom: 16 }}>
        <div style={{ fontSize: 11, color: "#0ea5e9", fontWeight: 700, letterSpacing: 2, marginBottom: 4 }}>CLAUDE API KEY</div>
        <div style={{ fontSize: 12, color: "#475569", marginBottom: 16, lineHeight: 1.6 }}>
          Google AI Studio(aistudio.google.com)에서 발급받은 Gemini API 키를 입력하세요.
          키는 이 기기에만 저장되며 외부로 전송되지 않습니다.
        </div>

        {apiKey && !showKey ? (
          <div style={{ background: "#1e293b", borderRadius: 8, padding: "11px 14px", marginBottom: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ color: "#94a3b8", fontSize: 13, fontFamily: "monospace" }}>{maskedKey}</span>
            <button onClick={() => setShowKey(true)} style={{ background: "none", border: "none", color: "#64748b", fontSize: 12, cursor: "pointer" }}>보기</button>
          </div>
        ) : (
          <input
            type="text"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder="AIzaSy..."
            style={{
              width: "100%", background: "#1e293b", border: "1px solid #334155",
              borderRadius: 8, padding: "11px 14px", color: "#e2e8f0",
              fontSize: 13, outline: "none", marginBottom: 10, fontFamily: "monospace",
            }}
          />
        )}

        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={handleSave} style={{
            flex: 1, padding: "12px", borderRadius: 10, border: "none", cursor: "pointer",
            background: saved ? "#10b981" : "linear-gradient(135deg,#0ea5e9,#7c3aed)",
            color: "#fff", fontWeight: 700, fontSize: 14,
          }}>
            {saved ? "✓ 저장됨" : "저장"}
          </button>
          {apiKey && (
            <button onClick={handleClear} style={{
              padding: "12px 16px", borderRadius: 10, border: "1px solid #ef444433",
              background: "#1e293b", color: "#ef4444", fontWeight: 700, fontSize: 14, cursor: "pointer",
            }}>삭제</button>
          )}
        </div>
      </div>

      {/* API 키 발급 안내 */}
      <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 14, padding: 20, marginBottom: 16 }}>
        <div style={{ fontSize: 11, color: "#f59e0b", fontWeight: 700, letterSpacing: 2, marginBottom: 12 }}>API 키 발급 방법</div>
        {[
          { step: "1", text: "aistudio.google.com 접속" },
          { step: "2", text: "회원가입 또는 로그인" },
          { step: "3", text: "좌측 메뉴 'Get API key' 클릭" },
          { step: "4", text: "'API 키 만들기' 버튼 클릭" },
          { step: "5", text: "생성된 키(AIzaSy...)를 위에 입력" },
        ].map(({ step, text }) => (
          <div key={step} style={{ display: "flex", gap: 12, marginBottom: 10, alignItems: "flex-start" }}>
            <div style={{ width: 22, height: 22, borderRadius: "50%", background: "#1e293b", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: "#f59e0b", fontWeight: 700, flexShrink: 0 }}>{step}</div>
            <div style={{ fontSize: 13, color: "#94a3b8", lineHeight: 1.5, paddingTop: 2 }}>{text}</div>
          </div>
        ))}
        <div style={{ marginTop: 8, padding: "10px 14px", background: "#1e293b", borderRadius: 8, fontSize: 12, color: "#64748b", lineHeight: 1.6 }}>
          💡 API 사용료는 Google에서 별도 청구됩니다. Gemini 2.5 Flash 기준 입력 $0.30/1M 토큰. 일반적인 사용량이면 월 $0.3~1 수준입니다.
        </div>
      </div>

      {/* 앱 정보 */}
      <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 14, padding: 20 }}>
        <div style={{ fontSize: 11, color: "#7c3aed", fontWeight: 700, letterSpacing: 2, marginBottom: 12 }}>앱 정보</div>
        <div style={{ fontSize: 13, color: "#64748b", lineHeight: 1.8 }}>
          <div>버전: 1.0.0</div>
          <div>InvestIQ - AI 투자 어드바이저</div>
          <div style={{ marginTop: 8, fontSize: 11, color: "#334155" }}>
            ⚠️ 이 앱의 투자 정보는 참고용이며, 투자 손실에 대한 책임은 투자자 본인에게 있습니다.
          </div>
        </div>
      </div>
    </div>
  );
}

// ── 메인 앱 ───────────────────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab] = useState("market");
  const tabs = [
    { id: "market",    label: "시장 인사이트", icon: "📊" },
    { id: "portfolio", label: "포트폴리오",    icon: "💼" },
    { id: "advisor",   label: "AI 조언",       icon: "🤖" },
    { id: "settings",  label: "설정",          icon: "⚙️" },
  ];

  return (
    <div style={{ minHeight: "100vh", background: "#020617", color: "#e2e8f0", fontFamily: "'Pretendard','Apple SD Gothic Neo',system-ui,sans-serif", maxWidth: 480, margin: "0 auto" }}>
      <style>{`
        @keyframes spin { from { transform:rotate(0deg); } to { transform:rotate(360deg); } }
        * { box-sizing:border-box; }
        ::-webkit-scrollbar { width:4px; }
        ::-webkit-scrollbar-thumb { background:#334155; border-radius:2px; }
        input::placeholder { color:#475569; }
        button:active { opacity:0.8; }
      `}</style>

      {/* 헤더 */}
      <div style={{ padding: "18px 18px 14px", borderBottom: "1px solid #0f172a", background: "#020617", position: "sticky", top: 0, zIndex: 100 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: "linear-gradient(135deg,#0ea5e9,#7c3aed)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>📈</div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: -0.5 }}>InvestIQ</div>
            <div style={{ fontSize: 10, color: "#475569", letterSpacing: 1 }}>AI INVESTMENT ADVISOR</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 4, background: "#0f172a", borderRadius: 10, padding: 4 }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              flex: 1, padding: "8px 4px", border: "none", borderRadius: 8,
              background: tab === t.id ? "#1e293b" : "transparent",
              color: tab === t.id ? "#e2e8f0" : "#64748b",
              cursor: "pointer", fontSize: 11, fontWeight: tab === t.id ? 700 : 400, transition: "all 0.15s",
            }}>
              <div>{t.icon}</div>
              <div style={{ marginTop: 2 }}>{t.label}</div>
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding: "18px 16px 48px" }}>
        {tab === "market"    && <MarketInsight />}
        {tab === "portfolio" && <Portfolio />}
        {tab === "advisor"   && <Advisor />}
        {tab === "settings"  && <Settings />}
      </div>
    </div>
  );
}
