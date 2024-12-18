// const config = require('../config/config.json');
// const { fetchMarketDataFromYahoo } = require("../broker/yahoo/quoteService");
// const { fetchMarketDataFromAlpaca, handleQuoteUpdate } = require("../broker/alpaca/quoteService");
// const { fetchMarketDataFromBackTester } = require("../backtesting/BackTester");
import appConfig from '../config/AppConfig.mjs';
import { fetchMarketDataFromYahoo } from "./yahoo/quoteService.mjs";
import { fetchMarketDataFromAlpaca, handleQuoteUpdate } from "./alpaca/quoteService.mjs";
import { fetchMarketDataFromBackTester } from "../backtesting/BackTester.mjs";

const mode = appConfig().dataSource.provider; // 'yahoo' or 'alpacaStream' or backtesting

export async function fetchMarketData (symbol) {
    let closes, highs, lows, volumes, update;
    let marketData;
    if (mode === 'alpacaStream') {
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
            console.warn("Insufficient data for analysis... filling buffer.");
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