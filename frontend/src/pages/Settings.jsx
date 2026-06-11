import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api, { fmt } from '../api/client.js'

function Section({ title, children }) {
  return (
    <div className="card">
      <h3 className="text-sm font-semibold text-gray-700 border-b pb-2 mb-4">{title}</h3>
      {children}
    </div>
  )
}

function FieldRow({ label, sub, children }) {
  return (
    <div className="flex items-center justify-between py-2 gap-4">
      <div>
        <div className="text-sm font-medium text-gray-700">{label}</div>
        {sub && <div className="text-xs text-gray-400">{sub}</div>}
      </div>
      <div className="w-52 flex-shrink-0">{children}</div>
    </div>
  )
}

async function downloadFile(endpoint, ext) {
  const res = await api.get(endpoint, { responseType: 'blob' })
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const url = URL.createObjectURL(res.data)
  const a = document.createElement('a')
  a.href = url
  a.download = `retirement_backup_${today}.${ext}`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export default function Settings() {
  const qc = useQueryClient()
  const [xlsxLoading, setXlsxLoading] = useState(false)
  const [csvLoading, setCsvLoading] = useState(false)

  const handleExportXlsx = async () => {
    setXlsxLoading(true)
    try { await downloadFile('/export/xlsx', 'xlsx') } finally { setXlsxLoading(false) }
  }
  const handleExportCsv = async () => {
    setCsvLoading(true)
    try { await downloadFile('/export/csv', 'zip') } finally { setCsvLoading(false) }
  }

  const { data: cfg, isLoading } = useQuery({
    queryKey: ['config'],
    queryFn: () => api.get('/config').then(r => r.data),
  })

  const [form, setForm] = useState(null)
  useEffect(() => { if (cfg) setForm(JSON.parse(JSON.stringify(cfg))) }, [cfg])

  const saveMut = useMutation({
    mutationFn: body => api.put('/config', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['config'] }),
  })

  const priceMut = useMutation({
    mutationFn: () => api.post('/price/update'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['assets'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })

  if (isLoading || !form) return <div className="flex items-center justify-center h-64 text-gray-400">불러오는 중...</div>

  const set = (path, val) => {
    const keys = path.split('.')
    setForm(prev => {
      const next = JSON.parse(JSON.stringify(prev))
      let obj = next
      for (let i = 0; i < keys.length - 1; i++) obj = obj[keys[i]]
      obj[keys[keys.length - 1]] = val
      return next
    })
  }

  const totalTarget = (
    (form.portfolio?.target_cash    || 0) +
    (form.portfolio?.target_bond    || 0) +
    (form.portfolio?.target_equity  || 0) +
    (form.portfolio?.target_income  || 0)
  )
  const totalOk = Math.abs(totalTarget - 1.0) < 0.001

  const inflRate = form.inflation?.assumed_rate ?? 0.025
  const inflOk   = inflRate >= 0

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-800">⚙️ 설정</h1>
        <button className="btn-primary" onClick={() => saveMut.mutate(form)}
          disabled={saveMut.isPending || !totalOk || !inflOk}>
          {saveMut.isPending ? '저장 중...' : '💾 설정 저장'}
        </button>
      </div>

      {saveMut.isSuccess && (
        <div className="bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg px-4 py-2">
          ✅ 설정이 저장되었습니다.
        </div>
      )}

      {/* 기본 정보 */}
      <Section title="👤 기본 정보">
        <FieldRow label="이름">
          <input value={form.user?.name || ''} onChange={e => set('user.name', e.target.value)} className="w-full" />
        </FieldRow>
        <FieldRow label="출생년도">
          <input type="number" value={form.user?.birth_year || ''} onChange={e => set('user.birth_year', +e.target.value)} className="w-full" />
        </FieldRow>
        <FieldRow label="은퇴 나이" sub="예: 65 (세)">
          <div>
            <input type="number" min="40" max="100"
              value={form.user?.retirement_age || ''}
              onChange={e => set('user.retirement_age', e.target.value ? +e.target.value : null)}
              className="w-full" />
            {form.user?.retirement_age && form.user?.birth_year &&
              (new Date().getFullYear() - form.user.birth_year) > form.user.retirement_age && (
              <p className="text-xs text-blue-500 mt-1">ℹ️ 이미 은퇴하셨습니다</p>
            )}
          </div>
        </FieldRow>
        <FieldRow label="월 생활비 (원)" sub="포트폴리오에서 인출할 월간 목표 금액">
          <input type="number" value={form.user?.monthly_expense || ''} onChange={e => set('user.monthly_expense', +e.target.value)} className="w-full" />
        </FieldRow>
        <FieldRow label="위험 성향">
          <select value={form.user?.risk_profile || 'balanced'} onChange={e => set('user.risk_profile', e.target.value)} className="w-full">
            <option value="conservative">보수적</option>
            <option value="balanced">균형형</option>
            <option value="aggressive">공격적</option>
          </select>
        </FieldRow>
      </Section>

      {/* 목표 포트폴리오 */}
      <Section title="🎯 목표 포트폴리오 비중">
        {[
          ['cash',   '현금성 (Cash)', '예금, CMA, MMF'],
          ['bond',   '채권/TDF',     '채권 ETF, TDF, 펀드'],
          ['equity', '주식형',        '주식형 ETF, 개별주식'],
          ['income', '리츠/인컴',     '리츠 ETF, 배당 ETF'],
        ].map(([key, label, sub]) => (
          <FieldRow key={key} label={label} sub={sub}>
            <div className="flex items-center gap-2">
              <input type="number" step="0.01" min="0" max="1"
                value={form.portfolio?.[`target_${key}`] || 0}
                onChange={e => set(`portfolio.target_${key}`, +e.target.value)}
                className="w-full" />
              <span className="text-sm text-gray-500 w-16">
                {((form.portfolio?.[`target_${key}`] || 0) * 100).toFixed(0)}%
              </span>
            </div>
          </FieldRow>
        ))}
        <div className={`mt-2 text-sm font-medium ${totalOk ? 'text-green-600' : 'text-red-500'}`}>
          합계: {(totalTarget * 100).toFixed(0)}% {totalOk ? '✅' : '⚠️ 합계가 100%가 아닙니다'}
        </div>
        <FieldRow label="리밸런싱 기준" sub="이 수치 이상 이탈 시 조정 권장 (예: 0.1 = 10%p)">
          <input type="number" step="0.01" value={form.portfolio?.rebalance_threshold || 0.1}
            onChange={e => set('portfolio.rebalance_threshold', +e.target.value)} className="w-full" />
        </FieldRow>
      </Section>

      {/* 국민연금 */}
      <Section title="🏛️ 국민연금 설정">
        <FieldRow label="개시 연월" sub="예: 2031-04">
          <input value={form.income?.national_pension?.start_date || ''}
            onChange={e => set('income.national_pension.start_date', e.target.value)}
            placeholder="2031-04" className="w-full" />
        </FieldRow>
        <FieldRow label="예상 수령액 (원/월)" sub="물가 조정 전 기준 금액">
          <input type="number" value={form.income?.national_pension?.base_amount || ''}
            onChange={e => set('income.national_pension.base_amount', +e.target.value)} className="w-full" />
        </FieldRow>
      </Section>

      {/* 물가상승률 */}
      <Section title="📈 기타 설정">
        <FieldRow label="물가상승률 가정" sub="예: 0.025 = 2.5% · 0 입력 가능 (민감도 확인용)">
          <div>
            <input type="number" step="0.001" min="0" value={inflRate}
              onChange={e => set('inflation.assumed_rate', +e.target.value)} className="w-full" />
            {!inflOk && (
              <p className="text-xs text-red-500 mt-1">⚠️ 물가상승률은 0 이상이어야 합니다</p>
            )}
          </div>
        </FieldRow>
        <FieldRow label="알림 이메일">
          <input type="email" value={form.alert?.email || ''}
            onChange={e => set('alert.email', e.target.value)} className="w-full" />
        </FieldRow>
      </Section>

      {/* 시세 업데이트 */}
      <Section title="📡 실시간 시세 업데이트">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-gray-700">종목 코드가 있는 자산의 현재가를 자동으로 갱신합니다.</div>
            <div className="text-xs text-gray-400 mt-1">FinanceDataReader / pykrx 사용 · 30초~1분 소요</div>
          </div>
          <button className="btn-primary" onClick={() => priceMut.mutate()} disabled={priceMut.isPending}>
            {priceMut.isPending ? '조회 중...' : '🔄 시세 업데이트'}
          </button>
        </div>
        {priceMut.isSuccess && priceMut.data && (
          <div className="mt-3 bg-green-50 border border-green-200 rounded-lg p-3 text-sm">
            <div className="text-green-700 font-medium mb-2">
              ✅ 업데이트 완료 — {priceMut.data.data.updated}개 성공 / {priceMut.data.data.failed}개 실패
            </div>
            <div className="space-y-1">
              {priceMut.data.data.details.map((d, i) => (
                <div key={i} className={`text-xs flex justify-between ${d.status === 'ok' ? 'text-gray-600' : 'text-red-500'}`}>
                  <span>{d.asset_name}</span>
                  <span>{d.status === 'ok' ? `${fmt.won(d.price)} → ${fmt.won(d.new_value)}` : '실패'}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {priceMut.isError && (
          <div className="mt-3 bg-red-50 border border-red-200 text-red-600 text-sm rounded-lg px-3 py-2">
            ❌ 오류: {priceMut.error?.message}
          </div>
        )}
      </Section>

      {/* 데이터 백업 */}
      <Section title="💾 데이터 백업">
        <p className="text-sm text-gray-600 mb-4">
          직접 입력한 자산·수입·설정 데이터를 내보냅니다.<br />
          계산 결과는 원본 데이터로 언제든 재계산되므로 제외됩니다.
        </p>
        <div className="flex gap-3">
          <button className="btn-primary" onClick={handleExportXlsx} disabled={xlsxLoading}>
            {xlsxLoading ? '다운로드 중...' : '📥 Excel로 내보내기'}
          </button>
          <button className="btn-primary" onClick={handleExportCsv} disabled={csvLoading}>
            {csvLoading ? '다운로드 중...' : '📥 CSV로 내보내기'}
          </button>
        </div>
      </Section>
    </div>
  )
}
