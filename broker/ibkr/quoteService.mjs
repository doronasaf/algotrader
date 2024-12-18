// import { IBApi, EventName, IBApiNextError } from 'ib-tws-api';
import axios from 'axios'; // Assuming you use axios for HTTP requests

// Define the WebSocket equivalent for IBKR
let isConnected = false;


// Buffer for OHLC data
export class OHLCBuffer {
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

export function handleQuoteUpdate(update) {
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


// Fetch delayed market data for a given ticker
/** fetchMarketData
 * Fetches delayed market data for a given ticker.
 * Returns an object with the following properties:
 * - timestamps: array of timestamps
 * - volumes: array of volumes
 * - highs: array of highs
 * - lows: array of lows
 * - closes: array of closes
 *
 * @param {string} ticker - The ticker symbol (e.g., "AAPL").
 * @returns {Promise<{timestamps: *, volumes: *, highs: *, lows: *, closes: *} | null>}
 */
export async function fetchMarketData(ticker) {
    const IBKR_API_BASE_URL = 'http://localhost:5000/v1/api';
    try {
        // Step 1: Resolve the conid for the ticker
        const searchResponse = await axios.post(`${IBKR_API_BASE_URL}/iserver/secdef/search`, {
            symbol: ticker,
        });
        const conid = searchResponse.data[0]?.conid;
        if (!conid) throw new Error(`Could not resolve conid for ticker: ${ticker}`);

        // Step 2: Fetch delayed market data
        const response = await axios.get(`${IBKR_API_BASE_URL}/iserver/marketdata/snapshot`, {
            params: { conid, fields: '31' }, // `31` is for delayed data
            timeout: 5000,
        });

        // Step 3: Parse and return data
        const bars = response.data;
        if (!bars || !bars.length) throw new Error('No market data returned');

        const timestamps = bars.map((bar) => bar.time);
        const volumes = bars.map((bar) => bar.volume);
        const highs = bars.map((bar) => bar.high);
        const lows = bars.map((bar) => bar.low);
        const closes = bars.map((bar) => bar.close);

        return { timestamps, volumes, highs, lows, closes };
    } catch (error) {
        console.error('Error fetching market data:', error.message);
        return null;
    }
}


import { Client, Contract, Order } from 'ib-tws-api';

async function run() {
    let api = new Client({
        host: '127.0.0.1',
        port: 4002
    });

    let details = await api.getHistoricalData({
        contract: Contract.stock('AAPL'),
        endDateTime: '20241217 17:59:59 US/Eastern',
        duration: '1 D',
        barSizeSetting: '1 min',
        whatToShow: 'TRADES',
        formatDate: 1,
        useRth: 1
    });
    console.log(details);
}

(async () => {
    await run();
})();