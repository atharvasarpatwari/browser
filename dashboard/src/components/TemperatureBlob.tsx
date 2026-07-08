import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { CloudSun } from 'lucide-react'

interface WeatherData {
  temp: number
  main: string
}

const API_KEY = 'YOUR_OPENWEATHER_API_KEY'

function TemperatureBlob() {
  const [weather, setWeather] = useState<WeatherData | null>(null)
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null)

  useEffect(() => {
    navigator.geolocation.getCurrentPosition(
      (pos) => setCoords({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      () => setCoords({ lat: 17.385, lon: 78.4867 })
    )
  }, [])

  useEffect(() => {
    if (!coords) return
    fetch(`https://api.openweathermap.org/data/2.5/weather?lat=${coords.lat}&lon=${coords.lon}&units=metric&appid=${API_KEY}`)
      .then((r) => { if (!r.ok) throw new Error(); return r.json() })
      .then((d) => setWeather({ temp: Math.round(d.main.temp), main: d.weather[0].main }))
      .catch(() => setWeather({ temp: 26, main: 'Mist' }))
  }, [coords])

  return (
    <motion.div
      className="glass card-hover p-6 flex items-center gap-6 overflow-hidden relative min-h-[96px]"
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: .5, delay: .3 }}
    >
      <motion.div
        className="shrink-0"
        animate={{ y: [0, -6, 0] }}
        transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}
      >
        <svg width={84} height={84} viewBox="0 0 100 100">
          <defs>
            <linearGradient id="blobGrad1" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#7c9cf5" stopOpacity=".2" />
              <stop offset="50%" stopColor="#7c9cf5" stopOpacity=".08" />
              <stop offset="100%" stopColor="#7c9cf5" stopOpacity=".02" />
            </linearGradient>
            <filter id="blobShadow1">
              <feDropShadow dx="0" dy="4" stdDeviation="14" floodColor="#7c9cf5" floodOpacity=".12" />
            </filter>
          </defs>
          <path fill="url(#blobGrad1)" filter="url(#blobShadow1)">
            <animate attributeName="d" dur="7s" repeatCount="indefinite" values="
              M50 6 C74 6 92 22 96 44 C100 66 88 84 72 94 C56 104 32 98 18 88 C4 78 2 56 6 36 C10 16 26 6 50 6Z;
              M50 10 C76 8 94 26 97 48 C100 70 86 86 70 95 C54 104 30 96 16 86 C2 76 4 54 7 34 C10 14 24 12 50 10Z;
              M50 6 C74 6 92 22 96 44 C100 66 88 84 72 94 C56 104 32 98 18 88 C4 78 2 56 6 36 C10 16 26 6 50 6Z" />
          </path>
        </svg>
      </motion.div>
      <div>
        <div className="flex items-baseline gap-1">
          <motion.span
            className="text-5xl font-[275] tracking-tight text-white/90"
            key={weather?.temp ?? '--'}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: .4 }}
          >
            {weather?.temp ?? '--'}
          </motion.span>
          <span className="text-xl font-light text-white/25">°C</span>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-white/30 mt-1.5 font-light">
          <CloudSun size={12} className="text-white/20" />
          Current temperature
        </div>
      </div>
    </motion.div>
  )
}

export default TemperatureBlob
