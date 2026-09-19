// 비율 변환 — 화면은 %(예: 5), API·DB 는 0~1 소수(예: 0.05).
// 인출 설정 화면의 모든 비율(target_pct, band_pct, equity_share_pct, expense_ratio)은 이 함수만 거친다.

const PRECISION = 1e6   // 소수 6자리 — 0.07 * 100 = 7.000000000000001 같은 부동소수 오차 제거

/** 0~1 소수 → 화면 입력용 % 문자열. null/''/NaN 은 ''. 예: 0.05 → '5', 0.075 → '7.5' */
export function ratioToPctInput(ratio) {
  if (ratio === null || ratio === undefined || ratio === '') return ''
  const n = Number(ratio)
  if (!Number.isFinite(n)) return ''
  return String(Math.round(n * 100 * PRECISION) / PRECISION)
}

/** 화면 % 입력 → API 0~1 소수. 빈 입력은 null, 숫자가 아니면 NaN. 예: '5' → 0.05 */
export function pctInputToRatio(input) {
  if (input === null || input === undefined) return null
  const s = String(input).trim()
  if (s === '') return null
  const n = Number(s)
  if (!Number.isFinite(n)) return NaN
  return Math.round((n / 100) * PRECISION) / PRECISION
}

/** 0~1 범위 검증. null(미입력)은 허용. 통과하면 null, 아니면 오류 문구. */
export function validateRatio(ratio, label = '비율') {
  if (ratio === null) return null
  if (Number.isNaN(ratio)) return `${label}: 숫자를 입력하세요`
  if (ratio < 0 || ratio > 1) return `${label}: 0~100% 범위여야 합니다`
  return null
}

/** 자산군 내 target_pct(0~1) 합계와 경고 여부. 서버(sum_warning)와 같은 허용 오차 ±0.0001. */
export function sumTargets(ratios) {
  const sum = Math.round(ratios.reduce((a, r) => a + (Number.isFinite(r) ? r : 0), 0) * PRECISION) / PRECISION
  return { sum, warning: Math.abs(sum - 1) > 0.0001 }
}
