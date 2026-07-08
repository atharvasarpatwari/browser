import { motion } from 'framer-motion'
import { Sparkles } from 'lucide-react'

function SearchWithCard() {
  return (
    <motion.div
      className="glass card-hover p-5 flex-1 flex flex-col justify-center"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: .5, delay: .45 }}
    >
      <div className="flex items-center gap-3">
        <motion.div
          className="w-9 h-9 rounded-xl bg-accent/10 flex items-center justify-center"
          animate={{ scale: [1, 1.04, 1] }}
          transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
        >
          <Sparkles size={14} className="text-accent/80" />
        </motion.div>
        <div>
          <p className="text-sm font-light text-white/70">Search With</p>
          <p className="text-[11px] text-white/20 mt-0.5 font-light">AI-powered results</p>
        </div>
      </div>
    </motion.div>
  )
}

export default SearchWithCard
