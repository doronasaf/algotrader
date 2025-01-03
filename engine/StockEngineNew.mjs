import process from "process";
import {getEntityLogger} from '../utils/logger/loggerManager.mjs';
import appConfig from '../config/AppConfig.mjs';
import {MarketAnalyzerFactory, TradingStrategy} from "../strategies/MarketAnalyzerFactory.mjs";
import {fetchMarketData, stopMarketData, setBracketOrdersForBuy, getOrders, monitorBracketOrder} from "../broker/MarketDataFetcher.mjs";
import {tradingConfig, isWithinTradingHours, timeUntilMarketClose} from "../utils/TradingHours.mjs";
import {identifyStocks} from "../stockInfo/StocksSelector.mjs";
import {fetchEarnings} from "../stockInfo/StockCalender.mjs";
import readline from "readline";
import {TimerLog} from "../utils/TimerLog.mjs";
import {fetchCSV} from '../stockInfo/GoogleSheetStockSelector.mjs';
import { convertLogsToCSV } from '../scripts/transactionsLogToCSV.mjs';
import {nyseTime} from "../utils/TimeFormatting.mjs";
import {BudgetManager} from "../utils/BudgetManager.mjs";

const appConf = appConfig();
const transactionLog = getEntityLogger('transactions', true);
const appLog = getEntityLogger('appLog');

const workers = new Map(); // Map to track workers by stock symbol {symbol: {worker, params}}
const stopFlags = new Map(); // Map to track stop flags by stock symbol
const sentTransactions = []; // Array to store all transactions
const tradeOrders = [];
const strategyTypes = Object.values(TradingStrategy);
let running = true; // Flag to control engine status
const budgetManager = new BudgetManager(appConf.trading.budget);
const defTradingParams = {
    capital: appConf.trading.singleTradeCapital,
    takeProfit: appConf.trading.takeProfit,
    stopLoss: appConf.trading.stopLoss,
    tradeTime: undefined,
}; // Default parameters


const analyzeEnhancedStrategy = async (ticker, params) => {
    let support = null;
    let resistance = null;
    let phase = "A"; // Start with Accumulation
    // let capital = params.capital; // Initial capital
    // let position = 0; // Number of shares held
    const regularInterval = appConf.app.disableTrading ? appConf.dataSource.testFetchInterval : appConf.dataSource.fetchInterval;//2000;
    const monitoringInterval = 60000; // 30 minutes
    let timeoutInterval = regularInterval;
    const timerLog = new TimerLog();
    const analyzersList = [];
    let selectedAnalyzer;
    let accumulationAchieved, breakoutConfirmed = false, potentialGain, potentialLoss, orderResults;
    let budgetAllocationSucceeded = false;

    for (const session in tradingConfig) {
        if (session !== "market") continue;
        const tradingSession = tradingConfig[session];
        if (!tradingSession.enabled) continue;
        while (isWithinTradingHours(tradingSession)) {
            try {
                // **Check Stop Flag**
                if (stopFlags.get(ticker) && phase !== "E") {
                    appLog.info(`Worker for ${ticker} stopped by user, phase = ${phase}`);
                    // await stopMarketData(ticker); // keep the data for future use
                    return; // Exit gracefully
                }

                let {closes, highs, lows, volumes} = await fetchMarketData(ticker);
                if (!closes || !highs || !lows || !volumes || closes?.length < 20) {
                    // appLog.info(`Insufficient data for ${ticker}. Retrying...`);
                    await new Promise((resolve) => setTimeout(resolve, regularInterval));
                    continue;
                }

                let close = closes[closes.length - 1];
                const high = highs[highs.length - 1];
                const low = lows[lows.length - 1];
                if (analyzersList.length === 0) {
                    for (const strategy of strategyTypes) {
                        analyzersList.push({
                            analyzer: MarketAnalyzerFactory.createAnalyzer(strategy, ticker, {
                                closes,
                                highs,
                                lows,
                                volumes
                            }, support, resistance, params, appConf),
                            accCompleted: false
                        });
                    }
                }

                switch (phase) {
                    case "A": // Accumulation
                        if (!support || !resistance) {
                            support = low;
                            resistance = high;
                        } else {
                            if (high > resistance) resistance = high;
                            if (low < support) support = low;
                        }
                        for (const analyzerItem of analyzersList) {
                            selectedAnalyzer = analyzerItem.analyzer;
                            selectedAnalyzer.setSupportResistance(support, resistance);
                            selectedAnalyzer.setMarketData({closes, highs, lows, volumes});
                            timerLog.start(`Ticker ${ticker} | Strategy: ${selectedAnalyzer.toString()} | Accumulation Phase (A)`);
                            accumulationAchieved = await selectedAnalyzer.evaluateAccumulation();
                            analyzerItem.accCompleted = accumulationAchieved;
                            timerLog.stop(`Ticker ${ticker} | Accumulation Phase (A)`);
                            if (accumulationAchieved) {
                                phase = "B";
                                appLog.info(`Ticker ${ticker} | Strategy: ${selectedAnalyzer.toString()} | Moved to Breakout Phase (B)`);
                            }
                        }
                        break;
                    case "B": // Breakout
                        for (const analyzerItem of analyzersList) {
                            selectedAnalyzer = analyzerItem.analyzer;
                            if (!analyzerItem.accCompleted) {
                                selectedAnalyzer.setSupportResistance(support, resistance);
                                selectedAnalyzer.setMarketData({closes, highs, lows, volumes});
                                accumulationAchieved = await selectedAnalyzer.evaluateAccumulation();
                                analyzerItem.accCompleted = accumulationAchieved;
                            }
                            if (analyzerItem.accCompleted) {
                                selectedAnalyzer.setMarketData({closes, highs, lows, volumes});
                                timerLog.start(`Ticker ${ticker} | Strategy: ${selectedAnalyzer.toString()} | Breakout Phase (B)`);
                                breakoutConfirmed = await selectedAnalyzer.evaluateBreakout();
                                timerLog.stop(`Ticker ${ticker} | Strategy: ${selectedAnalyzer.toString()} | Breakout Phase (B)`);
                                if (breakoutConfirmed === 1) {
                                    break;
                                }
                            }
                        }
                        if (breakoutConfirmed === 1) { // buy
                            const {shares, takeProfit, stopLoss} = selectedAnalyzer.getMargins();
                            // position += shares;
                            // capital -= shares * close;
                            potentialLoss = (close - stopLoss) * shares;
                            potentialGain = (takeProfit - close) * shares;
                            if (potentialGain >= appConf.trading.minimumGain) { // TBD Set minimum TP Percentage
                                budgetAllocationSucceeded = await budgetManager.allocateBudget(params.capital);
                                if (budgetAllocationSucceeded) {
                                    let budgetInfo = await budgetManager.getBudgetInfo();
                                    let trx = {
                                        ticker,
                                        source: params.source,
                                        action: "bracket",
                                        price: close,
                                        timestamp: nyseTime(),
                                        shares,
                                        takeProfit,
                                        stopLoss,
                                        potentialGain: potentialGain,
                                        potentialLoss: potentialLoss,
                                        budgetRemaining: budgetInfo.availableBudget,
                                        budgetAllocated: budgetInfo.allocatedBudget,
                                        status: "Live Buy",
                                        strategy: selectedAnalyzer.toString()
                                    };
                                    if (appConf.app.disableTrading === true) {
                                        appLog.info(`Ticker ${ticker} | In demo mode. Skipping order placement.`);
                                        trx.status = "Demo Buy";
                                        phase = "C"; // Skip execution monitoring and exit
                                    } else {
                                        orderResults = await setBracketOrdersForBuy(ticker, shares, close, takeProfit, stopLoss);
                                        trx.orderResults = orderResults;
                                        params.tradeTime = Date.now();
                                        // const orderResults = await buyStock(ticker, shares, "limit", close);
                                        timeoutInterval = monitoringInterval;
                                        phase = "E"; // Move to Execution Monitoring
                                    }
                                    await writeToLog(ticker, orderResults, tradeOrders, sentTransactions, trx);
                                } else {
                                    let {availableBudget, allocatedBudget} = await budgetManager.getBudgetInfo();
                                    appLog.info(`Ticker ${ticker} | Strategy: ${selectedAnalyzer.toString()} | Source: ${params.source} | Required Budget: ${params.capital} | Allocated Budget: ${allocatedBudget} | Remaining Budget: ${availableBudget} | Status: Budget Insufficient. Quit buying`);
                                }
                            } else {
                                appLog.info(`Ticker ${ticker} | Strategy: ${selectedAnalyzer.toString()} | Potential gain too low: ${potentialGain}`);
                                phase = "C"; // Skip execution monitoring
                            }
                        } else if (breakoutConfirmed === 0) {
                            phase = "B"; // Stay in Breakout phase
                        } else if (breakoutConfirmed === -1) {
                            phase = "A"; // Return to Accumulation phase
                        } else if (breakoutConfirmed === -2) {
                            appLog.info(`Ticker ${ticker} | Strategy: ${selectedAnalyzer.toString()} | Breakout phase failed with errors! check the app.log. Exiting strategy.`);
                            phase = "C"; // Exit the strategy
                        }
                        break;

                    case "C": // Cleanup
                        appLog.info(`Ticker ${ticker} | Strategy: ${selectedAnalyzer?.toString()} | End of trading session`);
                        budgetManager.releaseBudget(params.capital);
                        return;

                    case "E": // Execution Monitoring
                        if (appConf.dataSource.tradingProvider === 'ibkr') {
                            if (orderResults?.parentOrder && orderResults?.takeProfitOrder && orderResults?.stopLossOrder) {
                                appLog.info(`Ticker ${ticker} | IBKR Orders: ${JSON.stringify(orderResults)}`);
                                const monitoringTime = timeUntilMarketClose();
                                const pollingInterval = 60000;
                                const executionResults = await monitorBracketOrder(orderResults.parentOrder.orderId, [orderResults.takeProfitOrder.orderId, orderResults.stopLossOrder.orderId], pollingInterval, monitoringTime);

                                if (executionResults?.parentOrder?.status === "Filled") {
                                    executionResults.parentOrder.name = "Parent Order";
                                    tradeOrders.push(executionResults.parentOrder);
                                    const takeProfitOrderResult = executionResults.childOrders.find(order => order.orderId === orderResults.takeProfitOrder.orderId);
                                    const stopLossOrderResult = executionResults.childOrders.find(order => order.orderId === orderResults.stopLossOrder.orderId);
                                    if (takeProfitOrderResult && takeProfitOrderResult.status === "Filled") {
                                        takeProfitOrderResult.name = "Take Profit Order";
                                        tradeOrders.push(takeProfitOrderResult);
                                        phase = "C";
                                    } else if (stopLossOrderResult && stopLossOrderResult.status === "Filled") {
                                        stopLossOrderResult.name = "Stop Loss Order";
                                        tradeOrders.push(stopLossOrderResult);
                                        phase = "C";
                                    } else {
                                        appLog.info(`Ticker ${ticker} | Bracket Order No Children Return Status: ${JSON.stringify(executionResults)}`);
                                        transactionLog.info(JSON.stringify(executionResults));
                                        phase = "C";
                                    }
                                }
                            }
                        } else if (appConf.dataSource.tradingProvider === 'alpaca'){
                            if (orderResults?.order?.order_class === "bracket") {
                                if (orderResults.orderStatus?.status === "filled") {
                                    appLog.info(`Ticker ${ticker} | Bracket Order Limit (Parent) Filled: ${JSON.stringify(orderResults.order)}`);
                                    if (orderResults.orderStatus?.legs) {
                                        const takeProfitOrder = orderResults.orderStatus.legs.find(leg => leg.type === "limit");
                                        const stopLossOrder = orderResults.orderStatus.legs.find(leg => leg.type === "stop");
                                        if (takeProfitOrder?.status === "filled") {
                                            appLog.info(`Ticker ${ticker} | Bracket Order Take Profit Filled: ${JSON.stringify(takeProfitOrder)}`);
                                            transactionLog.info(JSON.stringify(takeProfitOrder));
                                            timeoutInterval = regularInterval;
                                            phase = "C";
                                        }
                                        if (stopLossOrder?.status === "filled") {
                                            appLog.info(`Ticker ${ticker} | Bracket Order Stop Loss Filled: ${JSON.stringify(stopLossOrder)}`);
                                            transactionLog.info(JSON.stringify(stopLossOrder));
                                            timeoutInterval = regularInterval;
                                            phase = "C";
                                        }
                                    }
                                }
                            }
                        }
                        break;
                }

                await new Promise((resolve) => setTimeout(resolve, timeoutInterval));
            } catch (error) {
                console.error(`Error in worker for ${ticker}: ${error.message}`);
                appLog.info(`Error in worker for ${ticker}: ${error.message}, stack: ${error.stack}`);
                phase = "C"; // Exit strategy;
            }
        }
    }
};

const writeToLog = async (ticker, orderResult, tradeOrders, sentTransactions, trx) => {
    if (appConf.app.disableTrading === false) { // Live Trading
        tradeOrders.push(orderResult.order);
        tradeOrders.push(orderResult.orderStatus);
    }
    sentTransactions.push(trx);
    transactionLog.info(JSON.stringify(trx));
}

const selectStocks = async (maxNumberOfStocks) => {
    const today = new Date();
    const dateString = today.toISOString().split('T')[0];
    const todayEarningStocks = await fetchEarnings(dateString);
    const combinedList = await identifyStocks(todayEarningStocks);
    const numberOfStocks = Math.min(maxNumberOfStocks, combinedList.length);
    return combinedList.slice(0, numberOfStocks); // maximum 9 stocks
}

/** read from google sheet */
const readFromExternalSource = async () => {
    // console.log("Refresh from google sheets");
    let stockList = await fetchCSV(appConf.google_sheets.url);
    stockList.splice(appConf.google_sheets.maxSymbols);
    for (let i = 0; i < stockList.length; i++) {
        if (!stockList[i][0]) continue;
        const symbol = stockList[i][0];
        let strategyType = TradingStrategy.TrendMomentumBreakoutStrategy;
        tryRunWorker({symbol, source: "google_sheet"}, strategyType);
    }
}

const readFromYahooFinance = async () => {
    const maxStockToFetch = appConf.stockSelector.maxNumberOfStocks || 0;
    if (maxStockToFetch > 0) {
        let stockCandidates = await selectStocks(maxStockToFetch); // Fetch max 10 stocks
        for (let i = 0; i < stockCandidates.length; i++) {
            const stockCandidate = stockCandidates[i];
            let strategyType = strategyTypes[i % strategyTypes.length];
            tryRunWorker(stockCandidate, strategyType);
        }
    }
}

function checkWorkerLastTrade (symbol) {
    const {params} = workers.get(symbol)  || {};
    if (params?.tradeTime) { // there was a trade for this symbol
        const tradeDurationInMinutes = (Date.now() - (params.tradeTime || 0)) / 1000 / 60;
        if (tradeDurationInMinutes >= 30) {
            appLog.info(`Cleaning up worker for ${symbol} after ${tradeDurationInMinutes} mins`);
            workers.delete(symbol); // Cleanup worker
            stopFlags.delete(symbol); // Cleanup stop flag
        }
    }
}
/**
 * Worker Logic
 */
const createWorker = (symbol, params) => {
    return async () => {
        appLog.info(`Worker started for ${symbol} with strategy ${params.type}`);
        try {
            await analyzeEnhancedStrategy(symbol, params);
        } catch (error) {
            console.error(`Error in worker for ${symbol}: ${error.message}`);
            appLog.info(`Error in worker for ${symbol}: ${error.message}, Releasing budget: ${params.capital}`);
        } finally {
            if (!params.tradeTime) { // there was no trade
                workers.delete(symbol); // Cleanup worker
            }
            stopFlags.delete(symbol); // Cleanup stop flag
        }
    };
};

/**
 * CLI Interface
 */
const startCLI = () => {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    let symbol, params;

    console.log("Engine CLI started. Type 'help' for available commands.");

    rl.on("line", async (line) => {
        const [command, ...args] = line.trim().split(" ");
        let budgetInfo, worker, runningWorkers, stopSymbol;
        let stockCandidate, stockCandidates;
        let amount = 0, counter = 0;
        let openOrders;


        switch (command) {
            case "help":
                console.log(`
            Available Commands:
              - start [symbol] [strategy]: Start a worker for a specific stock.
              - stop [symbol]: Stop a worker for a specific stock.
              - ls List all active workers.
              - ls-trx : List all transactions.
              - open-orders : List all open orders.
              - green-candles [amount]: Set minimum green candles in a row for bullish trend.
              - stop-engine : Gracefully stop the engine and all workers.
              - refresh-stocks : Refresh the list of stock.
              - refresh-ext-stocks : Refresh the list of stock from external source.
              - budget-add [amount]: Add budget to the engine.
              - budget-i: Get budget information.
              - help: Display this help message.
                    `);
                break;

            case "start":
                if (!args[0]) {
                    console.log("Usage: start [symbol]");
                    break;
                }
                symbol = args[0].toUpperCase();
                checkWorkerLastTrade(symbol);
                if (workers.has(symbol)) {
                    console.log(`Worker for ${symbol} is already running.`);
                    break;
                }
                params = {ticker: symbol, type: '', source: "Manual(CLI)", ...defTradingParams}; // Default strategy
                workers.set(symbol, {params});
                stopFlags.set(symbol, false); // Initialize stop flag
                worker = createWorker(symbol, params);
                worker(); // Start the worker
                break;

            case "stop":
                if (!args[0]) {
                    console.log("Usage: stop [symbol]");
                    break;
                }
                stopSymbol = args[0].toUpperCase();
                if (workers.has(stopSymbol)) {
                    console.log(`Raising stop flag for ${stopSymbol}`);
                    stopFlags.set(stopSymbol, true); // Raise stop flag
                } else {
                    console.log(`No worker found for ${stopSymbol}`);
                }
                break;

            case "ls":
                console.log("Active Workers:");
                counter = 0;
                for (const [symbol, {params}] of workers) {
                    counter++;
                    console.log(`${counter}) ${symbol}: Strategy = ${params.type}`);
                }
                console.log("Active strategies: ", strategyTypes);
                break;

            case "refresh-stocks":
                console.log("Refresh stocks");
                stockCandidates = await identifyStocks([]); // Fetch max 10 stocks
                for (let i = 0; i < stockCandidates.length; i++) {
                    stockCandidate = stockCandidates[i];
                    let strategyType = strategyTypes[i % strategyTypes.length];
                    tryRunWorker(stockCandidate, strategyType);
                }
                break;

            case "refresh-ext-stocks":
                await readFromExternalSource();
                break;

            case "budget-add":
                if (!args[0]) {
                    console.log("Usage: add-budget [amount]");
                    break;
                }
                amount = parseFloat(args[0]);
                if (isNaN(amount)) {
                    console.log("Invalid amount.");
                    break;
                }
                budgetManager.increaseBudget(amount);
                budgetInfo = await budgetManager.getBudgetInfo();
                console.log(`Budget increased by ${amount}. Total budget: ${JSON.stringify(budgetInfo)}`);
                break;

            case "budget-i":
                budgetInfo = await budgetManager.getBudgetInfo();
                console.log(`Budget info: ${JSON.stringify(budgetInfo)}`);
                break;

            case "ls-trx":
                console.log("Sent Transactions:");
                console.table(sentTransactions);
                console.log("Trade Orders:");
                console.table(tradeOrders);
                break;

            case "stop-engine":
                console.log("Stopping the engine...");
                running = false;
                runningWorkers = workers.keys();
                for (worker of runningWorkers) {
                    appLog.info(`Stopping worker for ${worker}`);
                    await stopMarketData(worker);
                    stopFlags.set(worker, true);
                }
                rl.close();
                break;
            case "open-orders":
                openOrders = await getOrders();
                console.log("Open Orders:");
                console.table(openOrders);
                break;

            case "green-candles":
                if (!args[0]) {
                    console.log("Minimum green candles in a row: ", appConf.strategies.TrendMomentumBreakoutStrategy.numOfGrennCandlesInARawThreshold);
                    console.log("Usage: green-candles [amount]");
                    break;
                }
                amount = parseInt(args[0]);
                if (isNaN(amount)) {
                    console.log("Invalid amount.");
                    break;
                }
                appConf.strategies.TrendMomentumBreakoutStrategy.numOfGrennCandlesInARawThreshold = amount;
                console.log("Minimum green candles in a row set to: ", amount);
                break;
            default:
                console.log("Unknown command. Type 'help' for available commands.");
        }
    });
};

function tryRunWorker(stockCandidate, strategyType) {
    const symbol = stockCandidate.symbol;
    checkWorkerLastTrade(symbol);
    if (!workers.has(symbol)) {
        console.log(`Spawning worker for ${symbol} from ${stockCandidate.source}`);
        const params = {ticker: symbol, type: strategyType, source: stockCandidate.source, ...defTradingParams}; // Default parameters
        const worker = createWorker(symbol, params);
        workers.set(symbol, {worker, params});
        stopFlags.set(symbol, false); // Initialize stop flag
        worker(); // Start the worker
    }
}

/**
 * Engine Logic
 */

const engine = async () => {
    const timeout = 1000 * 60 * 5; // 5 minutes
    try {
        while (running) {
            convertLogsToCSV();
            await readFromExternalSource();
            await readFromYahooFinance();
            await new Promise((resolve) => setTimeout(resolve, timeout)); // Sleep before rechecking
        }
    } catch (error) {
        console.error("Error in engine:", error.message);
    }
    appLog.info("Engine stopped.");
    console.log("Engine stopped.");
};

/**
 * Main Function
 */
export async function main() {
    console.log("Starting engine...");
    startCLI(); // Start the CLI interface
    await engine(); // Start the engine
    console.log("Goodbye ...");
}

// module.exports = { main };
