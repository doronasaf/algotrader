import axios from "axios";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Fetch real-time market data
/** fetchMarketData
 * returns an object with the following properties:
 * timestamps: array of timestamps
 * volumes: array of volumes
 * highs: array of highs
 * lows: array of lows
 * closes: array of closes

 * @param ticker
 * @returns {Promise<{timestamps: *, volumes, highs, lows, closes}|null>}
 */
export async function fetchMarketData(ticker) {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1m&range=1d`;
    while (true) {
        try {
            const response = await axios.get(url);
            const {chart} = response.data;

            let timestamps = chart.result[0].timestamp;
            let prices = chart.result[0].indicators.quote[0];
            if (!timestamps || !prices) {
                console.warn("No market data available for symbol:", ticker);
                return null;
            }
            // Return the most recent valid data point
            let lastIndex = 0;
            for (let i = timestamps.length - 1; i > 0; i--) {
                if (timestamps[i] && prices.high[i] && prices.low[i] && prices.close[i] && prices.volume[i]) {
                    lastIndex;
                    break;
                }
                lastIndex++;
            }
            timestamps.splice(-lastIndex, lastIndex); // Remove the last timestamp to avoid incomplete data
            prices.high.splice(-lastIndex, lastIndex);
            prices.low.splice(-lastIndex, lastIndex);
            prices.close.splice(-lastIndex, lastIndex);
            prices.volume.splice(-lastIndex, lastIndex);
            return {
                timestamps: timestamps.map((t) => new Date(t * 1000)),
                highs: prices.high,
                lows: prices.low,
                closes: prices.close,
                volumes: prices.volume
            };
        } catch (error) {
            if (error.response && error.response.status === 429) {
                console.log("Rate limit hit. Waiting 30 seconds...");
                await delay(30000); // Wait 30 seconds
            } else {
                console.error("Error fetching market data:", error.message);
                await delay(5000); // Wait 5 seconds
                return null;
            }
        }
    }
}

export async function fetchMarketDataFromYahoo (ticker) {
    return await fetchMarketData(ticker);
}

// module.exports = {
//     fetchMarketDataFromYahoo: fetchMarketData,
// };