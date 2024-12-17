const { IBApi, EventName } = require('ib-tws-api'); // IBKR TWS API
const { setTimeout } = require('timers/promises'); // Timer for delays

const API = new IBApi();
let isConnected = false;

// --- Connect to IBKR ---
API.connect('127.0.0.1', 7496, 1);

API.on(EventName.connected, () => {
    console.log('INFO: Connected to IBKR TWS API');
    isConnected = true;
});

API.on(EventName.error, (err) => {
    console.error('ERROR: IBKR API Error:', err.message || err);
});

API.on(EventName.disconnected, () => {
    console.warn('WARNING: Disconnected from IBKR TWS API');
    isConnected = false;
});

// --------------------------------------
// 1. Poll Order Status
async function pollOrderStatus(orderId, interval = 3000) {
    try {
        while (true) {
            const order = await getOrderById(orderId);
            if (order && order.status === 'Filled') {
                console.log(`INFO: Order ID ${orderId} filled.`);
                return order;
            } else if (order && order.status === 'Cancelled') {
                console.warn(`WARNING: Order ID ${orderId} was canceled.`);
                return order;
            } else {
                console.log(`INFO: Order ${orderId} status: ${order.status || 'Pending'}`);
            }
            await setTimeout(interval);
        }
    } catch (error) {
        console.error(`ERROR: Failed to poll order ${orderId} status: ${error.message}`);
        return null;
    }
}

// Helper Function: Get Order by ID
function getOrderById(orderId) {
    return new Promise((resolve) => {
        try {
            API.reqOpenOrders();
            API.on(EventName.openOrder, (id, contract, order, state) => {
                if (id === orderId) resolve({ id, ...state });
            });
        } catch (error) {
            console.error(`ERROR: Failed to fetch order ${orderId}: ${error.message}`);
            resolve(null);
        }
    });
}

// --------------------------------------
// 2. Get Open Orders
async function getOrders() {
    const orders = [];
    try {
        API.reqOpenOrders();
        return new Promise((resolve) => {
            API.on(EventName.openOrder, (id, contract, order, state) => {
                orders.push({
                    id,
                    symbol: contract.symbol,
                    type: order.orderType,
                    status: state.status,
                    ...order,
                });
            });
            setTimeout(1000).then(() => resolve(orders));
        });
    } catch (error) {
        console.error(`ERROR: Failed to fetch orders: ${error.message}`);
        return [];
    }
}

// --------------------------------------
// 3. Fetch Real-Time Quote
async function getQuote(symbol) {
    const tickerId = 1; // Arbitrary ID
    try {
        return new Promise((resolve, reject) => {
            API.reqMktData(
                tickerId,
                { symbol, secType: 'STK', exchange: 'SMART', currency: 'USD' },
                '',
                false,
                false,
                []
            );

            API.on(EventName.marketData, (id, tickType, price) => {
                if (id === tickerId) {
                    resolve({
                        bid: tickType === 1 ? price : null,
                        ask: tickType === 2 ? price : null,
                        timestamp: new Date().toISOString(),
                    });
                }
            });

            API.on(EventName.error, (err) => {
                console.error(`ERROR: Failed to fetch quote for ${symbol}: ${err.message}`);
                reject(err);
            });
        });
    } catch (error) {
        console.error(`ERROR: Exception in getQuote for ${symbol}: ${error.message}`);
        return null;
    }
}

// --------------------------------------
// 4. Get Open Positions
async function getOpenPositions() {
    const positions = [];
    try {
        API.reqPositions();
        return new Promise((resolve) => {
            API.on(EventName.position, (account, contract, position, avgCost) => {
                positions.push({
                    account,
                    symbol: contract.symbol,
                    position,
                    avgCost,
                });
            });
            setTimeout(1000).then(() => resolve(positions));
        });
    } catch (error) {
        console.error(`ERROR: Failed to fetch open positions: ${error.message}`);
        return [];
    }
}

// --------------------------------------
// 5. Place Bracket Orders
async function setBracketOrdersForBuy(symbol, quantity, limitPrice, takeProfitPrice, stopLossPrice) {
    try {
        const parentOrderId = API.nextOrderId();
        const takeProfitOrderId = parentOrderId + 1;
        const stopLossOrderId = parentOrderId + 2;

        const contract = {
            symbol,
            secType: 'STK',
            exchange: 'SMART',
            currency: 'USD',
        };

        const parentOrder = {
            orderId: parentOrderId,
            action: 'BUY',
            orderType: 'LMT',
            totalQuantity: quantity,
            lmtPrice: limitPrice,
            tif: 'GTC',
        };

        const takeProfitOrder = {
            orderId: takeProfitOrderId,
            action: 'SELL',
            orderType: 'LMT',
            totalQuantity: quantity,
            lmtPrice: takeProfitPrice,
            parentId: parentOrderId,
        };

        const stopLossOrder = {
            orderId: stopLossOrderId,
            action: 'SELL',
            orderType: 'STP',
            totalQuantity: quantity,
            auxPrice: stopLossPrice,
            parentId: parentOrderId,
        };

        API.placeOrder(parentOrderId, contract, parentOrder);
        API.placeOrder(takeProfitOrderId, contract, takeProfitOrder);
        API.placeOrder(stopLossOrderId, contract, stopLossOrder);

        console.log(`INFO: Bracket order placed for ${symbol}`);
        return await pollOrderStatus(parentOrderId);
    } catch (error) {
        console.error(`ERROR: Failed to place bracket order for ${symbol}: ${error.message}`);
        return null;
    }
}


// --------------------------------------
// Module Export
module.exports = {
    pollOrderStatus,
    getOrders,
    getQuote,
    getOpenPositions,
    setBracketOrdersForBuy,
};
