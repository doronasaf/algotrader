import WebSocket from 'ws';
import process from "process";

const FEED = "iex"; // Can be "sip" (paid) or "iex"
const WEBSOCKET_URL = `wss://stream.data.alpaca.markets/v2/${FEED}`;

// Alpaca API credentials
const API_KEY = process.env.ALPACA_API_KEY || 'PKNLI3BZGX8M03HC0VKO';
const SECRET_KEY = process.env.ALPACA_SECRET_KEY || '3GoJTGTUuw6a2pnwmudQmZdujLB5lfWw7zFuLjCr';

export let isConnected = false;
let alpacaWS = null;

class AlpacaWebSocket {
    constructor() {
        this.ws = null;
        this.tickers = new Set(); // Track subscribed tickers
        this.ohlcBuffer = new Map(); // Map of OHLC buffers by ticker
    }

    // Start WebSocket connection
    connect(onQuoteUpdate) {
        this.onQuoteUpdate = onQuoteUpdate;
        if (isConnected) {
            console.log("WebSocket already connected.");
            return;
        }

        this.ws = new WebSocket(WEBSOCKET_URL);

        this.ws.on('open', () => {
            console.log("Connected to Alpaca WebSocket");
            isConnected = true;

            // Authenticate
            this.authenticate();

            // Resubscribe to all tickers
            this.resubscribeToTickers();

            this.ws.on('message', (data) => this.handleMessage(data, onQuoteUpdate));
        });

        this.ws.on('close', () => {
            console.warn("WebSocket connection closed. Reconnecting...");
            isConnected = false;
            setTimeout(() => this.connect(onQuoteUpdate), 1000); // Reconnect after 1 second
        });

        this.ws.on('error', (error) => {
            console.error("WebSocket error:", error.message);
        });
    }

    authenticate() {
        this.ws.send(JSON.stringify({
            action: "auth",
            key: API_KEY,
            secret: SECRET_KEY,
        }));
    }

    subscribe(ticker) {
        if (!isConnected) {
            console.log("WebSocket not connected. Cannot subscribe.");
            this.connect(this.onQuoteUpdate);
        }
        if (this.tickers.has(ticker)) {
            console.log(`Already subscribed to ${ticker}`);
            return;
        }

        this.tickers.add(ticker);
        this.ws.send(JSON.stringify({
            action: "subscribe",
            trades: [ticker],
            quotes: [ticker],
            bars: [ticker],
        }));

        if (!this.ohlcBuffer.has(ticker)) {
            this.ohlcBuffer.set(ticker, new OHLCBuffer(100));
        }

        console.log(`Subscribed to ${ticker}`);
    }

    unsubscribe(ticker) {
        if (!this.tickers.has(ticker)) {
            console.log(`Not subscribed to ${ticker}`);
            return;
        }

        this.tickers.delete(ticker);
        this.ws.send(JSON.stringify({
            action: "unsubscribe",
            trades: [ticker],
            quotes: [ticker],
            bars: [ticker],
        }));

        this.ohlcBuffer.delete(ticker);
        console.log(`Unsubscribed from ${ticker}`);
    }

    resubscribeToTickers() {
        if (this.tickers.size > 0) {
            const tickers = Array.from(this.tickers);
            this.ws.send(JSON.stringify({
                action: "subscribe",
                trades: tickers,
                quotes: tickers,
                bars: tickers,
            }));
            console.log("Resubscribed to tickers:", tickers);
        }
    }

    handleMessage(data, onQuoteUpdate) {
        const parsedData = JSON.parse(data);

        parsedData.forEach((update) => {
            const ticker = update.S;

            if (!this.ohlcBuffer.has(ticker)) {
                console.warn(`Received update for untracked ticker: ${ticker}`);
                return;
            }

            const buffer = this.ohlcBuffer.get(ticker);
            const ohlc = handleQuoteUpdate(update);

            if (ohlc) {
                buffer.add(ohlc); // Add to buffer
                onQuoteUpdate(ticker, ohlc); // Notify client
            }
        });
    }
}

// Helper function to process updates
export function handleQuoteUpdate(update) {
    let ohlc = null;
    let midpoint;
    switch (update.T) {
        case "b": // Bar (OHLC) update
            ohlc = {
                open: update.o,
                high: update.h,
                low: update.l,
                close: update.c,
                volume: update.v,
                timestamp: update.t,
            };
            break;

        case "t": // Trade update
            ohlc = {
                open: update.p,
                high: update.p,
                low: update.p,
                close: update.p,
                volume: update.s || 0,
                timestamp: update.t,
            };
            break;

        case "q": // Quote update
            midpoint = (update.bp + update.ap) / 2;
            ohlc = {
                open: midpoint,
                high: midpoint,
                low: midpoint,
                close: midpoint,
                volume: 0,
                timestamp: update.t,
            };
            break;

        default:
            console.warn(`Unknown update type: ${update.T}`);
    }

    return ohlc;
}

// OHLC Buffer Class
class OHLCBuffer {
    constructor(maxSize = 120) {
        this.data = [];
        this.maxSize = maxSize;
    }

    add(ohlc) {
        if (this.data.length >= this.maxSize) {
            this.data.shift();
        }
        this.data.push(ohlc);
    }

    getAll() {
        return [...this.data];
    }
}

export function fetchMarketDataFromAlpaca(ticker, onQuoteUpdate) {
    if (!alpacaWS) alpacaWS = new AlpacaWebSocket();
    alpacaWS.connect(onQuoteUpdate);

    // Subscribe to a ticker
    alpacaWS.subscribe(ticker);
}

// (async () => {
//     fetchMarketDataFromAlpaca('AAPL', (ticker, ohlc) => {
//         console.log(`${ticker}: ${ohlc.close}`);
//     });
// })();