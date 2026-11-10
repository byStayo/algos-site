// Public, read-only projection of Composer history. Never return account values, identifiers, holdings or holding-derived quotes.
const NAMES = ['ALPHA', 'SHIELD', 'OMNI', 'SPY'];
const canonical = name => name === 'SHEILD' ? 'SHIELD' : name;
const round = n => Math.round(n * 1e6) / 1e6;

function normalizeHistory(raw, today) {
  const times = raw?.epoch_ms, values = raw?.deposit_adjusted_series;
  if (!Array.isArray(times) || times.length < 2 || !Array.isArray(values) || times.length !== values.length) throw Error('Invalid history');
  const dates = times.map(t => {
    if (!Number.isFinite(t)) throw Error('Invalid observation');
    return new Date(t).toISOString().slice(0, 10);
  });
  if (dates.some((d,i) => d > today || (i && d <= dates[i-1])) || values.some(v => !Number.isFinite(v) || v <= 0)) throw Error('Invalid sequence');
  // Preserve the public comparison's original 2025 baseline; omit earlier OMNI-only history.
  let start = dates.findLastIndex(d => d < '2025-01-01');
  if (start < 0) start = 0;
  const visibleDates = dates.slice(start), index = values.slice(start).map(v => round(v / values[start] * 100));
  const annual = {};
  for (const year of [...new Set(visibleDates.map(d => +d.slice(0,4)))].filter(y => y >= 2025)) {
    const first = visibleDates.findIndex(d => +d.slice(0,4) === year);
    const last = visibleDates.findLastIndex(d => +d.slice(0,4) === year);
    const baseline = Math.max(0, first - 1);
    annual[year] = {return:round((index[last]/index[baseline]-1)*100),baseline:visibleDates[baseline],through:visibleDates[last],partialBaseline:+visibleDates[baseline].slice(0,4) === year};
  }
  return {dates:visibleDates,index,baseline:visibleDates[0],asOf:visibleDates.at(-1),annual};
}

function buildPublic(stats, histories, now = new Date()) {
  const today = now.toISOString().slice(0,10), strategies = {};
  for (const name of NAMES) {
    const matches = stats.symphonies.filter(row => canonical(row.name) === name);
    if (matches.length !== 1) throw Error('Ambiguous strategy');
    strategies[name] = normalizeHistory(histories[name], today);
  }
  return {schemaVersion:2,asOf:NAMES.map(n=>strategies[n].asOf).sort()[0],retrievedAt:now.toISOString(),source:'Composer API: cash-flow-adjusted historical series',cadence:'Source observations are daily; the website checks for updates every five minutes while visible.',method:'Percentage change in the deposit-adjusted historical series. Each year uses its last available prior-year observation; SPY starts on 2 January 2025. Historical-series returns may differ slightly from Composer summary TWR.',strategies,quotes:[]};
}

async function source(path) {
  const base = 'https://api.composer.trade/api/v0.1/portfolio/accounts/';
  const response = await fetch(base + encodeURIComponent(process.env.COMPOSER_ACCOUNT_ID) + path, {headers:{'x-api-key-id':process.env.COMPOSER_API_KEY,Authorization:'Bearer '+process.env.COMPOSER_API_SECRET},signal:AbortSignal.timeout(18000)});
  if (!response.ok) throw Error('Source unavailable');
  return response.json();
}

exports.handler = async event => {
  const headers = {'Content-Type':'application/json; charset=utf-8','Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, OPTIONS','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'};
  if (event.httpMethod === 'OPTIONS') return {statusCode:204,headers,body:''};
  if (event.httpMethod !== 'GET') return {statusCode:405,headers:{...headers,Allow:'GET, OPTIONS'},body:'{"error":"Method not allowed"}'};
  try {
    if (['COMPOSER_ACCOUNT_ID','COMPOSER_API_KEY','COMPOSER_API_SECRET'].some(k=>!process.env[k])) throw Error('Configuration unavailable');
    const stats = await source('/symphony-stats-meta');
    if (!Array.isArray(stats.symphonies)) throw Error('Invalid source');
    const rows = NAMES.map(name=>{
      const matches=stats.symphonies.filter(row=>canonical(row.name)===name);
      if(matches.length!==1 || typeof matches[0].id!=='string') throw Error('Incomplete source');
      return {name,row:matches[0]};
    });
    const histories = Object.fromEntries(await Promise.all(rows.map(async ({name,row})=>[name,await source('/symphonies/'+encodeURIComponent(row.id))])));
    const data = buildPublic(stats,histories);
    return {statusCode:200,headers:{...headers,'Netlify-CDN-Cache-Control':'public, durable, max-age=300, stale-while-revalidate=60'},body:JSON.stringify(data)};
  } catch {
    // Never replace missing source observations with estimated paths or a new timestamp.
    return {statusCode:503,headers:{...headers,'Cache-Control':'no-store'},body:'{"error":"Verified performance is temporarily unavailable"}'};
  }
};
exports.buildPublic = buildPublic;
