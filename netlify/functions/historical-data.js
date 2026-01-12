// Netlify function for retrieving historical algo performance data
// Reads from Netlify Blobs storage populated by collect-daily-data.js

const { getStore } = require("@netlify/blobs");

// Default baselines in case Blobs hasn't been seeded yet
const DEFAULT_BASELINES = {
    ALPHA: { startValue2026: 1368.85, return2025: 36.88, originalInvestment: 1000 },
    SHIELD: { startValue2026: 1179.20, return2025: 17.92, originalInvestment: 1000 },
    OMNI: { startValue2026: 1165.90, return2025: 16.59, originalInvestment: 1000 }
};

// Helper to get store with proper configuration
function getBlobStore() {
    const siteID = process.env.SITE_ID || process.env.NETLIFY_SITE_ID;
    const token = process.env.NETLIFY_TOKEN || process.env.NETLIFY_ACCESS_TOKEN;

    if (siteID && token) {
        return getStore({
            name: "algo-performance",
            siteID,
            token
        });
    }
    // Fall back to automatic context (works in scheduled functions)
    return getStore("algo-performance");
}

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

    const action = event.queryStringParameters?.action;

    try {
        let store;
        let blobsAvailable = true;

        try {
            store = getBlobStore();
            // Test if store is actually working
            await store.get("test-connection").catch(() => null);
        } catch (e) {
            console.log('Blobs not available, using fallback data:', e.message);
            blobsAvailable = false;
        }

        // Get baselines
        if (action === 'baselines') {
            let baselines = DEFAULT_BASELINES;
            if (blobsAvailable) {
                baselines = await store.get("meta/baselines", { type: "json" }).catch(() => null) || DEFAULT_BASELINES;
            }
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({ baselines })
            };
        }

        // Get summary (latest data only)
        if (action === 'summary') {
            if (!blobsAvailable) {
                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify({
                        message: 'Data collection starting soon - using baseline data',
                        summary: null,
                        baselines: DEFAULT_BASELINES
                    })
                };
            }

            const latest = await store.get("meta/latest", { type: "json" }).catch(() => null);

            if (!latest) {
                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify({
                        message: 'No data collected yet',
                        summary: null,
                        baselines: DEFAULT_BASELINES
                    })
                };
            }

            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    lastUpdated: latest.lastUpdated,
                    latestDate: latest.latestDate,
                    summary: latest.summary,
                    totalDays: latest.availableDates?.length || 0,
                    baselines: DEFAULT_BASELINES
                })
            };
        }

        // Get full history for charting
        if (action === 'full-history') {
            if (!blobsAvailable) {
                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify({
                        message: 'Data collection starting soon - using baseline data',
                        dates: [],
                        baselines: DEFAULT_BASELINES,
                        algos: {
                            ALPHA: { dates: [], values: [], returns2026: [], returnsCumulative: [] },
                            SHIELD: { dates: [], values: [], returns2026: [], returnsCumulative: [] },
                            OMNI: { dates: [], values: [], returns2026: [], returnsCumulative: [] }
                        },
                        lastUpdated: null
                    })
                };
            }

            const latest = await store.get("meta/latest", { type: "json" }).catch(() => null);
            let baselines = await store.get("meta/baselines", { type: "json" }).catch(() => null);

            if (!baselines) {
                baselines = DEFAULT_BASELINES;
            }

            if (!latest || !latest.availableDates || latest.availableDates.length === 0) {
                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify({
                        message: 'No historical data collected yet',
                        dates: [],
                        baselines: baselines,
                        algos: {
                            ALPHA: { dates: [], values: [], returns2026: [], returnsCumulative: [] },
                            SHIELD: { dates: [], values: [], returns2026: [], returnsCumulative: [] },
                            OMNI: { dates: [], values: [], returns2026: [], returnsCumulative: [] }
                        },
                        lastUpdated: null
                    })
                };
            }

            // Fetch all daily snapshots
            const dailyData = [];
            for (const date of latest.availableDates) {
                try {
                    const snapshot = await store.get(`daily/${date}`, { type: "json" });
                    if (snapshot) {
                        dailyData.push(snapshot);
                    }
                } catch (e) {
                    console.error(`Error fetching ${date}:`, e);
                }
            }

            // Format for charting
            const algos = {
                ALPHA: { dates: [], values: [], returns2026: [], returnsCumulative: [] },
                SHIELD: { dates: [], values: [], returns2026: [], returnsCumulative: [] },
                OMNI: { dates: [], values: [], returns2026: [], returnsCumulative: [] }
            };

            for (const snapshot of dailyData) {
                for (const [name, data] of Object.entries(snapshot.algos || {})) {
                    if (algos[name]) {
                        algos[name].dates.push(snapshot.date);
                        algos[name].values.push(data.currentValue);
                        algos[name].returns2026.push(data.return2026);
                        algos[name].returnsCumulative.push(data.returnCumulative);
                    }
                }
            }

            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    dates: latest.availableDates,
                    baselines: baselines,
                    algos: algos,
                    lastUpdated: latest.lastUpdated,
                    latestDate: latest.latestDate
                })
            };
        }

        // Get specific date range
        if (action === 'range') {
            if (!blobsAvailable) {
                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify({ dates: [], data: [] })
                };
            }

            const startDate = event.queryStringParameters?.start;
            const endDate = event.queryStringParameters?.end;

            const latest = await store.get("meta/latest", { type: "json" }).catch(() => null);

            if (!latest || !latest.availableDates) {
                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify({ dates: [], data: [] })
                };
            }

            // Filter dates in range
            const filteredDates = latest.availableDates.filter(d => {
                if (startDate && d < startDate) return false;
                if (endDate && d > endDate) return false;
                return true;
            });

            const data = [];
            for (const date of filteredDates) {
                try {
                    const snapshot = await store.get(`daily/${date}`, { type: "json" });
                    if (snapshot) {
                        data.push(snapshot);
                    }
                } catch (e) {
                    console.error(`Error fetching ${date}:`, e);
                }
            }

            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    dates: filteredDates,
                    data: data
                })
            };
        }

        // Trigger manual collection (for testing/seeding)
        if (action === 'collect-now') {
            // Import and call the collect function
            const collectHandler = require('./collect-daily-data').handler;
            const result = await collectHandler(event, {});
            return result;
        }

        // Default: return available actions
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                availableActions: ['baselines', 'summary', 'full-history', 'range', 'collect-now'],
                description: 'Historical algo performance data API',
                baselines: DEFAULT_BASELINES
            })
        };

    } catch (error) {
        console.error('Historical data error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: error.message })
        };
    }
};
