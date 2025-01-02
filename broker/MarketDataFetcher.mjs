import {getEntityLogger} from '../utils/logger/loggerManager.mjs';
import appConfig from '../config/AppConfig.mjs';
import { fetchMarketDataFromYahoo } from "./yahoo/quoteService.mjs";
import { fetchMarketDataFromAlpaca, handleQuoteUpdate } from "./alpaca/quoteService.mjs";
import { setBracketOrdersForBuyAlpaca, getOrdersAlpaca } from "./alpaca/tradeService.mjs";
import { fetchMarketDataFromBackTester } from "../backtesting/BackTester.mjs";
import { MarketDataStreamer } from "../broker/ibkr/quoteService.mjs";
const appLog = getEntityLogger('appLog');
const appConf = appConfig();
const MARKET_DATA_PROVIDER = appConf.dataSource.marketDataProvider; // 'yahoo' or 'alpacaStream' or ibkr or backtesting
const TRADING_PROVIDER = appConf.dataSource.tradingProvider; // 'yahoo' or 'alpacaStream' or ibkr or backtesting

let streamingInitialized = false;
let marketDataStreamer;// = new MarketDataStreamer(); // Single instance for managing all streaming symbols
const symbolDataBuffers = new Map(); // Buffer for holding rolling market data for symbols

export async function fetchMarketData (symbol) {
    let closes, highs, lows, volumes, update;
    let marketData;
    if (MARKET_DATA_PROVIDER === 'ibkr') {
        if (!marketDataStreamer) {
            marketDataStreamer = new MarketDataStreamer();
        }
        // Check if symbol is already subscribed for streaming
        if (!symbolDataBuffers.has(symbol)) {
            await initializeStreaming(symbol);
        }
        // Fetch the most recent 5-minute rolling data from the buffer
        const rollingData = symbolDataBuffers.get(symbol);

        if (rollingData?.length >= appConf.dataSource.ibkr.minSamples) { // Ensure sufficient data points for analysis
            closes = rollingData.map(d => d.close);
            highs = rollingData.map(d => d.high);
            lows = rollingData.map(d => d.low);
            volumes = rollingData.map(d => d.volume);
        } else {
            if (!streamingInitialized) {
                appLog.info(`Streaming initialization is in process for ${symbol}.`);
            } else {
                // appLog.info(`Insufficient data for ${symbol}. Buffer size: ${rollingData?.length || 0}`);
            }
        }
    } else if (MARKET_DATA_PROVIDER === 'alpacaStream') {
        marketData = await fetchMarketDataFromAlpaca(symbol, handleQuoteUpdate(update)); // Updates the buffer and fetches last 100 data points
        if (marketDataIsValid(marketData)) {
            // Extract OHLC arrays for analysis
            closes = marketData.map(d => d.close);
            highs = marketData.map(d => d.high);
            lows = marketData.map(d => d.low);
            volumes = marketData.map(d => d.volume);
        }
    } else if (MARKET_DATA_PROVIDER === 'yahoo') {
        marketData = await fetchMarketDataFromYahoo(symbol); // yahoo finance
        if (marketDataIsValid(marketData)) {
            closes = marketData.closes;
            highs = marketData.highs;
            lows = marketData.lows;
            volumes = marketData.volumes;
        }
    } else if (MARKET_DATA_PROVIDER === 'backtesting') {
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
        if (TRADING_PROVIDER === 'ibkr') {
            return marketDataStreamer.getOpenOrders();
        } else if (TRADING_PROVIDER === 'alpaca') {
            return await getOrdersAlpaca();
        }
    } catch (error) {
        appLog.info("Error fetching orders:", error.message);
    }
}

// Expose setBracketOrder function
export async function setBracketOrdersForBuy(symbol, quantity, limitPrice, takeProfitPrice, stopLossPrice) {
    try {
        if (TRADING_PROVIDER === 'ibkr') {
            return await marketDataStreamer.setBracketOrder(symbol, quantity, limitPrice, takeProfitPrice, stopLossPrice);
        } else if (TRADING_PROVIDER === 'alpaca') {
            return await setBracketOrdersForBuyAlpaca(symbol, quantity, limitPrice, takeProfitPrice, stopLossPrice);
        }
    } catch (error) {
        appLog.info(`Error placing bracket order for ${symbol}:`, error.message);
    }
}

export async function monitorBracketOrder(parentOrderId, childOrderIds, pollingInterval = 30000, timeout = 3600000){
    try {
        if (TRADING_PROVIDER === 'ibkr') {
            return await marketDataStreamer.monitorBracketOrder(parentOrderId, childOrderIds, pollingInterval, timeout);
        } else if (TRADING_PROVIDER === 'alpaca') {
            return;
        }
    } catch (error) {
        appLog.info(`Error monitoring bracket order for ${parentOrderId}:`, error.message);
    }
}

export async function stopMarketData (symbol) {
    if (MARKET_DATA_PROVIDER === 'ibkr') {
        await marketDataStreamer.removeSymbol(symbol);
        symbolDataBuffers.delete(symbol);
    }
}
function marketDataIsValid(marketData) {
    let dataIsValid = true;
    if (MARKET_DATA_PROVIDER === 'alpacaStream') {
        if (!marketData) {
            appLog.info("No market data available.");
            dataIsValid = false;
        } else if (!marketData?.length) {
            appLog.info("Missing market data length.");
            dataIsValid = false;
        } else if (marketData?.length < appConf.dataSource.ibkr.minSamples) { // Minimum data points for analysis TBD CHANGE WHEN WORKING IN REALTIME ASAF ZZZZZZZ
            // appLog.info("Insufficient data for analysis... filling buffer.");
            dataIsValid = false;
        }
    } else if (MARKET_DATA_PROVIDER === 'yahoo') {
        if (!marketData) {
            appLog.info("No market data available.");
            dataIsValid = false;
        }
    }
    return dataIsValid;
}


export async function handleOpenOrders(openOrder) {
    const returnStatus = {
        symbol: undefined,
        parentStatus: undefined,     // "new|filled|cancelled",
        takeProfitStatus: undefined, // "held|filled|cancelled",
        stopLossStatus: undefined,   // "held|filled|cancelled",
        tradeStatus: undefined,      // "open|takeProfit|stopLoss"
    }
    if (appConf.dataSource.tradingProvider === 'ibkr') {
        returnStatus.symbol = openOrder?.parentOrder?.symbol;
        throw new Error ("Not implemented yet");
        // if (openOrder?.parentOrder && openOrder?.takeProfitOrder && openOrder?.stopLossOrder) {
        // }
    } else if (appConf.dataSource.tradingProvider === 'alpaca'){
        returnStatus.symbol = openOrder?.parentOrder?.symbol;
        if (openOrder?.parentOrder?.order_class === "bracket") {
            returnStatus.parentStatus = openOrder.parentOrder.status;
            if (openOrder.parentOrder.status === "filled") {
                const takeProfitOrder = openOrder.takeProfitOrder;
                const stopLossOrder = openOrder.stopLossOrder;
                returnStatus.takeProfitStatus = takeProfitOrder?.status;
                returnStatus.stopLossStatus = stopLossOrder?.status;
                if (takeProfitOrder?.status === "filled") {
                    returnStatus.tradeStatus = "takeProfit";
                }
                else if (stopLossOrder?.status === "filled") {
                    returnStatus.tradeStatus = "stopLoss";
                } else {
                    returnStatus.tradeStatus = "open";
                }
            } else {
                returnStatus.tradeStatus = openOrder.parentOrder.status;
            }
        }
    }
    return returnStatus;
}

// (async () => {
//     const orders = await getOrders();
//     console.log(JSON.stringify(orders, null, 2));
// })();