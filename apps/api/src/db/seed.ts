/// <reference types="node" />
import { createDb } from '../config/database';
import { circuits, seasons } from './schema';

const R2_BASE = '/circuits';

// Static track categorization: which characteristic dominates at this circuit.
// Drives car_performance_at_circuit (blend of season + category-specific pace).
const TRACK_CATEGORY: Record<string, string> = {
  a1_ring: 'high_speed', adelaide: 'street', albert_park: 'street', austin: 'balanced',
  bahrain: 'high_speed', bahrain_outer: 'balanced', baku: 'street', brands_hatch: 'high_downforce',
  buenos_aires: 'high_downforce', caesars_palace: 'street', canada: 'high_speed', catalunya: 'high_downforce',
  dallas: 'street', detroit: 'street', dijon: 'high_downforce', donington: 'high_downforce',
  estoril: 'high_downforce', fuji_speedway: 'high_speed', hockenheim: 'high_speed', hungaroring: 'high_downforce',
  imola: 'high_downforce', india: 'high_speed', indianapolis: 'high_speed', interlagos: 'balanced',
  istanbul: 'high_downforce', jacarepagua: 'high_downforce', jarama: 'high_downforce', jeddah: 'street',
  jerez: 'high_downforce', korea: 'balanced', kyalami: 'high_downforce', las_vegas: 'street',
  long_beach: 'street', lusail: 'high_speed', madrid: 'high_downforce', magny_cours: 'high_downforce',
  mexico_city: 'high_speed', miami: 'street', monaco: 'street', monza: 'high_speed',
  mugello: 'balanced', nurburgring: 'high_downforce', okayama: 'high_downforce', paul_ricard: 'high_downforce',
  phoenix: 'street', portimao: 'high_downforce', red_bull_ring: 'high_speed', sepang: 'high_speed',
  shanghai: 'high_speed', silverstone: 'high_speed', singapore: 'street', sochi: 'balanced',
  spa: 'high_speed', suzuka: 'high_downforce', valencia: 'street', watkins_glen: 'high_downforce',
  yas_marina: 'balanced', zandvoort: 'high_downforce', zolder: 'high_downforce',
};

const CIRCUITS_2025 = [
  { circuitKey: 'bahrain',      name: 'Bahrain International Circuit',         country: 'Bahrain',      city: 'Sakhir',        lapCount: 57, trackLengthKm: '5.412', overtakeRate: '0.72', numberOfCorners: 15, drsZones: 3, imageUrl: `${R2_BASE}/bahrain.jpg` },
  { circuitKey: 'jeddah',       name: 'Jeddah Corniche Circuit',                country: 'Saudi Arabia', city: 'Jeddah',        lapCount: 50, trackLengthKm: '6.174', overtakeRate: '0.60', numberOfCorners: 27, drsZones: 3, imageUrl: `${R2_BASE}/jeddah.jpg` },
  { circuitKey: 'albert_park',  name: 'Albert Park Circuit',                    country: 'Australia',    city: 'Melbourne',     lapCount: 58, trackLengthKm: '5.278', overtakeRate: '0.50', numberOfCorners: 16, drsZones: 4, imageUrl: `${R2_BASE}/albert_park.jpg` },
  { circuitKey: 'suzuka',       name: 'Suzuka International Racing Course',     country: 'Japan',        city: 'Suzuka',        lapCount: 53, trackLengthKm: '5.807', overtakeRate: '0.35', numberOfCorners: 18, drsZones: 2, imageUrl: `${R2_BASE}/suzuka.jpg` },
  { circuitKey: 'shanghai',     name: 'Shanghai International Circuit',         country: 'China',        city: 'Shanghai',      lapCount: 56, trackLengthKm: '5.451', overtakeRate: '0.55', numberOfCorners: 16, drsZones: 2, imageUrl: `${R2_BASE}/shanghai.jpg` },
  { circuitKey: 'miami',        name: 'Miami International Autodrome',          country: 'USA',          city: 'Miami',         lapCount: 57, trackLengthKm: '5.412', overtakeRate: '0.65', numberOfCorners: 19, drsZones: 3, imageUrl: `${R2_BASE}/miami.jpg` },
  { circuitKey: 'imola',        name: 'Autodromo Enzo e Dino Ferrari',          country: 'Italy',        city: 'Imola',         lapCount: 63, trackLengthKm: '4.909', overtakeRate: '0.30', numberOfCorners: 21, drsZones: 2, imageUrl: `${R2_BASE}/imola.jpg` },
  { circuitKey: 'monaco',       name: 'Circuit de Monaco',                      country: 'Monaco',       city: 'Monte Carlo',   lapCount: 78, trackLengthKm: '3.337', overtakeRate: '0.05', numberOfCorners: 19, drsZones: 1, imageUrl: `${R2_BASE}/monaco.jpg` },
  { circuitKey: 'canada',       name: 'Circuit Gilles Villeneuve',              country: 'Canada',       city: 'Montréal',      lapCount: 70, trackLengthKm: '4.361', overtakeRate: '0.65', numberOfCorners: 14, drsZones: 2, imageUrl: `${R2_BASE}/canada.jpg` },
  { circuitKey: 'catalunya',    name: 'Circuit de Barcelona-Catalunya',         country: 'Spain',        city: 'Barcelona',     lapCount: 66, trackLengthKm: '4.657', overtakeRate: '0.40', numberOfCorners: 14, drsZones: 2, imageUrl: `${R2_BASE}/catalunya.jpg` },
  { circuitKey: 'red_bull_ring',name: 'Red Bull Ring',                          country: 'Austria',      city: 'Spielberg',     lapCount: 71, trackLengthKm: '4.318', overtakeRate: '0.75', numberOfCorners: 10, drsZones: 3, imageUrl: `${R2_BASE}/red_bull_ring.jpg` },
  { circuitKey: 'silverstone',  name: 'Silverstone Circuit',                    country: 'UK',           city: 'Silverstone',   lapCount: 52, trackLengthKm: '5.891', overtakeRate: '0.55', numberOfCorners: 18, drsZones: 2, imageUrl: `${R2_BASE}/silverstone.jpg` },
  { circuitKey: 'hungaroring',  name: 'Hungaroring',                            country: 'Hungary',      city: 'Budapest',      lapCount: 70, trackLengthKm: '4.381', overtakeRate: '0.25', numberOfCorners: 14, drsZones: 1, imageUrl: `${R2_BASE}/hungaroring.jpg` },
  { circuitKey: 'spa',          name: 'Circuit de Spa-Francorchamps',           country: 'Belgium',      city: 'Spa',           lapCount: 44, trackLengthKm: '7.004', overtakeRate: '0.70', numberOfCorners: 19, drsZones: 2, imageUrl: `${R2_BASE}/spa.jpg` },
  { circuitKey: 'zandvoort',    name: 'Circuit Zandvoort',                      country: 'Netherlands',  city: 'Zandvoort',     lapCount: 72, trackLengthKm: '4.259', overtakeRate: '0.20', numberOfCorners: 14, drsZones: 2, imageUrl: `${R2_BASE}/zandvoort.jpg` },
  { circuitKey: 'monza',        name: 'Autodromo Nazionale Monza',              country: 'Italy',        city: 'Monza',         lapCount: 53, trackLengthKm: '5.793', overtakeRate: '0.85', numberOfCorners: 11, drsZones: 2, imageUrl: `${R2_BASE}/monza.jpg` },
  { circuitKey: 'baku',         name: 'Baku City Circuit',                      country: 'Azerbaijan',   city: 'Baku',          lapCount: 51, trackLengthKm: '6.003', overtakeRate: '0.78', numberOfCorners: 20, drsZones: 2, imageUrl: `${R2_BASE}/baku.jpg` },
  { circuitKey: 'singapore',    name: 'Marina Bay Street Circuit',              country: 'Singapore',    city: 'Singapore',     lapCount: 62, trackLengthKm: '4.940', overtakeRate: '0.22', numberOfCorners: 23, drsZones: 3, imageUrl: `${R2_BASE}/singapore.jpg` },
  { circuitKey: 'austin',       name: 'Circuit of the Americas',                country: 'USA',          city: 'Austin',        lapCount: 56, trackLengthKm: '5.513', overtakeRate: '0.68', numberOfCorners: 20, drsZones: 2, imageUrl: `${R2_BASE}/austin.jpg` },
  { circuitKey: 'mexico_city',  name: 'Autodromo Hermanos Rodriguez',           country: 'Mexico',       city: 'Mexico City',   lapCount: 71, trackLengthKm: '4.304', overtakeRate: '0.48', numberOfCorners: 17, drsZones: 3, imageUrl: `${R2_BASE}/mexico_city.jpg` },
  { circuitKey: 'interlagos',   name: 'Autodromo Jose Carlos Pace',             country: 'Brazil',       city: 'Sao Paulo',     lapCount: 71, trackLengthKm: '4.309', overtakeRate: '0.65', numberOfCorners: 15, drsZones: 2, imageUrl: `${R2_BASE}/interlagos.jpg` },
  { circuitKey: 'las_vegas',    name: 'Las Vegas Strip Circuit',                country: 'USA',          city: 'Las Vegas',     lapCount: 50, trackLengthKm: '6.201', overtakeRate: '0.62', numberOfCorners: 17, drsZones: 2, imageUrl: `${R2_BASE}/las_vegas.jpg` },
  { circuitKey: 'lusail',       name: 'Lusail International Circuit',           country: 'Qatar',        city: 'Lusail',        lapCount: 57, trackLengthKm: '5.380', overtakeRate: '0.58', numberOfCorners: 16, drsZones: 3, imageUrl: `${R2_BASE}/lusail.jpg` },
  { circuitKey: 'yas_marina',   name: 'Yas Marina Circuit',                     country: 'UAE',          city: 'Abu Dhabi',     lapCount: 58, trackLengthKm: '5.281', overtakeRate: '0.55', numberOfCorners: 16, drsZones: 2, imageUrl: `${R2_BASE}/yas_marina.jpg` },
  { circuitKey: 'portimao',     name: 'Autodromo Internacional do Algarve',     country: 'Portugal',     city: 'Portimao',      lapCount: 66, trackLengthKm: '4.653', overtakeRate: '0.45', numberOfCorners: 15, drsZones: 3, imageUrl: `${R2_BASE}/portimao.jpg` },
  // Historical circuits (used in 2021-2022)
  { circuitKey: 'sochi',        name: 'Sochi Autodrom',                          country: 'Russia',       city: 'Sochi',         lapCount: 53, trackLengthKm: '5.848', overtakeRate: '0.55', numberOfCorners: 18, drsZones: 2, imageUrl: `${R2_BASE}/sochi.jpg` },
  { circuitKey: 'istanbul',     name: 'Istanbul Park',                           country: 'Turkey',       city: 'Istanbul',      lapCount: 58, trackLengthKm: '5.338', overtakeRate: '0.60', numberOfCorners: 14, drsZones: 2, imageUrl: `${R2_BASE}/istanbul.jpg` },
  { circuitKey: 'paul_ricard',  name: 'Circuit Paul Ricard',                     country: 'France',       city: 'Le Castellet',  lapCount: 53, trackLengthKm: '5.842', overtakeRate: '0.45', numberOfCorners: 15, drsZones: 2, imageUrl: `${R2_BASE}/paul_ricard.jpg` },
  // 2026 new circuits
  { circuitKey: 'madrid',       name: 'IFEMA Madrid Circuit',                    country: 'Spain',        city: 'Madrid',        lapCount: 55, trackLengthKm: '5.473', overtakeRate: '0.52', numberOfCorners: 20, drsZones: 3, imageUrl: `${R2_BASE}/madrid.jpg` },
  // 2018-2020 historical circuits
  { circuitKey: 'hockenheim',    name: 'Hockenheimring',                          country: 'Germany',      city: 'Hockenheim',     lapCount: 67, trackLengthKm: '4.574', overtakeRate: '0.55', numberOfCorners: 17, drsZones: 3, imageUrl: `${R2_BASE}/hockenheim.jpg` },
  { circuitKey: 'nurburgring',   name: 'Nürburgring',                             country: 'Germany',      city: 'Nürburg',        lapCount: 60, trackLengthKm: '5.148', overtakeRate: '0.48', numberOfCorners: 15, drsZones: 3, imageUrl: `${R2_BASE}/nurburgring.jpg` },
  { circuitKey: 'mugello',       name: 'Autodromo Internazionale del Mugello',    country: 'Italy',        city: 'Mugello',        lapCount: 59, trackLengthKm: '5.245', overtakeRate: '0.35', numberOfCorners: 15, drsZones: 3, imageUrl: `${R2_BASE}/mugello.jpg` },
  // 2000-2017 historical circuits
  { circuitKey: 'sepang',        name: 'Sepang International Circuit',            country: 'Malaysia',     city: 'Kuala Lumpur',   lapCount: 56, trackLengthKm: '5.543', overtakeRate: '0.65', numberOfCorners: 15, drsZones: 3, imageUrl: `${R2_BASE}/sepang.jpg` },
  { circuitKey: 'indianapolis',  name: 'Indianapolis Motor Speedway',             country: 'USA',          city: 'Indianapolis',   lapCount: 73, trackLengthKm: '4.192', overtakeRate: '0.80', numberOfCorners: 13, drsZones: null, imageUrl: `${R2_BASE}/indianapolis.jpg` },
  { circuitKey: 'magny_cours',   name: 'Circuit de Nevers Magny-Cours',           country: 'France',       city: 'Magny-Cours',    lapCount: 70, trackLengthKm: '4.411', overtakeRate: '0.30', numberOfCorners: 17, drsZones: null, imageUrl: `${R2_BASE}/magny_cours.jpg` },
  { circuitKey: 'a1_ring',       name: 'A1-Ring',                                 country: 'Austria',      city: 'Spielberg',      lapCount: 71, trackLengthKm: '4.326', overtakeRate: '0.70', numberOfCorners:  9, drsZones: null, imageUrl: `${R2_BASE}/a1_ring.jpg` },
  { circuitKey: 'valencia',      name: 'Valencia Street Circuit',                 country: 'Spain',        city: 'Valencia',       lapCount: 57, trackLengthKm: '5.419', overtakeRate: '0.35', numberOfCorners: 25, drsZones: 2, imageUrl: `${R2_BASE}/valencia.jpg` },
  { circuitKey: 'korea',         name: 'Korean International Circuit',            country: 'South Korea',  city: 'Yeongam',        lapCount: 55, trackLengthKm: '5.615', overtakeRate: '0.50', numberOfCorners: 18, drsZones: 3, imageUrl: `${R2_BASE}/korea.jpg` },
  { circuitKey: 'india',         name: 'Buddh International Circuit',             country: 'India',        city: 'Greater Noida',  lapCount: 60, trackLengthKm: '5.125', overtakeRate: '0.55', numberOfCorners: 16, drsZones: 3, imageUrl: `${R2_BASE}/india.jpg` },
  { circuitKey: 'bahrain_outer', name: 'Bahrain International Circuit (Outer)',   country: 'Bahrain',      city: 'Sakhir',         lapCount: 87, trackLengthKm: '3.543', overtakeRate: '0.90', numberOfCorners: 11, drsZones: 4, imageUrl: `${R2_BASE}/bahrain_outer.jpg` },
  { circuitKey: 'fuji_speedway', name: 'Fuji Speedway',                           country: 'Japan',        city: 'Oyama',          lapCount: 67, trackLengthKm: '4.563', overtakeRate: '0.60', numberOfCorners: 16, drsZones: null, imageUrl: `${R2_BASE}/fuji_speedway.jpg` },
  // 1990-1999 historical circuits
  { circuitKey: 'phoenix',       name: 'Phoenix Street Circuit',                  country: 'USA',          city: 'Phoenix',        lapCount: 81, trackLengthKm: '3.798', overtakeRate: '0.40', numberOfCorners: 15, drsZones: null, imageUrl: `${R2_BASE}/phoenix.jpg` },
  { circuitKey: 'estoril',       name: 'Autódromo do Estoril',                    country: 'Portugal',     city: 'Estoril',        lapCount: 71, trackLengthKm: '4.360', overtakeRate: '0.50', numberOfCorners: 13, drsZones: null, imageUrl: `${R2_BASE}/estoril.jpg` },
  { circuitKey: 'jerez',         name: 'Circuito de Jerez',                       country: 'Spain',        city: 'Jerez de la Frontera', lapCount: 69, trackLengthKm: '4.428', overtakeRate: '0.35', numberOfCorners: 15, drsZones: null, imageUrl: `${R2_BASE}/jerez.jpg` },
  { circuitKey: 'adelaide',      name: 'Adelaide Street Circuit',                 country: 'Australia',    city: 'Adelaide',       lapCount: 81, trackLengthKm: '3.780', overtakeRate: '0.55', numberOfCorners: 16, drsZones: null, imageUrl: `${R2_BASE}/adelaide.jpg` },
  { circuitKey: 'kyalami',       name: 'Kyalami Racing Circuit',                  country: 'South Africa', city: 'Midrand',        lapCount: 72, trackLengthKm: '4.261', overtakeRate: '0.45', numberOfCorners: 13, drsZones: null, imageUrl: `${R2_BASE}/kyalami.jpg` },
  { circuitKey: 'donington',     name: 'Donington Park',                          country: 'UK',           city: 'Castle Donington', lapCount: 76, trackLengthKm: '4.020', overtakeRate: '0.60', numberOfCorners: 12, drsZones: null, imageUrl: `${R2_BASE}/donington.jpg` },
  { circuitKey: 'okayama',       name: 'TI Circuit Aida',                         country: 'Japan',        city: 'Okayama',        lapCount: 83, trackLengthKm: '3.703', overtakeRate: '0.30', numberOfCorners: 13, drsZones: null, imageUrl: `${R2_BASE}/okayama.jpg` },
  { circuitKey: 'buenos_aires',  name: 'Autódromo Oscar y Juan Gálvez',           country: 'Argentina',    city: 'Buenos Aires',   lapCount: 72, trackLengthKm: '4.259', overtakeRate: '0.40', numberOfCorners: 15, drsZones: null, imageUrl: `${R2_BASE}/buenos_aires.jpg` },
  // 1980-1989 historical circuits
  { circuitKey: 'brands_hatch',  name: 'Brands Hatch',                          country: 'UK',           city: 'Kent',           lapCount: 76, trackLengthKm: '4.207', overtakeRate: '0.500', numberOfCorners: 9,  drsZones: null, imageUrl: `${R2_BASE}/brands_hatch.jpg` },
  { circuitKey: 'zolder',        name: 'Circuit Zolder',                        country: 'Belgium',      city: 'Heusden-Zolder', lapCount: 70, trackLengthKm: '4.262', overtakeRate: '0.450', numberOfCorners: 10, drsZones: null, imageUrl: `${R2_BASE}/zolder.jpg` },
  { circuitKey: 'dijon',         name: 'Dijon-Prenois',                         country: 'France',       city: 'Dijon',          lapCount: 79, trackLengthKm: '3.801', overtakeRate: '0.400', numberOfCorners: 8,  drsZones: null, imageUrl: `${R2_BASE}/dijon.jpg` },
  { circuitKey: 'jacarepagua',   name: 'Jacarepaguá',                           country: 'Brazil',       city: 'Rio de Janeiro', lapCount: 61, trackLengthKm: '5.031', overtakeRate: '0.550', numberOfCorners: 11, drsZones: null, imageUrl: `${R2_BASE}/jacarepagua.jpg` },
  { circuitKey: 'detroit',       name: 'Detroit Street Circuit',                country: 'USA',          city: 'Detroit',        lapCount: 63, trackLengthKm: '4.168', overtakeRate: '0.350', numberOfCorners: 18, drsZones: null, imageUrl: `${R2_BASE}/detroit.jpg` },
  { circuitKey: 'dallas',        name: 'Dallas Fair Park Grand Prix Circuit',   country: 'USA',          city: 'Dallas',         lapCount: 67, trackLengthKm: '3.901', overtakeRate: '0.350', numberOfCorners: 14, drsZones: null, imageUrl: `${R2_BASE}/dallas.jpg` },
  { circuitKey: 'caesars_palace',name: 'Caesars Palace Grand Prix Circuit',     country: 'USA',          city: 'Las Vegas',      lapCount: 75, trackLengthKm: '3.650', overtakeRate: '0.400', numberOfCorners: 14, drsZones: null, imageUrl: `${R2_BASE}/caesars_palace.jpg` },
  { circuitKey: 'watkins_glen',  name: 'Watkins Glen International',            country: 'USA',          city: 'Watkins Glen',   lapCount: 59, trackLengthKm: '5.435', overtakeRate: '0.500', numberOfCorners: 11, drsZones: null, imageUrl: `${R2_BASE}/watkins_glen.jpg` },
  { circuitKey: 'jarama',        name: 'Circuito del Jarama',                    country: 'Spain',        city: 'Madrid',         lapCount: 80, trackLengthKm: '3.404', overtakeRate: '0.300', numberOfCorners: 11, drsZones: null, imageUrl: `${R2_BASE}/jarama.jpg` },
  { circuitKey: 'long_beach',    name: 'Long Beach Street Circuit',             country: 'USA',          city: 'Long Beach',     lapCount: 75, trackLengthKm: '3.275', overtakeRate: '0.450', numberOfCorners: 11, drsZones: null, imageUrl: `${R2_BASE}/long_beach.jpg` },
];

async function seed() {
  const db = createDb(process.env.DATABASE_URL!);

  console.log('Seeding seasons...');
  await db.insert(seasons).values([
    { year: 1980 }, { year: 1981 }, { year: 1982 }, { year: 1983 }, { year: 1984 },
    { year: 1985 }, { year: 1986 }, { year: 1987 }, { year: 1988 }, { year: 1989 },
    { year: 1990 }, { year: 1991 }, { year: 1992 }, { year: 1993 }, { year: 1994 },
    { year: 1995 }, { year: 1996 }, { year: 1997 }, { year: 1998 }, { year: 1999 },
    { year: 2000 }, { year: 2001 }, { year: 2002 }, { year: 2003 }, { year: 2004 },
    { year: 2005 }, { year: 2006 }, { year: 2007 }, { year: 2008 }, { year: 2009 },
    { year: 2010 }, { year: 2011 }, { year: 2012 }, { year: 2013 }, { year: 2014 },
    { year: 2015 }, { year: 2016 }, { year: 2017 },
    { year: 2018 },
    { year: 2019 },
    { year: 2020 },
    { year: 2021 },
    { year: 2022 },
    { year: 2023 },
    { year: 2024 },
    { year: 2025 },
    { year: 2026 },
  ]).onConflictDoNothing();

  console.log('Seeding circuits...');
  const circuitsWithCategory = (CIRCUITS_2025 as Array<Record<string, unknown>>).map(
    (c) => ({ ...c, trackCategory: TRACK_CATEGORY[c.circuitKey] ?? 'balanced' })
  ) as typeof CIRCUITS_2025;
  await db.insert(circuits).values(circuitsWithCategory).onConflictDoNothing();

  console.log('Seed complete.');
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
