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

        const authHeader = 'Basic ' + Buffer.from(`${API_KEY}:${API_SECRET}`).toString('base64');

        if (action === 'portfolios') {
            const response = await fetch(`https://api.composer.trade/api/v2/portfolio/accounts/${ACCOUNT_ID}/portfolios`, {
                headers: { 'Authorization': authHeader }
            });
            const data = await response.json();
            return { statusCode: 200, headers, body: JSON.stringify(data) };
        }

        if (action === 'symphony-history') {
            // Fetch historical data for all symphonies
            const startDate = '2025-01-01';
            const endDate = '2026-12-31';

            const results = {};

            for (const [name, symphonyId] of Object.entries(SYMPHONY_IDS)) {
                try {
                    const url = `https://api.composer.trade/api/v2/portfolio/accounts/${ACCOUNT_ID}/symphonies/${symphonyId}/daily-values?start_date=${startDate}&end_date=${endDate}`;
                    const response = await fetch(url, {
                        headers: { 'Authorization': authHeader }
                    });

                    if (response.ok) {
                        const data = await response.json();
                        results[name] = data;
                    }
                } catch (e) {
                    console.error(`Error fetching ${name}:`, e);
                }
            }

            // Process and format the data
            const processed = processHistoricalData(results);
            return { statusCode: 200, headers, body: JSON.stringify(processed) };
        }

        // Default: get current portfolio values
        const portfolioData = {};

        for (const [name, symphonyId] of Object.entries(SYMPHONY_IDS)) {
            try {
                const url = `https://api.composer.trade/api/v2/portfolio/accounts/${ACCOUNT_ID}/symphonies/${symphonyId}`;
                const response = await fetch(url, {
                    headers: { 'Authorization': authHeader }
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
    // Find common dates across all symphonies
    const allDates = new Set();

    for (const [name, data] of Object.entries(results)) {
        if (data.daily_values) {
            data.daily_values.forEach(d => allDates.add(d.date));
        }
    }

    const dates = Array.from(allDates).sort();
    if (dates.length === 0) {
        return { dates: [], ALPHA: { values: [], returns: [] }, SHIELD: { values: [], returns: [] }, OMNI: { values: [], returns: [] }, SPY: { values: [], returns: [] } };
    }

    const processed = { dates };

    for (const [name, data] of Object.entries(results)) {
        const valueMap = {};
        if (data.daily_values) {
            data.daily_values.forEach(d => {
                valueMap[d.date] = parseFloat(d.value);
            });
        }

        const values = [];
        const returns = [];
        const startingCapital = STARTING_CAPITAL[name];

        for (const date of dates) {
            const value = valueMap[date] || null;
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

    // Add SPY placeholder (would need Yahoo Finance API for real data)
    processed.SPY = {
        values: dates.map(() => null),
        returns: dates.map(() => null)
    };

    return processed;
}
