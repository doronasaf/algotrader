// const config = require('../config/config.json');
// const { fetchMarketDataFromYahoo } = require("../broker/yahoo/quoteService");
// const { fetchMarketDataFromAlpaca, handleQuoteUpdate } = require("../broker/alpaca/quoteService");
// const { fetchMarketDataFromBackTester } = require("../backtesting/BackTester");
import appConfig from '../config/AppConfig.mjs';
import { fetchMarketDataFromYahoo } from "./yahoo/quoteService.mjs";
import { fetchMarketDataFromAlpaca, handleQuoteUpdate } from "./alpaca/quoteService.mjs";
import { fetchMarketDataFromBackTester } from "../backtesting/BackTester.mjs";
import { MarketDataStreamer } from "../broker/ibkr/quoteService.mjs";

const mode = appConfig().dataSource.provider; // 'yahoo' or 'alpacaStream' or ibkr or backtesting

let streamingInitialized = false;
const marketDataStreamer = new MarketDataStreamer(); // Single instance for managing all streaming symbols
const symbolDataBuffers = new Map(); // Buffer for holding rolling market data for symbols

export async function fetchMarketData (symbol) {
    let closes, highs, lows, volumes, update;
    let marketData;
    if (mode === 'ibkr') {
        // Check if symbol is already subscribed for streaming
        if (!symbolDataBuffers.has(symbol)) {
            await initializeStreaming(symbol);
        }
        // Fetch the most recent 5-minute rolling data from the buffer
        const rollingData = symbolDataBuffers.get(symbol);

        if (rollingData?.length >= 25) { // Ensure sufficient data points for analysis
            closes = rollingData.map(d => d.close);
            highs = rollingData.map(d => d.high);
            lows = rollingData.map(d => d.low);
            volumes = rollingData.map(d => d.volume);
        } else {
            console.warn(`Insufficient data for ${symbol}. Buffer size: ${rollingData?.length || 0}`);
        }
    } else if (mode === 'alpacaStream') {
        marketData = await fetchMarketDataFromAlpaca(symbol, handleQuoteUpdate(update)); // Updates the buffer and fetches last 100 data points
        if (marketDataIsValid(marketData)) {
            // Extract OHLC arrays for analysis
            closes = marketData.map(d => d.close);
            highs = marketData.map(d => d.high);
            lows = marketData.map(d => d.low);
            volumes = marketData.map(d => d.volume);
        }
    } else if (mode === 'yahoo') {
        marketData = await fetchMarketDataFromYahoo(symbol); // yahoo finance
        if (marketDataIsValid(marketData)) {
            closes = marketData.closes;
            highs = marketData.highs;
            lows = marketData.lows;
            volumes = marketData.volumes;
        }
    } else if (mode === 'backtesting') {
        marketData = await fetchMarketDataFromBackTester(symbol); // yahoo finance
        if (marketDataIsValid(marketData)) {
            closes = marketData.closes;
            highs = marketData.highs;
            lows = marketData.lows;
            volumes = marketData.volumes;
        }
    }
    return { closes, highs, lows, volumes };
}

// Initialize streaming for a symbol and set up its buffer
async function initializeStreaming(symbol) {
    if (streamingInitialized && symbolDataBuffers.has(symbol)) return;

    await marketDataStreamer.addSymbol(symbol, (rollingData) => {
        // Store the rolling data in the buffer
        symbolDataBuffers.set(symbol, rollingData);
    });

    streamingInitialized = true;
    console.log(`Initialized streaming for ${symbol}`);
}


function marketDataIsValid(marketData) {
    let dataIsValid = true;
    if (mode === 'alpacaStream') {
        if (!marketData) {
            console.warn("No market data available.");
            dataIsValid = false;
        } else if (!marketData?.length) {
            console.warn("Missing market data length.");
            dataIsValid = false;
        } else if (marketData?.length < 20) { // Minimum data points for analysis TBD CHANGE WHEN WORKING IN REALTIME ASAF ZZZZZZZ
            // console.warn("Insufficient data for analysis... filling buffer.");
            dataIsValid = false;
        }
    } else if (mode === 'yahoo') {
        if (!marketData) {
            console.warn("No market data available.");
            dataIsValid = false;
        }
    }
    return dataIsValid;
}

// module.exports = {
//     fetchMarketData,
// }