const { IBApi, EventName, IBApiNextError } = require('ib-tws-api');

// Define the WebSocket equivalent for IBKR
const API = new IBApi();
let isConnected = false;

// Function to start a streaming connection
function startStreaming(ticker, onQuoteUpdate) {
    // Connect to the IBKR TWS/Gateway
    API.connect('127.0.0.1', 7496, 1);

    API.on(EventName.connected, () => {
        console.log('Connected to IBKR');
        isConnected = true;

        // Request market data for the given ticker
        API.reqMktData(1, {
            symbol: ticker,
            secType: 'STK', // Stock
            exchange: 'SMART', // Smart Routing
            currency: 'USD', // USD Currency
        }, '', false, false, []);

        console.log(`Subscribed to real-time data for ${ticker}`);
    });

    API.on(EventName.marketData, (tickerId, tickType, value) => {
        // Process different types of market data updates
        const update = {};

        switch (tickType) {
            case 1: // Bid Price
                update.type = 'quote';
                update.bidPrice = value;
                break;
            case 2: // Ask Price
                update.type = 'quote';
                update.askPrice = value;
                break;
            case 4: // Last Trade Price
                update.type = 'trade';
                update.price = value;
                break;
            case 5: // High Price
                update.high = value;
                break;
            case 6: // Low Price
                update.low = value;
                break;
            default:
                console.log(`Unhandled tick type: ${tickType}`);
        }

        // Add timestamp and symbol to the update
        update.symbol = ticker;
        update.timestamp = new Date().toISOString();

        // Pass the update to the callback
        onQuoteUpdate(update);
    });

    API.on(EventName.error, (error) => {
        console.error('Error:', error.message || error);
    });

    API.on(EventName.disconnected, () => {
        console.log('Disconnected from IBKR');
        isConnected = false;

        // Optionally, reconnect after a delay
        setTimeout(() => startStreaming(ticker, onQuoteUpdate), 5000);
    });

    return API;
}

// Buffer for OHLC data
class OHLCBuffer {
    constructor(maxSize = 100) {
        this.data = [];
        this.maxSize = maxSize;
    }

    add(ohlc) {
        if (this.data.length >= this.maxSize) {
            this.data.shift(); // Remove the oldest data point
        }
        this.data.push(ohlc);
    }

    getAll() {
        return [...this.data]; // Return a copy of the data
    }
}

const ohlcBuffer = new OHLCBuffer(100);

function handleQuoteUpdate(update) {
    if (!update || !update.type) {
        console.warn('Invalid update received.');
        return null;
    }

    let ohlc = null;

    switch (update.type) {
        case 'trade':
            ohlc = {
                open: update.price,
                high: update.price,
                low: update.price,
                close: update.price,
                volume: 0, // Trade updates may not include volume
                timestamp: update.timestamp,
            };
            break;

        case 'quote':
            const midpoint = (update.bidPrice + update.askPrice) / 2 || 0;
            ohlc = {
                open: midpoint,
                high: midpoint,
                low: midpoint,
                close: midpoint,
                volume: 0,
                timestamp: update.timestamp,
            };
            break;

        default:
            console.warn(`Unhandled update type: ${update.type}`);
            return null;
    }

    if (ohlc) {
        ohlcBuffer.add(ohlc); // Add the OHLC data to the buffer
    }

    return ohlcBuffer.getAll(); // Return the last 100 data points
}

module.exports = {
    startStreaming,
    handleQuoteUpdate,
    isConnected,
};
