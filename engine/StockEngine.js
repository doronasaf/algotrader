const getEntityLogger = require('../utils/logger/loggerManager');
const { sellStock, buyStock, getQuote, setBracketOrdersForBuy, getOpenPositions, getOrders} = require("../broker/alpaca/tradeService");
const { MarketAnalyzerFactory, TradingStrategy } = require("../strategies/MarketAnalyzerFactory");
const { fetchMarketData } = require("../broker/MarketDataFetcher");
const {tradingConfig, isWithinTradingHours} = require("../utils/TradingHours");
const {identifyStocks} = require("../stockInfo/StocksSelector");
const {fetchEarnings} = require("../stockInfo/StockCalender");
const logger = getEntityLogger('transactions');
const analytics = getEntityLogger('analytics');

const DEBUG = false;


// Enhanced A, B, C, D Strategy
const analyzeEnhancedStrategy = async (ticker, params) => {
    let support = null;
    let resistance = null;
    let phase = "A"; // Start with Accumulation
    let capital = params.capital; // Initial capital
    let position = 0; // Number of shares held
    const sentTransactions = [];
    const tradeOrders = [];
    const regularInterval= 2000;
    const monitoringInterval = 60000;
    let timeoutInterval = regularInterval;

    for (const session in tradingConfig) {
        if (session !== "market") continue;
        const config = tradingConfig[session];
        if (!config.enabled) continue;
        console.log(`Starting trading session: ${session}`);
        while (isWithinTradingHours(config)) {
            let { closes, highs, lows, volumes } = await fetchMarketData(ticker);
            if (!closes || !highs || !lows || !volumes || closes?.length < 20) {
                continue;
            }
            let close = closes[closes.length - 1];
            const high = highs[highs.length - 1];
            const low = lows[lows.length - 1];

            switch (phase) {
                case "A": // Accumulation
                    if (!support || !resistance) {
                        support = low;
                        resistance = high;
                    } else {
                        if (high > resistance) resistance = high;
                        if (low < support) support = low;
                        const analyzer = MarketAnalyzerFactory.createAnalyzer(params.type, ticker, { closes, highs, lows, volumes }, support, resistance);
                        const accumulationAchieved = await analyzer.evaluateAccumulation();
                        if (accumulationAchieved) {
                            phase = "B";
                        }
                    }
                    break;

                case "B": // Breakout
                    const analyzer = MarketAnalyzerFactory.createAnalyzer(params.type, ticker, { closes, highs, lows, volumes }, support, resistance);
                    const breakoutConfirmed = await analyzer.evaluateBreakout();
                    if (breakoutConfirmed === 1) {
                        // make a function to buy stock
                        const shares = Math.floor(capital / close);
                        position += shares;
                        capital -= shares * close;

                        const takeProfit = Math.floor(close * params.takeProfit * 100) / 100;
                        const stopLoss =  Math.floor(close * params.stopLoss * 100) / 100;
                        close =  Math.floor(close * 100) / 100;
                        const orderResult = await setBracketOrdersForBuy(ticker, shares, close, takeProfit, stopLoss);
                        orederResult.strategy = analyzer.toString();
                        logger.info(`Ticker ${ticker} | Strategy: ${analyzer.toString()} | Order Details: Shares: ${shares} | Buy Price: ${close} | Take Profit: ${takeProfit} | Stop Loss: ${stopLoss} | \nOrder: ${JSON.stringify(orderResult)}`);
                        await writeToLog(ticker, close, shares, capital, orderResult, "bracket", "BUY", tradeOrders, sentTransactions);
                        timeoutInterval = monitoringInterval;
                        phase = "E";
                    } else if (breakoutConfirmed === 0){
                        phase = "B"; // you are still in breakout phase
                    } else if (breakoutConfirmed === -1) {
                        phase = "A"; // you are back to accumulation phase
                    }
                    break;
                case "C":
                    logger.info(`Ticker ${ticker} | Strategy: ${analyzer.toString()} | End of trading session`);
                    return;
                case "E": // monitor execution
                    const openOrders = await getOrders();
                    if (openOrders.length === 0) {
                        console.log(`Ticker ${ticker} | No open positions found. Looking for opportunities...`);
                        if (sentTransactions.length > 0 ) console.table(sentTransactions);
                        timeoutInterval = regularInterval;
                        phase = "A";
                    } else {
                        for (const order of openOrders) {
                            if (order.type === 'single' && order.order.status === 'filled') {
                                timeoutInterval = regularInterval;
                                logger.info(JSON.stringify(order));
                                phase = 'C';
                            } else if (order.type === 'bracket') {
                                if (order.parentOrder.status === 'filled' && order.takeProfitOrder.status === 'filled' && order.stopLossOrder.status === 'filled'){
                                    timeoutInterval = regularInterval;
                                    phase = 'C';
                                    logger.info(JSON.stringify(order));
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

const writeToLog = async (ticker, close, sharesOrSellValue, capital, orderResult, action, status, tradeOrders, sentTransactions) => {
    tradeOrders.push(orderResult.order);
    tradeOrders.push(orderResult.orderStatus);
    sentTransactions.push({ ticker, action: action, price: close, timestamp: new Date(), sharesOrSellValue, status: status , strategy: orderResult.strategy});
}

const selectStocks = async (maxNumberOfStocks) => {
    const today = new Date();
    const dateString = today.toISOString().split('T')[0];
    const todayEarningStocks = await fetchEarnings(dateString);
    const combinedList = await identifyStocks(todayEarningStocks);
    const numberOfStocks = Math.min(maxNumberOfStocks, combinedList.length);
    return combinedList.slice(0,numberOfStocks); // maximum 9 stocks
}
// Main function
const main = async () => {

    const param = {
        capital: 3000, // Initial capital in USD
        takeProfit: 1.006, // 0.5% profit
        stopLoss: 0.98, // 2% stop loss
    }
    // const strategyTypes = Object.values(TradingStrategy);
    const strategyTypes = [TradingStrategy.CombinedWithWeightMomentum];
    while (true) {
        let candidates;
        if (DEBUG) {
            candidates = [
                {symbol: "TARA"},
                {symbol: "DXYZ"},
                {symbol: "SMCI"},
                {symbol: "PLTR"},
                {symbol: "RDDT"},
                {symbol: "TSLA"},
                {symbol: "IBIT"},
                {symbol: "SOUN"},
            ];
            // candidates = candidates.slice(0,6);
        } else {

            candidates = await selectStocks(10);
            candidates = candidates.concat({symbol: "RDDT"});
            // candidates = [...[
            //     {symbol: "GOOG"},
            //     {symbol: "GOOGL"},
            //     {symbol: "TSM"},
            //     {symbol: "ORCL"},
            //     {symbol: "MDB"}
            // ], ...candidates]

        }
        let params = [];
        for (const candidate of candidates) {
            params.push({ticker: candidate.symbol, ...param});
            console.log(`Selected stock: ${candidate.symbol}`);
        }
        const workers = [];
        for (let i=0; i< params.length; i++) {
            params[i].type = strategyTypes[i % strategyTypes.length];
            // params[i].type = TradingStrategy.DynamicWeightedStrategy;
            analytics.info(`Starting analysis for ${params[i].ticker} with strategy ${params[i].type}`);
            workers.push(analyzeEnhancedStrategy(params[i].ticker, params[i]));
        }
        const result = await Promise.all(workers);

        // sleep for 10 seconds before restarting
        await new Promise((resolve) => setTimeout(resolve,  10000));
    }
}

module.exports = {
    main,
}