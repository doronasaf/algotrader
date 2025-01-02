import { fetchCSV } from '../stockInfo/GoogleSheetStockSelector.mjs';
import { identifyStocks } from '../stockInfo/StocksSelector.mjs';
import { fetchEarnings } from '../stockInfo/StockCalender.mjs';
import {getOrders, handleOpenOrders } from "../broker/MarketDataFetcher.mjs";
import { getEntityLogger } from '../utils/logger/loggerManager.mjs';
import appConfig from '../config/AppConfig.mjs';
const appConf = appConfig();
const appLog = getEntityLogger('appLog');


export async function readFromExternalSource() {
    let stockList = await fetchCSV(appConf.google_sheets.url);
    stockList.splice(appConf.google_sheets.maxSymbols);
    return stockList;
}

export async function readFromYahooFinance() {
    const today = new Date();
    const earnings = await fetchEarnings(today.toISOString().split('T')[0]);
    const stocks = await identifyStocks(earnings);
    return stocks;
}

export async function checkOpenOrders() {
    const openOrders = [];
    try {
        const orders = await getOrders();
        for (const order of orders) {
            // "open|takeProfit|stopLoss"
            let orderStatus= await handleOpenOrders(order);
            if (orderStatus.tradeStatus === "open" || orderStatus.tradeStatus === "new") {
                openOrders.push(orderStatus.symbol);
                appLog.info(`Found Open order for ${orderStatus.symbol}, parentStatus: ${orderStatus.parentStatus}, takeProfitStatus: ${orderStatus.takeProfitStatus}, stopLossStatus: ${orderStatus.stopLossStatus}`);
            }
        }
    } catch (error) {
        console.error(`Error in checking open orders: ${error.message}`);
    }
    return openOrders;
}

(async () => {
    const openOrders = await checkOpenOrders();
    console.log(openOrders);
})();