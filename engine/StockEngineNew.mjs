import {getEntityLogger} from '../utils/logger/loggerManager.mjs';
import appConfig from '../config/AppConfig.mjs';
// import { sellStock, buyStock, getQuote, setBracketOrdersForBuy, getOpenPositions, getOrders} from "../broker/alpaca/tradeService.mjs";
import {MarketAnalyzerFactory, TradingStrategy} from "../strategies/MarketAnalyzerFactory.mjs";
import {fetchMarketData, stopMarketData, setBracketOrdersForBuy, getOrders, getOrderById} from "../broker/MarketDataFetcher.mjs";
import {tradingConfig, isWithinTradingHours} from "../utils/TradingHours.mjs";
import {identifyStocks} from "../stockInfo/StocksSelector.mjs";
import {fetchEarnings} from "../stockInfo/StockCalender.mjs";
import readline from "readline";
import {TimerLog} from "../utils/TimerLog.mjs";
import {fetchCSV} from '../stockInfo/GoogleSheetStockSelector.mjs';
import {nyseTime} from "../utils/TimeFormatting.mjs";
import {BudgetManager} from "../utils/BudgetManager.jsm.js";

const appConf = appConfig();
const transactionLog = getEntityLogger('transactions');
const appLog = getEntityLogger('appLog');

const workers = new Map(); // Map to track workers by stock symbol {symbol: {worker, params}}
const stopFlags = new Map(); // Map to track stop flags by stock symbol
const sentTransactions = []; // Array to store all transactions
const tradeOrders = [];
const strategyTypes = Object.values(TradingStrategy);
let running = true; // Flag to control engine status
global.budgetManager = new BudgetManager(appConf.trading.budget);
const defTradingParams = {
    capital: appConf.trading.singleTradeCapital,
    takeProfit: appConf.trading.takeProfit,
    stopLoss: appConf.trading.stopLoss
}; // Default parameters


const analyzeEnhancedStrategy = async (ticker, params) => {
    let support = null;
    let resistance = null;
    let phase = "A"; // Start with Accumulation
    let capital = params.capital; // Initial capital
    let position = 0; // Number of shares held
    const regularInterval = appConf.app.disableTrading ? appConf.dataSource.testFetchInterval : appConf.dataSource.fetchInterval;//2000;
    const monitoringInterval = 60000;
    let timeoutInterval = regularInterval;
    const timerLog = new TimerLog();
    const analyzersList = [];
    let selectedAnalyzer;
    let accumulationAchieved, breakoutConfirmed, potentialGain, potentialLoss, orderResult;
    let budgetAllocationSucceeded = false;

    // seeting the right take profit multiplier based on the data source provider
    if (appConf.dataSource.provider === 'yahoo') {
        params.takeProfitMultiplier = appConf.dataSource.yahoo.takeProfitMultipler;
    } else if (appConf.dataSource.provider === 'ibkr') {
        params.takeProfitMultiplier = appConf.dataSource.ibkr.takeProfitMultipler;
    } else {
        // default
    }

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
                    appLog.info(`Insufficient data for ${ticker}. Retrying...`);
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
                        let breakoutConfirmed = false
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
                            position += shares;
                            capital -= shares * close;
                            potentialLoss = (close - stopLoss) * shares;
                            potentialGain = (takeProfit - close) * shares;
                            if (potentialGain >= appConf.trading.minimumGain) {
                                budgetAllocationSucceeded = await budgetManager.allocateBudget(params.capital);
                                if (budgetAllocationSucceeded) {
                                    let budgetInfo = await global.budgetManager.getBudgetInfo();
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
                                        orderResult = await setBracketOrdersForBuy(ticker, shares, close, takeProfit, stopLoss);
                                        trx.orderResults = orderResult;
                                        // const orderResult = await buyStock(ticker, shares, "limit", close);
                                        timeoutInterval = monitoringInterval;
                                        phase = "E"; // Move to Execution Monitoring
                                    }
                                    await writeToLog(ticker, orderResult, tradeOrders, sentTransactions, trx);
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
                        const bracketOrderIds = Object.values(orderResult);
                        for (const orderId of bracketOrderIds) {
                            const order = await getOrderById(orderId);
                            if (order){
                                transactionLog.info(JSON.stringify(order));
                                console.log(`Order status: ${order.status}`);
                                if (order.status === "Filled") {
                                    appLog.info(`Ticker ${ticker} | Order Filled: ${JSON.stringify(order)}`);
                                    phase = "C"; // Move to Exit Strategy
                                }
                            } else {
                                appLog.info(`Ticker ${ticker} | Order not found: ${orderId}`);
                            }
                        }
                        const openOrders = await getOrders();
                        if (openOrders.length === 0) {
                            appLog.info(`Ticker ${ticker} | No open positions. Restarting strategy.`);
                            if (sentTransactions.length > 0) appLog.info(`Sent Transactions: ${JSON.stringify(sentTransactions)}`);
                            timeoutInterval = regularInterval;
                            phase = "C"; // Exit the strategy
                        } else {
                            let allFilled = false;
                            for (const order of openOrders) {
                                if (appConf.dataSource.provider === 'ibkr') {
                                    appLog.info(`Ticker ${ticker} | IBKR Orders: ${JSON.stringify(order)}`);
                                    if (order.order.status === "Filled") {
                                        allFilled = true;
                                    } else {
                                        allFilled = false;
                                    }
                                } else {
                                    if (order.type === "single" && order.order.status.toLowerCase() === "filled") {
                                        timeoutInterval = regularInterval;
                                        appLog.info(`Ticker ${ticker} | Single Order Filled: ${JSON.stringify(order)}`);
                                        transactionLog.info(JSON.stringify(order));
                                        phase = "C";
                                    } else if (order.type === "bracket") {
                                        if (order.parentOrder.status === "filled" && (order.takeProfitOrder.status === "filled" || order.stopLossOrder.status === "filled")) {
                                            timeoutInterval = regularInterval;
                                            phase = "C";
                                            appLog.info(`Ticker ${ticker} | Bracket Order Filled: ${JSON.stringify(order)}`);
                                            transactionLog.info(JSON.stringify(order));
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
                return;
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
    console.log("Refresh from google sheets");
    let stockList = await fetchCSV(appConf.dataSource.google_sheets.url);
    stockList.splice(appConf.dataSource.google_sheets.maxSymbols);
    for (let i = 0; i < stockList.length; i++) {
        if (!stockList[i][0]) continue;
        const symbol = stockList[i][0];
        let strategyType = TradingStrategy.TrendMomentumBreakoutStrategy;
        tryRunWorker({symbol, source: "google_sheet"}, strategyType);
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
            workers.delete(symbol); // Cleanup worker
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

    console.log("Engine CLI started. Type 'help' for available commands.");

    rl.on("line", async (line) => {
        const [command, ...args] = line.trim().split(" ");
        let budgetInfo, counter = 0;

        switch (command) {
            case "help":
                console.log(`
            Available Commands:
              - start [symbol] [strategy]: Start a worker for a specific stock.
              - stop [symbol]: Stop a worker for a specific stock.
              - list List all active workers.
              - transactions : List all transactions.
              - open-orders : List all open orders.
              - stop-engine : Gracefully stop the engine and all workers.
              - refresh-stocks : Refresh the list of stock.
              - refresh-ext-stocks : Refresh the list of stock from external source.
              - add-budget [amount]: Add budget to the engine.
              - budget-info: Get budget information.
              - help: Display this help message.
                    `);
                break;

            case "start":
                if (!args[0] && !args[1]) {
                    console.log("Usage: start [symbol] [strategy]");
                    break;
                }
                const symbol = args[0].toUpperCase();
                const strategy = args[1];
                if (workers.has(symbol)) {
                    console.log(`Worker for ${symbol} is already running.`);
                    break;
                }
                if (!strategyTypes.includes(strategy)) {
                    console.log(`Unknown strategy: ${strategy}`);
                    break;
                }
                const params = {ticker: symbol, type: strategy, source: "Manual(CLI)", ...defTradingParams}; // Default strategy
                workers.set(symbol, {params});
                stopFlags.set(symbol, false); // Initialize stop flag
                const worker = createWorker(symbol, params);
                worker(); // Start the worker
                break;

            case "stop":
                if (!args[0]) {
                    console.log("Usage: stop [symbol]");
                    break;
                }
                const stopSymbol = args[0].toUpperCase();
                if (workers.has(stopSymbol)) {
                    console.log(`Raising stop flag for ${stopSymbol}`);
                    stopFlags.set(stopSymbol, true); // Raise stop flag
                } else {
                    console.log(`No worker found for ${stopSymbol}`);
                }
                break;

            case "list":
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
                const stockCandidates = await identifyStocks([]); // Fetch max 10 stocks
                for (let i = 0; i < stockCandidates.length; i++) {
                    const stock = stockCandidates[i];
                    let strategyType = strategyTypes[i % strategyTypes.length];
                    const symbol = stock.symbol;
                    tryRunWorker(stock, strategyType);
                }
                break;

            case "refresh-ext-stocks":
                await readFromExternalSource();
                break;

            case "add-budget":
                if (!args[0]) {
                    console.log("Usage: add-budget [amount]");
                    break;
                }
                const amount = parseFloat(args[0]);
                if (isNaN(amount)) {
                    console.log("Invalid amount.");
                    break;
                }
                budgetManager.increaseBudget(amount);
                budgetInfo = await budgetManager.getBudgetInfo();
                console.log(`Budget increased by ${amount}. Total budget: ${JSON.stringify(budgetInfo)}`);
                break;

            case "budget-info":
                budgetInfo = await budgetManager.getBudgetInfo();
                console.log(`Budget info: ${JSON.stringify(budgetInfo)}`);
                break;

            case "transactions":
                console.log("Sent Transactions:");
                console.table(sentTransactions);
                console.log("Trade Orders: TBD");
                // console.table(tradeOrders);
                break;

            case "stop-engine":
                console.log("Stopping the engine...");
                running = false;
                const runningWorkers = workers.keys();
                for (const worker of runningWorkers) {
                    appLog.info(`Stopping worker for ${worker}`);
                    await stopMarketData(worker);
                    stopFlags.set(worker, true);
                }
                rl.close();
                break;
            case "open-orders":
                const openOrders = await getOrders();
                console.log("Open Orders:");
                console.table(openOrders);
                break;
            default:
                console.log("Unknown command. Type 'help' for available commands.");
        }
    });
};

function tryRunWorker(stockCandidate, strategyType) {
    const symbol = stockCandidate.symbol;
    if (!workers.has(symbol)) {

        console.log(`Spawning worker for ${symbol}`);
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
    try {
        await readFromExternalSource();
        const maxStockToFetch = appConf.stockSelector.maxNumberOfStocks || 0;
        while (running) {
            if (workers.size === 0 && maxStockToFetch > 0) {
                let stockCandidates = await selectStocks(maxStockToFetch); // Fetch max 10 stocks
                for (let i = 0; i < stockCandidates.length; i++) {
                    const stockCandidate = stockCandidates[i];
                    let strategyType = strategyTypes[i % strategyTypes.length];
                    const symbol = stockCandidate.symbol;
                    tryRunWorker(stockCandidate, strategyType);
                }
            }
            await new Promise((resolve) => setTimeout(resolve, 10000)); // Sleep before rechecking
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
