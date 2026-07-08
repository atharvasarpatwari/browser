import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function DateDisplay() {
  const [date, setDate] = useState(new Date())
  const [timeStr, setTimeStr] = useState('')

  useEffect(() => {
    const tick = () => {
      const d = new Date()
      setDate(d)
      setTimeStr(d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }))
    }
    tick()
    const id = setInterval(tick, 30_000)
    return () => clearInterval(id)
  }, [])

  return (
    <motion.div
      className="glass card-hover p-5 flex items-center gap-5"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: .5, delay: .2 }}
    >
      <div className="flex items-center gap-1">
        <span className="text-4xl font-[275] tracking-tight text-white/90">{date.getDate()}</span>
      </div>
      <div className="w-px h-10 bg-white/[.06]" />
      <div className="flex-1">
        <div className="text-base font-light tracking-tight text-white/70">
          {DAYS[date.getDay()]}, {MONTHS[date.getMonth()]}
        </div>
        <div className="text-[11px] text-white/25 mt-0.5 font-light tracking-wider">{timeStr}</div>
      </div>
      <div className="text-[10px] text-white/15 uppercase tracking-[.15em] font-medium">
        {date.getFullYear()}
      </div>
    </motion.div>
  )
}

export default DateDisplay
