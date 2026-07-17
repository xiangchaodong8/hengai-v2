import { DashboardHeader } from "@/components/dashboard/header"
import { ResonanceDashboard } from "@/components/dashboard/resonance-dashboard"
import { ProcessMatrix } from "@/components/dashboard/process-matrix"
import { CalculationResults } from "@/components/dashboard/calculation-results"
import { DataSecuritySection } from "@/components/dashboard/data-security"
import { DashboardFooter } from "@/components/dashboard/footer"

export default function IndustrialDashboard() {
  return (
    <div className="min-h-screen bg-slate-950 relative overflow-hidden">
      {/* 背景网格 */}
      <div 
        className="absolute inset-0 opacity-20"
        style={{
          backgroundImage: `
            linear-gradient(rgba(30, 41, 59, 0.6) 1px, transparent 1px),
            linear-gradient(90deg, rgba(30, 41, 59, 0.6) 1px, transparent 1px)
          `,
          backgroundSize: '50px 50px'
        }}
      />
      
      {/* 渐变光晕效果 */}
      <div className="absolute top-0 left-1/4 w-72 h-72 bg-cyan-500/8 rounded-full blur-3xl" />
      <div className="absolute top-1/3 right-1/4 w-64 h-64 bg-blue-500/8 rounded-full blur-3xl" />
      
      <div className="relative z-10">
        <DashboardHeader />
        
        <main className="px-4 py-3 space-y-3 max-w-[1920px] mx-auto">
          {/* 产业链诉求大盘 */}
          <ResonanceDashboard />

          {/* 工序矩阵和精算结果 - 并排布局 */}
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-3">
            <div className="xl:col-span-7">
              <ProcessMatrix />
            </div>
            <div className="xl:col-span-5">
              <CalculationResults />
            </div>
          </div>

          {/* 数据保密铁律 */}
          <DataSecuritySection />
        </main>

        <DashboardFooter />
      </div>
    </div>
  )
}
