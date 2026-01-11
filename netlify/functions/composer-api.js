// Netlify serverless function to proxy Composer API requests
// Avoids CORS issues and keeps credentials secure

const STARTING_CAPITAL = {
    ALPHA: 1000,
    SHIELD: 1000,
    OMNI: 1000,
    SPY: 50
};

const SYMPHONY_IDS = {
    ALPHA: 'sym_sNTi0P87mEFRgqqj3gkj',
    SHIELD: 'sym_K3wOORPKKdNBVq9B4sPI',
    OMNI: 'sym_PXLsUh4y1X73wwNMAzCa'
};

exports.handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Content-Type': 'application/json'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers, body: '' };
    }

    const action = event.queryStringParameters?.action;

    try {
        // Get credentials from environment variables
        const API_KEY = process.env.COMPOSER_API_KEY;
        const API_SECRET = process.env.COMPOSER_API_SECRET;
        const ACCOUNT_ID = process.env.COMPOSER_ACCOUNT_ID;

        if (!API_KEY || !API_SECRET) {
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({ error: 'API credentials not configured' })
            };
        }

        // Correct Composer API authentication headers
        const authHeaders = {
            'x-api-key-id': API_KEY,
            'authorization': `Bearer ${API_SECRET}`
        };

        if (action === 'portfolios') {
            const response = await fetch(`https://api.composer.trade/api/v0.1/accounts/list`, {
                headers: authHeaders
            });
            const data = await response.json();
            return { statusCode: 200, headers, body: JSON.stringify(data) };
        }

        if (action === 'symphony-history') {
            // Fetch historical data for all symphonies using the correct endpoint
            const results = {};

            for (const [name, symphonyId] of Object.entries(SYMPHONY_IDS)) {
                try {
                    // Use the symphony endpoint which returns epoch_ms and series
                    const url = `https://api.composer.trade/api/v0.1/portfolio/accounts/${ACCOUNT_ID}/symphonies/${symphonyId}`;
                    const response = await fetch(url, {
                        headers: authHeaders
                    });

                    if (response.ok) {
                        const data = await response.json();
                        // Convert epoch_ms and series to our format
                        if (data.epoch_ms && data.series) {
                            results[name] = {
                                epoch_ms: data.epoch_ms,
                                series: data.series,
                                deposit_adjusted_series: data.deposit_adjusted_series || data.series
                            };
                        }
                    }
                } catch (e) {
                    console.error(`Error fetching ${name}:`, e);
                }
            }

            // Process and format the data
            const processed = processHistoricalDataV2(results);
            return { statusCode: 200, headers, body: JSON.stringify(processed) };
        }

        // Debug action to explore available endpoints
        if (action === 'debug') {
            const results = {};

            // List all symphonies for this account
            const endpoints = [
                { name: 'symphonies_list', url: `/portfolio/accounts/${ACCOUNT_ID}/symphonies` },
                { name: 'account_summary', url: `/accounts/${ACCOUNT_ID}` },
                { name: 'account_portfolio', url: `/accounts/${ACCOUNT_ID}/portfolio` },
            ];

            for (const ep of endpoints) {
                try {
                    const response = await fetch(`https://api.composer.trade/api/v0.1${ep.url}`, { headers: authHeaders });
                    const data = await response.json();
                    results[ep.name] = { status: response.status, data: data };
                } catch (e) {
                    results[ep.name] = { error: e.message };
                }
            }

            // Check symphonies with different URL patterns
            const symphonyId = SYMPHONY_IDS.ALPHA;
            const testUrls = [
                { name: 'symphony_basic', url: `/portfolio/accounts/${ACCOUNT_ID}/symphonies/${symphonyId}` },
                { name: 'symphony_with_dates', url: `/portfolio/accounts/${ACCOUNT_ID}/symphonies/${symphonyId}?start_date=2024-01-01&end_date=2025-12-31` },
                { name: 'symphony_series', url: `/portfolio/accounts/${ACCOUNT_ID}/symphonies/${symphonyId}/series` },
                { name: 'symphony_values', url: `/portfolio/accounts/${ACCOUNT_ID}/symphonies/${symphonyId}/values` },
                { name: 'backtest', url: `/symphonies/${symphonyId}/backtest` },
                { name: 'symphony_public', url: `/symphonies/${symphonyId}` },
            ];

            for (const t of testUrls) {
                try {
                    const response = await fetch(`https://api.composer.trade/api/v0.1${t.url}`, { headers: authHeaders });
                    const data = await response.json();
                    results[t.name] = { status: response.status, sample: JSON.stringify(data).slice(0, 500) };
                } catch (e) {
                    results[t.name] = { error: e.message };
                }
            }

            return { statusCode: 200, headers, body: JSON.stringify(results) };
        }

        // Default: get current portfolio values
        const portfolioData = {};

        for (const [name, symphonyId] of Object.entries(SYMPHONY_IDS)) {
            try {
                const url = `https://api.composer.trade/api/v0.1/portfolio/accounts/${ACCOUNT_ID}/symphonies/${symphonyId}`;
                const response = await fetch(url, {
                    headers: authHeaders
                });

                if (response.ok) {
                    const data = await response.json();
                    const currentValue = parseFloat(data.current_value || 0);
                    const startingCapital = STARTING_CAPITAL[name];

                    // Calculate return from known starting capital
                    const ytdReturn = ((currentValue / startingCapital) - 1) * 100;

                    portfolioData[name] = {
                        value: currentValue,
                        return: ytdReturn,
                        startingCapital
                    };
                }
            } catch (e) {
                console.error(`Error fetching ${name}:`, e);
            }
        }

        return { statusCode: 200, headers, body: JSON.stringify(portfolioData) };

    } catch (error) {
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: error.message })
        };
    }
};

function processHistoricalData(results) {
    // Legacy function - kept for compatibility
    return { dates: [], ALPHA: { values: [], returns: [] }, SHIELD: { values: [], returns: [] }, OMNI: { values: [], returns: [] }, SPY: { values: [], returns: [] } };
}

function processHistoricalDataV2(results) {
    // Process new format with epoch_ms and series arrays
    const allTimestamps = new Set();

    // Collect all timestamps
    for (const [name, data] of Object.entries(results)) {
        if (data.epoch_ms && data.epoch_ms.length > 0) {
            data.epoch_ms.forEach(ts => allTimestamps.add(ts));
        }
    }

    const timestamps = Array.from(allTimestamps).sort((a, b) => a - b);
    if (timestamps.length === 0) {
        return { dates: [], ALPHA: { values: [], returns: [] }, SHIELD: { values: [], returns: [] }, OMNI: { values: [], returns: [] }, SPY: { values: [], returns: [] } };
    }

    // Convert timestamps to date strings
    const dates = timestamps.map(ts => {
        const d = new Date(ts);
        return d.toISOString().split('T')[0];
    });

    const processed = { dates };

    for (const [name, data] of Object.entries(results)) {
        const tsValueMap = {};
        if (data.epoch_ms && data.series) {
            for (let i = 0; i < data.epoch_ms.length; i++) {
                tsValueMap[data.epoch_ms[i]] = data.series[i];
            }
        }

        const values = [];
        const returns = [];
        const startingCapital = STARTING_CAPITAL[name];

        for (const ts of timestamps) {
            const value = tsValueMap[ts] !== undefined ? tsValueMap[ts] : null;
            values.push(value);

            if (value !== null) {
                const ret = ((value / startingCapital) - 1) * 100;
                returns.push(parseFloat(ret.toFixed(2)));
            } else {
                returns.push(null);
            }
        }

        processed[name] = { values, returns };
    }

    // Add SPY placeholder (fetched separately via Finnhub)
    processed.SPY = {
        values: dates.map(() => null),
        returns: dates.map(() => null)
    };

    return processed;
}
