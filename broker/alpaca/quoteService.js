const WebSocket = require('ws');

// Alpaca API Key and Secret
const API_KEY = process.env.ALPACA_API_KEY || 'PKNLI3BZGX8M03HC0VKO';
const SECRET_KEY = process.env.ALPACA_SECRET_KEY || '3GoJTGTUuw6a2pnwmudQmZdujLB5lfWw7zFuLjCr';

// WebSocket URL for Alpaca's Real-Time Streaming API
const FEED = "iex"; // Can be "sip" (paid) or "iex"
const WEBSOCKET_URL = `wss://stream.data.alpaca.markets/v2/${FEED}`; // production url
// const WEBSOCKET_URL = `wss://stream.data.sandbox.alpaca.markets/v2/${FEED}`; // sandbox url

let isConnected = false;

// Function to start a WebSocket connection
function startStreaming(ticker, onQuoteUpdate) {
    const ws = new WebSocket(WEBSOCKET_URL);

    ws.on('open', () => {
        console.log('Connected to Alpaca WebSocket');
        isConnected = true;

        // Authenticate the connection
        ws.send(JSON.stringify({
            action: "auth",
            key: API_KEY,
            secret: SECRET_KEY,
        }));

        // Subscribe to the ticker's trade, quote, and bar data
        ws.send(JSON.stringify({
            action: "subscribe",
            trades: [ticker], // For latest trades
            quotes: [ticker], // For live bid/ask updates
            bars: [ticker],   // For OHLC bars
        }));

        ws.on('error', (error) => {
            console.error("WebSocket Error:", error);
        });

    });

    ws.on('message', (data) => {
        const parsedData = JSON.parse(data);

        // Handle quote, trade, or bar updates
        parsedData.forEach((update) => {
            if (update.T === "q") { // Quote update
                console.log(`Quote Update: Bid ${update.bp}, Ask ${update.ap}`);
                onQuoteUpdate({
                    type: "quote",
                    symbol: update.S,
                    bidPrice: update.bp,
                    askPrice: update.ap,
                    bidSize: update.bs,
                    askSize: update.as,
                    timestamp: update.t,
                });
            } else if (update.T === "t") { // Trade update
                console.log(`Trade Update: Price ${update.p}, Volume ${update.s}`);
                onQuoteUpdate({
                    type: "trade",
                    symbol: update.S,
                    price: update.p,
                    size: update.s,
                    timestamp: update.t,
                });
            } else if (update.T === "b") { // Bar (OHLC) update
                console.log(`Bar Update: High ${update.h}, Low ${update.l}, Volume ${update.v}`);
                onQuoteUpdate({
                    type: "bar",
                    symbol: update.S,
                    open: update.o,
                    high: update.h,
                    low: update.l,
                    close: update.c,
                    volume: update.v,
                    timestamp: update.t,
                });
            }
        });
    });

    ws.on('error', (error) => {
        console.error("WebSocket Error:", error.message);
    });

    ws.on('close', () => {
        console.log("WebSocket connection closed.");
        isConnected = false;

        // Optionally, reconnect after a delay
        setTimeout(() => startStreaming(ticker, onQuoteUpdate), 500);
    });

    return ws;
}

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
        console.warn("Invalid update received.");
        return null;
    }

    let ohlc = null;

    switch (update.type) {
        case "bar":
            // Use bar data directly
            ohlc = {
                open: update.open,
                high: update.high,
                low: update.low,
                close: update.close,
                volume: update.volume,
                timestamp: update.timestamp,
            };
            break;

        case "trade":
            // Convert trade data to OHLC-like structure
            ohlc = {
                open: update.price,
                high: update.price,
                low: update.price,
                close: update.price,
                volume: update.size || 0,
                timestamp: update.timestamp,
            };
            break;

        case "quote":
            // Convert quote data to OHLC-like structure
            const midpoint = (update.bidPrice + update.askPrice) / 2;
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
            console.warn(`Unknown update type: ${update.type}`);
            return null;
    }

    if (ohlc) {
        ohlcBuffer.add(ohlc); // Add the OHLC data to the buffer
    }

    return ohlcBuffer.getAll(); // Return the last 100 data points
}

// Example Usage
// (async () => {
//     const ticker = "AAPL"; // Replace with the desired ticker
//
//     // Callback to process quote updates
//     const handleQuoteUpdate = (update) => {
//         console.log("Received update:", update);
//         return update;
//
//         // Process the update (e.g., analyze, log, or store it)
//     };
//
//     // Start streaming real-time data
//     startStreaming(ticker, handleQuoteUpdate);
// })();

// const handleQuoteUpdate = (update) => {
//         console.log("Received update:", update);
//         return update;
//         // Process the update (e.g., analyze, log, or store it)
// }

module.exports = {
    fetchMarketDataFromAlpaca: startStreaming,
    handleQuoteUpdate,
    isConnected,
}