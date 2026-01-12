// Scheduled Netlify function for daily algo performance data collection
// Runs at 4:35 PM ET (21:35 UTC) Monday-Friday after market close
// Stores data in Netlify Blobs for historical tracking

const { getStore } = require("@netlify/blobs");

const SYMPHONY_IDS = {
    ALPHA: 'lnhlaNYQmLsUGKvawI9Q',
    SHIELD: 'TSWiAWDIUm88ehrvaJnF',
    OMNI: 'xeKmY9ew0Xm0ujRh39nh'
};

// 2025 ending values - baseline for 2026 calculations
const BASELINES = {
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

exports.handler = async (event, context) => {
    const headers = {
        'Content-Type': 'application/json'
    };

    try {
        // Get today's date in ET timezone
        const now = new Date();
        const etDate = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
        const dateString = etDate.toISOString().split('T')[0];
        const dayOfWeek = etDate.getDay();

        // Skip weekends (0 = Sunday, 6 = Saturday)
        if (dayOfWeek === 0 || dayOfWeek === 6) {
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    message: 'Weekend - skipping data collection',
                    date: dateString
                })
            };
        }

        // Get API credentials
        const API_KEY = process.env.COMPOSER_API_KEY;
        const API_SECRET = process.env.COMPOSER_API_SECRET;
        const ACCOUNT_ID = process.env.COMPOSER_ACCOUNT_ID || 'a1acad9f-b26f-4279-b4d3-db7f1f0356e4';

        if (!API_KEY || !API_SECRET) {
            throw new Error('API credentials not configured');
        }

        const authHeaders = {
            'x-api-key-id': API_KEY,
            'authorization': `Bearer ${API_SECRET}`
        };

        // Fetch current symphony stats from Composer
        const statsUrl = `https://api.composer.trade/api/v0.1/portfolio/accounts/${ACCOUNT_ID}/symphony-stats-meta`;
        const response = await fetch(statsUrl, { headers: authHeaders });

        if (!response.ok) {
            throw new Error(`Composer API error: ${response.status}`);
        }

        const data = await response.json();

        // Process symphony data
        const algos = {};
        if (data.symphonies) {
            for (const sym of data.symphonies) {
                const name = sym.name.toUpperCase();
                if (BASELINES[name]) {
                    const baseline = BASELINES[name];
                    const currentValue = sym.value;

                    // Calculate returns
                    const return2026 = ((currentValue - baseline.startValue2026) / baseline.startValue2026) * 100;
                    const returnCumulative = ((currentValue - baseline.originalInvestment) / baseline.originalInvestment) * 100;

                    algos[name] = {
                        symphonyId: SYMPHONY_IDS[name],
                        currentValue: currentValue,
                        return2026: parseFloat(return2026.toFixed(2)),
                        returnCumulative: parseFloat(returnCumulative.toFixed(2)),
                        todayChange: sym.today_change || 0
                    };
                }
            }
        }

        // Create daily snapshot
        const dailySnapshot = {
            date: dateString,
            timestamp: now.getTime(),
            collectedAt: now.toISOString(),
            algos: algos
        };

        // Store in Netlify Blobs
        const store = getBlobStore();

        // Save daily snapshot
        await store.setJSON(`daily/${dateString}`, dailySnapshot);

        // Update baselines if not exists (one-time seed)
        const existingBaselines = await store.get("meta/baselines", { type: "json" }).catch(() => null);
        if (!existingBaselines) {
            await store.setJSON("meta/baselines", BASELINES);
        }

        // Update latest cache
        let latest = await store.get("meta/latest", { type: "json" }).catch(() => null);
        if (!latest) {
            latest = {
                availableDates: [],
                summary: {}
            };
        }

        // Add date if not already present
        if (!latest.availableDates.includes(dateString)) {
            latest.availableDates.push(dateString);
            latest.availableDates.sort();
        }

        latest.lastUpdated = now.toISOString();
        latest.latestDate = dateString;
        latest.summary = {};

        // Update summary with latest returns
        for (const [name, data] of Object.entries(algos)) {
            latest.summary[name] = {
                return2026: data.return2026,
                returnCumulative: data.returnCumulative,
                currentValue: data.currentValue
            };
        }

        await store.setJSON("meta/latest", latest);

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                date: dateString,
                algos: algos,
                message: `Daily data collected for ${dateString}`
            })
        };

    } catch (error) {
        console.error('Daily collection error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
                error: error.message,
                timestamp: new Date().toISOString()
            })
        };
    }
};
