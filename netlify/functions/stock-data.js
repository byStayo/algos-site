// Netlify serverless function to fetch stock data from Yahoo Finance
// Normalizes data to $1000 starting point for comparison

exports.handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Content-Type': 'application/json'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers, body: '' };
    }

    const ticker = event.queryStringParameters?.ticker?.toUpperCase();
    const startDate = event.queryStringParameters?.start || '2025-01-01';
    const endDate = event.queryStringParameters?.end || '2026-12-31';

    if (!ticker) {
        return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'Missing ticker parameter' })
        };
    }

    try {
        // Convert dates to Unix timestamps
        const start = Math.floor(new Date(startDate).getTime() / 1000);
        const end = Math.floor(new Date(endDate).getTime() / 1000);

        // Yahoo Finance API URL
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?period1=${start}&period2=${end}&interval=1d`;

        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        if (!response.ok) {
            throw new Error(`Yahoo Finance returned ${response.status}`);
        }

        const data = await response.json();

        if (data.chart?.error) {
            throw new Error(data.chart.error.description || 'Unknown error');
        }

        const result = data.chart?.result?.[0];
        if (!result) {
            throw new Error('No data returned for ticker');
        }

        const timestamps = result.timestamp || [];
        const quotes = result.indicators?.quote?.[0] || {};
        const closes = quotes.close || [];

        // Format dates and calculate returns normalized to $1000
        const dates = [];
        const values = [];
        const returns = [];

        let startPrice = null;

        for (let i = 0; i < timestamps.length; i++) {
            const close = closes[i];
            if (close === null || close === undefined) continue;

            if (startPrice === null) {
                startPrice = close;
            }

            const date = new Date(timestamps[i] * 1000).toISOString().split('T')[0];
            const normalizedValue = (close / startPrice) * 1000;
            const returnPct = ((close / startPrice) - 1) * 100;

            dates.push(date);
            values.push(parseFloat(normalizedValue.toFixed(2)));
            returns.push(parseFloat(returnPct.toFixed(2)));
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                ticker,
                dates,
                values,
                returns,
                startPrice,
                currentPrice: closes[closes.length - 1],
                dataPoints: dates.length
            })
        };

    } catch (error) {
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: error.message })
        };
    }
};
