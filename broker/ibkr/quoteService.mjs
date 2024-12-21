import { Client, Contract } from 'ib-tws-api';
import appConfig from '../../config/AppConfig.mjs';
import {getEntityLogger} from '../../utils/logger/loggerManager.mjs';
const appLog = getEntityLogger('app');

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
        this.api = new Client({ host: '127.0.0.1', port: 4002 });
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
            console.error("Error initializing connection:", error.message);
            console.error(error.stack);
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
            console.error(`Error in ${method.name}:`, error.message);

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
            appLog.info(`Symbol ${symbol} is already being tracked.`);
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
                console.error(`Stream Error for ${symbol}:`, err.message);
                this.retrySymbolInitialization(symbol, callback, 5000);
            });

            appLog.info(`Started tracking symbol: ${symbol}`);
        } catch (error) {
            console.error(`Error adding symbol ${symbol}:`, error.message);
            setTimeout(() => this.addSymbol(symbol, callback), 5000);
        }
    }

    // Retry symbol initialization
    async retrySymbolInitialization(symbol, callback, delayMs) {
        appLog.info(`Retrying initialization for symbol: ${symbol} after ${delayMs}ms`);
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
            console.error(`Error stopping tracking for symbol ${symbol}:`, error.message);
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
            };

            // Prepare parameters for the historical data request
            const endDateTime = ""; // Leave empty to fetch up to the current time
            const durationStr = "1 D"; // Fetch the last 20 minutes
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

            console.log(`Fetched ${ohlcData.length} bars for ${symbol}`);
            return ohlcData;
        } catch (error) {
            console.error(`Error fetching OHLC data for ${symbol}:`, error.message);
            throw error;
        }
    }

    // Order Management

    async getOpenOrders() {
        return this.handleError(async () => {
            const openOrders = await this.api.getAllOpenOrders();
            openOrders.forEach((order) => {
                this.orders.set(order.orderId, {
                    orderId: order.orderId,
                    symbol: order.contract.symbol,
                    action: order.action,
                    totalQuantity: order.totalQuantity,
                    orderType: order.orderType,
                    lmtPrice: order.lmtPrice,
                    auxPrice: order.auxPrice,
                    status: "open",
                });
            });
            return Array.from(this.orders.values());
        });
    }

    // Fetch order by ID
    async getOrderById(orderId) {
        return this.handleError(async () => {
            const orders = await this.getOrders();
            const order = orders.find((o) => o.orderId === orderId);
            if (!order) {
                throw new Error(`Order with ID ${orderId} not found`);
            }
            return order;
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
    async setBracketOrder(symbol, quantity, limitPrice, takeProfitPrice, stopLossPrice) {
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
                orderId: parentOrderId,
                action: "BUY",
                orderType: "LMT",
                totalQuantity: quantity,
                lmtPrice: limitPrice,
                transmit: false, // Do not transmit until children are ready
            };

            // Take-profit order
            const takeProfitOrder = {
                orderId: takeProfitOrderId,
                action: "SELL",
                orderType: "LMT",
                totalQuantity: quantity,
                lmtPrice: takeProfitPrice,
                parentId: parentOrderId,
                transmit: false, // Do not transmit yet
            };

            // Stop-loss order
            const stopLossOrder = {
                orderId: stopLossOrderId,
                action: "SELL",
                orderType: "STP",
                totalQuantity: quantity,
                auxPrice: stopLossPrice, // Stop-loss trigger price
                parentId: parentOrderId,
                transmit: true, // Transmit all orders as a group
            };

            // Place orders in sequence
            await this.api.placeOrder({ contract, order: parentOrder });
            await this.api.placeOrder({ contract, order: takeProfitOrder });
            await this.api.placeOrder({ contract, order: stopLossOrder });

            appLog.info(`Bracket order placed for ${symbol}`);
            parentOrder.symbol = symbol;
            parentOrder.orderId = parentOrderId;
            takeProfitOrder.orderId = takeProfitOrderId;
            stopLossOrder.orderId = stopLossOrderId;
            return { parentOrder, takeProfitOrder, stopLossOrder };
        });
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
}

//
// (async () => {
//     const marketDataStreamer = new MarketDataStreamer();
//
//     try {
//         const ohlcData = await marketDataStreamer.fetchOHLC("AAPL", "1 min");
//         console.log("Fetched OHLC data:", ohlcData);
//     } catch (error) {
//         console.error("Error fetching OHLC data:", error.message);
//     }
// })();
