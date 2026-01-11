// Netlify serverless function to fetch stock data from Finnhub
// Provides real historical stock data for comparison

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
    const endDate = event.queryStringParameters?.end;

    if (!ticker) {
        return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'Missing ticker parameter' })
        };
    }

    try {
        const API_KEY = process.env.FINNHUB_API_KEY;

        if (!API_KEY) {
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({
                    error: 'Finnhub API key not configured',
                    envKeys: Object.keys(process.env).filter(k => k.includes('FINN') || k.includes('API'))
                })
            };
        }

        // Convert dates to Unix timestamps
        const startTimestamp = Math.floor(new Date(startDate).getTime() / 1000);
        const endTimestamp = endDate
            ? Math.floor(new Date(endDate).getTime() / 1000)
            : Math.floor(Date.now() / 1000);

        // Fetch candle data from Finnhub
        const url = `https://finnhub.io/api/v1/stock/candle?symbol=${ticker}&resolution=D&from=${startTimestamp}&to=${endTimestamp}&token=${API_KEY}`;

        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`Finnhub returned ${response.status}`);
        }

        const data = await response.json();

        if (data.s === 'no_data' || !data.t || data.t.length === 0) {
            return {
                statusCode: 404,
                headers,
                body: JSON.stringify({ error: `No data found for ${ticker}` })
            };
        }

        // Process the data
        const dates = [];
        const values = [];
        const returns = [];

        // Normalize to $1000 starting value for comparison
        const startPrice = data.c[0];

        for (let i = 0; i < data.t.length; i++) {
            const timestamp = data.t[i];
            const close = data.c[i];

            // Convert timestamp to date string
            const date = new Date(timestamp * 1000).toISOString().split('T')[0];
            dates.push(date);

            // Normalize value to $1000 start
            const normalizedValue = (close / startPrice) * 1000;
            values.push(parseFloat(normalizedValue.toFixed(2)));

            // Calculate return percentage
            const returnPct = ((close / startPrice) - 1) * 100;
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
                currentPrice: data.c[data.c.length - 1],
                dataPoints: dates.length
            })
        };

    } catch (error) {
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
                error: error.message,
                stack: error.stack,
                ticker: ticker
            })
        };
    }
};
