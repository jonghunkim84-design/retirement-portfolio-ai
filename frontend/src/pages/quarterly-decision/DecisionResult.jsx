import { ASSET_TYPE_LABEL } from '../../api/client.js'
import { fmtRate, fmtYears, TONE_BADGE, bucketLabel, BUCKET_SOURCE_LABEL } from '../../lib/withdrawalCheck.js'
import {
  won, CONCLUSION_LABEL, CONCLUSION_TONE, ACCOUNT_TYPE_LABEL, describeSummary, describeReason, describeRegime,
  describeWarning, describeSkipped, describeSellRule, describeAccountItem, RULE_LABEL,
} from '../../lib/decisionText.js'

const CLASS_LABEL = { cash: '현금', bond: '채권(TDF·펀드)', equity: '주식', income: '리츠/인컴' }

function Section({ title, children, note }) {
  return (
    <div className="card">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">{title}</h3>
      {children}
      {note && <p className="text-[11px] text-gray-400 mt-3">{note}</p>}
    </div>
  )
}

function Line({ label, children, hint }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 text-sm">
      <span className="text-gray-600">{label}{hint && <span className="text-[11px] text-gray-400 ml-1.5">{hint}</span>}</span>
      <span className="tabular-nums text-right text-gray-800 font-medium">{children}</span>
    </div>
  )
}

const TONE_BOX = {
  ok: 'bg-green-50 border-green-200 text-green-900',
  info: 'bg-blue-50 border-blue-200 text-blue-900',
  neutral: 'bg-gray-50 border-gray-200 text-gray-800',
  danger: 'bg-red-50 border-red-200 text-red-900',
}

/** POST /decision-engine/run 결과 표시. 문장은 summary_code·reasons 로 프론트(lib/decisionText.js)에서 조립한다. */
export default function DecisionResult({ result }) {
  const c = result.conclusion
  const pay = result.payment
  const regime = describeRegime(result.regime)
  const refill = result.refill
  const b1 = result.bucket1_after
  const snap = result.inputs_snapshot
  const sellTotal = refill.sells.reduce((a, s) => a + s.amount, 0)

  return (
    <div className="space-y-4">
      {result.warnings.map(w => (
        <div key={w.code} className="bg-yellow-50 border border-yellow-200 text-yellow-800 text-sm rounded-xl px-4 py-2.5">⚠️ {describeWarning(w)}</div>
      ))}

      <div className={`border rounded-xl px-5 py-4 ${TONE_BOX[CONCLUSION_TONE[c.type]] ?? TONE_BOX.neutral}`}>
        <div className="flex items-center gap-2 mb-1.5">
          <span className={TONE_BADGE[CONCLUSION_TONE[c.type]] ?? 'badge-gray'}>{CONCLUSION_LABEL[c.type] ?? c.type}</span>
          <span className="text-xs opacity-70">기준일 {result.as_of} · {result.period}</span>
        </div>
        <p className="text-base font-semibold leading-relaxed">{describeSummary(result)}</p>
      </div>

      <Section title="① 이번 분기 지급">
        <Line label="기본 지급액 (순인출 필요액 ÷ 4)" hint="1버킷에서 지급">{won(pay.base_quarterly)}</Line>
        {pay.recommended_quarterly != null && (
          <Line label="가드레일 권고 지급액" hint="인출률 상단 초과 · 필수생활비는 줄이지 않음">{won(pay.recommended_quarterly)}</Line>
        )}
        {pay.raise_room_quarterly != null && (
          <Line label="증액 여지 (참고)" hint="인출률 하단 미만 · 자동으로 늘리지 않음">{won(pay.raise_room_quarterly)}</Line>
        )}
        <Line label="1버킷 잔액">{won(pay.bucket1_balance)}</Line>
        {pay.shortfall_before_refill > 0 && <Line label="지급액 대비 부족분 (선행 보충 필요)">{won(pay.shortfall_before_refill)}</Line>}
      </Section>

      <Section title="② 시장 국면 (R-04)">
        <div className="flex items-center gap-2 text-sm">
          <span className={TONE_BADGE[regime.tone]}>{regime.label}</span>
          <span className="text-gray-600">{regime.detail}</span>
        </div>
      </Section>

      <Section title="③ 1버킷 보충 판단 (R-01 · R-03 · R-04)">
        <ul className="list-disc pl-5 text-sm text-gray-700 space-y-1 mb-3">
          {c.reasons.map((r, i) => <li key={i}>{describeReason(r)}</li>)}
        </ul>
        {refill.sells.length > 0 ? (
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr><th>자산</th><th>자산군</th><th>버킷</th><th>계좌</th><th className="text-right">매도 금액</th><th>근거</th></tr>
              </thead>
              <tbody>
                {refill.sells.map((s, i) => (
                  <tr key={`${s.asset_id}-${i}`}>
                    <td className="font-medium">{s.asset_name}</td>
                    <td>{CLASS_LABEL[s.asset_class] ?? s.asset_class}</td>
                    <td>{bucketLabel(s.bucket)} <span className="text-[11px] text-gray-400">({BUCKET_SOURCE_LABEL[s.bucket_source]})</span></td>
                    <td>{ACCOUNT_TYPE_LABEL[s.account_type]}</td>
                    <td className="text-right tabular-nums">{won(s.amount)}</td>
                    <td className="text-xs text-gray-600">{s.rule} · {describeSellRule(s.rule)}</td>
                  </tr>
                ))}
                <tr><td colSpan={4} className="text-right font-semibold">합계</td><td className="text-right font-semibold tabular-nums">{won(sellTotal)}</td><td /></tr>
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-gray-500">매도할 자산이 없습니다.</p>
        )}
        <div className="mt-3 pt-3 border-t border-gray-100 text-sm">
          <Line label="1버킷 연수 (지급 후 → 보충 후)">
            {fmtYears(b1.years_before_refill)} <span className="text-gray-400">→</span> {fmtYears(b1.years_after_refill)}
          </Line>
          {refill.case && (
            <Line label="보충 필요 금액 (목표 / 최소까지)">{won(refill.need_amount)} / {won(refill.hard_need_amount)}</Line>
          )}
        </div>
      </Section>

      {result.account_checks.length > 0 && (
        <Section title="④ 계좌 확인 항목 (R-07)" note="세금 금액은 계산하지 않습니다. 확인 항목과 올해 연금 한도 사용액만 참고로 제공합니다.">
          <div className="space-y-3">
            {result.account_checks.map(a => (
              <div key={a.asset_id} className="border border-gray-100 rounded-lg px-3 py-2">
                <div className="text-sm font-medium text-gray-800">{a.asset_name} <span className="badge-gray ml-1">{ACCOUNT_TYPE_LABEL[a.account_type]}</span></div>
                <ul className="list-disc pl-5 text-sm text-gray-600 mt-1 space-y-0.5">
                  {a.items.map(it => <li key={it}>{describeAccountItem(it)}</li>)}
                </ul>
                {a.reference && (
                  <div className="text-xs text-gray-600 bg-gray-50 rounded px-2 py-1.5 mt-2">
                    {a.reference.year}년 연금 한도 사용액 {won(a.reference.ytd_total)}
                    (연금저축 {won(a.reference.pension_savings_ytd)} · 퇴직연금 {won(a.reference.retirement_pension_ytd)})
                    {a.reference.remaining != null && <> — 연 한도 {won(a.reference.annual_limit)} 중 잔여 <b>{won(a.reference.remaining)}</b></>}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section title="자산군 비중과 허용 폭 (R-03)" note={`허용 폭 방식: ${snap.class_mode === 'relative' ? '목표 대비 상대 폭' : snap.class_mode === 'config' ? '기존 설정값(rebalance_threshold)' : '미적용'} · 판정은 이탈 ≥ 허용 폭(이상)`}>
        <div className="overflow-x-auto">
          <table>
            <thead><tr><th>자산군</th><th className="text-right">현재 비중</th><th className="text-right">목표</th><th className="text-right">이탈</th><th className="text-right">허용 폭</th><th>판정</th></tr></thead>
            <tbody>
              {Object.entries(snap.class_weights).map(([k, v]) => (
                <tr key={k}>
                  <td>{CLASS_LABEL[k] ?? k}</td>
                  <td className="text-right tabular-nums">{fmtRate(v.weight)}</td>
                  <td className="text-right tabular-nums">{fmtRate(v.target)}</td>
                  <td className="text-right tabular-nums">{v.diff_ratio == null ? '-' : `${v.diff_ratio > 0 ? '+' : ''}${(v.diff_ratio * 100).toFixed(1)}%p`}</td>
                  <td className="text-right tabular-nums">{fmtRate(v.band)}</td>
                  <td>{v.over_band ? <span className="badge-yellow">{v.excess > 0 ? `초과 ${won(v.excess)}` : '초과(부족)'}</span> : <span className="badge-gray">범위 안</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="적용 규칙과 미적용 규칙">
        <div className="text-sm space-y-2">
          <div>
            <span className="text-gray-500 mr-2">적용:</span>
            {result.applied_rules.length === 0 ? '-' : result.applied_rules.map(code => (
              <span key={code} className="badge-green mr-1.5" title={RULE_LABEL[code]}>{code} {RULE_LABEL[code]}</span>
            ))}
          </div>
          {result.skipped_rules.length > 0 && (
            <div>
              <span className="text-gray-500">미적용:</span>
              <ul className="list-disc pl-5 mt-1 text-gray-600 space-y-0.5">
                {result.skipped_rules.map((s, i) => <li key={i}>{describeSkipped(s)}</li>)}
              </ul>
            </div>
          )}
        </div>
      </Section>

      <Section title="가정">
        <ul className="list-disc pl-5 text-sm text-gray-600 space-y-1">
          {result.assumptions.map(a => <li key={a}>{a}</li>)}
        </ul>
      </Section>

      <p className="text-center text-sm text-gray-500">규칙에 따른 판단 결과이며, 실행 여부는 직접 결정하세요.</p>
    </div>
  )
}
