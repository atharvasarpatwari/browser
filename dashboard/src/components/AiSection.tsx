import { useState } from 'react'

const AI_TOOLS = [
  {
    icon: '🧠', name: 'AI Tools',
    gradient: 'from-purple-600/90 to-blue-600/90',
    glow: 'rgba(147,51,234,0.35)',
    border: 'border-purple-500/50',
    bg: 'from-purple-500/20 to-blue-500/10',
  },
  {
    icon: '🤖', name: 'ChatGPT',
    gradient: 'from-emerald-500/90 to-teal-500/90',
    glow: 'rgba(16,185,129,0.35)',
    border: 'border-emerald-500/50',
    bg: 'from-emerald-500/20 to-teal-500/10',
  },
  {
    icon: '✨', name: 'Gemini',
    gradient: 'from-blue-500/90 to-cyan-400/90',
    glow: 'rgba(59,130,246,0.35)',
    border: 'border-blue-500/50',
    bg: 'from-blue-500/20 to-cyan-400/10',
  },
  {
    icon: '🌀', name: 'Copilot',
    gradient: 'from-violet-500/90 to-fuchsia-500/90',
    glow: 'rgba(139,92,246,0.35)',
    border: 'border-violet-500/50',
    bg: 'from-violet-500/20 to-fuchsia-500/10',
  },
  {
    icon: '❋', name: 'Claude',
    gradient: 'from-orange-500/90 to-amber-500/90',
    glow: 'rgba(249,115,22,0.35)',
    border: 'border-orange-500/50',
    bg: 'from-orange-500/20 to-amber-500/10',
  },
  {
    icon: '⬢', name: 'Perplexity',
    gradient: 'from-cyan-500/90 to-sky-400/90',
    glow: 'rgba(6,182,212,0.35)',
    border: 'border-cyan-500/50',
    bg: 'from-cyan-500/20 to-sky-400/10',
  },
  {
    icon: '🐋', name: 'DeepSeek',
    gradient: 'from-sky-600/90 to-indigo-600/90',
    glow: 'rgba(37,99,235,0.35)',
    border: 'border-sky-500/50',
    bg: 'from-sky-600/20 to-indigo-600/10',
  },
  {
    icon: '∞', name: 'Meta AI',
    gradient: 'from-pink-500/90 to-rose-500/90',
    glow: 'rgba(236,72,153,0.35)',
    border: 'border-pink-500/50',
    bg: 'from-pink-500/20 to-rose-500/10',
  },
]

function AiSection() {
  const [active, setActive] = useState(0)

  return (
    <div className="w-full flex justify-center mx-auto">
      <div className="flex items-center gap-3 overflow-x-auto py-3 px-2 scrollbar-none">
        {AI_TOOLS.map((tool, i) => {
          const isActive = i === active
          return (
            <button
              key={tool.name}
              onClick={() => setActive(i)}
              className={`
                relative flex items-center gap-3 min-w-fit px-5 py-3 rounded-[26px] cursor-pointer
                transition-all duration-300 ease-out select-none whitespace-nowrap group
                border backdrop-blur-xl
                ${isActive
                  ? tool.border + ' scale-105'
                  : 'border-white/10 hover:border-white/30'
                }
                text-white hover:-translate-y-1.5
              `}
              style={{
                background: isActive
                  ? `linear-gradient(135deg, ${tool.glow.replace('0.35', '0.18')}, rgba(255,255,255,0.05))`
                  : 'rgba(255,255,255,0.04)',
                boxShadow: isActive
                  ? `0 0 30px ${tool.glow}, 0 8px 32px rgba(0,0,0,0.45)`
                  : '0 4px 16px rgba(0,0,0,0.25)',
              }}
            >
              {/* Animated glow ring on hover */}
              {isActive && (
                <div
                  className="absolute inset-0 rounded-[26px] opacity-60 animate-pulse"
                  style={{
                    background: `radial-gradient(circle at 50% 0%, ${tool.glow}, transparent 70%)`,
                    filter: 'blur(12px)',
                  }}
                />
              )}

              <span
                className={`
                  w-10 h-10 rounded-full flex items-center justify-center text-lg
                  transition-all duration-300
                  ${isActive ? 'scale-110 shadow-lg' : 'group-hover:scale-110'}
                `}
                style={{
                  background: isActive
                    ? `linear-gradient(135deg, ${tool.gradient.replace('/90', '')})`
                    : 'rgba(255,255,255,0.08)',
                  boxShadow: isActive ? `0 0 20px ${tool.glow}` : 'none',
                }}
              >
                {tool.icon}
              </span>

              <span className="text-base md:text-xl font-semibold tracking-tight">
                {tool.name}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export default AiSection
