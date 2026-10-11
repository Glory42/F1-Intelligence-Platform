export interface ForecastDay {
  date: string;
  tempMax: number;
  tempMin: number;
  rainProb: number;
  weatherCode: number;
}

// Only surfaces the upcoming Fri/Sat/Sun (FP, quali, race): skips any other days
export async function getWeatherForecast(lat: number, lng: number): Promise<ForecastDay[]> {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weathercode&timezone=auto&forecast_days=16`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
  const data = await res.json();

  const days: ForecastDay[] = [];
  for (let i = 0; i < data.daily.time.length; i++) {
    const weekday = new Date(data.daily.time[i]).getDay();
    if (weekday !== 5 && weekday !== 6 && weekday !== 0) continue;
    days.push({
      date: data.daily.time[i],
      tempMax: Math.round(data.daily.temperature_2m_max[i]),
      tempMin: Math.round(data.daily.temperature_2m_min[i]),
      rainProb: Math.round(data.daily.precipitation_probability_max[i] ?? 0),
      weatherCode: data.daily.weathercode[i],
    });
    if (days.length === 3) break;
  }
  return days;
}
