"use client"

import { Shield, FileText, History, Database, Cloud, Lock, CheckCircle2, ArrowRight } from "lucide-react"

export function DataSecuritySection() {
  return (
    <div className="bg-slate-900/60 rounded-lg border border-slate-700/50">
      {/* 数据保密铁律 + 流程图 */}
      <div className="p-3 border-b border-slate-700/40">
        <div className="flex items-center gap-2 mb-3">
          <Lock className="w-4 h-4 text-emerald-400" />
          <h3 className="text-sm font-semibold text-emerald-400">数据保密铁律</h3>
        </div>
        
        {/* 数据流程图 */}
        <div className="flex items-center bg-slate-800/30 rounded-lg p-3">
          {/* 本地数据计算 */}
          <div className="flex items-center gap-2.5 flex-1">
            <div className="w-11 h-11 rounded-lg bg-slate-700/60 border border-slate-600/50 flex items-center justify-center flex-shrink-0">
              <Database className="w-5 h-5 text-slate-300" />
            </div>
            <div>
              <p className="text-xs font-medium text-white">本地数据计算</p>
              <p className="text-[10px] text-slate-500">LOCAL_VAULT</p>
            </div>
          </div>
          
          {/* 箭头1 */}
          <div className="flex items-center gap-1 px-2">
            <div className="w-6 h-[1.5px] bg-gradient-to-r from-slate-600 to-cyan-500/50" />
            <span className="text-[10px] px-1.5 py-0.5 bg-slate-700/60 rounded text-slate-400 border border-slate-600/40 whitespace-nowrap">脱敏</span>
            <ArrowRight className="w-3.5 h-3.5 text-cyan-500/60" />
          </div>
          
          {/* 脱敏存证 */}
          <div className="flex items-center gap-2.5 flex-1">
            <div className="w-11 h-11 rounded-lg bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center flex-shrink-0">
              <Shield className="w-5 h-5 text-cyan-400" />
            </div>
            <div>
              <p className="text-xs font-medium text-white">脱敏存证</p>
              <p className="text-[10px] text-slate-500">仅存计算结果</p>
            </div>
          </div>
          
          {/* 箭头2 */}
          <div className="flex items-center gap-1 px-2">
            <div className="w-6 h-[1.5px] bg-gradient-to-r from-cyan-500/50 to-amber-500/50" />
            <span className="text-[10px] px-1.5 py-0.5 bg-slate-700/60 rounded text-slate-400 border border-slate-600/40 whitespace-nowrap">上链</span>
            <ArrowRight className="w-3.5 h-3.5 text-amber-500/60" />
          </div>
          
          {/* 核验池存证 */}
          <div className="flex items-center gap-2.5 flex-1">
            <div className="w-11 h-11 rounded-lg bg-amber-500/20 border border-amber-500/40 flex items-center justify-center flex-shrink-0">
              <Cloud className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <p className="text-xs font-medium text-white">核验池存证</p>
              <p className="text-[10px] text-slate-500">单位碳强度+同比增减率</p>
            </div>
          </div>
        </div>
        
        <p className="text-[10px] text-slate-500 mt-2 flex items-center gap-1.5">
          <span className="text-amber-500">⚠</span>
          原始工序级数据仅存于本地，计算结果脱敏后存证，绝不上传服务器
        </p>
      </div>

      {/* 操作按钮区域 - 重新设计 */}
      <div className="p-3">
        <div className="grid grid-cols-3 gap-3">
          {/* 确权存入核验池 */}
          <div className="relative group">
            <div className="absolute inset-0 bg-gradient-to-r from-cyan-500/20 to-cyan-400/10 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity" />
            <button className="relative w-full flex items-center gap-3 p-3 rounded-lg bg-gradient-to-br from-cyan-500/15 to-cyan-600/5 border border-cyan-500/40 hover:border-cyan-400/60 transition-all">
              <div className="relative">
                <div className="absolute inset-0 bg-cyan-400/30 rounded-lg blur-md" />
                <div className="relative w-10 h-10 rounded-lg bg-gradient-to-br from-cyan-400/30 to-cyan-600/20 border border-cyan-400/50 flex items-center justify-center">
                  <CheckCircle2 className="w-5 h-5 text-cyan-400" />
                </div>
              </div>
              <div className="flex-1 text-left">
                <p className="text-sm font-semibold text-cyan-400">确权存入核验池</p>
                <p className="text-[10px] text-slate-400 mt-0.5">存入脱敏结果，供产业链共享</p>
              </div>
              <ArrowRight className="w-4 h-4 text-cyan-500/50 group-hover:text-cyan-400 group-hover:translate-x-0.5 transition-all" />
            </button>
          </div>
          
          {/* 导出合规月报 */}
          <div className="relative group">
            <div className="absolute inset-0 bg-gradient-to-r from-slate-500/10 to-slate-400/5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity" />
            <button className="relative w-full flex items-center gap-3 p-3 rounded-lg bg-slate-800/50 border border-slate-600/50 hover:border-slate-500/60 transition-all">
              <div className="relative">
                <div className="w-10 h-10 rounded-lg bg-slate-700/60 border border-slate-600/50 flex items-center justify-center">
                  <FileText className="w-5 h-5 text-slate-300" />
                </div>
              </div>
              <div className="flex-1 text-left">
                <p className="text-sm font-semibold text-white">导出合规月报</p>
                <p className="text-[10px] text-slate-400 mt-0.5">生成 CISA 标准月报 PDF</p>
              </div>
              <ArrowRight className="w-4 h-4 text-slate-500/50 group-hover:text-slate-400 group-hover:translate-x-0.5 transition-all" />
            </button>
          </div>
          
          {/* 查看历史记录 */}
          <div className="relative group">
            <div className="absolute inset-0 bg-gradient-to-r from-slate-500/10 to-slate-400/5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity" />
            <button className="relative w-full flex items-center gap-3 p-3 rounded-lg bg-slate-800/50 border border-slate-600/50 hover:border-slate-500/60 transition-all">
              <div className="relative">
                <div className="w-10 h-10 rounded-lg bg-slate-700/60 border border-slate-600/50 flex items-center justify-center">
                  <History className="w-5 h-5 text-slate-300" />
                </div>
              </div>
              <div className="flex-1 text-left">
                <p className="text-sm font-semibold text-white">查看历史记录</p>
                <p className="text-[10px] text-slate-400 mt-0.5">确权记录与版本管理</p>
              </div>
              <ArrowRight className="w-4 h-4 text-slate-500/50 group-hover:text-slate-400 group-hover:translate-x-0.5 transition-all" />
            </button>
          </div>
        </div>

        {/* 签署承诺书 */}
        <div className="flex items-center justify-between mt-3 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30">
          <div className="flex items-center gap-2">
            <span className="text-amber-500 text-sm">⚠</span>
            <span className="text-xs text-white">操作前需签署《重工业核心数据保密承诺书》</span>
          </div>
          <button className="px-3 py-1.5 rounded border border-slate-500/50 bg-slate-800/60 text-white text-xs hover:bg-slate-700/60 hover:border-slate-400/50 transition-all">
            签署承诺书
          </button>
        </div>
      </div>
    </div>
  )
}
