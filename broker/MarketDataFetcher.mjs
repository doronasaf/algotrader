import {getEntityLogger} from '../utils/logger/loggerManager.mjs';
import appConfig from '../config/AppConfig.mjs';
import { fetchMarketDataFromYahoo } from "./yahoo/quoteService.mjs";
import { fetchMarketDataFromAlpaca, handleQuoteUpdate } from "./alpaca/quoteService.mjs";
import { fetchMarketDataFromBackTester } from "../backtesting/BackTester.mjs";
import { MarketDataStreamer } from "../broker/ibkr/quoteService.mjs";
const appLog = getEntityLogger('appLog');
const mode = appConfig().dataSource.provider; // 'yahoo' or 'alpacaStream' or ibkr or backtesting

let streamingInitialized = false;
let marketDataStreamer;// = new MarketDataStreamer(); // Single instance for managing all streaming symbols
const symbolDataBuffers = new Map(); // Buffer for holding rolling market data for symbols

export async function fetchMarketData (symbol) {
    let closes, highs, lows, volumes, update;
    let marketData;
    if (mode === 'ibkr') {
        if (!marketDataStreamer) {
            marketDataStreamer = new MarketDataStreamer();
        }
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
            if (!streamingInitialized) {
                appLog.info(`Streaming initialization is in process for ${symbol}.`);
            } else {
                appLog.info(`Insufficient data for ${symbol}. Buffer size: ${rollingData?.length || 0}`);
            }
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
    appLog.info(`Initialized streaming for ${symbol}`);
}

// Expose getOrders function
export async function getOrders() {
    try {
        return marketDataStreamer.getOpenOrders();
    } catch (error) {
        appLog.info("Error fetching orders:", error.message);
    }
}

// Expose setBracketOrder function
export async function setBracketOrdersForBuy(symbol, quantity, limitPrice, takeProfitPrice, stopLossPrice) {
    try {
        return await marketDataStreamer.setBracketOrder(symbol, quantity, limitPrice, takeProfitPrice, stopLossPrice);
    } catch (error) {
        appLog.info(`Error placing bracket order for ${symbol}:`, error.message);
    }
}

export async function monitorBracketOrder(parentOrderId, childOrderIds, pollingInterval = 30000, timeout = 3600000){
    try {

        return await marketDataStreamer.monitorBracketOrder(parentOrderId, childOrderIds, pollingInterval, timeout);
    } catch (error) {
        appLog.info(`Error monitoring bracket order for ${parentOrderId}:`, error.message);
    }
}

export async function stopMarketData (symbol) {
    if (mode === 'ibkr') {
        await marketDataStreamer.removeSymbol(symbol);
        symbolDataBuffers.delete(symbol);
    }
}
function marketDataIsValid(marketData) {
    let dataIsValid = true;
    if (mode === 'alpacaStream') {
        if (!marketData) {
            appLog.info("No market data available.");
            dataIsValid = false;
        } else if (!marketData?.length) {
            appLog.info("Missing market data length.");
            dataIsValid = false;
        } else if (marketData?.length < 20) { // Minimum data points for analysis TBD CHANGE WHEN WORKING IN REALTIME ASAF ZZZZZZZ
            appLog.info("Insufficient data for analysis... filling buffer.");
            dataIsValid = false;
        }
    } else if (mode === 'yahoo') {
        if (!marketData) {
            appLog.info("No market data available.");
            dataIsValid = false;
        }
    }
    return dataIsValid;
}

