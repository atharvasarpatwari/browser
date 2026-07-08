import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'

const GREETINGS = ['Good Morning', 'Good Afternoon', 'Good Evening', 'Good Night']

function GreetingCard() {
  const [greeting, setGreeting] = useState('')

  useEffect(() => {
    const h = new Date().getHours()
    if (h < 12) setGreeting(GREETINGS[0])
    else if (h < 17) setGreeting(GREETINGS[1])
    else if (h < 21) setGreeting(GREETINGS[2])
    else setGreeting(GREETINGS[3])
  }, [])

  return (
    <motion.div
      className="glass card-hover p-6"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: .5, delay: .15 }}
    >
      <p className="text-[10px] text-white/30 uppercase tracking-[.25em] font-medium mb-2.5">{greeting}</p>
      <div className="flex items-center gap-2">
        <h2 className="text-2xl font-light tracking-tight text-white/90">CQMS S.ATHARVA</h2>
        <motion.span
          className="text-base"
          animate={{ scale: [1, 1.15, 1] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
        >
          💕
        </motion.span>
      </div>
    </motion.div>
  )
}

export default GreetingCard
