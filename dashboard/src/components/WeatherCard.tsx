import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { MapPin, Thermometer, Droplets, Cloud, CloudSun, CloudRain, CloudSnow, CloudFog, Sun } from 'lucide-react'

interface WeatherData {
  temp: number
  feels_like: number
  humidity: number
  description: string
  city: string
  main: string
}

const API_KEY = 'YOUR_OPENWEATHER_API_KEY'

function getWeatherIcon(main: string) {
  const props = { size: 40 }
  switch (main) {
    case 'Clear': return <Sun {...props} className="text-yellow-400" />
    case 'Clouds': return <Cloud {...props} className="text-white/50" />
    case 'Rain': case 'Drizzle': return <CloudRain {...props} className="text-blue-400" />
    case 'Snow': return <CloudSnow {...props} className="text-white/80" />
    case 'Mist': case 'Fog': case 'Haze': return <CloudFog {...props} className="text-white/35" />
    default: return <CloudSun {...props} className="text-white/40" />
  }
}

function WeatherCard() {
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
      .then((d) => setWeather({
        temp: Math.round(d.main.temp),
        feels_like: Math.round(d.main.feels_like),
        humidity: d.main.humidity,
        description: d.weather[0].description,
        city: d.name,
        main: d.weather[0].main,
      }))
      .catch(() => {
        setWeather({
          temp: 26, feels_like: 28, humidity: 74,
          description: 'Mist', city: 'Hyderabad',
          main: 'Mist',
        })
      })
  }, [coords])

  return (
    <motion.div
      className="glass card-hover p-6"
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: .5, delay: .25 }}
    >
      {weather ? (
        <div className="flex items-center gap-6">
          <motion.div
            className="shrink-0"
            initial={{ scale: 0, rotate: -30 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: 'spring', stiffness: 200, damping: 15, delay: .3 }}
          >
            <div className="w-16 h-16 rounded-2xl bg-white/[.03] flex items-center justify-center">
              {getWeatherIcon(weather.main)}
            </div>
          </motion.div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 text-[11px] text-white/30 mb-1.5 font-light">
              <MapPin size={10} className="shrink-0" />
              <span className="truncate">{weather.city}</span>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-3xl font-[275] tracking-tight text-white/90">{weather.temp}°</span>
              <span className="text-sm text-white/25 font-light">C</span>
            </div>
            <div className="text-[11px] text-white/30 capitalize mt-0.5 font-light">{weather.description}</div>
          </div>
          <div className="flex flex-col gap-2.5 text-[11px] text-white/40 font-light">
            <div className="flex items-center gap-2">
              <Thermometer size={11} className="shrink-0 text-white/25" />
              <span>Feels {weather.feels_like}°</span>
            </div>
            <div className="flex items-center gap-2">
              <Droplets size={11} className="shrink-0 text-white/25" />
              <span>{weather.humidity}%</span>
            </div>
            <div className="w-20 h-1 bg-white/8 rounded-full overflow-hidden">
              <motion.div
                className="h-full rounded-full bg-gradient-to-r from-blue-500/60 to-cyan-400/60"
                initial={{ width: 0 }}
                animate={{ width: `${weather.humidity}%` }}
                transition={{ duration: 1.2, ease: 'easeOut', delay: .4 }}
              />
            </div>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-center h-[72px]">
          <div className="w-5 h-5 border border-white/15 border-t-white/50 rounded-full animate-spin" />
        </div>
      )}
    </motion.div>
  )
}

export default WeatherCard
