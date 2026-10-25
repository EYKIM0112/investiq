# InvestIQ (보관용)

**이 앱은 더 이상 사용하지 않습니다. AI_Agent 투자 에이전트로 옮길 부품을 보관하는 저장소입니다.**

아래는 옮겨 쓸 만한 주요 부품이 어디에 있는지 정리한 목록입니다.

## 1. `api/` 폴더 — 시세·정보를 가져오는 부품

| 파일 | 하는 일 |
| --- | --- |
| `naver.js` | 네이버에서 한국 종목 시세·정보를 가져옵니다. |
| `yahoo.js`, `yahoo-sector.js` | 야후 파이낸스에서 시세와 업종(섹터) 정보를 가져옵니다. |
| `edgar.js` | 미국 공시(SEC EDGAR, 기업이 공식 제출하는 보고서)를 가져옵니다. |
| `fng.js`, `fng-kr.js` | 공포·탐욕 지수(시장 분위기를 숫자로 나타낸 값)를 가져옵니다. 미국판과 한국판입니다. |
| `kis.js`, `kis-history.js`, `kis-sector.js`, `kis-dividend.js` | 한국투자증권(KIS) 데이터를 가져옵니다. 현재 시세, 과거 가격, 업종, 배당 정보 순입니다. |

## 2. `public/kis_master.json` — 종목 목록 파일

- 한국투자증권 기준 종목 목록입니다.
- 매주 자동으로 새로 받아집니다. 담당은 `.github/workflows/update-kis-master.yml` 입니다.
- 미국 종목판인 `public/kis_master_us.json`도 함께 있습니다.

## 3. `public/backtest.js`, `public/gurus.js` — 백테스트 부품

- 백테스트는 과거 데이터로 "이 투자 방법을 썼다면 어땠을지" 시험해 보는 것입니다.
- `backtest.js`가 시험하는 쪽입니다.
- `gurus.js`는 투자 대가들의 포트폴리오(SEC 13F, 큰 투자자가 분기마다 제출하는 보유 종목 보고서)를 보여주는 부품입니다.

## 4. `index.html`의 `TRUSTED_SOURCES`, `SOURCE_RULES` — AI 출처 규칙

- AI가 답할 때 어떤 출처를 믿을지, 출처를 어떻게 표시할지 정한 규칙입니다.
- 666~669번째 줄 근처에 있습니다. 코드가 바뀌면 줄 번호는 달라질 수 있으니 이름으로 검색하세요.
