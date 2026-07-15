import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import Layout        from './components/Layout.jsx'
import Login         from './pages/Login.jsx'
import Dashboard     from './pages/Dashboard.jsx'
import Assets        from './pages/Assets.jsx'
import RiskScore     from './pages/RiskScore.jsx'
import Rebalance     from './pages/Rebalance.jsx'
import Withdrawal    from './pages/Withdrawal.jsx'
import Settings      from './pages/Settings.jsx'
import PensionPlan   from './pages/PensionPlan.jsx'
import ReturnAnalysis from './pages/ReturnAnalysis.jsx'
import CashFlow      from './pages/CashFlow.jsx'
import Income        from './pages/Income.jsx'
import Expenses      from './pages/Expenses.jsx'
import PensionOptimize from './pages/PensionOptimize.jsx'
import NetWorth      from './pages/NetWorth.jsx'
import AIAdvisor      from './pages/AIAdvisor.jsx'
import PensionTax      from './pages/PensionTax.jsx'
import HealthInsurance from './pages/HealthInsurance.jsx'
import WithdrawalStrategy from './pages/WithdrawalStrategy.jsx'
import RealAssets from './pages/RealAssets.jsx'
import EstatePlan from './pages/EstatePlan.jsx'

// 로그인하지 않으면 /login 으로 리다이렉트
function ProtectedLayout() {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#1e3a5f]">
        <div className="text-center">
          <div className="text-4xl mb-4">🏦</div>
          <div className="text-white/60 text-sm">불러오는 중...</div>
        </div>
      </div>
    )
  }

  if (!user) return <Navigate to="/login" replace />

  return (
    <Layout>
      <Outlet />
    </Layout>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* 공개 라우트 */}
          <Route path="/login" element={<Login />} />

          {/* 보호 라우트 — 로그인 필요 */}
          <Route element={<ProtectedLayout />}>
            <Route path="/"                 element={<Dashboard />} />
            <Route path="/assets"           element={<Assets />} />
            <Route path="/real-assets"      element={<RealAssets />} />
            <Route path="/risk"             element={<RiskScore />} />
            <Route path="/rebalance"        element={<Rebalance />} />
            <Route path="/withdrawal"       element={<Withdrawal />} />
            <Route path="/pension-plan"     element={<PensionPlan />} />
            <Route path="/returns"          element={<ReturnAnalysis />} />
            <Route path="/networth"         element={<NetWorth />} />
            <Route path="/cashflow"         element={<CashFlow />} />
            <Route path="/income"           element={<Income />} />
            <Route path="/expenses"         element={<Expenses />} />
            <Route path="/pension-optimize" element={<PensionOptimize />} />
            <Route path="/ai-advisor"       element={<AIAdvisor />} />
            <Route path="/pension-tax"       element={<PensionTax />} />
            <Route path="/health-insurance" element={<HealthInsurance />} />
            <Route path="/withdrawal-strategy" element={<WithdrawalStrategy />} />
            <Route path="/estate-plan"      element={<EstatePlan />} />
            <Route path="/settings"         element={<Settings />} />
          </Route>

          {/* 없는 경로 → 홈으로 */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
