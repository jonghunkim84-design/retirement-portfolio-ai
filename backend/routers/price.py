import time
from datetime import date, timedelta
from fastapi import APIRouter
from database import supabase

router = APIRouter()


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


@router.post("/update")
def update_prices():
    res    = supabase.table("assets").select("*").eq("is_active", True).execute()
    assets = [a for a in (res.data or []) if a.get("ticker")]

    results = []
    for a in assets:
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
            results.append({
                "asset_name": a["asset_name"],
                "ticker": ticker,
                "status": "failed",
            })

    ok   = sum(1 for r in results if r["status"] == "ok")
    fail = sum(1 for r in results if r["status"] == "failed")
    return {"updated": ok, "failed": fail, "details": results}
