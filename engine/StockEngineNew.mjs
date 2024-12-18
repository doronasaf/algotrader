import {getEntityLogger} from '../utils/logger/loggerManager.mjs';
import appConfig from '../config/AppConfig.mjs';
import { sellStock, buyStock, getQuote, setBracketOrdersForBuy, getOpenPositions, getOrders} from "../broker/alpaca/tradeService.mjs";
import { MarketAnalyzerFactory, TradingStrategy } from "../strategies/MarketAnalyzerFactory.mjs";
import { fetchMarketData } from "../broker/MarketDataFetcher.mjs";
import {tradingConfig, isWithinTradingHours} from "../utils/TradingHours.mjs";
import {identifyStocks} from "../stockInfo/StocksSelector.mjs";
import {fetchEarnings} from "../stockInfo/StockCalender.mjs";
import readline from "readline";
import {TimerLog} from "../utils/TimerLog.mjs";
import { fetchCSV } from '../stockInfo/GoogleSheetStockSelector.mjs';
import {nyseTime} from "../utils/TimeFormatting.mjs";
import {BudgetManager}   from "../utils/BudgetManager.jsm.js";

const appConf = appConfig();
const transactionLog = getEntityLogger('transactions');
const analyticsLog = getEntityLogger('analytics');
const appLog = getEntityLogger('app');

const workers = new Map(); // Map to track workers by stock symbol {symbol: {worker, params}}
const stopFlags = new Map(); // Map to track stop flags by stock symbol
const sentTransactions = []; // Array to store all transactions
const tradeOrders = [];
const strategyTypes = Object.values(TradingStrategy);
let running = true; // Flag to control engine status
global.budgetManager = new BudgetManager(appConf.trading.budget);
const defTradingParams = { capital: appConf.trading.singleTradeCapital, takeProfit: appConf.trading.takeProfit, stopLoss: appConf.trading.stopLoss }; // Default parameters


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
    let accumulationAchieved, breakoutConfirmed;


    for (const session in tradingConfig) {
        if (session !== "market") continue;
        const tradingSession = tradingConfig[session];
        if (!tradingSession.enabled) continue;
        while (isWithinTradingHours(tradingSession)) {
            // **Check Stop Flag**
            if (stopFlags.get(ticker) && phase !== "E") {
                appLog.info(`Worker for ${ticker} stopped by user, phase = ${phase}`);
                return; // Exit gracefully
            }

            let { closes, highs, lows, volumes } = await fetchMarketData(ticker);
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
                    analyzersList.push({analyzer: MarketAnalyzerFactory.createAnalyzer(strategy, ticker, { closes, highs, lows, volumes }, support, resistance, params), accCompleted:false});
                }
            }
            // if (!analyzer) analyzer = MarketAnalyzerFactory.createAnalyzer(params.type, ticker, { closes, highs, lows, volumes }, support, resistance, params);

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
                    // analyzer.setSupportResistance(support, resistance);
                    let breakoutConfirmed = false
                    for (const analyzerItem of analyzersList) {
                        selectedAnalyzer = analyzerItem.analyzer;
                        if (!analyzerItem.accCompleted) {
                            selectedAnalyzer.setSupportResistance(support, resistance);
                            selectedAnalyzer.setMarketData({closes, highs, lows, volumes});
                            accumulationAchieved = await selectedAnalyzer.evaluateAccumulation();
                            analyzerItem.accCompleted = accumulationAchieved;
                        };
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
                        // const shares = Math.floor(capital / close);
                        position += shares;
                        capital -= shares * close;
                        if (appConf.app.disableTrading === true) {
                            analyticsLog.info(`Ticker ${ticker} | In demo mode. Skipping order placement.`);
                            let budgetInfo = global.budgetManager.getBudgetInfo();
                            let trx = {ticker, source: params.source, action: "BUY", price: close, timestamp: nyseTime(), shares, takeProfit, stopLoss, potentialGain: (takeProfit - close) * shares, potentialLoss: (close - stopLoss) * shares, budgetRemaining: budgetInfo.remainingBudget, budgetAllocated: budgetInfo.allocatedBudget, status: "Demo"};
                            transactionLog.info(JSON.stringify(trx));
                            sentTransactions.push(trx);
                            phase = "C"; // Skip execution monitoring
                            break;
                        }
                        const orderResult = await setBracketOrdersForBuy(ticker, shares, close, takeProfit, stopLoss);
                        // const orderResult = await buyStock(ticker, shares, "limit", close);
                        orderResult.strategy = selectedAnalyzer.toString();
                        transactionLog.info(`Ticker ${ticker} | Source: ${params.source} Buy Order: Shares = ${shares}, Buy Price = ${close}, TP = ${takeProfit}, SL = ${stopLoss}`);

                        await writeToLog(ticker, close, shares, capital, orderResult, "bracket", "BUY", tradeOrders, sentTransactions, params.source);
                        timeoutInterval = monitoringInterval;
                        phase = "E"; // Move to Execution Monitoring
                    } else if (breakoutConfirmed === 0) {
                        phase = "B"; // Stay in Breakout phase
                    } else if (breakoutConfirmed === -1) {
                        phase = "A"; // Return to Accumulation phase
                    }
                    break;

                case "C": // Cleanup
                    appLog.info(`Ticker ${ticker} | Strategy: ${selectedAnalyzer?.toString()} | End of trading session`);
                    return;

                case "E": // Execution Monitoring
                    const openOrders = await getOrders();

                    if (openOrders.length === 0) {
                        appLog.info(`Ticker ${ticker} | No open positions. Restarting strategy.`);
                        if (sentTransactions.length > 0) appLog.info(`Sent Transactions: ${JSON.stringify(sentTransactions)}`);
                        timeoutInterval = regularInterval;
                        phase = "C"; // Exit the strategy
                    } else {
                        for (const order of openOrders) {
                            if (order.type === "single" && order.order.status === "filled") {
                                timeoutInterval = regularInterval;
                                transactionLog.info(`Ticker ${ticker} | Single Order Filled: ${JSON.stringify(order)}`);
                                phase = "C";
                            } else if (order.type === "bracket") {
                                if (order.parentOrder.status === "filled" && (order.takeProfitOrder.status === "filled" || order.stopLossOrder.status === "filled")) {
                                    timeoutInterval = regularInterval;
                                    phase = "C";
                                    transactionLog.info(`Ticker ${ticker} | Bracket Order Filled: ${JSON.stringify(order)}`);
                                }
                            }
                        }
                    }
                    break;
            }

            await new Promise((resolve) => setTimeout(resolve, timeoutInterval));
        }
    }
};

const writeToLog = async (ticker, close, sharesOrSellValue, capital, orderResult, action, status, tradeOrders, sentTransactions, source) => {
    tradeOrders.push(orderResult.order);
    tradeOrders.push(orderResult.orderStatus);
    sentTransactions.push({ ticker, source, action: action, price: close, timestamp: new Date(), sharesOrSellValue, status: status , strategy: orderResult.strategy});
}

const selectStocks = async (maxNumberOfStocks) => {
    const today = new Date();
    const dateString = today.toISOString().split('T')[0];
    const todayEarningStocks = await fetchEarnings(dateString);
    const combinedList = await identifyStocks(todayEarningStocks);
    const numberOfStocks = Math.min(maxNumberOfStocks, combinedList.length);
    return combinedList.slice(0,numberOfStocks); // maximum 9 stocks
}


/**
 * Worker Logic
 */
const createWorker = (symbol, params) => {
    return async () => {
        appLog.info(`Worker started for ${symbol} with strategy ${params.type}`);
        let allocated = false;
        try {
            allocated = await budgetManager.allocateBudget(params.capital);
            if (!allocated) {
                appLog.info(`Worker for ${symbol} could not start due to insufficient budget.`);
                let {availableBudget, allocatedBudget} = await budgetManager.getBudgetInfo();
                analyticsLog.info(`Ticker ${symbol} | Strategy: ${params.type} | Source: ${params.source} | Budget: ${params.capital} | Allocated Budget: ${allocatedBudget} | Remaining Budget: ${availableBudget} | Status: Budget Insufficient`);
            } else {
                await analyzeEnhancedStrategy(symbol, params);
                appLog.info(`Worker completed for ${symbol}. Releasing budget.`);
            }
        } catch (error) {
            console.error(`Error in worker for ${symbol}: ${error.message}`);
            appLog.info(`Error in worker for ${symbol}: ${error.message}, Releasing budget: ${params.capital}`);
        } finally {
            if (allocated) {
                await budgetManager.releaseBudget(params.capital);
            }
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

        switch (command) {
            case "help":
                console.log(`
            Available Commands:
              - start [symbol] [strategy]: Start a worker for a specific stock.
              - stop [symbol]: Stop a worker for a specific stock.
              - list List all active workers.
              - transactions : List all transactions.
              - stop-engine : Gracefully stop the engine and all workers.
              - refresh-stocks : Refresh the list of stock.
              - refresh-ext-stocks : Refresh the list of stock from external source.
              - add-budget [amount]: Add budget to the engine.
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
                const params = { ticker: symbol, type: strategy, source: "Manual(CLI)", ...defTradingParams }; // Default strategy
                workers.set(symbol, { params });
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
                for (const [symbol, { params }] of workers) {
                    console.log(`- ${symbol}: Strategy = ${params.type}`);
                }
                console.log("Active strategies: ", strategyTypes);
                break;

            case "refresh-stocks":
                console.log("Refresh stocks");
                const stockCandidates = await identifyStocks([]); // Fetch max 10 stocks
                for (let i=0; i< stockCandidates.length; i++) {
                    const stock = stockCandidates[i];
                    let strategyType = strategyTypes[i % strategyTypes.length];
                    const symbol = stock.symbol;
                    tryRunWorker(stock, strategyType);
                }
                break;

            case "refresh-ext-stocks":
                console.log("Refresh from google sheets");
                let stockList = await fetchCSV(appConf.dataSource.google_sheets.url);
                stockList.splice(15)
                for (let i=0; i< stockList.length; i++) {
                    if (!stockList[i][0]) continue;
                    const symbol = stockList[i][0];
                    const strategy = stockList[i][1];
                    let strategyType = TradingStrategy.TrendMomentumBreakoutStrategy;
                    tryRunWorker({symbol, source: "google_sheet"}, strategyType);
                }
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
                    global.budget += amount;
                    console.log(`Budget increased by ${amount}. Total budget: ${global.budget}`);
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
                    stopFlags.set(worker, true);
                }
                rl.close();
                break;

            default:
                console.log("Unknown command. Type 'help' for available commands.");
        }
    });
};

function tryRunWorker (stockCandidate, strategyType) {
    const symbol = stockCandidate.symbol;
    if (!workers.has(symbol)) {

        console.log(`Spawning worker for ${symbol}`);
        const params = { ticker: symbol, type: strategyType, source: stockCandidate.source, ...defTradingParams }; // Default parameters
        const worker = createWorker(symbol, params);
        workers.set(symbol, { worker, params });
        stopFlags.set(symbol, false); // Initialize stop flag
        worker(); // Start the worker
    }
}
/**
 * Engine Logic
 */

const engine = async () => {
    try {
        const maxStockToFetch = appConf.stockSelector.maxNumberOfStocks;
        while (running) {
            if (workers.size === 0) {

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
}

// module.exports = { main };
