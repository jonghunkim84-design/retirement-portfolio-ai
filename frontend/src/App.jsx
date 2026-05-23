import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Layout from './components/Layout.jsx'
import Dashboard  from './pages/Dashboard.jsx'
import Assets     from './pages/Assets.jsx'
import RiskScore  from './pages/RiskScore.jsx'
import Rebalance  from './pages/Rebalance.jsx'
import Withdrawal from './pages/Withdrawal.jsx'
import Settings       from './pages/Settings.jsx'
import PensionPlan    from './pages/PensionPlan.jsx'
import ReturnAnalysis from './pages/ReturnAnalysis.jsx'
import CashFlow      from './pages/CashFlow.jsx'
import Income          from './pages/Income.jsx'
import PensionOptimize from './pages/PensionOptimize.jsx'
import NetWorth        from './pages/NetWorth.jsx'
import MaturityGuide   from './pages/MaturityGuide.jsx'

export default function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/"              element={<Dashboard />} />
          <Route path="/assets"        element={<Assets />} />
          <Route path="/risk"          element={<RiskScore />} />
          <Route path="/rebalance"     element={<Rebalance />} />
          <Route path="/withdrawal"    element={<Withdrawal />} />
          <Route path="/pension-plan"  element={<PensionPlan />} />
          <Route path="/returns"       element={<ReturnAnalysis />} />
          <Route path="/networth"        element={<NetWorth />} />
          <Route path="/maturity-guide"  element={<MaturityGuide />} />
          <Route path="/cashflow"      element={<CashFlow />} />
          <Route path="/income"           element={<Income />} />
          <Route path="/pension-optimize" element={<PensionOptimize />} />
          <Route path="/settings"      element={<Settings />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  )
}
