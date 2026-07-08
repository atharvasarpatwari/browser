import { useState, useRef, useCallback } from 'react'
import { motion } from 'framer-motion'
import { Search, Mic, ArrowRight } from 'lucide-react'

const ENGINES: Record<string, string> = {
  Google: 'https://www.google.com/search?q=',
  DuckDuckGo: 'https://duckduckgo.com/?q=',
  Bing: 'https://www.bing.com/search?q=',
  Brave: 'https://search.brave.com/search?q=',
  Default: 'https://www.google.com/search?q=',
}

function SearchBar() {
  const [query, setQuery] = useState('')
  const [listening, setListening] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const engine = typeof window !== 'undefined'
    ? localStorage.getItem('searchEngine') || 'Default'
    : 'Default'
  const baseUrl = ENGINES[engine] || ENGINES.Default

  const doSearch = useCallback(() => {
    const q = query.trim()
    if (!q) return
    window.open(baseUrl + encodeURIComponent(q), '_self')
  }, [query, baseUrl])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') doSearch()
  }

  const handleVoice = () => {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) return
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    const recog = new SpeechRecognition()
    recog.lang = 'en-US'
    recog.interimResults = false
    recog.onresult = (e: any) => {
      const text = e.results[0][0].transcript
      setQuery(text)
      setListening(false)
      setTimeout(() => {
        setQuery(text)
        if (inputRef.current) inputRef.current.value = text
        window.open(baseUrl + encodeURIComponent(text), '_self')
      }, 300)
    }
    recog.onerror = () => setListening(false)
    recog.onend = () => setListening(false)
    setListening(true)
    recog.start()
  }

  return (
    <motion.div
      className="glass-strong flex items-center gap-2 px-2 glow-ring rounded-[36px]"
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: .5, delay: .35 }}
    >
      <div className="flex-1 flex items-center gap-3 pl-5">
        <Search size={15} className="text-white/20 shrink-0" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type here..."
          className="flex-1 bg-transparent text-white/80 text-sm outline-none placeholder:text-white/15 font-light py-3.5"
          autoFocus
        />
      </div>
      <div className="flex items-center gap-1">
        <motion.button
          onClick={handleVoice}
          className={`p-2.5 rounded-full transition-all duration-300 ${
            listening
              ? 'bg-accent/20 text-accent'
              : 'hover:bg-white/5 text-white/25 hover:text-white/50'
          }`}
          title="Voice search"
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.92 }}
        >
          <Mic size={14} />
        </motion.button>
        <motion.button
          onClick={doSearch}
          className="px-5 py-2.5 rounded-full bg-white/8 hover:bg-white/12 text-white/50 hover:text-white/80 text-xs font-medium transition-all duration-300 flex items-center gap-2"
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.96 }}
        >
          Search
          <ArrowRight size={12} className="text-white/20" />
        </motion.button>
      </div>
    </motion.div>
  )
}

export default SearchBar
