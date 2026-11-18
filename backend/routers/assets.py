from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, field_validator, model_validator
from typing import Optional
from datetime import date, datetime
from database import supabase

router = APIRouter()

_TAX_ACCOUNT_TYPES = {'pension_savings', 'retirement_pension', 'isa', 'regular'}


class AssetIn(BaseModel):
    account_name: str
    asset_name: str
    ticker: Optional[str] = None
    asset_type: str
    quantity: float = 0
    unit_price: float = 0
    current_value: float = 0
    purchase_date: Optional[str] = None
    is_active: bool = True
    maturity_date: Optional[str] = None
    investment_amount: Optional[float] = None
    tax_account_type: Optional[str] = None

    @field_validator('purchase_date')
    @classmethod
    def purchase_not_future(cls, v):
        if v and v > str(date.today()):
            raise ValueError('매입일은 오늘 이후 날짜를 입력할 수 없습니다.')
        return v

    @field_validator('tax_account_type')
    @classmethod
    def tax_type_valid(cls, v):
        if v is not None and v not in _TAX_ACCOUNT_TYPES:
            raise ValueError(f'세제 분류 값이 유효하지 않습니다: {v}')
        return v

    @model_validator(mode='after')
    def check_maturity_after_purchase(self):
        if self.maturity_date and self.purchase_date:
            if self.maturity_date <= self.purchase_date:
                raise ValueError('만기일은 매입일보다 이후여야 합니다.')
        return self


@router.get("")
def list_assets():
    res = supabase.table("assets").select("*").order("account_name").order("asset_name").execute()
    return res.data or []


class AssetExportIn(BaseModel):
    ids: list[int]


@router.post("/export")
def export_assets_xlsx(body: AssetExportIn):
    """화면에 조회된 자산(ids 순서 그대로)을 Excel로 내보낸다."""
    import io
    import openpyxl
    from openpyxl.styles import PatternFill, Font
    from openpyxl.utils import get_column_letter
    from fastapi.responses import StreamingResponse

    type_ko = {'cash': '현금성', 'bond': '채권', 'tdf': 'TDF', 'fund': '펀드',
               'equity': '주식형', 'income': '리츠/인컴'}
    tax_ko = {'pension_savings': '연금저축', 'retirement_pension': '퇴직연금(IRP)',
              'isa': 'ISA', 'regular': '일반'}

    rows = []
    if body.ids:
        data = supabase.table("assets").select("*").in_("id", body.ids).execute().data or []
        by_id = {a["id"]: a for a in data}
        rows = [by_id[i] for i in body.ids if i in by_id]

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "자산 관리"
    header = ["계좌", "자산명", "유형", "세제분류", "티커", "수량", "현재가",
              "입금액", "평가액", "매입일", "만기일", "상태"]
    ws.append(header)
    for c in ws[1]:
        c.fill = PatternFill(start_color="185FA5", end_color="185FA5", fill_type="solid")
        c.font = Font(color="FFFFFF", bold=True)
    for a in rows:
        ws.append([
            a.get("account_name") or "",
            a.get("asset_name") or "",
            type_ko.get(a.get("asset_type"), a.get("asset_type") or ""),
            tax_ko.get(a.get("tax_account_type") or "", "미분류"),
            a.get("ticker") or "",
            float(a.get("quantity") or 0),
            float(a.get("unit_price") or 0),
            float(a["investment_amount"]) if a.get("investment_amount") is not None else None,
            float(a.get("current_value") or 0),
            a.get("purchase_date") or "",
            a.get("maturity_date") or "",
            "활성" if a.get("is_active") else "비활성",
        ])
    n = len(rows)
    if n:
        # 합계는 활성 자산 기준 (화면의 합계와 동일)
        active_sum = sum(float(a.get("current_value") or 0) for a in rows if a.get("is_active"))
        ws.append([])
        ws.append(["합계(활성)", "", "", "", "", "", "", "", active_sum])
        for c in ws[ws.max_row]:
            c.font = Font(bold=True)
    for r in ws.iter_rows(min_row=2, min_col=6, max_col=9):
        for c in r:
            c.number_format = '#,##0.##'
    for col in ws.columns:
        w = max((len(str(c.value)) if c.value is not None else 0) for c in col)
        ws.column_dimensions[get_column_letter(col[0].column)].width = min(w + 4, 50)
    ws.freeze_panes = "A2"

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )


@router.post("")
def create_asset(body: AssetIn):
    data = body.model_dump()
    data["created_at"] = datetime.now().isoformat()
    data["updated_at"] = datetime.now().isoformat()
    try:
        res = supabase.table("assets").insert(data).execute()
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    return res.data[0]


@router.put("/{asset_id}")
def update_asset(asset_id: int, body: AssetIn):
    data = body.model_dump()
    data["updated_at"] = datetime.now().isoformat()
    try:
        res = supabase.table("assets").update(data).eq("id", asset_id).execute()
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not res.data:
        raise HTTPException(status_code=404, detail="자산을 찾을 수 없습니다")
    return res.data[0]


@router.delete("/{asset_id}")
def delete_asset(asset_id: int):
    res = supabase.table("assets").delete().eq("id", asset_id).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="자산을 찾을 수 없습니다")
    return {"ok": True}


@router.patch("/{asset_id}/toggle")
def toggle_active(asset_id: int):
    cur = supabase.table("assets").select("is_active").eq("id", asset_id).execute()
    if not cur.data:
        raise HTTPException(status_code=404, detail="자산을 찾을 수 없습니다")
    new_state = not cur.data[0]["is_active"]
    res = supabase.table("assets").update({
        "is_active": new_state,
        "updated_at": datetime.now().isoformat()
    }).eq("id", asset_id).execute()
    return res.data[0]
