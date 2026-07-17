"use client"

import { Shield, Bell, ChevronDown } from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"

export function DashboardHeader() {
  return (
    <header className="flex items-center justify-between px-6 py-3 border-b border-cyan-500/20 bg-slate-900/80 backdrop-blur-sm">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded bg-gradient-to-br from-cyan-500/30 to-blue-500/30 flex items-center justify-center border border-cyan-500/30">
            <svg className="w-6 h-6 text-cyan-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="7" height="7" rx="1" />
              <rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" />
              <rect x="14" y="14" width="7" height="7" rx="1" />
            </svg>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-white tracking-wide">
                工业原厂·因子精算
              </h1>
              <span className="text-sm px-2 py-0.5 rounded bg-amber-500/20 text-amber-400 border border-amber-500/40">
                战情室
              </span>
            </div>
            <p className="text-xs text-slate-500 tracking-wider">INDUSTRIAL ORIGIN · FACTOR AUDIT SUITE</p>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-800/60 border border-slate-700/50">
          <Shield className="w-4 h-4 text-cyan-400" />
          <span className="text-sm text-slate-300">数据主权受控模式</span>
        </div>
        
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/30">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-sm text-emerald-400">本地计算中</span>
        </div>
        
        <div className="relative cursor-pointer">
          <Bell className="w-5 h-5 text-slate-400 hover:text-white transition-colors" />
          <span className="absolute -top-1 -right-1 w-4 h-4 bg-amber-500 text-slate-900 text-xs font-bold rounded-full flex items-center justify-center">
            12
          </span>
        </div>

        <div className="flex items-center gap-3 cursor-pointer hover:bg-slate-800/40 px-3 py-2 rounded-lg transition-colors">
          <Avatar className="w-9 h-9 border-2 border-cyan-500/40">
            <AvatarFallback className="bg-gradient-to-br from-cyan-500/30 to-blue-600/30 text-cyan-300 text-sm font-medium">
              宝武
            </AvatarFallback>
          </Avatar>
          <div className="text-right">
            <p className="text-sm font-medium text-white">宝武钢铁集团</p>
            <p className="text-xs text-slate-500">能源管理部 · Lv.5</p>
          </div>
          <ChevronDown className="w-4 h-4 text-slate-500" />
        </div>
      </div>
    </header>
  )
}
