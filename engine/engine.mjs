import { startCLI } from './cli.mjs';
import { tryRunWorker , workers } from './workers.mjs';
import { readFromExternalSource, readFromYahooFinance, checkOpenOrders } from './dataFetchers.mjs';
import appConfig from "../config/AppConfig.mjs";
import { getEntityLogger } from '../utils/logger/loggerManager.mjs';
import {processAndCombineLogsToCSV} from "../scripts/combineTxAndAnalytics.mjs";
import {convertLogsToCSV} from "../scripts/transactionsLogToCSV.mjs";

const appLog = getEntityLogger('appLog');
const appConf = appConfig();
export let running = true;
export const defTradingParams = {
    capital: appConf.trading.singleTradeCapital,
    takeProfit: appConf.trading.takeProfit,
    stopLoss: appConf.trading.stopLoss,
    tradeTime: undefined,
};

export async function main() {
    console.log("Starting engine...");
    await runEngine(); // Start the main engine loop
    console.log("Goodbye ...");
}

/**
 * Run the Trading Engine
 */
export async function runEngine() {
    try {
        console.log("Starting engine...");

        // Start CLI interface for user commands
        await startCLI();

        // Initialize required configurations
        const timeout = 1000 * 60 * 5; // 5 minutes


        // Engine main loop
        while (running) {
            const openOrders = await checkOpenOrders();
            openOrders.forEach(symbol => {
                workers.set(symbol, {worker: undefined, params: {tradeTime: Date.now(), ticker: symbol, source: "Open Orders"}});
            });
            const googleSheetsStocks = await readFromExternalSource();

            const yahooFinanceStocks = await readFromYahooFinance();
            const stocks = googleSheetsStocks.concat(yahooFinanceStocks);
            for (const stock of stocks) {
                tryRunWorker(stock.symbol, { ...defTradingParams, source: stock.source });
            }

            await new Promise((resolve) => setTimeout(resolve, timeout)); // Sleep for defined timeout

            // Convert logs to CSV for reporting
            processAndCombineLogsToCSV();

            convertLogsToCSV();
        }

        console.log("Engine stopped gracefully.");
    } catch (error) {
        console.error("Error in engine execution:", error.message);
        appLog.error(`Error in engine execution: ${error.message}`);
    } finally {
        console.log("Exiting engine.");
        appLog.info("Engine exited.");
    }
}
