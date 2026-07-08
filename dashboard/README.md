# Nova Dashboard

Premium dark-themed browser homepage/dashboard.

## Setup

```bash
cd dashboard
npm install
npm run dev
```

Opens at `http://localhost:5173`.

## Build

```bash
npm run build
```

Output in `dist/`.

## Config

- Replace `YOUR_OPENWEATHER_API_KEY` in `src/components/WeatherCard.tsx` and `src/components/TemperatureBlob.tsx` with your OpenWeather API key (free tier: https://openweathermap.org/api)
- Search engine preference is saved in localStorage
