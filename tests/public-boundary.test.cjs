const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {buildPublic, handler} = require('../netlify/functions/public-performance.js');
const names = ['ALPHA', 'SHIELD', 'OMNI', 'SPY'];
const histories = Object.fromEntries(names.map(name => [name, {
  epoch_ms: [Date.parse('2024-12-31'), Date.parse('2025-12-31'), Date.parse('2026-01-02')],
  deposit_adjusted_series: [1000, 1100, 1155],
  account_id: 'PRIVATE_ACCOUNT_CANARY', holdings: [{ticker: 'PRIVATE_HOLDING_CANARY'}]
}]));
const stats = {symphonies: names.map(name => ({name, id:'PRIVATE_ID_'+name,
  get holdings(){throw Error('Private holdings must never be inspected for public output');}
}))};

test('results projection ignores holdings and excludes private source fields', () => {
  const result = buildPublic(stats, histories, new Date('2026-01-03'));
  assert.deepEqual(result.quotes, []);
  assert.equal(result.strategies.ALPHA.annual[2025].return, 10);
  assert.equal(result.strategies.ALPHA.annual[2026].return, 5);
  assert.ok(!JSON.stringify(result).includes('PRIVATE_'));
  for(const row of Object.values(result.strategies)) {
    assert.deepEqual(Object.keys(row).sort(), ['annual','asOf','baseline','dates','index'].sort());
  }
});

test('every retired proxy rejects all query/action variants without reading credentials or upstream', async () => {
  const original = global.fetch; let calls = 0;
  global.fetch = async () => { calls++; throw Error('Must not call upstream'); };
  try {
    for(const file of ['composer-api','live-data','historical-data']) {
      const retired = require('../netlify/functions/'+file+'.js').handler;
      for(const method of ['GET','POST','OPTIONS']) for(const action of ['portfolios','debug','holdings','symphony-stats','symphony-history','baselines','full-history',undefined]) {
        const response = await retired({httpMethod:method,queryStringParameters:{action,symphony:'PRIVATE_ID'}});
        assert.equal(response.statusCode, 410);
        assert.equal(response.headers['Cache-Control'], 'no-store');
        assert.ok(!response.body.includes('PRIVATE_'));
      }
    }
    assert.equal(calls, 0);
  } finally { global.fetch = original; }
});

test('public HTTP function preserves dated returns while omitting source records', async () => {
  const originalFetch = global.fetch;
  const keys = ['COMPOSER_ACCOUNT_ID','COMPOSER_API_KEY','COMPOSER_API_SECRET'];
  const previous = keys.map(k => process.env[k]);
  keys.forEach(k => process.env[k] = 'SYNTHETIC_'+k);
  global.fetch = async url => ({ok:true,json:async () => url.endsWith('/symphony-stats-meta') ? stats : histories.ALPHA});
  try {
    const response = await handler({httpMethod:'GET'});
    assert.equal(response.statusCode, 200);
    const result = JSON.parse(response.body);
    assert.deepEqual(result.quotes, []);
    assert.equal(result.strategies.OMNI.annual[2026].return, 5);
    assert.ok(!response.body.includes('PRIVATE_'));
    assert.ok(!response.body.includes('SYNTHETIC_'));
    assert.equal((await handler({httpMethod:'POST'})).statusCode,405);
  } finally {
    global.fetch = originalFetch;
    keys.forEach((key,i) => previous[i] === undefined ? delete process.env[key] : process.env[key] = previous[i]);
  }
});

test('static publishing excludes function sources and old account dashboards', () => {
  const root = path.resolve(__dirname,'..');
  assert.match(fs.readFileSync(path.join(root,'netlify.toml'),'utf8'), /publish\s*=\s*"public"/);
  assert.deepEqual(fs.readdirSync(path.join(root,'public')).sort(), ['_redirects','index.html']);
  const redirects = fs.readFileSync(path.join(root,'public/_redirects'),'utf8');
  assert.match(redirects, /\/live\.html https:\/\/anastasiadesglobal\.com\/proprietary-algorithms\/#verified-performance 302/);
});
