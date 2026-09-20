"""
시장 지표 초기 적재 (지시서 04 C단계) — 로컬에서 수동 실행.

기본은 DRY-RUN: 원천에서 조회·검증만 하고 DB 에 쓰지 않으며, 지표별 대상 원천·기간·예상 건수를 출력한다.
실제 저장은 --apply 를 줘야 한다 (사용자 승인 후에만 실행).

  python scripts/market_initial_load.py                 # 예상 건수 확인(쓰기 없음)
  python scripts/market_initial_load.py --apply         # 저장
  python scripts/market_initial_load.py --days 1095 --only KS11,US500

backend/ 디렉터리에서 실행한다. .env 의 SUPABASE_SERVICE_KEY·ECOS_API_KEY 를 사용한다.
"""
import argparse
import os
import sys
from datetime import date

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import database
import market_data


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="DB 에 저장 (없으면 dry-run)")
    ap.add_argument("--days", type=int, default=1095, help="가져올 기간(일). 기본 1095=3년")
    ap.add_argument("--only", default="", help="쉼표로 구분한 지표 코드만")
    args = ap.parse_args()
    only = [c.strip() for c in args.only.split(",") if c.strip()] or None

    print(f"모드: {'APPLY(저장)' if args.apply else 'DRY-RUN(쓰기 없음)'} · 기간 {args.days}일 · ECOS 키 {'있음' if os.getenv('ECOS_API_KEY') else '없음'}")
    out = market_data.refresh_all(database.supabase, date.today(), only=only,
                                  full_days=args.days, apply=args.apply, time_budget_s=1e9)
    print(f"{'코드':10} {'상태':8} {'원천':6} {'조회':>6} {'제외':>5} {'저장후보':>8} {'이상치':>6}  마지막 일자 / 사유")
    total = 0
    for r in out["results"]:
        cand = r.get("stored_candidate", 0)
        total += cand
        print(f"{r['code']:10} {r['status']:8} {str(r.get('source') or '-'):6} {r.get('fetched', 0):6} "
              f"{r.get('dropped', 0):5} {cand:8} {r.get('flagged', 0):6}  {r.get('last_date') or '-'} {r.get('reason') or ''}")
    print(f"합계 저장후보 {total}건 · 성공 {out['ok']} · 실패 {out['failed']} · 건너뜀 {out['skipped']} · 실제 저장 {out['stored']}건")


if __name__ == "__main__":
    main()
