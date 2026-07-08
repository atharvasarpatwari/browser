import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import AnalogClock from './components/AnalogClock'
import GreetingCard from './components/GreetingCard'
import DateDisplay from './components/DateDisplay'
import WeatherCard from './components/WeatherCard'
import TemperatureBlob from './components/TemperatureBlob'
import SearchBar from './components/SearchBar'
import SearchEngineSelector from './components/SearchEngineSelector'
import SearchWithCard from './components/SearchWithCard'
import BottomDock from './components/BottomDock'
import FloatingButtons from './components/FloatingButtons'

function Particles() {
  const particles = Array.from({ length: 25 }, (_, i) => ({
    id: i,
    x: Math.random() * 100,
    y: Math.random() * 100,
    size: Math.random() * 1.8 + .6,
    duration: Math.random() * 12 + 10,
    delay: Math.random() * 6,
    xDrift: (Math.random() - .5) * 20,
  }))

  return (
    <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
      {particles.map((p) => (
        <motion.div
          key={p.id}
          className="absolute rounded-full bg-white/8"
          style={{
            left: `${p.x}%`,
            top: `${p.y}%`,
            width: p.size,
            height: p.size,
          }}
          animate={{
            y: [0, -40, 0],
            x: [0, p.xDrift, 0],
            opacity: [0.15, 0.5, 0.15],
          }}
          transition={{
            duration: p.duration,
            repeat: Infinity,
            delay: p.delay,
            ease: 'easeInOut',
          }}
        />
      ))}
    </div>
  )
}

function App() {
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])

  return (
    <AnimatePresence>
      {mounted && (
        <motion.div
          className="relative min-h-screen w-full flex flex-col items-center justify-center p-4 md:p-8 overflow-hidden"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: .8, ease: 'easeOut' }}
        >
          <Particles />

          <div className="relative z-10 w-full max-w-6xl mx-auto flex flex-col lg:flex-row gap-6 lg:gap-8 items-start">

            {/* ─── LEFT COLUMN ─── */}
            <motion.div
              className="w-full lg:w-[38%] flex flex-col gap-5"
              initial={{ opacity: 0, x: -30 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: .6, delay: .1 }}
            >
              <AnalogClock />
              <GreetingCard />
              <DateDisplay />
            </motion.div>

            {/* ─── RIGHT COLUMN ─── */}
            <motion.div
              className="w-full lg:w-[62%] flex flex-col gap-4"
              initial={{ opacity: 0, x: 30 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: .6, delay: .15 }}
            >
              <WeatherCard />
              <TemperatureBlob />
              <SearchBar />
              <div className="flex flex-col sm:flex-row gap-4">
                <SearchEngineSelector />
                <SearchWithCard />
              </div>
            </motion.div>
          </div>

          {/* ─── BOTTOM DOCK ─── */}
          <motion.div
            className="relative z-10 mt-8 mb-4"
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: .5, delay: .5 }}
          >
            <BottomDock />
          </motion.div>

          {/* ─── FLOATING BUTTONS ─── */}
          <FloatingButtons />
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export default App
