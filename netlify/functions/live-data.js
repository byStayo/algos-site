// Netlify serverless function for live 2026 algo tracking
// Provides real-time portfolio stats, holdings, and performance data

const SYMPHONY_IDS = {
    ALPHA: 'lnhlaNYQmLsUGKvawI9Q',
    SHIELD: 'TSWiAWDIUm88ehrvaJnF',
    OMNI: 'xeKmY9ew0Xm0ujRh39nh'
};

const STARTING_CAPITAL = {
    ALPHA: 1000,
    SHIELD: 1000,
    OMNI: 1000
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
        const API_KEY = process.env.COMPOSER_API_KEY;
        const API_SECRET = process.env.COMPOSER_API_SECRET;
        const ACCOUNT_ID = process.env.COMPOSER_ACCOUNT_ID;

        if (!API_KEY || !API_SECRET || !ACCOUNT_ID) {
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({ error: 'API credentials not configured' })
            };
        }

        const authHeaders = {
            'x-api-key-id': API_KEY,
            'authorization': `Bearer ${API_SECRET}`
        };

        // Get aggregate portfolio stats
        if (action === 'portfolio-stats') {
            const url = `https://api.composer.trade/api/v0.1/portfolio/accounts/${ACCOUNT_ID}/aggregate-portfolio-stats`;
            const response = await fetch(url, { headers: authHeaders });

            if (!response.ok) {
                return { statusCode: response.status, headers, body: JSON.stringify({ error: 'Failed to fetch portfolio stats' }) };
            }

            const data = await response.json();
            return { statusCode: 200, headers, body: JSON.stringify(data) };
        }

        // Get per-symphony stats
        if (action === 'symphony-stats') {
            const url = `https://api.composer.trade/api/v0.1/portfolio/accounts/${ACCOUNT_ID}/symphony-stats-meta`;
            const response = await fetch(url, { headers: authHeaders });

            if (!response.ok) {
                return { statusCode: response.status, headers, body: JSON.stringify({ error: 'Failed to fetch symphony stats' }) };
            }

            const data = await response.json();

            // Format response with calculated returns from starting capital
            const formattedStats = {};
            if (data.symphonies) {
                for (const sym of data.symphonies) {
                    const name = sym.name.toUpperCase();
                    const startingCap = STARTING_CAPITAL[name] || 1000;
                    formattedStats[name] = {
                        id: sym.symphony_id,
                        name: sym.name,
                        value: sym.value,
                        realReturn: ((sym.value / startingCap) - 1) * 100,
                        timeWeightedReturn: sym.time_weighted_return * 100,
                        investedSince: sym.invested_since,
                        todayChange: sym.today_change || 0,
                        sharpeRatio: sym.sharpe_ratio
                    };
                }
            }

            return { statusCode: 200, headers, body: JSON.stringify({ symphonies: formattedStats, raw: data }) };
        }

        // Get current holdings
        if (action === 'holdings') {
            const url = `https://api.composer.trade/api/v0.1/portfolio/accounts/${ACCOUNT_ID}/holdings`;
            const response = await fetch(url, { headers: authHeaders });

            if (!response.ok) {
                return { statusCode: response.status, headers, body: JSON.stringify({ error: 'Failed to fetch holdings' }) };
            }

            const data = await response.json();
            return { statusCode: 200, headers, body: JSON.stringify(data) };
        }

        // Get daily performance for 2026
        if (action === 'daily-performance') {
            const symphonyId = event.queryStringParameters?.symphony;

            if (symphonyId) {
                // Get specific symphony performance
                const url = `https://api.composer.trade/api/v0.1/portfolio/accounts/${ACCOUNT_ID}/symphonies/${symphonyId}/performance`;
                const response = await fetch(url, { headers: authHeaders });

                if (!response.ok) {
                    return { statusCode: response.status, headers, body: JSON.stringify({ error: 'Failed to fetch symphony performance' }) };
                }

                const data = await response.json();

                // Filter to 2026 only
                const jan2026 = new Date('2026-01-01').getTime();
                const result = filterPerformanceTo2026(data, jan2026);

                return { statusCode: 200, headers, body: JSON.stringify(result) };
            } else {
                // Get all symphonies' performance
                const results = {};

                for (const [name, id] of Object.entries(SYMPHONY_IDS)) {
                    try {
                        const url = `https://api.composer.trade/api/v0.1/portfolio/accounts/${ACCOUNT_ID}/symphonies/${id}/performance`;
                        const response = await fetch(url, { headers: authHeaders });

                        if (response.ok) {
                            const data = await response.json();
                            const jan2026 = new Date('2026-01-01').getTime();
                            results[name] = filterPerformanceTo2026(data, jan2026);
                        }
                    } catch (e) {
                        console.error(`Error fetching ${name}:`, e);
                    }
                }

                return { statusCode: 200, headers, body: JSON.stringify(results) };
            }
        }

        // Get market hours
        if (action === 'market-hours') {
            const url = `https://api.composer.trade/api/v0.1/market/hours`;
            const response = await fetch(url, { headers: authHeaders });

            if (!response.ok) {
                // Fallback: calculate market hours based on current time
                const now = new Date();
                const nyTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
                const hour = nyTime.getHours();
                const minute = nyTime.getMinutes();
                const day = nyTime.getDay();

                const isWeekday = day >= 1 && day <= 5;
                const isMarketHours = hour >= 9 && (hour < 16 || (hour === 9 && minute >= 30));

                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify({
                        isOpen: isWeekday && isMarketHours,
                        currentTime: nyTime.toISOString(),
                        nextOpen: isMarketHours ? null : 'Next market open at 9:30 AM ET'
                    })
                };
            }

            const data = await response.json();
            return { statusCode: 200, headers, body: JSON.stringify(data) };
        }

        // Default: return available actions
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                availableActions: ['portfolio-stats', 'symphony-stats', 'holdings', 'daily-performance', 'market-hours'],
                symphonyIds: SYMPHONY_IDS
            })
        };

    } catch (error) {
        console.error('Live data error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: error.message })
        };
    }
};

function filterPerformanceTo2026(data, jan2026Timestamp) {
    if (!data.dates || !data.series) {
        return { dates: [], values: [], returns: [] };
    }

    // Find start index for 2026
    const startIdx = data.dates.findIndex(d => new Date(d).getTime() >= jan2026Timestamp);

    if (startIdx === -1) {
        return { dates: [], values: [], returns: [], note: 'No 2026 data yet' };
    }

    const dates = data.dates.slice(startIdx);
    const values = data.series.slice(startIdx);
    const adjustedValues = data.deposit_adjusted_series ? data.deposit_adjusted_series.slice(startIdx) : values;

    // Calculate returns from first day of 2026
    const startValue = values[0];
    const returns = values.map(v => ((v / startValue) - 1) * 100);

    return {
        dates,
        values,
        adjustedValues,
        returns: returns.map(r => parseFloat(r.toFixed(2))),
        startValue,
        currentValue: values[values.length - 1],
        totalReturn: parseFloat(returns[returns.length - 1].toFixed(2))
    };
}
