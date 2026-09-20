import { useQuery } from '@tanstack/react-query'
import api, { ASSET_TYPE_LABEL } from '../../api/client.js'
import {
  NULL_TEXT, fmtYears, fmtRate, fmtMultiple, fmtShare, pickReason, reasonText,
  bucketRuleMeta, guardMeta, TONE_BADGE, BUCKET_SOURCE_LABEL, bucketLabel,
} from '../../lib/withdrawalCheck.js'
import { Loading, Banner, won } from './ui.jsx'

// null 은 "-" + 사유 툴팁 (0 으로 표시하지 않는다)
function Val({ text, reason }) {
  const isNull = text === NULL_TEXT
  return (
    <span title={isNull && reason ? reason : undefined}
      style={isNull && reason ? { cursor: 'help', textDecoration: 'underline dotted' } : undefined}>
      {text}
    </span>
  )
}
const money = v => (typeof v === 'number' ? won(v) : NULL_TEXT)

function Section({ title, children, note }) {
  return (
    <div className="card">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">{title}</h3>
      {children}
      {note && <p className="text-[11px] text-gray-400 mt-3">{note}</p>}
    </div>
  )
}

function Line({ label, children, strong }) {
  return (
    <div className={`flex items-baseline justify-between py-1.5 text-sm ${strong ? 'border-t border-gray-200 mt-1 pt-2.5 font-semibold' : ''}`}>
      <span className="text-gray-600">{label}</span>
      <span className="tabular-nums text-right text-gray-800">{children}</span>
    </div>
  )
}

export default function CheckTab() {
  const { data: d, isLoading, error } = useQuery({
    queryKey: ['withdrawal-check'],
    queryFn: () => api.get('/withdrawal-check').then(r => r.data),
  })
  if (isLoading) return <Loading />
  if (error || !d) return <Banner tone="red">점검 결과를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</Banner>

  const net = d.net_need
  const noNeed = pickReason(d.reasons, 'net_need')
  const wr = d.withdrawal_rate
  const r = d.rules
  const c = d.completeness
  const byBucket = b => d.assets.filter(a => a.effective_bucket === b)
  const unassigned = d.assets.filter(a => a.effective_bucket == null)

  return (
    <div className="space-y-5">
      <Banner tone="blue">
        기준일 <b>{d.as_of}</b> · 수익률과 물가 상승을 반영하지 않은 <b>단순 계산</b>입니다.
        이 화면의 버킷은 <b>재지정값을 반영</b>합니다. 기존 리밸런싱·대시보드 화면의 버킷은 자산유형 기준입니다.
      </Banner>

      {(c.default_bucket_count > 0 || !c.baseline_set || !c.cashflow_set) && (
        <Banner tone="yellow">
          {!c.cashflow_set && <div>· 생활비 항목이 입력되지 않았습니다. (생활비·정기수입 탭)</div>}
          {!c.baseline_set && <div>· 인출 기준점이 입력되지 않았습니다. (인출 기준점 탭)</div>}
          {c.default_bucket_count > 0 && (
            <div>· 기본 버킷이 적용된 자산 {c.default_bucket_count}개 (금액의 {fmtShare(c.default_bucket_value_share)}) —
              자산유형 기준 버킷입니다. 보유상품 속성 탭에서 재지정할 수 있습니다.</div>
          )}
        </Banner>
      )}

      {/* 규칙 판정 */}
      <Section title="규칙 판정 (R-01 · R-02 · R-05 · R-06)"
        note="참고 수치이며 실행 판단은 규칙 엔진(예정)에서 제공합니다. 부족액·감액·증액 여지는 거래 지시가 아닙니다.">
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr><th>규칙</th><th>판정</th><th className="text-right">현재</th><th className="text-right">기준</th><th className="text-right">참고 금액</th></tr>
            </thead>
            <tbody>
              <tr>
                <td>R-01 1버킷 연수</td>
                <td><span className={TONE_BADGE[bucketRuleMeta(r['R-01'].status).tone]} title={reasonText(r['R-01'].reason)}>
                  {bucketRuleMeta(r['R-01'].status).label}</span></td>
                <td className="text-right"><Val text={fmtYears(r['R-01'].years)} reason={noNeed} /></td>
                <td className="text-right text-gray-500">
                  최소 <Val text={fmtYears(r['R-01'].min_years)} reason={reasonText(r['R-01'].reason)} /> · 목표 <Val text={fmtYears(r['R-01'].target_years)} reason={reasonText(r['R-01'].reason)} />
                </td>
                <td className="text-right">목표까지 부족 <Val text={money(r['R-01'].shortfall)} reason={reasonText(r['R-01'].reason)} /></td>
              </tr>
              <tr>
                <td>R-02 2버킷 연수 (단독)</td>
                <td><span className={TONE_BADGE[bucketRuleMeta(r['R-02'].status).tone]} title={reasonText(r['R-02'].reason)}>
                  {bucketRuleMeta(r['R-02'].status).label}</span></td>
                <td className="text-right"><Val text={fmtYears(r['R-02'].years)} reason={noNeed} /></td>
                <td className="text-right text-gray-500">목표 <Val text={fmtYears(r['R-02'].target_years)} reason={reasonText(r['R-02'].reason)} /></td>
                <td className="text-right">목표까지 부족 <Val text={money(r['R-02'].shortfall)} reason={reasonText(r['R-02'].reason)} /></td>
              </tr>
              <tr>
                <td>R-05 인출률 상단</td>
                <td><span className={TONE_BADGE[guardMeta(r['R-05'].status).tone]}
                  title={reasonText(r['R-05'].reason)}>{guardMeta(r['R-05'].status).label}</span></td>
                <td className="text-right"><Val text={fmtMultiple(r['R-05'].ratio)} reason={reasonText(r['R-05'].reason)} /> <span className="text-gray-400">(초기 대비)</span></td>
                <td className="text-right text-gray-500">초과 기준 <Val text={fmtMultiple(r['R-05'].upper_multiplier)} reason={reasonText(r['R-05'].reason)} /></td>
                <td className="text-right">선택생활비 감액 참고 <Val text={money(r['R-05'].suggestion_amount)} reason={reasonText(r['R-05'].reason) || '상단을 넘지 않아 해당 없음'} /></td>
              </tr>
              <tr>
                <td>R-06 인출률 하단</td>
                <td><span className={TONE_BADGE[guardMeta(r['R-06'].status).tone]} title={reasonText(r['R-06'].reason)}>
                  {guardMeta(r['R-06'].status).label}</span></td>
                <td className="text-right"><Val text={fmtMultiple(r['R-06'].ratio)} reason={reasonText(r['R-06'].reason)} /> <span className="text-gray-400">(초기 대비)</span></td>
                <td className="text-right text-gray-500">미만 기준 <Val text={fmtMultiple(r['R-06'].lower_multiplier)} reason={reasonText(r['R-06'].reason)} /></td>
                <td className="text-right">증액 여지 참고 <Val text={money(r['R-06'].suggestion_amount)} reason={reasonText(r['R-06'].reason) || '하단 미만이 아니라 해당 없음'} /></td>
              </tr>
            </tbody>
          </table>
        </div>
      </Section>

      {/* 인출률 */}
      <Section title="인출률" note="가드레일 판정은 계획 기준 인출률로 합니다. 실적 기준은 참고용입니다 (기준일 이전 12개월 달력 기준 — 인출 관리 화면의 '최근 12개월'과 정의가 다를 수 있습니다).">
        <Line label="초기 인출률 (인출 기준점)"><Val text={fmtRate(wr.initial)} reason={reasonText(wr.reasons.initial)} /></Line>
        <Line label="현재 인출률 (계획 기준 = 순인출 필요액 ÷ 투자자산)"><Val text={fmtRate(wr.current_plan)} reason={reasonText(wr.reasons.current_plan)} /></Line>
        <Line label="현재 인출률 (실적 기준, 참고)">
          <Val text={fmtRate(wr.current_actual)} reason={reasonText(wr.reasons.current_actual)} />
          {wr.actual_12m_total != null && <span className="text-gray-400 text-xs ml-2">(12개월 {money(wr.actual_12m_total)} · {wr.actual_12m_count}건)</span>}
        </Line>
        <Line label="초기 대비 배수 (현재 계획 ÷ 초기)" strong><Val text={fmtMultiple(wr.ratio_to_initial)} reason={reasonText(wr.reasons.ratio)} /></Line>
      </Section>

      {/* 생활비 구성 */}
      <Section title="생활비 구성 (기준일 유효 항목)" note="개시 전 항목은 합계에 포함하지 않고 아래에 '예정'으로 표시합니다.">
        <Line label="필수생활비">{money(net.gross.essential_annual)} / 년</Line>
        <Line label="선택생활비">{money(net.gross.discretionary_annual)} / 년</Line>
        <Line label="정기수입">− {money(net.gross.income_annual)} / 년</Line>
        <Line label="순인출 필요액 (전체)" strong>
          <Val text={net.annual_total > 0 ? money(net.annual_total) : NULL_TEXT} reason={noNeed} /> / 년 · 월 <Val text={net.annual_total > 0 ? money(net.monthly_total) : NULL_TEXT} reason={noNeed} />
        </Line>
        <Line label="순인출 필요액 (필수생활비 기준)">
          <Val text={net.annual_essential > 0 ? money(net.annual_essential) : NULL_TEXT} reason={noNeed} /> / 년
        </Line>
        {(net.upcoming_income.length > 0 || net.upcoming_expense.length > 0) && (
          <div className="mt-3 rounded-lg bg-blue-50/50 border border-blue-100 px-3 py-2 text-sm">
            <div className="text-xs font-semibold text-blue-800 mb-1"><span className="badge-blue mr-1.5">예정</span>아직 개시되지 않은 항목 (위 합계에 미포함)</div>
            {net.upcoming_income.map((u, i) => (
              <div key={`i${i}`} className="flex justify-between text-gray-700"><span>수입 · {u.name}</span><span>월 {money(u.monthly_amount)} · {u.start_date} 개시</span></div>
            ))}
            {net.upcoming_expense.map((u, i) => (
              <div key={`e${i}`} className="flex justify-between text-gray-700"><span>지출 · {u.name}</span><span>월 {money(u.monthly_amount)} · {u.start_date} 개시</span></div>
            ))}
          </div>
        )}
      </Section>

      {/* 버킷별 자산 */}
      <Section title="버킷별 자산과 커버 연수" note="커버 연수 = 버킷 잔액 ÷ 순인출 필요액 (수익률 0% 가정). 필수 기준은 필수생활비의 순인출액으로 나눈 값입니다.">
        <div className="space-y-4">
          {d.buckets.map(b => (
            <div key={b.bucket}>
              <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1.5">
                <div className="text-sm font-semibold text-gray-800">{bucketLabel(b.bucket)}
                  <span className="text-gray-400 font-normal ml-2">{b.asset_count}개 · {money(b.value)}</span></div>
                <div className="text-xs text-gray-600">
                  전체 기준 <b><Val text={fmtYears(b.years_total)} reason={noNeed} /></b> · 필수 기준 <b><Val text={fmtYears(b.years_essential)} reason={noNeed} /></b>
                </div>
              </div>
              <AssetTable rows={byBucket(b.bucket)} />
            </div>
          ))}
          {unassigned.length > 0 && (
            <div>
              <div className="text-sm font-semibold text-red-600 mb-1.5">버킷 미지정 {unassigned.length}개 · {money(d.unassigned.value)}</div>
              <AssetTable rows={unassigned} />
            </div>
          )}
        </div>
        <div className="mt-4 pt-3 border-t border-gray-100 text-sm space-y-0.5">
          <Line label="1+2버킷 누적 (전체 / 필수)">
            <Val text={fmtYears(d.cumulative.b1_b2_years_total)} reason={noNeed} /> / <Val text={fmtYears(d.cumulative.b1_b2_years_essential)} reason={noNeed} />
          </Line>
          <Line label="전체 투자자산 (전체 / 필수)">
            <Val text={fmtYears(d.cumulative.all_years_total)} reason={noNeed} /> / <Val text={fmtYears(d.cumulative.all_years_essential)} reason={noNeed} />
            <span className="text-gray-400 text-xs ml-2">({money(d.total_assets)})</span>
          </Line>
        </div>
      </Section>

      {/* 가정 */}
      <Section title="계산 가정">
        <ul className="list-disc pl-5 text-sm text-gray-600 space-y-1">
          {d.assumptions.map(a => <li key={a}>{a}</li>)}
        </ul>
      </Section>
    </div>
  )
}

function AssetTable({ rows }) {
  if (rows.length === 0) return <div className="text-xs text-gray-400 px-1">해당 자산이 없습니다.</div>
  return (
    <div className="overflow-x-auto">
      <table>
        <thead>
          <tr><th>자산</th><th>유형</th><th className="text-right">금액</th><th>실효 버킷</th><th>출처</th></tr>
        </thead>
        <tbody>
          {rows.map(a => (
            <tr key={a.id}>
              <td className="font-medium">{a.asset_name}<div className="text-[11px] text-gray-400 font-normal">{a.account_name}</div></td>
              <td>{ASSET_TYPE_LABEL[a.asset_type] || a.asset_type}</td>
              <td className="text-right tabular-nums">{money(a.value)}</td>
              <td>{bucketLabel(a.effective_bucket)}</td>
              <td>
                <span className={a.bucket_source === 'override' ? 'badge-blue' : 'badge-gray'}
                  title={a.bucket_source === 'override' ? `자산유형 기본은 ${bucketLabel(a.default_bucket)}` : '자산유형 기준 기본값'}>
                  {BUCKET_SOURCE_LABEL[a.bucket_source]}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
