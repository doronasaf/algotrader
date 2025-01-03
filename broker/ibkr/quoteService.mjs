import { Client, Contract } from 'ib-tws-api';
import axios from 'axios';
import appConfig from '../../config/AppConfig.mjs';
import {getEntityLogger} from '../../utils/logger/loggerManager.mjs';
const appLog = getEntityLogger('appLog');

// const candleInterval = appConfig().dataSource.ibkr.candleInterval; // 'yahoo' or 'alpacaStream' or ibkr or backtesting
// const maxSamples = appConfig().dataSource.ibkr.maxSamples; // 'yahoo' or 'alpacaStream' or ibkr or backtesting

class OHLCAggregator {
    constructor(symbol, intervalMs, callback) {
        this.symbol = symbol;
        this.intervalMs = intervalMs; // Interval duration in milliseconds (10 seconds)
        this.callback = callback; // Callback to invoke with aggregated 5-minute data
        this.currentInterval = null; // Tracks the current 10-second OHLC
        this.intervalStart = null; // Start time of the current interval
        this.rollingBuffer = []; // Stores the last 30 10-second intervals (5 minutes)
        this.maxSamples = appConfig().dataSource.ibkr.maxSamples; // Number of samples for the rolling buffer
        this.minSamples = appConfig().dataSource.ibkr.minSamples; // Minimum samples to trigger callback
        this.firstBatchReady = false; // Tracks if the first 5 minutes are ready
    }

    processTick(data) {
        const now = Date.now();
        if (data.tickType === 4) { // Only process last price ticks

            const price = data.value;

            // Initialize the current interval if not already set
            if (!this.currentInterval) {
                this.currentInterval = {
                    open: price,
                    high: price,
                    low: price,
                    close: price,
                    volume: 0,
                    timestamp: new Date().toISOString(),
                };
                this.intervalStart = now;
            }

            // Update OHLC values for the current interval
            this.currentInterval.high = Math.max(this.currentInterval.high, price);
            this.currentInterval.low = Math.min(this.currentInterval.low, price);
            this.currentInterval.close = price;

            // Update volume
            this.currentInterval.volume += data.ticker.lastSize || 0;
        }
        if (!this.currentInterval) {
            this.intervalStart = Date.now();
        }
        // Check if the interval has ended
        if (now - this.intervalStart >= this.intervalMs) {
            this.finalizeInterval();
        }
    }

    finalizeInterval() {
        // Add the completed interval to the rolling buffer
        this.rollingBuffer.push(this.currentInterval);

        // Maintain a sliding window of the last 5 minutes
        if (this.rollingBuffer.length > this.maxSamples) {
            this.rollingBuffer.shift();
        }

        // Set the first batch as ready if we've collected 5 minutes of data
        if (this.rollingBuffer.length === this.minSamples) {
            this.firstBatchReady = true;
        }

        // Trigger the callback once the first batch is ready
        if (this.firstBatchReady) {
            this.callback(this.rollingBuffer);
        }

        // Start a new interval, using the previous close as the next open
        this.currentInterval = {
            open: this.currentInterval.close,
            high: this.currentInterval.close,
            low: this.currentInterval.close,
            close: this.currentInterval.close,
            volume: 0,
            timestamp: new Date().toISOString(),
        };
        this.intervalStart = Date.now();
    }
}


export class MarketDataStreamer {
    constructor() {
        this.api = new Client({ host: '127.0.0.1', port: 4002 , clientId: 1});
        this.aggregators = {}; // Track OHLCAggregator instances by symbol
        this.orders = new Map(); // Store orders by their unique ID
        this.connected = false; // Track connection status

        this.initializeConnection();
    }

    // Initialize and maintain connection to IBKR
    async initializeConnection() {
        try {
            if (!this.connected) {
                const serverVersion = await this.api.connect();
                appLog.info("Connected to IBKR API. Server version:", serverVersion);
                this.connected = true;
                this.reconnect();
            }
        } catch (error) {
            appLog.info("Error initializing connection:", error.message);
            appLog.info(error.stack);
            this.connected = false;
            this.reconnect(); // Attempt to reconnect
        }
    }

    // Reconnect to IBKR
    async reconnect() {
        const reconnectDelay = 5000; // 5 seconds
        await new Promise((resolve) => setTimeout(resolve, reconnectDelay));
        appLog.info("Reconnecting to IBKR...");
        this.initializeConnection();
    }

    // Graceful error handling
    async handleError(method, ...args) {
        try {
            return await method(...args);
        } catch (error) {
            appLog.info(`Error in ${method.name}:`, error.message);

            // Reconnect logic if the error is connection-related
            if (error.message.includes("disconnected") || !this.connected) {
                this.connected = false;
                console.warn("Connection error detected. Reconnecting...");
                await this.reconnect();
            }

            // Log and rethrow other errors
            throw error;
        }
    }

    // Dynamically add a symbol to be tracked
    async addSymbol(symbol, callback) {
        if (this.aggregators[symbol]) {
            // appLog.info(`Symbol ${symbol} is already being tracked.`);
            return;
        }

        try {
            const contract = Contract.stock(symbol);

            // Create an OHLCAggregator for the symbol
            const aggregator = new OHLCAggregator(symbol, appConfig().dataSource.ibkr.candleInterval, callback);

            // Start streaming market data for the symbol
            const stream = await this.api.streamMarketData({ contract });

            // Attach stream to aggregator for cleanup
            aggregator.stream = stream;
            this.aggregators[symbol] = aggregator;

            stream.on("tick", (data) => {
                const aggregator = this.aggregators[symbol];
                if (aggregator) {
                    aggregator.processTick(data);
                }
            });

            stream.on("error", (err) => {
                appLog.info(`Stream Error for ${symbol}:`, err.message);
                this.retrySymbolInitialization(symbol, callback, 5000);
            });

            // appLog.info(`Started tracking symbol: ${symbol}`);
        } catch (error) {
            appLog.info(`Error adding symbol ${symbol}:`, error.message);
            setTimeout(() => this.addSymbol(symbol, callback), 5000);
        }
    }

    // Retry symbol initialization
    async retrySymbolInitialization(symbol, callback, delayMs) {
        // appLog.info(`Retrying initialization for symbol: ${symbol} after ${delayMs}ms`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));

        // Ensure the symbol is cleaned up before retrying
        if (this.aggregators[symbol]) {
            const aggregator = this.aggregators[symbol];
            if (aggregator.stream) {
                aggregator.stream.stop();
                aggregator.stream.removeAllListeners();
            }
            delete this.aggregators[symbol];
        }

        await this.addSymbol(symbol, callback);
    }

    // Stop tracking a symbol
    async removeSymbol(symbol) {
        if (!this.aggregators[symbol]) {
            appLog.info(`Symbol ${symbol} is not being tracked.`);
            return;
        }

        try {
            // Stop the stream for the symbol
            const aggregator = this.aggregators[symbol];
            if (aggregator && aggregator.stream) {
                aggregator.stream.stop(); // Stop the market data stream
                aggregator.stream.removeAllListeners(); // Remove all listeners to prevent memory leaks
                appLog.info(`Stopped stream for symbol: ${symbol}`);
            }

            // Clean up the aggregator and remove the symbol
            delete this.aggregators[symbol];
            appLog.info(`Stopped tracking symbol: ${symbol}`);
        } catch (error) {
            appLog.info(`Error stopping tracking for symbol ${symbol}:`, error.message);
        }
    }

    // Get Historical Data - Syncronous operation - no callback needed
    async fetchOHLC (symbol, barSize = "1 min") {
        try {
            const contract = {
                symbol,
                secType: "STK", // Security type (e.g., STK for stocks)
                exchange: "SMART", // IBKR's SMART routing
                currency: "USD", // Currency
                includeExpired: false,
            };

            // Prepare parameters for the historical data request
            const endDateTime = "20241220-19:30:00"; // Leave empty to fetch up to the current time
            const durationStr = "3 D"; // Fetch the last 20 minutes
            const whatToShow = "TRADES"; // Fetch trade data for OHLC
            const useRth = 1; // Only fetch Regular Trading Hours (1 = RTH, 0 = All hours)
            const formatDate = 1; // Use human-readable date format

            // Fetch historical data
            const historicalData = await this.api.getHistoricalData({
                contract,
                endDateTime,
                duration: durationStr,
                barSizeSetting: barSize,
                whatToShow,
                useRth,
                formatDate,
            });

            // Transform the data into a structured format
            const ohlcData = historicalData.map((bar) => ({
                timestamp: bar.time,
                open: bar.open,
                high: bar.high,
                low: bar.low,
                close: bar.close,
                volume: bar.volume,
            }));

            // appLog.info(`Fetched ${ohlcData.length} bars for ${symbol}`);
            return ohlcData;
        } catch (error) {
            appLog.info(`Error fetching OHLC data for ${symbol}:`, error.message);
            throw error;
        }
    }

    async buildOHLCFromTicks(symbol, duration, barSize) {
        try {
            // Define contract
            const contract = {
                symbol,
                secType: "STK", // Stock
                exchange: "SMART", // SMART routing
                currency: "USD", // Currency
            };

            // Calculate startDateTime based on duration
            const now = new Date();
            const durationMs = this.parseDurationToMilliseconds(duration); // Convert duration to milliseconds
            const startDateTime = new Date(now.getTime() - durationMs).toISOString().substring(0,now.toISOString().indexOf('.')).replaceAll('-','').replace('T','-');

            // Fetch historical tick data
            const tickData = await this.api.getHistoricalTicks({
                contract,
                startDateTime, // Calculated based on duration
                numberOfTicks: 10000, // Up to now
                whatToShow: "TRADES", // Fetch trades data
                useRth: 1, // Regular trading hours only
            });

            if (!tickData || tickData.length === 0) {
                throw new Error(`No tick data available for ${symbol}`);
            }

            // appLog.info(`Fetched ${tickData.length} ticks for ${symbol}`);

            // Define the aggregation interval in milliseconds (e.g., 1-minute = 60000 ms)
            const intervalMs = this.parseBarSizeToMilliseconds(barSize);

            // Aggregate ticks into OHLC bars
            const ohlcBars = [];
            let currentBar = { open: null, high: null, low: null, close: null, volume: 0 };
            let currentBarStartTime = new Date(startDateTime).getTime();

            tickData.forEach((tick) => {
                const tickTimestamp = new Date(tick.time*1000).getTime();

                // If the tick is outside the current bar's interval, finalize the current bar
                if (tickTimestamp >= currentBarStartTime + intervalMs) {
                    if (currentBar.open !== null) {
                        ohlcBars.push({ ...currentBar, timestamp: currentBarStartTime });
                    }
                    // Start a new bar
                    currentBarStartTime += intervalMs;
                    currentBar = { open: null, high: null, low: null, close: null, volume: 0 };
                }

                // Update the current bar
                const price = tick.price;
                const size = tick.size;

                currentBar.open = currentBar.open ?? price;
                currentBar.high = currentBar.high !== null ? Math.max(currentBar.high, price) : price;
                currentBar.low = currentBar.low !== null ? Math.min(currentBar.low, price) : price;
                currentBar.close = price;
                currentBar.volume += size;
            });

            // Add the final bar if it has data
            if (currentBar.open !== null) {
                ohlcBars.push({ ...currentBar, timestamp: currentBarStartTime });
            }

            // appLog.info(`Generated ${ohlcBars.length} OHLC bars for ${symbol}`);
            return ohlcBars;
        } catch (error) {
            appLog.info(`Error building OHLC for ${symbol}:`, error.message);
            throw error;
        }
    }


    parseDurationToMilliseconds(duration) {
        const [value, unit] = duration.split(" ");
        const multiplier = {
            S: 1000, // Seconds
            M: 60 * 1000, // Minutes
            H: 60 * 60 * 1000, // Hours
            D: 24 * 60 * 60 * 1000, // Days
            W: 7 * 24 * 60 * 60 * 1000, // Weeks
        }[unit.toUpperCase()];

        if (!multiplier) {
            throw new Error(`Invalid duration unit: ${unit}`);
        }

        return parseInt(value, 10) * multiplier;
    }

    parseBarSizeToMilliseconds(barSize) {
        const [value, unit] = barSize.split(" ");
        const multiplier = {
            secs: 1000, // Seconds
            min: 60 * 1000, // Minutes
            hour: 60 * 60 * 1000, // Hours
        }[unit.toLowerCase()];

        if (!multiplier) {
            throw new Error(`Invalid bar size unit: ${unit}`);
        }

        return parseInt(value, 10) * multiplier;
    }


    // Order Management

    async getOpenOrders() {
        return this.handleError(async () => {
            const openOrders = await this.api.getAllOpenOrders();
            openOrders.forEach((openOrder) => {
                this.orders.set(openOrder.order.orderId, {
                    orderId: openOrder.order.orderId,
                    symbol: openOrder.contract.symbol,
                    action: openOrder.order.action,
                    totalQuantity: openOrder.order.totalQuantity,
                    orderType: openOrder.order.orderType,
                    lmtPrice: openOrder.order.lmtPrice,
                    auxPrice: openOrder.order.auxPrice,
                    status: openOrder?.orderState?.status,
                });
            });
            return Array.from(this.orders.values());
        });
    }

    // Fetch open positions
    async getOpenPositions() {
        return this.handleError(async () => {
            const positions = await this.api.getPositions(); // return type is {}
            return positions;
        });
    }

    // Set a Bracket Order
    async setBracketOrderDeprecated(symbol, quantity, limitPrice, takeProfitPrice, stopLossPrice) {
        return this.handleError(async () => {
            const contract = {
                symbol,
                secType: "STK",
                exchange: "SMART",
                currency: "USD",
            };

            // Generate unique order IDs for the bracket orders
            const parentOrderId = await this.api._allocateRequestId();
            const takeProfitOrderId = await this.api._allocateRequestId();
            const stopLossOrderId = await this.api._allocateRequestId();

            // Parent order (limit order)
            const parentOrder = {
                // orderId: parentOrderId,
                cOID: parentOrderId,
                account: appConfig().dataSource.ibkr.account,
                action: "BUY",
                orderType: "LMT",
                totalQuantity: quantity,
                lmtPrice: limitPrice,
                transmit: false, // do not transmit the parent order
            };
            const retParentOrderId =  await this.api.placeOrder({ contract, order: parentOrder });
            await sleep(1000); // Wait for the parent order to be placed

            // Take-profit order
            const takeProfitOrder = {
                //orderId: takeProfitOrderId, // is not allowed in the api for bracket orders
                account: appConfig().dataSource.ibkr.account,
                action: "SELL",
                orderType: "LMT",
                totalQuantity: quantity,
                lmtPrice: takeProfitPrice,
                parentId: retParentOrderId,
                transmit: false, // Do not transmit yet
            };

            // Stop-loss order
            const stopLossOrder = {
                //orderId: stopLossOrderId, // is not allowed in the api for bracket orders
                account: appConfig().dataSource.ibkr.account,
                action: "SELL",
                orderType: "STP",
                totalQuantity: quantity,
                auxPrice: stopLossPrice, // Stop-loss trigger price
                parentId: retParentOrderId,
                transmit: true, // Transmit takeProfit and StopLoss orders as a group
            };

            // Place orders in sequence

            const retTakeProfitId =  await this.api.placeOrder({ contract, order: takeProfitOrder });
            const retStopLossOrderId = await this.api.placeOrder({ contract, order: stopLossOrder });

            appLog.info(`Bracket order placed for ${symbol}`);
            parentOrder.symbol = symbol;
            parentOrder.orderId = retParentOrderId;
            takeProfitOrder.orderId = retTakeProfitId;
            stopLossOrder.orderId = retStopLossOrderId;
            return { parentOrder, takeProfitOrder, stopLossOrder };
        });
    }

    async setBracketOrder(symbol, quantity, limitPrice, takeProfitPrice, stopLossPrice) {
        /**
         * Places a bracket order for a buy transaction.
         * @param {string} symbol - The stock symbol.
         * @param {number} quantity - Number of shares to buy.
         * @param {number} limitPrice - Limit price for the parent order.
         * @param {number} takeProfitPrice - Price at which to take profit.
         * @param {number} stopLossPrice - Price at which to stop loss.
         * @returns {Promise<Object>} - Returns the parent, take-profit, and stop-loss orders.
         */
        const BASE_URL = appConfig().dataSource.ibkr.portalGwBaseUrl; // IBKR Client Portal API base URL

        try {
            // Step 1: Get account details
            // const accountResponse = await axios.get(`${BASE_URL}/account`);
            // const accountId = accountResponse.data[0]?.accountId;
            // if (!accountId) throw new Error("Unable to fetch account ID.");
            const accountId = appConfig().dataSource.ibkr.account;

            // Step 2: Get contract details for the symbol
            const contractResponse = await axios.get(`${BASE_URL}/marketdata/symbols`, {params: {symbols: symbol}});
            const conid = contractResponse.data[symbol]?.[0]?.conid;
            if (!conid) throw new Error(`Unable to fetch contract ID for symbol: ${symbol}`);

            // Step 3: Construct the parent order
            const parentOrder = {
                acctId: accountId,
                conid,
                orderType: "LMT", // Limit order
                side: "BUY",
                price: limitPrice,
                quantity,
                tif: "DAY", // Time in Force: Day order
                transmit: false, // Do NOT Transmit immediately
            };

            // Step 4: Place the parent order
            const parentOrderResponse = await axios.post(`${BASE_URL}/account/${accountId}/orders`, parentOrder);
            const parentOrderId = parentOrderResponse.data.orderId;

            // Step 5: Construct the take-profit order
            const takeProfitOrder = {
                acctId: accountId,
                conid,
                orderType: "LMT", // Limit order
                side: "SELL",
                price: takeProfitPrice,
                quantity,
                tif: "DAY",
                parentId: parentOrderId, // Link to parent order
                transmit: false, // Do NOT Transmit immediately
            };

            // Step 6: Place the take-profit order
            const takeProfitOrderResponse = await axios.post(`${BASE_URL}/account/${accountId}/orders`, takeProfitOrder);
            const takeProfitOrderId = takeProfitOrderResponse.data.orderId;

            // Step 7: Construct the stop-loss order
            const stopLossOrder = {
                acctId: accountId,
                conid,
                orderType: "STP", // Stop order
                side: "SELL",
                auxPrice: stopLossPrice, // Stop price
                quantity,
                tif: "DAY",
                parentId: parentOrderId, // Link to parent order
                transmit: true, // Transmit immediately
            };

            // Step 8: Place the stop-loss order
            const stopLossOrderResponse = await axios.post(`${BASE_URL}/account/${accountId}/orders`, stopLossOrder);
            const stopLossOrderId = stopLossOrderResponse.data.orderId;

            // Step 9: Return all placed orders
            return {
                parentOrder: {...parentOrder, orderId: parentOrderId},
                takeProfitOrder: {...takeProfitOrder, orderId: takeProfitOrderId},
                stopLossOrder: {...stopLossOrder, orderId: stopLossOrderId},
            };
        } catch (error) {
            appLog.info(`Error placing bracket order for ${symbol}:`, error.message);
            console.log(`Error placing bracket order for ${symbol}:`, error.message);
            throw error;
        }
    }
    // Place an order
    async placeOrder(symbol, action, quantity, orderType, price = null) {
        return this.handleError(async () => {
            const contract = Contract.stock(symbol); // Create a stock contract for the symbol
            // Build the order object
            const order = {
                action: action.toUpperCase(), // "BUY" or "SELL"
                orderType: orderType.toUpperCase(), // "LMT" (limit), "MKT" (market), etc.
                totalQuantity: quantity,
                account: appConfig().dataSource.ibkr.account,
            };

            // Add price fields for limit or stop orders
            if (orderType.toUpperCase() === "LMT" && price !== null) {
                order.lmtPrice = price;
            } else if (orderType.toUpperCase() === "STP" && price !== null) {
                order.auxPrice = price; // Stop price
            }

            // Place the order
            const orderId = await this.api.placeOrder({contract, order});
            order.orderId = orderId;
            appLog.info(`Order placed: ${JSON.stringify(order)}`);
            return order;
        });
    }


    async fetchExecutionsForSymbol(symbol) {
        try {
            // Define the execution filter for the symbol
            const executionFilter = {
                symbol, // Filter by the specific symbol (e.g., "AAPL")
            };

            // Fetch executions
            // not implemented in ib-tws-api
            const executions = await this.api.reqExecutions(executionFilter);

            // Log results
            if (executions && executions.length > 0) {
                appLog.info(`Executions for ${symbol}:`, executions);
            } else {
                appLog.info(`No executions found for ${symbol}.`);
            }

            return executions;
        } catch (error) {
            appLog.info(`Error fetching executions for ${symbol}:`, error.message);
            throw error;
        }
    }

    async cancelAllOrders() {
        try {
            await this.api.reqGlobalCancel();
        } catch (error) {
            appLog.info(`Error canceling all orders:`, error.message);
        }
    }

    async monitorBracketOrder(parentOrderId, childOrderIds, pollingInterval = 30000, timeout = 3600000) {
        return this.handleError(async () => {
            /**
             * Monitors a bracket order, ensuring the parent order is filled first, and then tracking child orders.
             *
             * @param {Number} parentOrderId - The order ID of the parent order.
             * @param {Array} childOrderIds - Array of child order IDs (e.g., take-profit and stop-loss).
             * @param {Number} pollingInterval - Time (in ms) between each status check.
             * @param {Number} timeout - Maximum time (in ms) to wait for completion.
             * @returns {Object} - Final status of the parent and child orders.
             */
            const startTime = Date.now();

            // Monitor Parent Order
            appLog.info(`Monitoring parent order: ${parentOrderId}`);
            let retried = false;
            const retOrders = {
                parentOrder: {orderId: parentOrderId, status: ""},
                childOrders: [],
            };
            while (true) {
                try {
                    let orders = await this.api.getAllOpenOrders();
                    let parentOrder = orders.find(order => order.order.orderId === parentOrderId);

                    if (!parentOrder) {
                        if (!retried) {
                            retried = true;
                            await sleep(250);
                            continue;
                        }
                        // throw new Error(`Parent order ${parentOrderId} not found.`); // TODO FIX THIS ASAF
                        appLog.info(`Parent order ${parentOrderId} not found.`);
                    }

                    appLog.info(`Parent Order Status: ${parentOrder?.orderState?.status}`);

                    // If parent order is filled, break to monitor child orders
                    if (parentOrder?.orderState?.status === "Filled") {
                        appLog.info(`Parent order ${parentOrderId} filled.`);
                        retOrders.parentOrder.status = "Filled";
                        break;
                    }

                    // If parent order is canceled, exit early
                    if (parentOrder?.orderState?.status === "Cancelled") {
                        appLog.info(`Parent order ${parentOrderId} canceled.`);
                        retOrders.parentOrder.status = "Cancelled";
                        return retOrders;
                    }

                    // Check timeout
                    if (Date.now() - startTime > timeout) {
                        throw new Error(`Timeout waiting for parent order ${parentOrderId} to fill.`);
                    }

                    // Wait for the polling interval
                    await new Promise(resolve => setTimeout(resolve, pollingInterval));
                } catch (error) {
                    appLog.info(`Error monitoring parent order: ${error.message}`);
                    throw error;
                }
            }

            // Monitor Child Orders
            appLog.info(`Monitoring child orders: ${childOrderIds.join(", ")}`);
            const monitoredChildren = new Set();

            while (monitoredChildren.size < childOrderIds.length) {
                let orders, childOrders;
                try {
                    orders = await this.api.getAllOpenOrders();
                    childOrders = orders.filter(order => childOrderIds.includes(order.order.orderId));

                    childOrders.forEach(childOrder => {
                        appLog.info(`Child Order ${childOrder.order.orderId} Status: ${childOrder?.orderState?.status}`);

                        if (childOrder?.orderState?.status === "Filled") {
                            appLog.info(`Child order ${childOrder.order.orderId} filled.`);
                            monitoredChildren.add(childOrder.order.orderId);
                        } else if (childOrder?.orderState?.status === "Cancelled") {
                            appLog.info(`Child order ${childOrder.order.orderId} canceled.`);
                            monitoredChildren.add(childOrder.order.orderId);
                        }
                    });

                    // Exit if both child orders are either filled or canceled
                    if (monitoredChildren.size === childOrderIds.length) {
                        appLog.info("All child orders processed.");
                        retOrders.childOrders = childOrders.map(o => ({
                            orderId: o.order.orderId,
                            status: o.orderState.status
                        }));
                        return retOrders;
                    }

                    // Check timeout
                    if (Date.now() - startTime > timeout) {
                        throw new Error("Timeout waiting for child orders to complete.");
                    }

                    // Wait for the polling interval
                    await new Promise(resolve => setTimeout(resolve, pollingInterval));
                } catch (error) {
                    appLog.info(`Error monitoring child orders: ${error.message}`);
                    retOrders.childOrders = childOrders.map(o => ({
                        orderId: o.order.orderId,
                        status: o.orderState.status
                    }));
                    return retOrders;
                }
            }
        });
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// (async () => {
//     const marketDataStreamer = new MarketDataStreamer();
//     const openOrders = await marketDataStreamer.getOpenOrders();
//     console.log(JSON.stringify(openOrders));
//     //await marketDataStreamer.cancelAllOrders();
//     // for (const order of openOrders) {
//     //     const retStatus  = await marketDataStreamer.cancelOrder(order.orderId);
//     //     appLog.info(JSON.stringify(order));
//     // }
//
//     const orderResults = await marketDataStreamer.setBracketOrderDeprecated('AAPL', 1, 259, 300, 258);
//     console.log(JSON.stringify(orderResults));
//     if (orderResults?.parentOrder && orderResults?.takeProfitOrder && orderResults?.stopLossOrder) {
//         await marketDataStreamer.monitorBracketOrder(orderResults.parentOrder.orderId, [orderResults.takeProfitOrder.orderId, orderResults.stopLossOrder.orderId]);
//     }
// })();