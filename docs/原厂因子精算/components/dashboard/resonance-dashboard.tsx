"use client"

import { TrendingUp } from "lucide-react"

export function ResonanceDashboard() {
  return (
    <div className="p-3 bg-slate-900/60 rounded-lg border border-slate-700/50 relative">
      {/* 标题 */}
      <div className="flex items-center gap-2 mb-3">
        <div className="w-5 h-5 rounded bg-cyan-500/20 flex items-center justify-center">
          <svg className="w-3.5 h-3.5 text-cyan-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 2L2 7l10 5 10-5-10-5z" />
            <path d="M2 17l10 5 10-5" />
            <path d="M2 12l10 5 10-5" />
          </svg>
        </div>
        <h2 className="text-sm font-semibold text-amber-400">产业链诉求大盘</h2>
        <span className="text-[10px] text-slate-500">(Resonance Dashboard)</span>
      </div>

      {/* 荣誉墙按钮 - 右上角 */}
      <button className="absolute top-3 right-3 px-3 py-1 text-xs bg-amber-500/20 text-amber-400 border border-amber-500/40 rounded hover:bg-amber-500/30 transition-colors">
        荣誉墙
      </button>

      <div className="grid grid-cols-4 gap-3">
        {/* 当前产业链数量 */}
        <div className="p-3 rounded-lg bg-slate-800/40 border border-slate-700/40">
          <p className="text-xs text-slate-400 mb-2">当前产业链共有</p>
          <div className="flex items-baseline gap-1 mb-1">
            <span className="text-4xl font-bold text-amber-400" style={{textShadow: '0 0 20px rgba(251, 191, 36, 0.4)'}}>1,420</span>
            <span className="text-lg text-amber-400">家</span>
          </div>
          <p className="text-[10px] text-slate-500 mb-1">配套中小企业申请您的碳因子背书</p>
          <p className="text-xs text-emerald-400 flex items-center gap-1">
            较上月 <TrendingUp className="w-3 h-3" /> +186 家
          </p>
        </div>

        {/* 预计可挽回金额 */}
        <div className="p-3 rounded-lg bg-slate-800/40 border border-slate-700/40">
          <p className="text-xs text-slate-400 mb-2">预计可为全产业链挽回</p>
          <div className="mb-1">
            <span className="text-3xl font-bold text-amber-400" style={{textShadow: '0 0 20px rgba(251, 191, 36, 0.4)'}}>€128,000,000</span>
          </div>
          <p className="text-[10px] text-slate-500 mb-1">的超额碳税损失</p>
          <p className="text-xs text-emerald-400 flex items-center gap-1">
            较上月增加 €12,800,000 <TrendingUp className="w-3 h-3" />
          </p>
        </div>

        {/* 定海神针 */}
        <div className="p-3 rounded-lg bg-slate-800/40 border border-slate-700/40 flex flex-col items-center justify-center text-center">
          <p className="text-[10px] text-slate-400 leading-tight">您的每一次确权<br/>都是产业链绿色出海的</p>
          
          {/* 盾牌图标 */}
          <div className="relative my-2">
            <svg className="w-14 h-14" viewBox="0 0 80 80">
              <defs>
                <linearGradient id="shieldGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#22c55e" />
                  <stop offset="100%" stopColor="#065f46" />
                </linearGradient>
                <filter id="glow">
                  <feGaussianBlur stdDeviation="2" result="coloredBlur"/>
                  <feMerge>
                    <feMergeNode in="coloredBlur"/>
                    <feMergeNode in="SourceGraphic"/>
                  </feMerge>
                </filter>
              </defs>
              <path 
                d="M40 8 L68 20 L68 40 C68 56 56 68 40 74 C24 68 12 56 12 40 L12 20 Z" 
                fill="url(#shieldGradient)" 
                stroke="#4ade80" 
                strokeWidth="2"
                filter="url(#glow)"
              />
              <path 
                d="M32 40 L38 46 L50 34" 
                fill="none" 
                stroke="#fff" 
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          
          <h3 className="text-xl font-bold text-amber-400" style={{textShadow: '0 0 15px rgba(251, 191, 36, 0.5)'}}>定海神针</h3>
          <p className="text-[10px] text-slate-500">链主担当 · 共赢未来</p>
        </div>

        {/* 诉求行业分布 */}
        <div className="p-3 rounded-lg bg-slate-800/40 border border-slate-700/40">
          <div className="flex items-center gap-2 mb-1">
            <div className="px-1.5 py-0.5 rounded bg-cyan-500/20 border border-cyan-500/30">
              <span className="text-[10px] text-cyan-400">CL-Origin 绿色出海先行者</span>
            </div>
          </div>
          <p className="text-[10px] text-emerald-400 mb-2">首次确权完成</p>
          <p className="text-xs text-slate-400 mb-2">诉求行业分布</p>
          
          {/* 饼图 */}
          <div className="flex items-center gap-3">
            <div className="relative w-16 h-16 flex-shrink-0">
              <svg className="w-full h-full transform -rotate-90" viewBox="0 0 80 80">
                <circle cx="40" cy="40" r="30" fill="none" stroke="#334155" strokeWidth="8" />
                <circle 
                  cx="40" cy="40" r="30" fill="none" 
                  stroke="#3b82f6" strokeWidth="8"
                  strokeDasharray="137.4 188.5"
                />
                <circle 
                  cx="40" cy="40" r="30" fill="none" 
                  stroke="#22d3ee" strokeWidth="8"
                  strokeDasharray="33.9 188.5" strokeDashoffset="-137.4"
                />
                <circle 
                  cx="40" cy="40" r="30" fill="none" 
                  stroke="#10b981" strokeWidth="8"
                  strokeDasharray="17 188.5" strokeDashoffset="-171.3"
                />
              </svg>
            </div>
            <div className="flex flex-col gap-1.5 text-[10px]">
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-sm bg-blue-500" />
                <span className="text-slate-400">钢铁行业</span>
                <span className="text-white font-medium ml-auto">73%</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-sm bg-cyan-400" />
                <span className="text-slate-400">铝业行业</span>
                <span className="text-white font-medium ml-auto">18%</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-sm bg-emerald-500" />
                <span className="text-slate-400">水泥行业</span>
                <span className="text-white font-medium ml-auto">9%</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
