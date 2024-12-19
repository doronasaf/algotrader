import { Client, Contract } from 'ib-tws-api';
import appConfig from '../../config/AppConfig.mjs';

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
        this.maxSamples = appConfig().dataSource.ibkr.maxSamples; // Number of samples in a 5-minute window
        this.firstBatchReady = false; // Tracks if the first 5 minutes are ready
    }

    processTick(data) {
        if (data.tickType !== 4) return; // Only process last price ticks

        const price = data.value;
        const now = Date.now();

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
        if (this.rollingBuffer.length === this.maxSamples) {
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
    }

    // Dynamically add a symbol to be tracked
    async addSymbol(symbol, callback) {
        // Check if the symbol is already being tracked
        if (this.aggregators[symbol]) {
            console.log(`Symbol ${symbol} is already being tracked.`);
            return;
        }

        try {
            const contract = Contract.stock(symbol);

            // Create an OHLCAggregator for the symbol
            const aggregator = new OHLCAggregator(symbol, appConfig().dataSource.ibkr.candleInterval, callback); // 10-second interval

            // Start streaming market data for the symbol
            const stream = await this.api.streamMarketData({ contract });

            this.aggregators[symbol] = aggregator;

            stream.on('tick', (data) => {
                const aggregator = this.aggregators[symbol];
                aggregator.processTick(data);
            });

            stream.on('error', (err) => {
                console.error(`Stream Error for ${symbol}:`, err.message);
                setTimeout(() => this.addSymbol(symbol, callback), 5000); // Retry the stream
            });

            console.log(`Started tracking symbol: ${symbol}`);
        } catch (error) {
            console.error(`Error adding symbol ${symbol}:`, error.message);
        }
    }

    // Stop tracking a symbol
    removeSymbol(symbol) {
        if (this.aggregators[symbol]) {
            delete this.aggregators[symbol];
            console.log(`Stopped tracking symbol: ${symbol}`);
        } else {
            console.log(`Symbol ${symbol} is not being tracked.`);
        }
    }
}

// let marketDataStreamerInstance = null; // Singleton instance

// export async function fetchMarketDataFromIbkr(symbol, callback) {
//     // Initialize the MarketDataStreamer only once
//     if (!marketDataStreamerInstance) {
//         marketDataStreamerInstance = new MarketDataStreamer();
//     }
//
//     // Add the symbol to the MarketDataStreamer
//     await marketDataStreamerInstance.addSymbol(symbol, callback);
// }
