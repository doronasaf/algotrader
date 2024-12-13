const axios = require("axios");
const _ = require("lodash");

async function fetchChartData(ticker) {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1m&range=1d`;

    try {
        const response = await axios.get(url);
        const { chart } = response.data;

        // Extract relevant data
        const timestamps = chart.result[0].timestamp;
        const prices = chart.result[0].indicators.quote[0];

        return timestamps.map((timestamp, index) => ({
            timestamp,
            high: prices.high[index],
            low: prices.low[index],
            close: prices.close[index],
            volume: prices.volume[index],
        }));
    } catch (error) {
        console.error("Error fetching chart data:", error.message);
        return [];
    }
}

function calculateVWAP(data) {
    let cumulativePriceVolume = 0;
    let cumulativeVolume = 0;

    return data.map((point) => {
        const typicalPrice = (point.high + point.low + point.close) / 3;
        const priceVolume = typicalPrice * point.volume;

        cumulativePriceVolume += priceVolume;
        cumulativeVolume += point.volume;

        const vwap = cumulativeVolume === 0 ? 0 : cumulativePriceVolume / cumulativeVolume;

        return {
            ...point,
            typicalPrice,
            vwap,
        };
    });
}

function analyzeStrategy(vwapData) {
    const decisions = vwapData.map((point) => {
        const currentPrice = point.close;
        const decision =
            currentPrice < point.vwap
                ? "BUY"
                : currentPrice > point.vwap
                    ? "HOLD/SELL"
                    : "NO ACTION";

        return {
            timestamp: point.timestamp,
            currentPrice,
            vwap: point.vwap,
            decision,
        };
    });

    return decisions;
}

async function main() {
    const ticker = "DXYZ"; // Replace with your desired ticker symbol
    const data = await fetchChartData(ticker);

    if (data.length === 0) {
        console.log("No data retrieved. Exiting...");
        return;
    }

    // Step 1: Calculate VWAP
    const vwapData = calculateVWAP(data);

    // Step 2: Analyze Strategy
    const strategyResults = analyzeStrategy(vwapData);

    // Step 3: Print the results
    console.log("VWAP Analysis and Trading Strategy:");
    console.table(
        strategyResults.map(({ timestamp, currentPrice, vwap, decision }) => ({
            Timestamp: new Date(timestamp * 1000).toLocaleTimeString(),
            "Current Price": currentPrice?.toFixed(2),
            VWAP: vwap?.toFixed(2),
            Decision: decision,
        }))
    );
}

main();
