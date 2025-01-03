import { analyzeEnhancedStrategy } from './strategy.mjs';
import { BudgetManager } from '../utils/BudgetManager.mjs';
import appConfig from '../config/AppConfig.mjs';
import { getEntityLogger } from '../utils/logger/loggerManager.mjs';

const appConf = appConfig();
const appLog = getEntityLogger('appLog');
export const workers = new Map();
export const stopFlags = new Map();
const budgetManager = new BudgetManager(appConf.trading.budget);

function createWorker(symbol, params) {
    return async () => {
        try {
            // appLog.info(`Worker started for ${symbol}`);
            await analyzeEnhancedStrategy(symbol, params, budgetManager, stopFlags);
        } catch (error) {
            appLog.error(`Error in worker for ${symbol}:`, error.message);
        } finally {
            workers.delete(symbol);
            stopFlags.delete(symbol);
        }
    };
}

export function tryRunWorker(symbol, params) {
    checkWorkerLastTrade(symbol);
    if (!workers.has(symbol)) {
        console.log(`Spawning worker for ${symbol} from ${params.source}`);
        const worker = createWorker(symbol, params);
        workers.set(symbol, {worker, params});
        stopFlags.set(symbol, false); // Initialize stop flag
        worker(); // Start the worker
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