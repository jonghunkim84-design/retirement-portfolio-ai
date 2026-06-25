import { supabase } from '../lib/supabase'

export async function getLatestHealthInsuranceSimulation(userId) {
  const { data } = await supabase
    .from('health_insurance_simulations')
    .select('total_monthly, total_annual, is_dependent_eligible, created_at, label')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  return data ?? null
}
