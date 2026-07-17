"use client"

import { Check, TrendingDown } from "lucide-react"

export function CalculationResults() {
  const chartData = [
    { month: "2024-05", value: 2.1 },
    { month: "2024-06", value: 0.8 },
    { month: "2024-07", value: -0.5 },
    { month: "2024-08", value: -2.3 },
    { month: "2024-09", value: -4.1 },
    { month: "2024-10", value: -6.2 },
  ]

  const getYPosition = (value: number) => 50 - (value * 4)

  const points = chartData.map((d, i) => ({
    x: 10 + i * 36,
    y: getYPosition(d.value)
  }))

  const linePath = points.map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`)).join(' ')

  return (
    <div className="p-3 bg-slate-900/60 rounded-lg border border-slate-700/50 h-full flex flex-col">
      {/* 标题 */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-amber-400 text-base">★</span>
          <h3 className="text-sm font-semibold text-white">精算结果</h3>
          <span className="text-[10px] text-slate-500">(本地计算完成)</span>
        </div>
        <div className="w-5 h-5 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center">
          <Check className="w-3 h-3 text-emerald-400" />
        </div>
      </div>

      {/* 主要内容区域 */}
      <div className="flex gap-4 flex-1">
        {/* 左侧 - 仪表盘 */}
        <div className="flex flex-col items-center w-40">
          <p className="text-xs text-slate-400 mb-2">单位产品碳强度</p>
          
          <div className="relative w-28 h-28">
            <svg className="w-full h-full" viewBox="0 0 120 120">
              <defs>
                <linearGradient id="gaugeGradient2" x1="0%" y1="100%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#ef4444" />
                  <stop offset="30%" stopColor="#f59e0b" />
                  <stop offset="60%" stopColor="#22c55e" />
                  <stop offset="100%" stopColor="#06b6d4" />
                </linearGradient>
              </defs>
              <path
                d="M 18 85 A 45 45 0 1 1 102 85"
                fill="none"
                stroke="#1e293b"
                strokeWidth="10"
                strokeLinecap="round"
              />
              <path
                d="M 18 85 A 45 45 0 1 1 102 85"
                fill="none"
                stroke="url(#gaugeGradient2)"
                strokeWidth="10"
                strokeLinecap="round"
                strokeDasharray="220"
                strokeDashoffset="50"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center pt-1">
              <span className="text-3xl font-bold text-emerald-400" style={{textShadow: '0 0 15px rgba(52, 211, 153, 0.5)'}}>
                1.842
              </span>
              <span className="text-[10px] text-slate-400">tCO₂e/吨钢</span>
            </div>
          </div>

          <div className="flex items-center gap-6 mt-2 w-full justify-center">
            <div className="text-center">
              <p className="text-[10px] text-slate-500">行业对标</p>
              <p className="text-lg font-bold text-white">2.156</p>
            </div>
            <div className="text-center">
              <p className="text-[10px] text-slate-500">优秀水平</p>
              <p className="text-lg font-bold text-cyan-400">1.650</p>
            </div>
          </div>
        </div>

        {/* 右侧 - 同比增减率图表 */}
        <div className="flex-1 flex flex-col">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs font-medium text-white">同比增减率</h4>
            <div className="flex items-center gap-1 text-emerald-400">
              <span className="text-xl font-bold">-6.20%</span>
              <TrendingDown className="w-4 h-4" />
            </div>
          </div>
          
          <div className="relative flex-1 min-h-[90px]">
            <div className="absolute left-0 top-0 bottom-0 w-6 flex flex-col justify-between text-[9px] text-slate-500">
              <span>10%</span>
              <span className="text-slate-400">0%</span>
              <span>-10%</span>
            </div>
            
            <div className="ml-7 h-full relative border-l border-b border-slate-700/50">
              <svg className="w-full h-full" viewBox="0 0 200 100" preserveAspectRatio="none">
                <line x1="0" y1="10" x2="200" y2="10" stroke="#334155" strokeWidth="0.5" strokeDasharray="3 3" />
                <line x1="0" y1="50" x2="200" y2="50" stroke="#475569" strokeWidth="0.8" />
                <line x1="0" y1="90" x2="200" y2="90" stroke="#334155" strokeWidth="0.5" strokeDasharray="3 3" />
                
                <defs>
                  <linearGradient id="areaGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stopColor="#22c55e" stopOpacity="0.3" />
                    <stop offset="100%" stopColor="#22c55e" stopOpacity="0.02" />
                  </linearGradient>
                </defs>
                
                <path
                  d={`M ${points[0].x} ${points[0].y} ${points.slice(1).map(p => `L ${p.x} ${p.y}`).join(' ')} L ${points[points.length - 1].x} 50 L ${points[0].x} 50 Z`}
                  fill="url(#areaGrad)"
                />
                
                <path
                  d={linePath}
                  fill="none"
                  stroke="#22c55e"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                
                {points.map((point, i) => (
                  <g key={i}>
                    <circle cx={point.x} cy={point.y} r="5" fill="#22c55e" opacity="0.2" />
                    <circle cx={point.x} cy={point.y} r="3" fill="#0f172a" stroke="#22c55e" strokeWidth="1.5" />
                  </g>
                ))}
              </svg>
            </div>
          </div>
          
          <div className="flex justify-between text-[8px] text-slate-500 mt-1 ml-7">
            {chartData.map((d) => (
              <span key={d.month}>{d.month.slice(5)}</span>
            ))}
          </div>
        </div>
      </div>

      {/* 碳排放结构占比 */}
      <div className="mt-3 pt-3 border-t border-slate-700/30">
        <h4 className="text-xs font-medium text-white mb-2">碳排放结构占比</h4>
        <div className="h-3 rounded overflow-hidden flex bg-slate-800/60">
          <div className="bg-blue-500 h-full" style={{ width: "62%" }} />
          <div className="bg-emerald-500 h-full" style={{ width: "28%" }} />
          <div className="bg-red-500 h-full" style={{ width: "10%" }} />
        </div>
        <div className="flex items-center gap-5 mt-2 text-[10px]">
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm bg-blue-500" />
            <span className="text-slate-400">直接排放</span>
            <span className="text-white font-medium">62%</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm bg-emerald-500" />
            <span className="text-slate-400">间接排放</span>
            <span className="text-white font-medium">28%</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm bg-red-500" />
            <span className="text-slate-400">工艺排放</span>
            <span className="text-white font-medium">10%</span>
          </div>
        </div>
      </div>
    </div>
  )
}
