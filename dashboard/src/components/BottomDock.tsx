import { motion } from 'framer-motion'
import { Youtube, Mail, Send, Phone, Twitter, MessageCircle } from 'lucide-react'

const LINKS = [
  { icon: Youtube, label: 'YouTube', url: 'https://youtube.com', color: 'hover:text-red-400/80' },
  { icon: Mail, label: 'Mail', url: 'https://mail.google.com', color: 'hover:text-blue-400/80' },
  { icon: Send, label: 'Telegram', url: 'https://web.telegram.org', color: 'hover:text-sky-400/80' },
  { icon: Phone, label: 'Phone', url: 'tel:', color: 'hover:text-green-400/80' },
  { icon: Twitter, label: 'Twitter/X', url: 'https://x.com', color: 'hover:text-white/70' },
  { icon: MessageCircle, label: 'Discord', url: 'https://discord.com/app', color: 'hover:text-indigo-400/80' },
]

function BottomDock() {
  return (
    <motion.div
      className="glass-dock px-6 py-2.5 flex items-center gap-0.5"
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: .5, delay: .5 }}
    >
      {LINKS.map((item, i) => (
        <motion.a
          key={item.label}
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className={`relative p-3 rounded-xl text-white/25 ${item.color} transition-colors duration-200`}
          whileHover={{ scale: 1.18, y: -7 }}
          whileTap={{ scale: 0.92 }}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: .3, delay: .55 + i * .04 }}
          title={item.label}
        >
          <item.icon size={17} />
          <motion.div
            className="absolute -bottom-0.5 left-1/2 w-1 h-1 rounded-full bg-white/20"
            initial={{ opacity: 0, x: '-50%' }}
            whileHover={{ opacity: 1 }}
          />
        </motion.a>
      ))}
    </motion.div>
  )
}

export default BottomDock
