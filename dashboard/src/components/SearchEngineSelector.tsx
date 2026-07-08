import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Search } from 'lucide-react'

const ENGINES = ['Default', 'Google', 'DuckDuckGo', 'Bing', 'Brave']

function SearchEngineSelector() {
  const [selected, setSelected] = useState('Default')

  useEffect(() => {
    const saved = localStorage.getItem('searchEngine')
    if (saved && ENGINES.includes(saved)) setSelected(saved)
  }, [])

  const handleSelect = (engine: string) => {
    setSelected(engine)
    localStorage.setItem('searchEngine', engine)
  }

  return (
    <motion.div
      className="glass card-hover p-5 flex-1"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: .5, delay: .4 }}
    >
      <div className="flex items-center gap-2 mb-4">
        <Search size={12} className="text-white/20" />
        <p className="text-[10px] text-white/25 uppercase tracking-[.2em] font-medium">Search Engine</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {ENGINES.map((e) => (
          <motion.button
            key={e}
            onClick={() => handleSelect(e)}
            className={`relative px-4 py-2 rounded-full text-xs font-medium transition-all duration-300 ${
              selected === e
                ? 'text-accent border border-accent/25'
                : 'text-white/35 border border-white/[.05] hover:bg-white/[.04] hover:text-white/55'
            }`}
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.95 }}
          >
            {selected === e && (
              <motion.div
                layoutId="enginePill"
                className="absolute inset-0 rounded-full bg-accent/12"
                transition={{ type: 'spring', stiffness: 350, damping: 28 }}
              />
            )}
            <span className="relative z-10">{e}</span>
          </motion.button>
        ))}
      </div>
    </motion.div>
  )
}

export default SearchEngineSelector
