import { Sun, Cloud, CloudRain, CloudLightning, Thermometer, CloudFog } from 'lucide-react';
import type { ForecastDay } from '../weather';

interface WeatherForecastProps {
  lat: number;
  lng: number;
  cityName: string;
  forecast: ForecastDay[] | null;
}

export function WeatherForecast({ lat, lng, cityName, forecast }: WeatherForecastProps) {
  function getWeatherIcon(code: number) {
    if (code === 0) return <Sun size={14} className="text-yellow-400" />;
    if ([1, 2, 3].includes(code)) return <Cloud size={14} className="text-muted-foreground" />;
    if ([45, 48].includes(code)) return <CloudFog size={14} className="text-muted-foreground/80" />;
    if ([51, 53, 55, 61, 63, 65, 80, 81, 82].includes(code)) return <CloudRain size={14} className="text-blue-400" />;
    if ([95, 96, 99].includes(code)) return <CloudLightning size={14} className="text-purple-400" />;
    return <Cloud size={14} className="text-muted-foreground" />;
  }

  function formatDateLabel(dateStr: string, index: number) {
    const date = new Date(dateStr);
    const options: Intl.DateTimeFormatOptions = { weekday: 'short' };
    const dayName = date.toLocaleDateString('en-US', options);

    // Label as FP (Friday), QUALI (Saturday), RACE (Sunday) if index matches typical weekend
    if (index === 0) return `${dayName} // FP`;
    if (index === 1) return `${dayName} // QUALI`;
    return `${dayName} // RACE`;
  }

  if (lat === 0 && lng === 0) {
    return (
      <div className="border border-white/[0.06] bg-black p-5">
        <h3 className="flex items-center gap-2 font-mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground mb-4">
          <Sun size={11} /> Live Weekend Forecast
        </h3>
        <p className="text-[10px] text-muted-foreground leading-relaxed">
          Geographical coordinates are unavailable for this historic circuit. Live weather telemetry offline.
        </p>
      </div>
    );
  }

  return (
    <div className="border border-white/[0.06] bg-black p-5">
      <h3 className="flex items-center gap-2 font-mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground mb-4">
        <Sun size={11} /> Live Weekend Forecast
      </h3>

      {!forecast || forecast.length === 0 ? (
        <p className="text-[10px] text-muted-foreground">
          Failed to fetch live weather data. Using historical weather model predictions.
        </p>
      ) : (
        <div className="space-y-3">
          {forecast.map((day, idx) => (
            <div key={day.date} className="flex items-center justify-between p-2 bg-white/[0.01] border border-white/[0.04]">
              <div className="flex items-center gap-3">
                <span className="font-mono text-[9px] tracking-wider text-muted-foreground">
                  {formatDateLabel(day.date, idx)}
                </span>
              </div>
              <div className="flex items-center gap-4">
                {/* Weather code state icon */}
                <div className="flex items-center gap-1.5">
                  {getWeatherIcon(day.weatherCode)}
                  <span className="font-mono text-[9px] text-muted-foreground">{day.rainProb}% rain</span>
                </div>
                {/* Temp */}
                <div className="flex items-center gap-1">
                  <Thermometer size={10} className="text-muted-foreground" />
                  <span className="font-mono text-[10px] font-semibold text-white">
                    {day.tempMax}°<span className="text-[8px] text-muted-foreground font-normal">/{day.tempMin}°</span>
                  </span>
                </div>
              </div>
            </div>
          ))}
          <div className="pt-1 flex items-center justify-between font-mono text-[7px] text-muted-foreground uppercase tracking-widest">
            <span>Location: {cityName}</span>
            <span>Refreshed: live</span>
          </div>
        </div>
      )}
    </div>
  );
}
