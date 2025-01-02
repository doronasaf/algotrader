import readline from "readline";
import process from "process";
import { getEntityLogger } from '../utils/logger/loggerManager.mjs';
import { tryRunWorker, workers, stopFlags } from './workers.mjs';
import { defTradingParams } from './engine.mjs';
import { getOrders } from '../broker/MarketDataFetcher.mjs';
import { readFromExternalSource, readFromYahooFinance } from './dataFetchers.mjs';
import { stopMarketData } from "../broker/MarketDataFetcher.mjs";
import { sentTransactions, tradeOrders }  from "./strategy.mjs";

const appLog = getEntityLogger("appLog");
import { BudgetManager } from '../utils/BudgetManager.mjs';
import appConfig from '../config/AppConfig.mjs';

const appConf = appConfig();
const budgetManager = new BudgetManager(appConf.trading.budget);

export async function startCLI() {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    console.log("Engine CLI started. Type 'help' for available commands.");

    rl.on("line", async (line) => {
        const [command, ...args] = line.trim().split(" ");
        switch (command) {
            case "help":
                displayHelp();
                break;

            case "start":
                handleStartCommand(args);
                break;

            case "stop":
                handleStopCommand(args);
                break;

            case "ls":
                listWorkers();
                break;

            case "lst":
                await displayTransactions();
                break;

            case "refresh-stocks":
                await refreshStocks();
                break;

            case "refresh-ext-stocks":
                await refreshExternalStocks();
                break;

            case "budget-add":
                handleBudgetAdd(args);
                break;

            case "budget-i":
                await displayBudgetInfo();
                break;

            case "green-candles":
                handleGreenCandles(args);
                break;

            case "open-orders":
                await displayOpenOrders();
                break;

            case "stop-engine":
                await stopEngine(rl);
                break;

            default:
                console.log("Unknown command. Type 'help' for available commands.");
        }
    });
}

function displayHelp() {
    console.log(`
Available Commands:
  - start [symbol]: Start a worker for a specific stock.
  - stop [symbol]: Stop a worker for a specific stock.
  - ls: List all active workers.
  - lst: List all transactions and orders.
  - refresh-stocks: Refresh the list of stocks.
  - refresh-ext-stocks: Refresh stocks from an external source.
  - budget-add [amount]: Add budget to the engine.
  - budget-i: Get current budget information.
  - green-candles [amount]: Set minimum green candles in a row for bullish trends.
  - open-orders: List all open orders.
  - stop-engine: Gracefully stop the engine and all workers.
  - help: Display this help message.
    `);
}

function handleStartCommand(args) {
    const symbol = args[0]?.toUpperCase();
    if (!symbol) {
        console.log("Usage: start [symbol]");
        return;
    }

    if (workers.has(symbol)) {
        console.log(`Worker for ${symbol} is already running.`);
        return;
    }

    const params = { ticker: symbol, source: "CLI", ...appConf.defaultParams };
    tryRunWorker(symbol, params);
}

function handleStopCommand(args) {
    const symbol = args[0]?.toUpperCase();
    if (!symbol) {
        console.log("Usage: stop [symbol]");
        return;
    }

    if (workers.has(symbol)) {
        console.log(`Raising stop flag for ${symbol}`);
        stopFlags.set(symbol, true); // Raise stop flag
    } else {
        console.log(`No worker found for ${symbol}`);
    }
}

function listWorkers() {
    let counter = 1;
    console.log("Active Workers:");
    for (const [symbol, { params }] of workers) {
        console.log(`${counter}) ${symbol}: Source = ${params.source}`);
        counter++;
    }
}

async function refreshStocks() {
    console.log("Refreshing stocks from Yahoo Finance...");
    const stocks = await readFromYahooFinance();
    for (const stock of stocks) {
        tryRunWorker(stock.symbol, { ...defTradingParams, source: stock.source });
    }
    console.log("Stocks refreshed.");
}

async function refreshExternalStocks() {
    console.log("Refreshing stocks from external source...");
    const stocks = await readFromExternalSource();
    for (const stock of stocks) {
        tryRunWorker(stock.symbol, { ...defTradingParams, source: stock.source });
    }
    console.log("External stocks refreshed.");
}

function handleBudgetAdd(args) {
    const amount = parseFloat(args[0]);
    if (isNaN(amount)) {
        console.log("Usage: budget-add [amount]");
        return;
    }

    budgetManager.increaseBudget(amount);
    console.log(`Budget increased by ${amount}.`);
}

async function displayBudgetInfo() {
    const budgetInfo = await budgetManager.getBudgetInfo();
    console.log(`Budget info:`, JSON.stringify(budgetInfo));
}

function handleGreenCandles(args) {
    const amount = parseInt(args[0]);
    if (isNaN(amount)) {
        console.log("Usage: green-candles [amount]");
        console.log(`Current setting: ${appConf.strategies.TrendMomentumBreakoutStrategy.numOfGreenCandlesThreshold}`);
        return;
    }

    appConf.strategies.TrendMomentumBreakoutStrategy.numOfGreenCandlesThreshold = amount;
    console.log(`Minimum green candles in a row set to: ${amount}`);
}

async function displayOpenOrders() {
    const openOrders = await getOrders();
    console.log("Open Orders:");
    console.table(openOrders);
}

async function displayTransactions() {
    console.log("------------ Sent Transactions ------------");
    console.table(sentTransactions);
    console.log("------------ Trade Orders ------------");
    console.table(tradeOrders);
}

async function stopEngine(rl) {
    console.log("Stopping the engine...");
    rl.close();


    console.log("Stopping the engine...");
    let runningWorkers = workers.keys();
    for (const symbol of runningWorkers) {
        appLog.info(`Stopping worker for ${symbol}`);
        await stopMarketData(symbol);
        stopFlags.set(symbol, true);
    }
    rl.close();
}
