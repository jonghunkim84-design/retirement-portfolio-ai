import time
import logging
from datetime import date, datetime, timedelta
from fastapi import APIRouter
from database import supabase

router = APIRouter()
logger = logging.getLogger(__name__)


def _get_price_fdr(ticker: str):
    try:
        import FinanceDataReader as fdr
        end   = date.today()
        start = end - timedelta(days=10)
        df    = fdr.DataReader(ticker.zfill(6), start=str(start), end=str(end))
        if df.empty:
            return None, None
        return float(df["Close"].iloc[-1]), str(df.index[-1].date())
    except Exception:
        return None, None


def _get_price_pykrx(ticker: str):
    try:
        from pykrx import stock
        today = date.today().strftime("%Y%m%d")
        start = (date.today() - timedelta(days=10)).strftime("%Y%m%d")
        df    = stock.get_market_ohlcv_by_date(start, today, ticker.zfill(6))
        if df.empty:
            return None, None
        return float(df["종가"].iloc[-1]), str(df.index[-1].date())
    except Exception:
        return None, None


def get_price(ticker: str):
    price, pdate = _get_price_fdr(ticker)
    if price:
        return price, pdate, "FDR"
    price, pdate = _get_price_pykrx(ticker)
    if price:
        return price, pdate, "pykrx"
    return None, None, "failed"


def _mark_price_status(asset_id, failed: bool, now_iso: str):
    """price_updated_at / price_update_failed 기록.
    마이그레이션(2026-06-12) 실행 전에는 컬럼이 없어 실패하므로 조용히 건너뜀."""
    payload = {"price_update_failed": failed}
    if not failed:
        payload["price_updated_at"] = now_iso
    try:
        supabase.table("assets").update(payload).eq("id", asset_id).execute()
    except Exception:
        pass


def run_price_update() -> dict:
    """시세 갱신 공용 로직 — 수동 버튼(POST /price/update)과 일일 Cron이 같은 함수를 사용.

    종목별 실패 격리: 한 종목의 조회·저장 실패가 나머지 진행을 막지 않는다.
    반환: {"updated": n, "failed": m, "details": [...]}
    """
    res     = supabase.table("assets").select("*").eq("is_active", True).execute()
    assets  = [a for a in (res.data or []) if a.get("ticker")]
    now_iso = datetime.now().isoformat()

    results = []
    for a in assets:
        try:
            ticker   = str(a["ticker"]).strip()
            quantity = float(a.get("quantity") or 0)

            price, price_date, source = get_price(ticker)
            time.sleep(0.3)

            if price and quantity > 0:
                new_val = round(price * quantity)
                supabase.table("assets").update({
                    "unit_price":    price,
                    "current_value": new_val,
                }).eq("id", a["id"]).execute()
                _mark_price_status(a["id"], failed=False, now_iso=now_iso)
                results.append({
                    "asset_name": a["asset_name"],
                    "ticker": ticker,
                    "price": price,
                    "price_date": price_date,
                    "new_value": new_val,
                    "source": source,
                    "status": "ok",
                })
            else:
                _mark_price_status(a["id"], failed=True, now_iso=now_iso)
                results.append({
                    "asset_name": a["asset_name"],
                    "ticker": ticker,
                    "status": "failed",
                })
        except Exception as e:
            logger.error(f"[시세] {a.get('asset_name')} 갱신 실패: {e}")
            results.append({
                "asset_name": a.get("asset_name"),
                "ticker": a.get("ticker"),
                "status": "failed",
            })

    ok   = sum(1 for r in results if r["status"] == "ok")
    fail = sum(1 for r in results if r["status"] == "failed")
    return {"updated": ok, "failed": fail, "details": results}


@router.post("/update")
def update_prices():
    return run_price_update()
