import { useEffect, useState } from 'react'

function AnalogClock() {
  const [time, setTime] = useState(new Date())

  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  const hours = time.getHours() % 12
  const minutes = time.getMinutes()
  const seconds = time.getSeconds()

  const hourDeg = (hours / 12) * 360 + (minutes / 60) * 30
  const minuteDeg = (minutes / 60) * 360 + (seconds / 60) * 6
  const secondDeg = (seconds / 60) * 360

  const size = 280
  const c = size / 2
  const r = size / 2 - 4

  const scallopPoints = Array.from({ length: 24 }, (_, i) => {
    const angle = (i * 15 - 90) * (Math.PI / 180)
    const isTip = i % 2 === 0
    const rad = isTip ? r : r - 14
    return `${c + rad * Math.cos(angle)},${c + rad * Math.sin(angle)}`
  })

  const hourMarks = Array.from({ length: 12 }, (_, i) => {
    const a = (i * 30 - 90) * (Math.PI / 180)
    const outer = r - 2
    const inner = i % 3 === 0 ? r - 24 : r - 14
    return { x1: c + inner * Math.cos(a), y1: c + inner * Math.sin(a), x2: c + outer * Math.cos(a), y2: c + outer * Math.sin(a), bold: i % 3 === 0 }
  })

  const hourLabels = Array.from({ length: 12 }, (_, i) => {
    const a = (i * 30 - 90) * (Math.PI / 180)
    const labelR = r - 32
    return { x: c + labelR * Math.cos(a), y: c + labelR * Math.sin(a), label: i === 0 ? 12 : i }
  })

  return (
    <div className="glass p-6 flex items-center justify-center animate-glow">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <defs>
          <radialGradient id="clockFace" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(255,255,255,.02)" />
            <stop offset="100%" stopColor="rgba(255,255,255,.005)" />
          </radialGradient>
          <filter id="clockGlow">
            <feDropShadow dx="0" dy="0" stdDeviation="3" floodColor="#7c9cf5" floodOpacity=".15" />
          </filter>
        </defs>
        <circle cx={c} cy={c} r={r} fill="url(#clockFace)" stroke="rgba(255,255,255,.06)" strokeWidth=".5" />
        <polygon points={scallopPoints.join(' ')} fill="none" stroke="rgba(255,255,255,.08)" strokeWidth=".8" />
        {hourMarks.map((t, i) => (
          <line key={i} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2}
            stroke={t.bold ? 'rgba(255,255,255,.5)' : 'rgba(255,255,255,.14)'}
            strokeWidth={t.bold ? 1.8 : .8} strokeLinecap="round" />
        ))}
        {hourLabels.map((l, i) => (
          <text key={i} x={l.x} y={l.y} textAnchor="middle" dominantBaseline="central"
            fill="rgba(255,255,255,.25)" fontSize="8" fontWeight="300" fontFamily="Inter, sans-serif"
            letterSpacing="1">
            {l.label}
          </text>
        ))}
        <circle cx={c} cy={c} r={2} fill="#7c9cf5" filter="url(#clockGlow)" />
        <g style={{ transform: `rotate(${hourDeg}deg)`, transformOrigin: `${c}px ${c}px`, transition: 'transform .4s cubic-bezier(.4,0,.2,1)' }}>
          <line x1={c} y1={c + 8} x2={c} y2={c - 60} stroke="rgba(255,255,255,.75)" strokeWidth={3} strokeLinecap="round" />
        </g>
        <g style={{ transform: `rotate(${minuteDeg}deg)`, transformOrigin: `${c}px ${c}px`, transition: 'transform .4s cubic-bezier(.4,0,.2,1)' }}>
          <line x1={c} y1={c + 8} x2={c} y2={c - 90} stroke="rgba(255,255,255,.55)" strokeWidth={2} strokeLinecap="round" />
        </g>
        <g style={{ transform: `rotate(${secondDeg}deg)`, transformOrigin: `${c}px ${c}px`, transition: 'transform .2s cubic-bezier(.4,0,.2,1)' }}>
          <line x1={c} y1={c + 18} x2={c} y2={c - 98} stroke="#7c9cf5" strokeWidth={1} strokeLinecap="round" filter="url(#clockGlow)" />
        </g>
        <circle cx={c} cy={c} r={6} fill="none" stroke="rgba(255,255,255,.06)" strokeWidth=".5" />
      </svg>
    </div>
  )
}

export default AnalogClock
