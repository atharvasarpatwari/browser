import { motion } from 'framer-motion'
import { Menu, Bookmark, Grid, Settings } from 'lucide-react'

const BUTTONS = [
  { icon: Menu, label: 'Menu', position: 'top-6 left-6', delay: .6 },
  { icon: Bookmark, label: 'Bookmarks', position: 'top-6 right-24', delay: .65 },
  { icon: Grid, label: 'Apps', position: 'top-6 right-6', delay: .7 },
  { icon: Settings, label: 'Settings', position: 'bottom-6 right-6', delay: .75 },
]

function FloatingButtons() {
  return (
    <>
      {BUTTONS.map((btn) => (
        <motion.a
          key={btn.label}
          href="#"
          className={`fixed ${btn.position} z-20 w-11 h-11 rounded-full btn-ghost flex items-center justify-center text-white/30 hover:text-white/60 transition-colors duration-200`}
          whileHover={{ scale: 1.1, boxShadow: '0 0 20px rgba(124,156,245,.08)' }}
          whileTap={{ scale: 0.9 }}
          initial={{ opacity: 0, scale: 0, x: btn.position.includes('left') ? -12 : 12 }}
          animate={{ opacity: 1, scale: 1, x: 0 }}
          transition={{ delay: btn.delay, type: 'spring', stiffness: 200, damping: 16 }}
          title={btn.label}
        >
          <btn.icon size={16} />
        </motion.a>
      ))}
    </>
  )
}

export default FloatingButtons
