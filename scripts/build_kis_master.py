#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
KIS 종목마스터(.mst/.cod) → kis_master.json / kis_master_us.json 생성기.

실증 근거(2026-07-26 세션에서 로컬 원본과 대조 확정):
  국내 kospi_code.mst : 각 행에서 뒤 227바이트가 메타(part2). 그 앞이 단축코드9 + 표준코드12 + 한글명.
                        part2 앞 2바이트 = 그룹코드. 'EF'=ETF, 'ST'=주식.
       kosdaq_code.mst: 코스닥은 그룹코드가 공백 → 전량 주식으로 취급(외국주권 9xxxxx 포함).
  미국 {nas,nys,ams}mst.cod : 탭 구분(TSV, cp949). 5번째=Symbol, 7번째=한글명, 9번째=Security type.
                        Security type 2=주식, 3=ETP(ETF).

공식 파서(koreainvestment/open-trading-api) 규칙을 따르되, 개행 제거 후 폭은 227.
표준 라이브러리만 사용(pandas 불필요).
"""
import json
import os
import ssl
import sys
import urllib.request
import zipfile
from datetime import date, timezone, datetime

BASE_URL = "https://new.real.download.dws.co.kr/common/master/"
WORK = os.environ.get("KIS_WORK_DIR", ".")
OUT_DIR = os.environ.get("KIS_OUT_DIR", "public")

# 국내 part2(메타) 폭 = 공식 파서 field_specs 합
_DOMESTIC_SPECS = [2,1,4,4,4, 1,1,1,1,1, 1,1,1,1,1, 1,1,1,1,1,
                   1,1,1,1,1, 1,1,1,1,1, 1,9,5,5,1, 1,1,2,1,1,
                   1,2,2,2,3, 1,3,12,12,8, 15,21,2,7,1, 1,1,1,1,9,
                   9,9,5,9,8, 9,3,1,1,1]
P2 = sum(_DOMESTIC_SPECS)  # = 227

US_MARKETS = ["nas", "nys", "ams"]  # 나스닥/뉴욕/아멕스 (미국만)


def _download(url, dest):
    ssl._create_default_https_context = ssl._create_unverified_context
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=60) as r, open(dest, "wb") as f:
        f.write(r.read())


def _unzip(zip_path, work):
    with zipfile.ZipFile(zip_path) as z:
        names = z.namelist()
        z.extractall(work)
    return names


def parse_domestic(mst_path, is_kosdaq):
    """kospi/kosdaq .mst → [(code, name, groupcode)]"""
    rows = []
    with open(mst_path, encoding="cp949") as f:
        for line in f:
            line = line.rstrip("\n")
            if len(line) < P2 + 22:
                continue
            front = line[:len(line) - P2]
            code = front[0:9].rstrip()
            name = front[21:].strip()
            gc = "  " if is_kosdaq else line[len(line) - P2:][0:2]
            if code:
                rows.append((code, name, gc))
    return rows


def parse_us(cod_path):
    """{mkt}mst.cod (TSV) → [(symbol, kor_name, sec_type)]"""
    rows = []
    with open(cod_path, encoding="cp949") as f:
        for line in f:
            p = line.rstrip("\n").split("\t")
            if len(p) < 9:
                continue
            sym = p[4].strip()
            kname = p[6].strip()
            st = p[8].strip()
            if sym:
                rows.append((sym, kname, st))
    return rows


def build_domestic(work):
    etf, stock = {}, {}
    for mkt, is_kq in (("kospi", False), ("kosdaq", True)):
        zpath = os.path.join(work, f"{mkt}_code.mst.zip")
        _download(f"{BASE_URL}{mkt}_code.mst.zip", zpath)
        _unzip(zpath, work)
        mst = os.path.join(work, f"{mkt}_code.mst")
        for code, name, gc in parse_domestic(mst, is_kq):
            if gc == "EF":
                etf[code] = name
            elif gc == "ST" or is_kq:  # 코스닥은 전량 주식(외국주권 포함)
                stock[code] = name
    return etf, stock


def build_us(work):
    stock, etf = {}, {}
    for mkt in US_MARKETS:
        zpath = os.path.join(work, f"{mkt}mst.cod.zip")
        _download(f"{BASE_URL}{mkt}mst.cod.zip", zpath)
        names = _unzip(zpath, work)
        # zip 내부 파일명이 대문자(NASMST.COD)일 수 있음
        cod = None
        for n in names:
            if n.lower().endswith(".cod"):
                cod = os.path.join(work, n)
                break
        if cod is None:
            cod = os.path.join(work, f"{mkt}mst.cod")
        for sym, kname, st in parse_us(cod):
            if st == "2":
                stock[sym] = kname
            elif st == "3":
                etf[sym] = kname
    return stock, etf


def _sorted(d):
    return {k: d[k] for k in sorted(d)}


# 파싱이 크게 어긋난 결과가 배포되는 것을 막는 하한선(sanity check).
# 실측 기준값(2026-07): 국내 etf 1143 / stock 2744, 미국 stock 6677 / etf 5873.
# 신규상장·상폐로 변동은 정상이므로 여유롭게 하한만 둔다. 이 값 미만이면 파싱 실패로 간주하고 중단.
_MIN = {
    "domestic_etf": 1000,
    "domestic_stock": 2500,
    "us_stock": 6000,
    "us_etf": 5000,
}


def _sanity(d_etf, d_stock, us_stock, us_etf):
    checks = [
        ("domestic_etf", len(d_etf)),
        ("domestic_stock", len(d_stock)),
        ("us_stock", len(us_stock)),
        ("us_etf", len(us_etf)),
    ]
    errs = []
    for key, n in checks:
        if n < _MIN[key]:
            errs.append(f"{key}={n} < 최소 {_MIN[key]}")
    # 한글명 깨짐(cp949 실패로 대체문자가 대량 발생) 감지
    def broken_ratio(d):
        if not d:
            return 1.0
        bad = sum(1 for v in d.values() if not v or "\ufffd" in v)
        return bad / len(d)
    for label, d in (("domestic_stock", d_stock), ("us_stock", us_stock)):
        r = broken_ratio(d)
        if r > 0.05:
            errs.append(f"{label} 이름 깨짐 비율 {r:.1%} > 5%")
    if errs:
        sys.stderr.write("[SANITY FAIL] 파싱 결과 이상 — 배포 중단:\n  " + "\n  ".join(errs) + "\n")
        sys.exit(1)


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    today = date.today().isoformat()

    d_etf, d_stock = build_domestic(WORK)
    us_stock, us_etf = build_us(WORK)

    _sanity(d_etf, d_stock, us_stock, us_etf)

    domestic = {
        "etf": _sorted(d_etf),
        "stock": _sorted(d_stock),
        "_meta": {
            "source": "KIS kospi/kosdaq_code.mst",
            "generated": today,
            "etf_count": len(d_etf),
            "stock_count": len(d_stock),
        },
    }
    us = {
        "stock": _sorted(us_stock),
        "etf": _sorted(us_etf),
        "_meta": {
            "source": "KIS nas/nys/ams mst.cod",
            "generated": today,
            "stock_count": len(us_stock),
            "etf_count": len(us_etf),
        },
    }

    with open(os.path.join(OUT_DIR, "kis_master.json"), "w", encoding="utf-8") as f:
        json.dump(domestic, f, ensure_ascii=False, separators=(",", ":"))
    with open(os.path.join(OUT_DIR, "kis_master_us.json"), "w", encoding="utf-8") as f:
        json.dump(us, f, ensure_ascii=False, separators=(",", ":"))

    print(f"[domestic] etf={len(d_etf)} stock={len(d_stock)}")
    print(f"[us]       stock={len(us_stock)} etf={len(us_etf)}")


if __name__ == "__main__":
    main()
