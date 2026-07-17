"use client"

import { useState } from "react"
import { ChevronDown, FileUp, Trash2 } from "lucide-react"

interface ProcessStep {
  id: number
  name: string
  icon: string
}

interface ProcessData {
  production: string
  energyConsumption: string
  emissionFactor: string
  carbonEmission: string
}

// 钢铁行业工序
const steelProcessSteps: ProcessStep[] = [
  { id: 1, name: "焦化", icon: "焦" },
  { id: 2, name: "球团", icon: "球" },
  { id: 3, name: "烧结", icon: "烧" },
  { id: 4, name: "炼铁", icon: "铁" },
  { id: 5, name: "炼钢", icon: "钢" },
  { id: 6, name: "转炉", icon: "转" },
  { id: 7, name: "电炉", icon: "电" },
  { id: 8, name: "轧烧等", icon: "轧" },
  { id: 9, name: "其他工序", icon: "他" },
]

// 铝业行业工序
const aluminumProcessSteps: ProcessStep[] = [
  { id: 1, name: "采矿", icon: "矿" },
  { id: 2, name: "氧化铝", icon: "氧" },
  { id: 3, name: "电解", icon: "电" },
  { id: 4, name: "熔铸", icon: "熔" },
  { id: 5, name: "轧制", icon: "轧" },
  { id: 6, name: "挤压", icon: "挤" },
  { id: 7, name: "表面处理", icon: "表" },
  { id: 8, name: "其他工序", icon: "他" },
]

// 水泥行业工序
const cementProcessSteps: ProcessStep[] = [
  { id: 1, name: "原料开采", icon: "采" },
  { id: 2, name: "破碎", icon: "碎" },
  { id: 3, name: "生料制备", icon: "生" },
  { id: 4, name: "预热器", icon: "热" },
  { id: 5, name: "回转窑", icon: "窑" },
  { id: 6, name: "冷却", icon: "冷" },
  { id: 7, name: "粉磨", icon: "磨" },
  { id: 8, name: "包装", icon: "包" },
]

// 钢铁行业数据
const steelInitialData: Record<number, ProcessData> = {
  1: { production: "850,000", energyConsumption: "3.42", emissionFactor: "0.094", carbonEmission: "275,934" },
  2: { production: "1,020,000", energyConsumption: "1.15", emissionFactor: "0.094", carbonEmission: "110,058" },
  3: { production: "980,000", energyConsumption: "1.25", emissionFactor: "0.094", carbonEmission: "115,472" },
  4: { production: "1,150,000", energyConsumption: "13.85", emissionFactor: "0.085", carbonEmission: "1,362,738" },
  5: { production: "1,120,000", energyConsumption: "7.65", emissionFactor: "0.085", carbonEmission: "1,190,680" },
  6: { production: "680,000", energyConsumption: "5.32", emissionFactor: "0.085", carbonEmission: "894,468" },
  7: { production: "320,000", energyConsumption: "4.18", emissionFactor: "0.512", carbonEmission: "1,460,313" },
  8: { production: "210,000", energyConsumption: "1.08", emissionFactor: "0.085", carbonEmission: "19,134" },
  9: { production: "", energyConsumption: "", emissionFactor: "", carbonEmission: "" },
}

// 铝业行业数据
const aluminumInitialData: Record<number, ProcessData> = {
  1: { production: "2,500,000", energyConsumption: "0.85", emissionFactor: "0.045", carbonEmission: "95,625" },
  2: { production: "1,800,000", energyConsumption: "12.50", emissionFactor: "0.092", carbonEmission: "2,070,000" },
  3: { production: "920,000", energyConsumption: "52.80", emissionFactor: "0.095", carbonEmission: "4,614,720" },
  4: { production: "890,000", energyConsumption: "2.35", emissionFactor: "0.085", carbonEmission: "177,818" },
  5: { production: "780,000", energyConsumption: "1.68", emissionFactor: "0.085", carbonEmission: "111,384" },
  6: { production: "650,000", energyConsumption: "1.25", emissionFactor: "0.085", carbonEmission: "69,063" },
  7: { production: "620,000", energyConsumption: "0.92", emissionFactor: "0.078", carbonEmission: "44,491" },
  8: { production: "", energyConsumption: "", emissionFactor: "", carbonEmission: "" },
}

// 水泥行业数据
const cementInitialData: Record<number, ProcessData> = {
  1: { production: "3,200,000", energyConsumption: "0.45", emissionFactor: "0.035", carbonEmission: "50,400" },
  2: { production: "3,150,000", energyConsumption: "0.65", emissionFactor: "0.042", carbonEmission: "85,995" },
  3: { production: "3,000,000", energyConsumption: "1.85", emissionFactor: "0.088", carbonEmission: "488,400" },
  4: { production: "2,850,000", energyConsumption: "0.95", emissionFactor: "0.092", carbonEmission: "249,090" },
  5: { production: "2,800,000", energyConsumption: "3.25", emissionFactor: "0.520", carbonEmission: "4,732,000" },
  6: { production: "2,780,000", energyConsumption: "0.35", emissionFactor: "0.045", carbonEmission: "43,785" },
  7: { production: "2,650,000", energyConsumption: "1.45", emissionFactor: "0.088", carbonEmission: "338,195" },
  8: { production: "2,600,000", energyConsumption: "0.15", emissionFactor: "0.025", carbonEmission: "9,750" },
}

const tabs = [
  { id: "steel", name: "钢铁行业工序矩阵", icon: "🏭" },
  { id: "aluminum", name: "铝业行业工序矩阵", icon: "🔲" },
  { id: "cement", name: "水泥行业工序矩阵", icon: "🏗" },
]

const industryConfig = {
  steel: { steps: steelProcessSteps, data: steelInitialData },
  aluminum: { steps: aluminumProcessSteps, data: aluminumInitialData },
  cement: { steps: cementProcessSteps, data: cementInitialData },
}

export function ProcessMatrix() {
  const [activeTab, setActiveTab] = useState<"steel" | "aluminum" | "cement">("steel")
  const [steelData, setSteelData] = useState(steelInitialData)
  const [aluminumData, setAluminumData] = useState(aluminumInitialData)
  const [cementData, setCementData] = useState(cementInitialData)

  const currentSteps = industryConfig[activeTab].steps
  const currentData = activeTab === "steel" ? steelData : activeTab === "aluminum" ? aluminumData : cementData
  const setCurrentData = activeTab === "steel" ? setSteelData : activeTab === "aluminum" ? setAluminumData : setCementData

  const handleInputChange = (stepId: number, field: keyof ProcessData, value: string) => {
    setCurrentData(prev => ({
      ...prev,
      [stepId]: {
        ...prev[stepId],
        [field]: value
      }
    }))
  }

  return (
    <div className="bg-slate-900/60 rounded-lg border border-slate-700/50 h-full">
      {/* 标签栏 */}
      <div className="flex items-center justify-between px-3 pt-2 pb-0 border-b border-slate-700/50">
        <div className="flex">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as "steel" | "aluminum" | "cement")}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs transition-colors relative ${
                activeTab === tab.id
                  ? "text-cyan-400 bg-slate-800/60"
                  : "text-slate-400 hover:text-white hover:bg-slate-800/30"
              }`}
              style={activeTab === tab.id ? {
                borderTop: '2px solid #22d3ee',
                borderLeft: '1px solid #334155',
                borderRight: '1px solid #334155',
                borderBottom: '1px solid transparent',
                marginBottom: '-1px',
                borderTopLeftRadius: '4px',
                borderTopRightRadius: '4px',
              } : {}}
            >
              <span className="text-sm">{tab.icon}</span>
              <span>{tab.name}</span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 pb-2">
          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            <span>数据周期:</span>
            <button className="flex items-center gap-1 px-2 py-1 rounded bg-slate-800/60 border border-slate-600/50 text-white hover:bg-slate-700/60 transition-colors text-[10px]">
              2024年10月 <ChevronDown className="w-3 h-3" />
            </button>
          </div>
          <button className="flex items-center gap-1 px-2 py-1 rounded bg-slate-800/60 border border-slate-600/50 text-slate-300 text-[10px] hover:bg-slate-700/60 transition-colors">
            <FileUp className="w-3 h-3" /> 导入模板
          </button>
          <button className="flex items-center gap-1 px-2 py-1 rounded bg-slate-800/60 border border-slate-600/50 text-slate-300 text-[10px] hover:bg-slate-700/60 transition-colors">
            <Trash2 className="w-3 h-3" /> 清空本地数据
          </button>
        </div>
      </div>

      <div className="p-3">
        {/* 工序流程图 */}
        <div className="flex items-center justify-start gap-0.5 mb-3 pb-3 border-b border-slate-700/30 overflow-x-auto">
          {currentSteps.map((step, index) => (
            <div key={step.id} className="flex items-center flex-shrink-0">
              <div className="flex flex-col items-center">
                <div className="relative">
                  <span className="absolute -top-0.5 -left-0.5 w-3.5 h-3.5 bg-cyan-500 text-slate-900 text-[8px] font-bold rounded-full flex items-center justify-center z-10">
                    {step.id}
                  </span>
                  <div className="w-9 h-9 rounded-lg bg-slate-800/80 border border-slate-600/50 flex items-center justify-center">
                    <div className="w-6 h-6 rounded bg-slate-700/60 flex items-center justify-center">
                      <span className="text-xs text-slate-300">{step.icon}</span>
                    </div>
                  </div>
                </div>
                <span className="text-[9px] text-slate-400 mt-1 whitespace-nowrap">{step.name}</span>
              </div>
              {index < currentSteps.length - 1 && (
                <div className="flex items-center mx-0.5 mb-4">
                  <div className="w-3 h-[1px] bg-slate-600" />
                  <div className="w-0 h-0 border-t-[2px] border-t-transparent border-b-[2px] border-b-transparent border-l-[3px] border-l-slate-600" />
                </div>
              )}
            </div>
          ))}
        </div>

        {/* 数据表格 */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-700/50">
                <th className="text-left py-2 px-1.5 text-slate-400 font-medium w-20 text-[10px]">参数类别</th>
                {currentSteps.map((step) => (
                  <th key={step.id} className="text-center py-2 px-0.5 text-slate-500 font-normal text-[9px] min-w-[70px]">
                    产量(吨)
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-slate-700/30">
                <td className="py-1.5 px-1.5 text-slate-400 text-[10px]">产量 (吨)</td>
                {currentSteps.map((step) => (
                  <td key={step.id} className="text-center py-1 px-0.5">
                    <input
                      type="text"
                      value={currentData[step.id]?.production || ''}
                      onChange={(e) => handleInputChange(step.id, 'production', e.target.value)}
                      className="w-full text-center py-1 px-0.5 bg-slate-800/60 border border-slate-600/40 rounded text-white text-[10px] font-mono focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/30"
                      placeholder="-"
                    />
                  </td>
                ))}
              </tr>
              <tr className="border-b border-slate-700/30">
                <td className="py-1.5 px-1.5 text-slate-400 text-[10px]">
                  <div>综合能耗</div>
                  <div className="text-[8px] text-slate-500">(GJ/吨)</div>
                </td>
                {currentSteps.map((step) => (
                  <td key={step.id} className="text-center py-1 px-0.5">
                    <input
                      type="text"
                      value={currentData[step.id]?.energyConsumption || ''}
                      onChange={(e) => handleInputChange(step.id, 'energyConsumption', e.target.value)}
                      className="w-full text-center py-1 px-0.5 bg-slate-800/60 border border-slate-600/40 rounded text-white text-[10px] font-mono focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/30"
                      placeholder="-"
                    />
                  </td>
                ))}
              </tr>
              <tr className="border-b border-slate-700/30">
                <td className="py-1.5 px-1.5 text-slate-400 text-[10px]">
                  <div>碳排放因子</div>
                  <div className="text-[8px] text-slate-500">(tCO₂e/GJ)</div>
                </td>
                {currentSteps.map((step) => (
                  <td key={step.id} className="text-center py-1 px-0.5">
                    <input
                      type="text"
                      value={currentData[step.id]?.emissionFactor || ''}
                      onChange={(e) => handleInputChange(step.id, 'emissionFactor', e.target.value)}
                      className="w-full text-center py-1 px-0.5 bg-slate-800/60 border border-slate-600/40 rounded text-white text-[10px] font-mono focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/30"
                      placeholder="-"
                    />
                  </td>
                ))}
              </tr>
              <tr className="border-b border-slate-700/30">
                <td className="py-1.5 px-1.5 text-slate-400 text-[10px]">
                  <div>碳排放量</div>
                  <div className="text-[8px] text-slate-500">(tCO₂e)</div>
                </td>
                {currentSteps.map((step) => (
                  <td key={step.id} className="text-center py-1 px-0.5">
                    <div className="py-1 px-0.5 text-amber-400 text-[10px] font-mono font-medium">
                      {currentData[step.id]?.carbonEmission || '-'}
                    </div>
                  </td>
                ))}
              </tr>
              <tr>
                <td className="py-1.5 px-1.5 text-slate-400 text-[10px]">操作</td>
                {currentSteps.map((step) => (
                  <td key={step.id} className="text-center py-1 px-0.5">
                    <button className="px-1.5 py-1 text-[9px] bg-cyan-500/20 text-cyan-400 rounded border border-cyan-500/40 hover:bg-cyan-500/30 hover:border-cyan-400/60 transition-all font-medium whitespace-nowrap">
                      自动计算
                    </button>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>

        <p className="text-[9px] text-slate-500 mt-2 flex items-center gap-1">
          <span className="text-amber-500">⚠</span>
          所有原始能耗数据仅保存在本地浏览器，不会上传服务器
        </p>
      </div>
    </div>
  )
}
