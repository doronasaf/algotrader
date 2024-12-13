const axios = require("axios");
const { calculateIndicators } = require("../utils/TechUtils");
const { sellStock, buyStock, getQuote, setBracketOrdersForBuy, getOpenPositions, getOrders} = require("../broker/alpaca/tradeService");
const { BullishMomentumStrategy } = require("./BullishMomentumStrategy");
const { OversoldWithUpwardMomentumStrategy } = require("./OversoldWithUpwardMomentumStrategy");
const { fetchMarketData } = require("../broker/MarketDataFetcher");
const logger = require("../log/logger");
const {tradingConfig, isWithinTradingHours} = require("../utils/TradingHours");
const {identifyStocks} = require("./StocksSelector");

const DEBUG = true;
const mode = 'yahoo'; // 'yahoo' or 'alpacaStream'


// Enhanced A, B, C, D Strategy
const analyzeEnhancedStrategy = async (ticker, params) => {
    let support = null;
    let resistance = null;
    let phase = "A"; // Start with Accumulation
    let capital = params.capital; // Initial capital
    let position = 0; // Number of shares held
    const theoreticTrades = [];
    const tradeOrders = [];
    let avgVolume, dynamicVolumeThreshold;
    const regularInterval= 5000;
    const monitoringInterval = 60000;
    let timeoutInterval = regularInterval;

    for (const session in tradingConfig) {
        const config = tradingConfig[session];
        if (!config.enabled) continue;

        console.log(`Starting trading session: ${session}`);

        while (isWithinTradingHours(config)) {
            let { closes, highs, lows, volumes } = await fetchMarketData(ticker);
            if (!closes || !highs || !lows || !volumes) {
                continue;
            }

            let close = closes[closes.length - 1];
            const high = highs[highs.length - 1];
            const low = lows[lows.length - 1];
            const volume = volumes[volumes.length - 1];

            const bulishMomentum = new BullishMomentumStrategy(ticker, { closes, highs, lows, volumes }, support, resistance);
            const oversoldWithUpwardMomentum = new OversoldWithUpwardMomentumStrategy(ticker, { closes, highs, lows, volumes }, support, resistance);

            // console.log(`Ticker: ${ticker} | Phase: ${phase} | Close: ${close}, High: ${high}, Low: ${low}, Volume: ${volume}, DynamicVolumeThreshold: ${dynamicVolumeThreshold}`);
            // console.log(`Ticker ${ticker}  | MACD: ${macdValue.MACD}, Signal: ${macdValue.signal}, RSI: ${rsiValue}`);

            switch (phase) {
                case "A": // Accumulation
                    if (!support || !resistance) {
                        support = low;
                        resistance = high;
                        console.log(`Ticker ${ticker} | Initialized support to ${support} and resistance to ${resistance}`);
                    } else {
                        if (high > resistance) resistance = high;
                        if (low < support) support = low;
                        bulishMomentum.setSupportResistance(support, resistance);
                        oversoldWithUpwardMomentum.setSupportResistance(support, resistance);
                        // Calculate dynamic volume threshold
                        // avgVolume = volumes.slice(-params.numberOfPrevVolumes).reduce((sum, v) => sum + v, 0) / params.numberOfPrevVolumes; // Last 20 volumes
                        // dynamicVolumeThreshold = avgVolume * params.dynamicVolumeThreshold;

                        // Check for momentum confirmation
                        const accumulationAchieved = await oversoldWithUpwardMomentum.evaluateAccumulation();
                        if (accumulationAchieved) {
                            // console.log(`Ticker: ${ticker} | Momentum confirmed. Stabilizing range...`);
                            // console.log(`Ticker: ${ticker} | Phase: ${phase} | Close: ${close}, High: ${high}, Low: ${low}, Volume: ${volume}, DynamicVolumeThreshold: ${dynamicVolumeThreshold}`);
                            logger.logMessage(`Ticker ${ticker} | Momentum confirmed. Stabilizing range...`, params.logDestination);
                            phase = "B";
                        }
                    }
                    break;

                case "B": // Breakout
                    const breakoutConfirmed = await oversoldWithUpwardMomentum.evaluateBreakout();
                    if (breakoutConfirmed) {
                        // make a function to buy stock
                        const shares = Math.floor(capital / close);
                        position += shares;
                        capital -= shares * close;

                        const takeProfit = Math.floor(close * params.takeProfit * 100) / 100;
                        const stopLoss =  Math.floor(close * params.stopLoss * 100) / 100;
                        close =  Math.floor(close * 100) / 100;
                        const orderResult = await setBracketOrdersForBuy(ticker, shares, close, takeProfit, stopLoss);
                        console.log(`Ticker ${ticker} | Breakout confirmed. Set bracket order for buying position: Limit: ${close}, Shares: ${shares}, Take Profit: ${takeProfit}, Stop Loss: ${stopLoss}`);
                        await writeToLog(ticker, close, shares, capital, orderResult, "bracket", "BUY", params.logDestination, tradeOrders, theoreticTrades);
                        timeoutInterval = monitoringInterval;
                        phase = "E";
                    }
                    break;

                case "E": // monitor execution
                    const openOrders = await getOrders();
                    if (openOrders.length === 0) {
                        console.log(`Ticker ${ticker} | No open positions found. Looking for opportunities...`);
                        if (theoreticTrades.length > 0 ) console.table(theoreticTrades);
                        timeoutInterval = regularInterval;
                        phase = "A";
                    } else {
                        for (const order of openOrders) {
                            if (order.type === 'single' && order.order.status === 'filled') {
                                timeoutInterval = regularInterval;
                                phase = 'A';
                            } else if (order.type === 'bracket') {
                                if (order.order.status === 'filled' && order.takeProfitOrder.status === 'filled' && order.stopLossOrder.status === 'filled'){
                                    timeoutInterval = regularInterval;
                                    phase = 'A';
                                }
                            }
                        }
                    }
                    break;
            }
            await new Promise((resolve) => setTimeout(resolve, timeoutInterval)) ;
        }
    }
}

const writeToLog = async (ticker, close, sharesOrSellValue, capital, orderResult, action, status, logDestination, tradeOrders, theoreticTrades) => {
    logger.logMessage(JSON.stringify(orderResult), logDestination);
    tradeOrders.push(orderResult.order);
    tradeOrders.push(orderResult.orderStatus);
    theoreticTrades.push({ ticker, action: action, price: close, timestamp: new Date(), sharesOrSellValue, status: status });
}

// Main function
const main = async () => {
    // const params = [
    //     // {
    //     //     ticker: "DXYZ", // Replace with desired ticker
    //     //     capital: 10000, // Initial capital in USD
    //     //     breakoutThreshold: 1.002, // 0.2% breakout
    //     //     dynamicVolumeThreshold: 1.5, // Minimum volume
    //     //     numberOfPrevVolumes: 20, // Last 20 volumes
    //     //     rsiAccumulationMin: 40,
    //     //     rsiAccumulationMax: 60,
    //     //     rsiBullishBreakoutMin: 69,
    //     //     rsiBullishBreakoutMax: 80,
    //     //     rsiPeriod: 12,
    //     // macdFastEMA: 6,
    //     // macdSlowEMA: 14,
    //     // macdSignalEMA: 3,
    //     //     takeProfit: 1.006, // 0.4% profit
    //     //     stopLoss: 0.98, // 2% stop loss
    //     // }
    //     // ,
    //     // {
    //     //     ticker: "DXYZ", // Replace with desired ticker
    //     //     capital: 10000, // Initial capital in USD
    //     //     breakoutThreshold: 1.002, // 0.2% breakout
    //     //     dynamicVolumeThreshold: 1.3, // multiply of volume
    //     //     numberOfPrevVolumes: 20, // Last 20 volumes
    //     //     rsiAccumulationMin: 40,
    //     //     rsiAccumulationMax: 60,
    //     //     rsiBullishBreakoutMin: 69,
    //     //     rsiBullishBreakoutMax: 80,
    //     //     rsiPeriod: 12,
    //     //     macdFastEMA: 6,
    //     //     macdSlowEMA: 14,
    //     //     macdSignalEMA: 3,
    //     //     takeProfit: 1.006, // 0.5% profit
    //     //     stopLoss: 0.98, // 2% stop loss
    //     // },
    //     // {
    //     //     ticker: "RDDT", // Replace with desired ticker
    //     //     capital: 10000, // Initial capital in USD
    //     //     breakoutThreshold: 1.002, // 0.2% breakout
    //     //     dynamicVolumeThreshold: 1.3, // Minimum volume
    //     //     numberOfPrevVolumes: 20, // Last 20 volumes
    //     //     rsiAccumulationMin: 40,
    //     //     rsiAccumulationMax: 60,
    //     //     rsiBullishBreakoutMin: 69,
    //     //     rsiBullishBreakoutMax: 80,
    //     //     rsiPeriod: 12,
    //     //     macdFastEMA: 6,
    //     //     macdSlowEMA: 14,
    //     //     macdSignalEMA: 3,
    //     //     takeProfit: 1.007, // 0.5% profit
    //     //     stopLoss: 0.98, // 2% stop loss
    //     // },
    //     // {
    //     //     ticker: "DKNG", // Replace with desired ticker
    //     //     capital: 10000, // Initial capital in USD
    //     //     breakoutThreshold: 1.002, // 0.2% breakout
    //     //     dynamicVolumeThreshold: 1.3, // Minimum volume
    //     //     numberOfPrevVolumes: 20, // Last 20 volumes
    //     //     rsiAccumulationMin: 40,
    //     //     rsiAccumulationMax: 60,
    //     //     rsiBullishBreakoutMin: 69,
    //     //     rsiBullishBreakoutMax: 80,
    //     //     rsiPeriod: 12,
    //     //     takeProfit: 1.006, // 0.4% profit
    //     //     stopLoss: 0.98, // 2% stop loss
    //     // }
    //     // ,
    //     // {
    //     //     ticker: "PLTR", // Replace with desired ticker
    //     //     capital: 10000, // Initial capital in USD
    //     //     breakoutThreshold: 1.002, // 0.2% breakout
    //     //     dynamicVolumeThreshold: 1.3, // Minimum volume
    //     //     numberOfPrevVolumes: 20, // Last 20 volumes
    //     //     rsiAccumulationMin: 40,
    //     //     rsiAccumulationMax: 60,
    //     //     rsiBullishBreakoutMin: 69,
    //     //     rsiBullishBreakoutMax: 80,
    //     //     rsiPeriod: 12,
    //     //     takeProfit: 1.006, // 0.4% profit
    //     //     stopLoss: 0.98, // 2% stop loss
    //     // }
    //     // ,
    //     {
    //         ticker: "TARA", // Replace with desired ticker
    //         capital: 7000, // Initial capital in USD
    //         breakoutThreshold: 1.001, // 0.2% breakout
    //         dynamicVolumeThreshold: 1.3, // Minimum volume
    //         numberOfPrevVolumes: 25, // Last 20 volumes
    //         rsiAccumulationMin: 40,
    //         rsiAccumulationMax: 60,
    //         rsiBullishBreakoutMin: 69,
    //         rsiBullishBreakoutMax: 80,
    //         rsiPeriod: 12,
    //         macdFastEMA: 6,
    //         macdSlowEMA: 14,
    //         macdSignalEMA: 3,
    //         takeProfit: 1.006, // 0.4% profit
    //         stopLoss: 0.98, // 2% stop loss
    //     }
    // ];

    let initializedLogs = 0;
    const param = {
        capital: 3000, // Initial capital in USD
        takeProfit: 1.006, // 0.4% profit
        stopLoss: 0.98, // 2% stop loss
    }
    // let candidates = await identifyStocks();
    // candidates = candidates.slice(0,10);
    let candidates = [
        {symbol: "TARA"},
        {symbol: "DXYZ"},
        {symbol: "DKNG"},
        {symbol: "PLTR"},
        {symbol: "RDDT"},
        {symbol: "TSLA"},
        {symbol: "LULU"},
        {symbol: "SOUN"},
        {symbol: "UBER"},
    ];
    candidates = candidates.slice(0,5);
    const params = [];
    for (const candidate of candidates) {
        params.push({ticker: candidate.symbol, ...param});
    }
    while (true) {
        const workers = [];
        for (const param of params) {
            if (initializedLogs < params.length) {
                const logDestination = `./logs/${param.ticker}-${new Date().toISOString().split("T")[0]}_${initializedLogs}.log`;
                param.logDestination = logDestination;
                logger.logMessage(`Parameters: ${JSON.stringify(param)}`, logDestination);
                initializedLogs++;
            }
            workers.push(analyzeEnhancedStrategy(param.ticker, param));
        }
        const result = await Promise.all(workers);

        console.log("Trading session completed.");

        // sleep for 10 seconds before restarting
        await new Promise((resolve) => setTimeout(resolve,  10000));
    }

}

(async () => {
    await main();
})();


module.exports = {
    analyzeEnhancedStrategy,
}