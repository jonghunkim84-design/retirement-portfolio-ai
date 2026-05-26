import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import api, { fmt } from '../api/client.js'

// ── 버킷별 상품 카탈로그 (참고용 · 최신 금리/수익률 별도 확인 필요) ──
const PRODUCT_CATALOG = {
  B1: {
    label: '현금성 자산',
    desc:  '즉시 유동성 확보 · 원금 안전 · 예금자보호 대상 우선',
    products: [
      {
        rank: 1, icon: '🏦',
        name: '파킹통장',
        type: '은행 수시입출식 예금',
        features: '언제든 입출금 · 일별 이자 지급 · 카카오·토스·케이뱅크 등 인터넷은행 금리 유리',
        examples: '토스뱅크 파킹통장, 카카오뱅크 파킹통장, 케이뱅크 플러스박스',
        account: '일반',
        risk: '매우 낮음',
        horizon: '단기 (즉시 출금)',
      },
      {
        rank: 2, icon: '💳',
        name: 'CMA (종합자산관리계좌)',
        type: '증권사 수시입출식',
        features: 'RP·MMF 운용 · 1일 단위 이자 · 체크카드 연결 가능 · 증권 계좌와 통합',
        examples: '미래에셋 CMA, 한국투자증권 CMA, NH투자증권 CMA',
        account: '일반',
        risk: '매우 낮음',
        horizon: '단기 (즉시)',
      },
      {
        rank: 3, icon: '🏛',
        name: '단기 정기예금 (6~12개월)',
        type: '은행 확정금리 예금',
        features: '만기 확정 금리 · 예금자보호 5천만원 · 금리 비교 후 선택 (저축은행 금리 우위)',
        examples: 'SB톡톡플러스(저축은행), 시중은행 정기예금',
        account: '일반',
        risk: '매우 낮음',
        horizon: '단기 (6~12개월)',
      },
      {
        rank: 4, icon: '📊',
        name: 'KODEX 단기채권PLUS ETF',
        type: 'ETF · 초단기 국채',
        features: '잔존만기 1년 이하 국고채 편입 · 변동성 극히 낮음 · IRP·연금저축 계좌 투자 가능',
        examples: '종목코드 A230730 · 한국거래소 상장',
        account: '일반 / IRP / 연금저축',
        risk: '낮음',
        horizon: '단기~중기',
      },
      {
        rank: 5, icon: '💰',
        name: 'MMF (머니마켓펀드)',
        type: '초단기금융펀드',
        features: '우량 단기채·CP 투자 · D+1 환매 · 실질 원금손실 위험 거의 없음',
        examples: '각 은행·증권사 MMF 상품',
        account: '일반 / IRP',
        risk: '낮음',
        horizon: '단기',
      },
    ],
  },
  B2: {
    label: '채권 / TDF / 펀드',
    desc:  '중수익·중위험 · 물가 방어 · 은퇴 포트폴리오 안정적 핵심 자산',
    products: [
      {
        rank: 1, icon: '🇰🇷',
        name: 'TIGER 국채3년 ETF',
        type: 'ETF · 중기 국채',
        features: '잔존만기 3년 내외 국고채 추종 · 금리 하락 시 자본이득 · 안정적 이자수익',
        examples: '종목코드 A114820',
        account: '일반 / IRP / 연금저축',
        risk: '낮음',
        horizon: '중기 (2~5년)',
      },
      {
        rank: 2, icon: '📄',
        name: 'KODEX 종합채권(AA-이상)액티브 ETF',
        type: 'ETF · 우량 종합채권',
        features: 'AA- 이상 국채·공사채·우량 회사채 분산 · 액티브 운용으로 금리 대응',
        examples: '종목코드 A136340',
        account: '일반 / IRP / 연금저축',
        risk: '낮음~보통',
        horizon: '중기',
      },
      {
        rank: 3, icon: '🎯',
        name: 'TDF 2030 / 2035 (생애주기펀드)',
        type: '혼합형 펀드',
        features: '자동 자산배분 · 목표연도 가까울수록 채권 비중 자동 증가 · IRP 세제혜택',
        examples: '미래에셋 TDF2030, 한국투자TDF2030, 삼성TDF2030 시리즈',
        account: 'IRP / 연금저축 우선',
        risk: '보통',
        horizon: '장기 (5년+)',
      },
      {
        rank: 4, icon: '🌏',
        name: 'TIGER 미국채10년선물 ETF',
        type: 'ETF · 미국 장기채',
        features: '미국 10년물 국채 선물 추종 · 주식과 역상관 관계 · 환헤지 버전 별도',
        examples: '종목코드 A305080 (환노출) / A308620 (환헤지)',
        account: '일반 / IRP / 연금저축',
        risk: '보통',
        horizon: '중장기',
      },
      {
        rank: 5, icon: '📜',
        name: '증권사 채권 직매입',
        type: '개별 국채 · 공사채 · 우량 회사채',
        features: '만기 보유 시 확정 수익 · 중도 매도 가능 · 원하는 만기 선택',
        examples: '각 증권사 HTS 채권 창구 (잔존만기 1~5년 우량 채권 추천)',
        account: '일반 / IRP',
        risk: '낮음~보통',
        horizon: '잔존만기에 따라',
      },
    ],
  },
  B3: {
    label: '주식형 / 인컴',
    desc:  '장기 성장 + 인컴 수익 · 물가 초과 수익 목표 · 장기 보유 전제',
    products: [
      {
        rank: 1, icon: '🇰🇷',
        name: 'KODEX 200 ETF',
        type: 'ETF · 국내 대형주',
        features: '코스피200 추종 · 국내 대표 50+ 기업 분산 · 낮은 보수 · 배당수익률 ~2%',
        examples: '종목코드 A069500',
        account: '일반 / IRP / 연금저축',
        risk: '높음',
        horizon: '장기 (5년+)',
      },
      {
        rank: 2, icon: '🇺🇸',
        name: 'TIGER 미국S&P500 ETF',
        type: 'ETF · 미국 대형주',
        features: '미국 S&P500 추종 · 글로벌 분산 · 환노출 (원/달러 변동 포함)',
        examples: '종목코드 A360750',
        account: '일반 / IRP / 연금저축',
        risk: '높음',
        horizon: '장기 (5년+)',
      },
      {
        rank: 3, icon: '💸',
        name: 'TIGER 미국배당다우존스 ETF',
        type: 'ETF · 미국 고배당 / 월배당',
        features: '월배당 지급 · 배당 성장 미국 기업 편입 · 인컴+성장 동시 추구',
        examples: '종목코드 A458730',
        account: '일반 / IRP / 연금저축',
        risk: '보통~높음',
        horizon: '중장기',
      },
      {
        rank: 4, icon: '🏢',
        name: 'KODEX 한국부동산리츠인프라 ETF',
        type: 'ETF · 국내 리츠',
        features: '국내 상장 리츠 분산 편입 · 분기 분배금 · 부동산 간접투자 효과',
        examples: '종목코드 A432320',
        account: '일반 / IRP / 연금저축',
        risk: '보통',
        horizon: '중장기',
      },
      {
        rank: 5, icon: '📈',
        name: 'TIGER 배당성장 ETF',
        type: 'ETF · 국내 배당성장주',
        features: '배당 꾸준히 증가 이력 국내 우량주 편입 · 방어적 성장주 특성',
        examples: '종목코드 A237350',
        account: '일반 / IRP / 연금저축',
        risk: '높음',
        horizon: '장기',
      },
    ],
  },
}

// ── 버킷 서브 라벨 ────────────────────────────────────────────────
const BUCKET_SUB = {
  B1: '예금, CMA, MMF',
  B2: '채권 ETF, TDF, 펀드',
  B3: '주식형 ETF, 개별주식, 리츠, 배당 ETF',
}

// ── 색상 매핑 ─────────────────────────────────────────────────────
const BUCKET_STYLE = {
  B1: { bar: 'bg-blue-500',   text: 'text-blue-600',   border: 'border-blue-400',   badge: 'bg-blue-100 text-blue-700'   },
  B2: { bar: 'bg-green-500',  text: 'text-green-600',  border: 'border-green-400',  badge: 'bg-green-100 text-green-700'  },
  B3: { bar: 'bg-purple-500', text: 'text-purple-600', border: 'border-purple-400', badge: 'bg-purple-100 text-purple-700' },
}

const URGENCY_STYLE = {
  '긴급': 'bg-red-100 text-red-700',
  '주의': 'bg-orange-100 text-orange-700',
  '예정': 'bg-gray-100 text-gray-600',
}

// ── 버킷 현황 바 ──────────────────────────────────────────────────
function BucketBar({ b }) {
  const style = BUCKET_STYLE[b.bucket]
  const pct   = b.current_pct
  const tgt   = b.target_pct
  const short = b.shortage > 0
  const over  = b.deviation > 5

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-2">
          <span className={`font-bold ${style.text}`}>{b.bucket}</span>
          <span className="text-gray-600">{b.name}</span>
          {short && (
            <span className="text-[10px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full font-semibold">
              ▼ {Math.abs(b.deviation)}%p 부족
            </span>
          )}
          {over && (
            <span className="text-[10px] bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded-full font-semibold">
              ▲ {b.deviation}%p 초과
            </span>
          )}
          {!short && !over && (
            <span className="text-[10px] bg-green-100 text-green-600 px-1.5 py-0.5 rounded-full font-semibold">
              ✓ 적정
            </span>
          )}
        </div>
        <div className="text-right">
          <span className={`font-semibold ${style.text}`}>{pct}%</span>
          <span className="text-gray-400"> / 목표 {tgt}%</span>
        </div>
      </div>
      {/* 진행 바 */}
      <div className="relative h-3 bg-gray-100 rounded-full overflow-hidden">
        {/* 현재 */}
        <div
          className={`absolute left-0 top-0 h-full rounded-full transition-all ${style.bar}`}
          style={{ width: `${Math.min(pct, 100)}%`, opacity: 0.85 }}
        />
        {/* 목표 마커 */}
        <div
          className="absolute top-0 h-full w-0.5 bg-gray-500/60"
          style={{ left: `${tgt}%` }}
        />
      </div>
      <div className="flex justify-between text-[10px] text-gray-400">
        <span>현재 {fmt.eok(b.current_amt)}</span>
        {short && <span className="text-red-500 font-medium">부족 {fmt.eok(b.shortage)}</span>}
        <span>목표 {fmt.eok(b.target_amt)}</span>
      </div>
    </div>
  )
}

// ── 상품 카드 ──────────────────────────────────────────────────────
function ProductCard({ p }) {
  const riskColor = {
    '매우 낮음': 'bg-blue-100 text-blue-700',
    '낮음':     'bg-green-100 text-green-700',
    '낮음~보통': 'bg-teal-100 text-teal-700',
    '보통':     'bg-yellow-100 text-yellow-700',
    '보통~높음': 'bg-orange-100 text-orange-700',
    '높음':     'bg-red-100 text-red-700',
  }[p.risk] ?? 'bg-gray-100 text-gray-600'

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-xl">{p.icon}</span>
          <div>
            <p className="font-bold text-gray-800 text-sm">{p.name}</p>
            <p className="text-[11px] text-gray-400">{p.type}</p>
          </div>
        </div>
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border border-gray-200 text-gray-500">
          #{p.rank}
        </span>
      </div>

      <p className="text-xs text-gray-600 leading-relaxed mb-3">{p.features}</p>

      <div className="space-y-1.5 text-[11px]">
        <div className="flex gap-1.5">
          <span className="text-gray-400 w-12 flex-shrink-0">예시</span>
          <span className="text-gray-700 font-medium">{p.examples}</span>
        </div>
        <div className="flex gap-1.5">
          <span className="text-gray-400 w-12 flex-shrink-0">계좌</span>
          <span className="text-blue-600 font-medium">{p.account}</span>
        </div>
        <div className="flex items-center gap-2 mt-2">
          <span className={`px-2 py-0.5 rounded-full font-semibold ${riskColor}`}>
            위험 {p.risk}
          </span>
          <span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
            ⏱ {p.horizon}
          </span>
        </div>
      </div>
    </div>
  )
}

// ── 메인 ──────────────────────────────────────────────────────────
export default function MaturityGuide() {
  const [selectedBucket, setSelectedBucket] = useState(null)   // null = 자동 (추천 버킷)
  const [urgencyFilter,  setUrgencyFilter]  = useState('all')  // 'all' | '30' | '90'

  const { data, isLoading } = useQuery({
    queryKey: ['maturity-guide'],
    queryFn:  () => api.get('/rebalance/maturity-guide').then(r => r.data),
    staleTime: 60_000,
  })

  if (isLoading) return (
    <div className="flex items-center justify-center h-64 text-gray-400">불러오는 중...</div>
  )

  const {
    bucket_status    = [],
    primary_bucket   = {},
    priority_order   = [],
    reasons          = [],
    maturing_assets  = [],
    maturity_total   = 0,
    b1_months_covered = 0,
    monthly_expense  = 5_000_000,
  } = data ?? {}

  // 활성 버킷 (선택 없으면 추천 버킷)
  const activeBucket = selectedBucket ?? primary_bucket?.bucket ?? 'B1'

  // 만기 자산 필터
  const filtered = maturing_assets.filter(a => {
    if (urgencyFilter === '30') return a.days_left <= 30
    if (urgencyFilter === '90') return a.days_left <= 90
    return true
  })

  const catalog = PRODUCT_CATALOG[activeBucket]

  return (
    <div className="space-y-5">

      {/* ── 헤더 ─────────────────────────────────────────────────── */}
      <div className="bg-gradient-to-r from-[#1e3a5f] to-[#1a5c96] text-white rounded-xl px-6 py-5">
        <h1 className="text-xl font-bold">🔄 만기 자산 재배분 가이드</h1>
        <p className="text-blue-200 text-sm mt-1">
          만기 도래 자산을 어느 버킷으로 이동할지 안내하고, 투자 상품 카테고리를 추천합니다.
        </p>
      </div>

      {/* ── 요약 KPI 카드 ──────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card border-l-4 border-orange-400">
          <p className="text-xs text-gray-500">90일 이내 만기</p>
          <p className="text-lg font-bold text-gray-800 mt-0.5">{maturing_assets.length}건</p>
          <p className="text-xs text-gray-400">{fmt.eok(maturity_total)}</p>
        </div>
        <div className={`card border-l-4 ${
          b1_months_covered >= 6 ? 'border-green-500' : 'border-red-400'
        }`}>
          <p className="text-xs text-gray-500">B1 생활비 커버</p>
          <p className={`text-lg font-bold mt-0.5 ${
            b1_months_covered >= 6 ? 'text-green-600' : 'text-red-500'
          }`}>
            {b1_months_covered}개월
          </p>
          <p className="text-xs text-gray-400">
            {b1_months_covered >= 6 ? '✅ 안전 기준 충족' : '⚠️ 6개월 미만 — B1 우선'}
          </p>
        </div>
        <div className={`card border-l-4 ${BUCKET_STYLE[primary_bucket?.bucket ?? 'B1']?.border ?? 'border-gray-300'}`}>
          <p className="text-xs text-gray-500">우선 편입 버킷</p>
          <p className={`text-lg font-bold mt-0.5 ${BUCKET_STYLE[primary_bucket?.bucket ?? 'B1']?.text}`}>
            {primary_bucket?.bucket}
          </p>
          <p className="text-xs text-gray-400">{primary_bucket?.name}</p>
        </div>
        <div className="card border-l-4 border-gray-300">
          <p className="text-xs text-gray-500">B1 부족액</p>
          <p className="text-lg font-bold text-gray-800 mt-0.5">
            {fmt.eok(bucket_status.find(b => b.bucket === 'B1')?.shortage ?? 0)}
          </p>
          <p className="text-xs text-gray-400">목표 비율 기준</p>
        </div>
      </div>

      {/* ── 재배분 이유 배너 ───────────────────────────────────────── */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-4">
        <p className="text-sm font-bold text-amber-800 mb-2">
          📌 재배분 가이드 — {primary_bucket?.bucket} ({primary_bucket?.name}) 우선 편입
        </p>
        <ul className="space-y-1">
          {reasons.map((r, i) => (
            <li key={i} className="text-xs text-amber-700 flex items-start gap-1.5">
              <span className="mt-0.5">•</span>
              <span>{r}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* ── 포트폴리오 조정 현황 테이블 (엑셀 형식) ──────────────── */}
      {bucket_status.length > 0 && (() => {
        const total = bucket_status.reduce((s, b) => s + (b.current_amt || 0), 0)
        return (
          <div className="card overflow-hidden">
            {/* 헤더 */}
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-700">📋 포트폴리오 조정 현황</h3>
              <div className="flex items-center gap-3 text-xs text-gray-500">
                <span className="flex items-center gap-1">
                  <span className="inline-block w-2.5 h-2.5 rounded-full bg-blue-500"/>매수 필요
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block w-2.5 h-2.5 rounded-full bg-red-400"/>매도 필요
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block w-2.5 h-2.5 rounded-full bg-green-400"/>적정
                </span>
              </div>
            </div>

            {/* 총 자산 배너 */}
            <div className="bg-[#1e3a5f] text-white rounded-lg px-4 py-2.5 mb-3 flex items-center gap-3">
              <span className="text-xs text-blue-200">현재 총 자산</span>
              <span className="font-bold text-base">{Math.round(total).toLocaleString('ko-KR')}원</span>
            </div>

            {/* 테이블 */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-gray-100 text-gray-600">
                    <th className="px-4 py-2.5 text-left text-xs font-semibold border border-gray-200 min-w-[130px]">
                      자산 유형
                    </th>
                    <th className="px-4 py-2.5 text-right text-xs font-semibold border border-gray-200 w-20">
                      목표비율
                    </th>
                    <th className="px-4 py-2.5 text-right text-xs font-semibold border border-gray-200 min-w-[130px]">
                      목표금액
                    </th>
                    <th className="px-4 py-2.5 text-right text-xs font-semibold border border-gray-200 w-20">
                      현재비율
                    </th>
                    <th className="px-4 py-2.5 text-right text-xs font-semibold border border-gray-200 min-w-[130px]">
                      현재 보유금액
                    </th>
                    <th className="px-4 py-2.5 text-right text-xs font-semibold border border-gray-200 min-w-[130px]">
                      조정 필요금액
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {bucket_status.map((b, i) => {
                    const adj    = b.target_amt - b.current_amt   // + 부족(매수), - 초과(매도)
                    const adjAbs = Math.abs(adj)
                    const isBuy  = adj >  50_000   // 5만원 이상 부족 → 매수
                    const isSell = adj < -50_000   // 5만원 이상 초과 → 매도

                    return (
                      <tr key={b.bucket}
                        className={`border border-gray-200 ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'} hover:bg-blue-50/40 transition-colors`}>
                        {/* 자산 유형 */}
                        <td className="px-4 py-3 border border-gray-200">
                          <div className="font-semibold text-gray-800 text-sm">{b.name}</div>
                          <div className="text-[11px] text-gray-400 mt-0.5">{BUCKET_SUB[b.bucket]}</div>
                        </td>
                        {/* 목표비율 */}
                        <td className="px-4 py-3 text-right font-medium text-gray-700 border border-gray-200">
                          {b.target_pct}%
                        </td>
                        {/* 목표금액 */}
                        <td className="px-4 py-3 text-right text-gray-700 border border-gray-200 tabular-nums">
                          {Math.round(b.target_amt).toLocaleString('ko-KR')}
                        </td>
                        {/* 현재비율 */}
                        <td className={`px-4 py-3 text-right font-bold border border-gray-200 ${
                          isBuy  ? 'text-blue-600' :
                          isSell ? 'text-red-500'  : 'text-green-600'
                        }`}>
                          {b.current_pct}%
                        </td>
                        {/* 현재 보유금액 */}
                        <td className="px-4 py-3 text-right font-medium text-gray-800 border border-gray-200 tabular-nums">
                          {Math.round(b.current_amt).toLocaleString('ko-KR')}
                        </td>
                        {/* 조정 필요금액 */}
                        <td className={`px-4 py-3 text-right font-bold border border-gray-200 tabular-nums ${
                          isBuy  ? 'text-blue-600 bg-blue-50'   :
                          isSell ? 'text-red-500 bg-red-50'     : 'text-green-600 bg-green-50'
                        }`}>
                          {isBuy  ? `▲ ${Math.round(adjAbs).toLocaleString('ko-KR')}` :
                           isSell ? `▼ ${Math.round(adjAbs).toLocaleString('ko-KR')}` :
                           '✓ 적정'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-gray-100 border-t-2 border-gray-400 font-bold">
                    <td className="px-4 py-3 text-gray-700 font-bold border border-gray-200">합계</td>
                    <td className="px-4 py-3 text-right text-gray-700 border border-gray-200">100%</td>
                    <td className="px-4 py-3 text-right text-gray-700 border border-gray-200 tabular-nums">
                      {Math.round(total).toLocaleString('ko-KR')}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-700 border border-gray-200">100%</td>
                    <td className="px-4 py-3 text-right text-gray-700 border border-gray-200 tabular-nums">
                      {Math.round(total).toLocaleString('ko-KR')}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-400 border border-gray-200">-</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <p className="text-[11px] text-gray-400 mt-3">
              ▲ 매수 필요 = 목표 대비 부족 · ▼ 매도 필요 = 목표 대비 초과
            </p>
          </div>
        )
      })()}

      {/* ── 버킷 현황 ────────────────────────────────────────────── */}
      <div className="card">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">📊 버킷별 현재 비율 vs 목표</h3>
        <div className="space-y-5">
          {bucket_status.map(b => <BucketBar key={b.bucket} b={b} />)}
        </div>
        <p className="text-[11px] text-gray-400 mt-4 border-t pt-3">
          목표 비율은 <strong>설정 페이지</strong>에서 변경할 수 있습니다.
          수직선(|)이 목표 비율 위치입니다.
        </p>
      </div>

      {/* ── 만기 예정 자산 ────────────────────────────────────────── */}
      <div className="card">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h3 className="text-sm font-semibold text-gray-700">⏳ 만기 예정 자산 (90일 이내)</h3>
          <div className="flex gap-1.5">
            {[
              { key: '30',  label: '30일 이내' },
              { key: '90',  label: '90일 이내' },
              { key: 'all', label: '전체' },
            ].map(f => (
              <button key={f.key}
                onClick={() => setUrgencyFilter(f.key)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                  urgencyFilter === f.key
                    ? 'bg-[#1e3a5f] text-white'
                    : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                }`}>
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="text-center py-10 text-gray-400">
            <span className="text-3xl block mb-2">✅</span>
            {urgencyFilter === '30'
              ? '30일 이내 만기 자산이 없습니다'
              : '해당 기간 내 만기 자산이 없습니다'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs whitespace-nowrap">
              <thead>
                <tr className="bg-gray-50 text-gray-600">
                  <th className="text-left py-2 px-3 font-semibold">자산명</th>
                  <th className="text-left py-2 px-3 font-semibold">계좌</th>
                  <th className="text-right py-2 px-3 font-semibold">평가액</th>
                  <th className="text-center py-2 px-3 font-semibold">만기일</th>
                  <th className="text-center py-2 px-3 font-semibold">잔여</th>
                  <th className="text-center py-2 px-3 font-semibold">긴급도</th>
                  <th className="text-center py-2 px-3 font-semibold">추천 버킷</th>
                  <th className="text-left py-2 px-3 font-semibold">계좌 유형</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(a => {
                  const bStyle = BUCKET_STYLE[a.recommended_bucket] ?? {}
                  return (
                    <tr key={a.id} className="border-t border-gray-100 hover:bg-gray-50">
                      <td className="py-2 px-3 font-semibold text-gray-800">{a.asset_name}</td>
                      <td className="py-2 px-3 text-gray-500">{a.account_name}</td>
                      <td className="py-2 px-3 text-right font-semibold text-gray-800">
                        {fmt.eok(a.current_value)}
                      </td>
                      <td className="py-2 px-3 text-center text-gray-600">{a.maturity_date}</td>
                      <td className="py-2 px-3 text-center font-semibold text-gray-700">
                        {a.days_left}일
                      </td>
                      <td className="py-2 px-3 text-center">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${URGENCY_STYLE[a.urgency]}`}>
                          {a.urgency}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-center">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${bStyle.badge}`}>
                          {a.recommended_bucket} {a.recommended_bucket_name}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-gray-400">
                        {a.is_pension
                          ? <span className="text-blue-500 font-medium">🔒 IRP/연금저축 내 재투자</span>
                          : <span className="text-green-600">↔ 자유롭게 이동 가능</span>
                        }
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="bg-gray-50 border-t-2 border-gray-200">
                  <td colSpan={2} className="py-2 px-3 text-xs font-bold text-gray-600">합계</td>
                  <td className="py-2 px-3 text-right text-xs font-bold text-gray-800">
                    {fmt.eok(filtered.reduce((s, a) => s + a.current_value, 0))}
                  </td>
                  <td colSpan={5} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* ── 추천 상품 ────────────────────────────────────────────── */}
      <div className="card">
        <div className="flex items-start justify-between mb-1 flex-wrap gap-2">
          <div>
            <h3 className="text-sm font-semibold text-gray-700">💡 버킷별 추천 상품 카테고리</h3>
            <p className="text-[11px] text-gray-400 mt-0.5">
              참고용 안내입니다 — 실제 투자 전 최신 금리·수익률·운용 조건을 반드시 확인하세요.
            </p>
          </div>
          {/* 버킷 탭 */}
          <div className="flex gap-1.5">
            {['B1', 'B2', 'B3'].map(bk => {
              const style = BUCKET_STYLE[bk]
              const isPrimary = bk === primary_bucket?.bucket
              return (
                <button key={bk}
                  onClick={() => setSelectedBucket(bk === activeBucket && selectedBucket ? null : bk)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                    activeBucket === bk
                      ? `${style.badge} ${style.border} border`
                      : 'bg-gray-100 text-gray-500 border-transparent hover:bg-gray-200'
                  }`}>
                  {bk} {PRODUCT_CATALOG[bk].label}
                  {isPrimary && <span className="ml-1 text-[10px]">★</span>}
                </button>
              )
            })}
          </div>
        </div>

        {/* 버킷 설명 */}
        {catalog && (
          <div className={`mt-3 mb-4 px-4 py-2.5 rounded-lg text-xs ${BUCKET_STYLE[activeBucket]?.badge}`}>
            <span className="font-semibold">{PRODUCT_CATALOG[activeBucket].label}</span>
            {' — '}
            {PRODUCT_CATALOG[activeBucket].desc}
          </div>
        )}

        {/* 5개 상품 카드 그리드 */}
        {catalog && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
            {catalog.products.map(p => (
              <ProductCard key={p.rank} p={p} />
            ))}
          </div>
        )}
      </div>

      {/* ── 우선순위 안내 박스 ────────────────────────────────────── */}
      <div className="card bg-gray-50">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">🧭 재배분 우선순위 결정 기준</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          <div className="bg-white rounded-lg p-3 border border-blue-100">
            <p className="font-bold text-blue-600 mb-1">1순위 — 안전망 우선</p>
            <p className="text-gray-600">
              B1(현금성) 자산이 생활비 6개월치 미만이면 만기 자산을 B1으로 편입합니다.
              비상금 확보가 포트폴리오 관리의 최우선입니다.
            </p>
          </div>
          <div className="bg-white rounded-lg p-3 border border-green-100">
            <p className="font-bold text-green-600 mb-1">2순위 — 목표 비율 부족 버킷</p>
            <p className="text-gray-600">
              안전망이 충분하면 목표 비율 대비 부족액이 가장 큰 버킷을 우선합니다.
              이를 통해 포트폴리오 목표 배분을 자연스럽게 유지합니다.
            </p>
          </div>
          <div className="bg-white rounded-lg p-3 border border-purple-100">
            <p className="font-bold text-purple-600 mb-1">3순위 — 균형 유지</p>
            <p className="text-gray-600">
              모든 버킷이 목표 비율에 도달한 경우 B2(채권/TDF)로 편입해
              리스크 대비 수익을 안정적으로 유지합니다.
            </p>
          </div>
        </div>

        {/* IRP/연금저축 유의사항 */}
        <div className="mt-3 bg-blue-50 rounded-lg px-4 py-3 text-xs text-blue-800">
          <p className="font-bold mb-1">🔒 IRP / 연금저축 계좌 유의사항</p>
          <p>
            IRP·연금저축 계좌에 있는 자산은 중도 인출 시 세제 혜택이 취소되고 기타소득세가 부과됩니다.
            만기 후 <strong>동일 계좌 내에서 재투자</strong>하는 것을 권장합니다.
            위험자산(주식형 ETF/펀드) 편입 한도는 계좌 잔액의 70%입니다.
          </p>
        </div>

        <p className="text-[10px] text-gray-400 mt-3">
          ⚠ 본 가이드는 포트폴리오 구조 관리 목적의 참고 자료입니다.
          개별 상품 투자 여부는 최신 시장 상황, 금리, 개인 세금 환경을 직접 확인 후 결정하시기 바랍니다.
        </p>
      </div>

    </div>
  )
}
