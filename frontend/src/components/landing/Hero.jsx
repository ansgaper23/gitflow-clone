import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Sparkles, ArrowRight, ArrowUp, Bot, User, LayoutDashboard, LineChart as ChartIcon, Settings, Search, Menu, Bell } from 'lucide-react'

const SUGGESTIONS = [
  'Una plataforma de cursos online',
  'Un dashboard de ventas',
  'Una app de gestión de inventario',
]

const lovableGradient = "bg-[linear-gradient(to_right,#4F88FF_0%,#B0ACFE_28.57%,#FB65C2_47.62%,#FD2980_57.14%,#FF8F1B_100%)]"

export default function Hero() {
  const navigate = useNavigate()
  const [prompt, setPrompt] = useState('')

  const start = (e) => {
    e?.preventDefault()
    if (prompt.trim()) sessionStorage.setItem('gitflow_pending_prompt', prompt.trim())
    navigate('/auth')
  }

  return (
    <section className="relative mx-auto w-full max-w-7xl px-4 pt-32 pb-16 text-center sm:pt-40 lg:pt-48">

      <h1 className="hero-fade-in hero-fade-in-2 mx-auto mt-8 max-w-5xl text-[3rem] leading-[1.05] font-semibold tracking-[-0.02em] text-white sm:text-[4.5rem]">
        Creador de aplicaciones <br className="hidden sm:block" />
        <span className="text-transparent bg-clip-text bg-[linear-gradient(to_right,#4F88FF_0%,#B0ACFE_28.57%,#FB65C2_47.62%,#FD2980_57.14%,#FF8F1B_100%)]">
          con IA
        </span>
      </h1>

      <p className="hero-fade-in hero-fade-in-3 mx-auto mt-6 max-w-2xl text-[1.1rem] leading-relaxed text-white/80">
        Da vida a un nuevo producto, una herramienta interna o una empresa entera. Si puedes describirlo, puedes crearlo.
      </p>

      <form onSubmit={start} className="hero-fade-in hero-fade-in-4 mx-auto mt-12 max-w-3xl relative z-10">
        <div className="relative flex flex-col rounded-3xl bg-white/10 backdrop-blur-md shadow-2xl transition-[border-color,box-shadow] duration-300 border border-white/20 focus-within:border-white/40">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) start(e)
            }}
            placeholder="¿Qué quieres crear hoy?"
            rows={2}
            className="w-full resize-none bg-transparent px-6 pt-6 pb-4 text-lg text-white outline-none placeholder:text-white/50"
          />
          <div className="flex items-center justify-between px-4 pb-4 pt-2">
            <div className="flex gap-2"></div>
            <button
              type="submit"
              className={`press flex items-center justify-center size-10 rounded-full text-white transition-all hover:scale-[1.05] active:scale-95 ${lovableGradient}`}
            >
              <ArrowUp className="size-5" />
            </button>
          </div>
        </div>
      </form>

      <div className="hero-fade-in hero-fade-in-5 mx-auto mt-6 flex max-w-2xl flex-wrap items-center justify-center gap-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setPrompt(s)}
            className="press rounded-full border border-white/10 bg-white/5 px-4 py-2 text-[13px] font-medium text-white/70 transition-all hover:bg-white/10 hover:text-white"
          >
            {s}
          </button>
        ))}
      </div>

      {/* App Showcase Preview */}
      <div className="hero-fade-in hero-fade-in-6 relative mx-auto mt-24 max-w-5xl text-left">
        <div className="relative rounded-[1.5rem] border border-white/20 bg-[#0a0a0a]/90 shadow-2xl backdrop-blur-xl overflow-hidden ring-1 ring-white/10">
          {/* Mockup Header (Browser style) */}
          <div className="flex items-center gap-4 border-b border-white/10 bg-[#161616] px-4 py-3">
            <div className="flex gap-1.5">
              <div className="size-3 rounded-full bg-[#ff5f56]" />
              <div className="size-3 rounded-full bg-[#ffbd2e]" />
              <div className="size-3 rounded-full bg-[#27c93f]" />
            </div>
            <div className="flex-1 flex justify-center">
              <div className="flex h-7 w-64 items-center justify-center rounded-md bg-[#222] border border-white/5 text-[11px] text-white/40 font-mono">
                flow-pro.online/preview
              </div>
            </div>
            <div className="w-12"></div> {/* Spacer for center alignment */}
          </div>

          {/* Mockup Body: Split view (Chat + IDE/Preview) */}
          <div className="flex aspect-[16/9] w-full bg-[#0d0d0d] overflow-hidden">
             
             {/* Left: AI Chat Interface */}
             <div className="w-[32%] shrink-0 border-r border-white/10 bg-[#141414] flex flex-col relative z-10">
                
                {/* Chat Header */}
                <div className="h-12 border-b border-white/5 flex items-center px-4 gap-2">
                   <div className="flex items-center justify-center size-6 rounded-full bg-gradient-to-r from-[#4F88FF] to-[#FB65C2]">
                      <Bot className="size-3.5 text-white" />
                   </div>
                   <span className="text-xs font-semibold text-white/90">FlowPro</span>
                </div>

                <div className="flex-1 p-4 flex flex-col gap-5 overflow-hidden">
                   
                   {/* User message */}
                   <div className="self-end flex gap-2 max-w-[90%]">
                      <div className="bg-[#2a2a2a] rounded-2xl rounded-tr-sm px-3.5 py-2.5 text-[11px] text-white/90 leading-relaxed shadow-sm">
                         Crea un dashboard de ventas moderno con modo oscuro.
                      </div>
                      <div className="flex-shrink-0 size-6 rounded-full bg-white/10 flex items-center justify-center">
                         <User className="size-3.5 text-white/60" />
                      </div>
                   </div>

                   {/* AI message */}
                   <div className="self-start flex gap-2 max-w-[95%]">
                      <div className="flex-shrink-0 size-6 rounded-full bg-gradient-to-r from-[#4F88FF] to-[#FB65C2] flex items-center justify-center shadow-sm">
                         <Bot className="size-3.5 text-white" />
                      </div>
                      <div className="flex flex-col gap-2">
                         <div className="bg-white/5 border border-white/10 shadow-sm rounded-2xl rounded-tl-sm px-3.5 py-2.5">
                            <span className="text-[11px] text-white/90">¡Claro! Iniciando el entorno y generando los componentes...</span>
                         </div>
                         
                         {/* Code Block Mock */}
                         <div className="w-full bg-[#0a0a0a] rounded-xl p-3 border border-white/10 font-mono text-[10px] shadow-inner relative overflow-hidden">
                            {/* Glowing line indicator */}
                            <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-gradient-to-b from-[#4F88FF] to-[#FB65C2]"></div>
                            
                            <div className="flex items-center gap-2 mb-2 pb-2 border-b border-white/5">
                               <Sparkles className="size-3 text-[#FB65C2]" />
                               <span className="text-white/40">Dashboard.jsx</span>
                            </div>
                            <div className="text-white/70 leading-relaxed">
                               <span className="text-[#ff7b72]">export default function</span> <span className="text-[#79c0ff]">Dashboard</span>() {'{'}<br/>
                               &nbsp;&nbsp;<span className="text-[#ff7b72]">return</span> (<br/>
                               &nbsp;&nbsp;&nbsp;&nbsp;&lt;<span className="text-[#7ee787]">div</span> <span className="text-[#a5d6ff]">className</span>=<span className="text-[#a5d6ff]">"flex h-screen bg-[#0a0a0a]"</span>&gt;<br/>
                               &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{'{'}/* Sidebar */{'}'}<br/>
                               &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&lt;<span className="text-[#7ee787]">Sidebar</span> /&gt;<br/>
                               &nbsp;&nbsp;&nbsp;&nbsp;&lt;/<span className="text-[#7ee787]">div</span>&gt;<br/>
                               &nbsp;&nbsp;)<br/>
                               {'}'}
                            </div>
                         </div>
                      </div>
                   </div>
                </div>

                {/* Chat Input Mock */}
                <div className="p-3 border-t border-white/5 bg-[#141414]">
                   <div className="h-9 w-full bg-[#222] border border-white/10 rounded-xl flex items-center px-3 justify-between">
                      <span className="text-[11px] text-white/40">Haz un cambio...</span>
                      <div className="size-5 rounded-full bg-white/10 flex items-center justify-center">
                        <ArrowUp className="size-3 text-white/50" />
                      </div>
                   </div>
                </div>
             </div>

             {/* Right: Realistic App Preview */}
             <div className="w-[68%] bg-[#0f1115] relative flex">
                
                {/* Fake App Sidebar */}
                <div className="w-16 border-r border-white/5 bg-[#16181d] flex flex-col items-center py-4 gap-6">
                   <div className="size-8 rounded-lg bg-gradient-to-br from-[#4F88FF] to-[#FB65C2] mb-4"></div>
                   <LayoutDashboard className="size-5 text-white/90" />
                   <ChartIcon className="size-5 text-white/30" />
                   <Settings className="size-5 text-white/30 mt-auto" />
                </div>

                {/* Fake App Main Content */}
                <div className="flex-1 flex flex-col">
                   {/* App Navbar */}
                   <div className="h-14 border-b border-white/5 flex items-center px-6 justify-between bg-[#16181d]/50">
                      <div className="flex items-center gap-2 bg-[#222] rounded-lg px-3 py-1.5 border border-white/5">
                         <Search className="size-3.5 text-white/40" />
                         <span className="text-[11px] text-white/40">Buscar métricas...</span>
                      </div>
                      <div className="flex items-center gap-4">
                         <Bell className="size-4 text-white/50" />
                         <div className="size-7 rounded-full bg-white/10 border border-white/20"></div>
                      </div>
                   </div>

                   {/* App Dashboard Widgets */}
                   <div className="flex-1 p-6 flex flex-col gap-6">
                      <div className="flex items-center justify-between">
                         <div className="text-lg font-semibold text-white/90">Resumen Financiero</div>
                         <div className="h-7 w-24 bg-white/5 rounded-md border border-white/10"></div>
                      </div>

                      {/* KPI Cards */}
                      <div className="grid grid-cols-3 gap-4">
                         {[
                           { label: "Ingresos", val: "$45,231", color: "from-[#4F88FF] to-[#B0ACFE]" },
                           { label: "Usuarios", val: "1,204", color: "from-[#FB65C2] to-[#FD2980]" },
                           { label: "Conversión", val: "3.2%", color: "from-[#FD2980] to-[#FF8F1B]" }
                         ].map((kpi, i) => (
                            <div key={i} className="bg-[#16181d] rounded-xl p-4 border border-white/5 flex flex-col gap-2 shadow-lg">
                               <span className="text-[10px] text-white/50 uppercase tracking-wider">{kpi.label}</span>
                               <span className="text-xl font-bold text-white/90">{kpi.val}</span>
                               <div className={`h-1 w-full bg-gradient-to-r ${kpi.color} rounded-full mt-2 opacity-80`}></div>
                            </div>
                         ))}
                      </div>

                      {/* Chart Area Mock */}
                      <div className="flex-1 bg-[#16181d] rounded-xl border border-white/5 p-5 shadow-lg flex flex-col">
                         <span className="text-xs text-white/50 mb-4">Tráfico Mensual</span>
                         <div className="flex-1 flex items-end justify-between gap-2 px-2">
                            {[40, 70, 45, 90, 65, 80, 55, 100, 75, 60].map((h, i) => (
                               <div key={i} className="w-full bg-gradient-to-t from-[#4F88FF]/80 to-[#FB65C2]/80 rounded-t-sm transition-all duration-500 ease-in-out hover:opacity-80 cursor-pointer" style={{ height: `${h}%` }}></div>
                            ))}
                         </div>
                      </div>
                   </div>
                </div>

             </div>
          </div>
        </div>
      </div>
    </section>
  )
}
