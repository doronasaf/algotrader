const getEntityLogger = require('../utils/logger/loggerManager');
const { sellStock, buyStock, getQuote, setBracketOrdersForBuy, getOpenPositions, getOrders} = require("../broker/alpaca/tradeService");
const { MarketAnalyzerFactory, TradingStrategy } = require("../strategies/MarketAnalyzerFactory");
const { fetchMarketData } = require("../broker/MarketDataFetcher");
const {tradingConfig, isWithinTradingHours} = require("../utils/TradingHours");
const {identifyStocks} = require("../stockInfo/StocksSelector");
const {fetchEarnings} = require("../stockInfo/StockCalender");
const transactionLog = getEntityLogger('transactions');
const analyticsLog = getEntityLogger('analytics');
const appLog = getEntityLogger('app');
const readline = require("readline");

const workers = new Map(); // Map to track workers by stock symbol {symbol: {worker, params}}
const stopFlags = new Map(); // Map to track stop flags by stock symbol
const sentTransactions = []; // Array to store all transactions
const tradeOrders = [];
const strategyTypes = Object.values(TradingStrategy);
let running = true; // Flag to control engine status

let budget = 20000; // Total budget available
let allocatedBudget = 0; // Budget currently allocated to active workers
const defTradingParams = { capital: 3000, takeProfit: 1.006, stopLoss: 0.98 }; // Default parameters


const analyzeEnhancedStrategy = async (ticker, params) => {
    let support = null;
    let resistance = null;
    let phase = "A"; // Start with Accumulation
    let capital = params.capital; // Initial capital
    let position = 0; // Number of shares held
    const regularInterval = 2000;
    const monitoringInterval = 60000;
    let timeoutInterval = regularInterval;

    for (const session in tradingConfig) {
        if (session !== "market") continue;
        const config = tradingConfig[session];
        if (!config.enabled) continue;
        // log.info(`Starting trading session for ${ticker}: ${session}`);

        while (isWithinTradingHours(config)) {
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

            switch (phase) {
                case "A": // Accumulation
                    if (!support || !resistance) {
                        support = low;
                        resistance = high;
                    } else {
                        if (high > resistance) resistance = high;
                        if (low < support) support = low;

                        const analyzer = MarketAnalyzerFactory.createAnalyzer(params.type, ticker, { closes, highs, lows, volumes }, support, resistance, params);
                        const accumulationAchieved = await analyzer.evaluateAccumulation();
                        if (accumulationAchieved) {
                            phase = "B";
                            appLog.info(`Ticker ${ticker} | Moved to Breakout Phase (B)`);
                        }
                    }
                    break;

                case "B": // Breakout
                    const analyzer = MarketAnalyzerFactory.createAnalyzer(params.type, ticker, { closes, highs, lows, volumes }, support, resistance, params);
                    const breakoutConfirmed = await analyzer.evaluateBreakout();
                    if (breakoutConfirmed === 1) { // buy
                        const margins = analyzer.getMargins();
                        const newShares = Math.floor(margins.shares);
                        const newTakeProfit = margins.takeProfit;
                        const newStopLoss = margins.stopLoss;
                        const shares = Math.floor(capital / close);
                        position += shares;
                        capital -= shares * close;

                        const takeProfit = Math.floor(close * params.takeProfit * 100) / 100;
                        const stopLoss = Math.floor(close * params.stopLoss * 100) / 100;
                        close = Math.floor(close * 100) / 100;

                        if (shares !== newShares && takeProfit !== newTakeProfit && stopLoss !== newStopLoss) {
                            appLog.info(`Ticker ${ticker} | Updated Margins: Shares = ${newShares}, TP = ${newTakeProfit}, SL = ${newStopLoss}`);
                        }

                        const orderResult = await setBracketOrdersForBuy(ticker, shares, close, takeProfit, stopLoss);
                        orderResult.strategy = analyzer.toString();
                        transactionLog.info(`Ticker ${ticker} | Buy Order: Shares = ${shares}, Buy Price = ${close}, TP = ${takeProfit}, SL = ${stopLoss}`);

                        await writeToLog(ticker, close, shares, capital, orderResult, "bracket", "BUY", tradeOrders, sentTransactions);
                        timeoutInterval = monitoringInterval;
                        phase = "E"; // Move to Execution Monitoring
                    } else if (breakoutConfirmed === 0) {
                        phase = "B"; // Stay in Breakout phase
                    } else if (breakoutConfirmed === -1) {
                        phase = "A"; // Return to Accumulation phase
                    }
                    break;

                case "C": // Cleanup
                    appLog.info(`Ticker ${ticker} | Strategy: ${analyzer?.toString()} | End of trading session`);
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

const allocateBudget = (budgetNeeded) => {
    if (allocatedBudget + budgetNeeded > budget) {
        appLog.info(`Insufficient budget to allocate ${budgetNeeded}. Available: ${budget - allocatedBudget}`);
        return false;
    }
    allocatedBudget += budgetNeeded;
    return true;
};

const releaseBudget = (budgetToRelease) => {
    allocatedBudget -= budgetToRelease;
    if (allocatedBudget < 0) allocatedBudget = 0; // Ensure no negative budget
};
/**
 * Worker Logic
 */
const createWorker = (symbol, params) => {
    return async () => {
        appLog.info(`Worker started for ${symbol} with strategy ${params.type}`);
        try {
            if (!allocateBudget(params.capital)) {
                appLog.info(`Worker for ${symbol} could not start due to insufficient budget.`);
                workers.delete(symbol); // Cleanup worker
                stopFlags.delete(symbol); // Cleanup stop flag
                return;
            }
            await analyzeEnhancedStrategy(symbol, params);
            appLog.info(`Worker completed for ${symbol}. Releasing budget.`);
        } catch (error) {
            console.error(`Error in worker for ${symbol}: ${error.message}`);
            appLog.info(`Error in worker for ${symbol}: ${error.message}, Releasing budget: ${params.capital}`);
        } finally {
            releaseBudget(params.capital);
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
                const params = { ticker: symbol, type: strategy, ...defTradingParams }; // Default strategy
                const worker = createWorker(symbol, params);
                workers.set(symbol, { worker, params });
                stopFlags.set(symbol, false); // Initialize stop flag
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
                    budget += amount;
                    console.log(`Budget increased by ${amount}. Total budget: ${budget}`);
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
        const params = { ticker: symbol, type: strategyType, ...defTradingParams }; // Default parameters
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
        while (running) {
            if (workers.size === 0) {
                let stockCandidates = await selectStocks(10); // Fetch max 10 stocks
                // let stockCandidates=[];//zzzzzzzz
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
const main = async () => {
    console.log("Starting engine...");
    startCLI(); // Start the CLI interface
    await engine(); // Start the engine
};

module.exports = { main };
