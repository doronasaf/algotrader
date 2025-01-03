// import 'dotenv/config';
// require("dotenv").config();
import Alpaca from "@alpacahq/alpaca-trade-api";
import process from "process";


// Alpaca API configuration
const alpaca = new Alpaca({
    keyId: process.env.APCA_API_KEY_ID || 'PKG9R7WYXGUCCHFH3KPI',
    secretKey: process.env.APCA_API_SECRET_KEY || 'RIlsleDGAm3ddImZSHyJaj6XTSSsTOOCyXLxWj2M',
    paper: process.env.APCA_PAPER_API || true, // Set to false for live trading
    usePolygon: false,
});

// Buy stock

/**
 * name: buyStock
 * @param symbol
 * @param quantity
 * @param type
 * @param limit_price
 * @returns {Promise<{orderStatus: undefined, order: undefined}>}
 */
// eslint-disable-next-line no-unused-vars
async function buyStock(symbol, quantity, type="market", limit_price) {
    const orderResult = {
        order: undefined,
        orderStatus: undefined
    };
    try {
        let order;
        // keep only 2 decimal places on limit_price
        if (type === "limit") {
            order = await alpaca.createOrder({
                symbol,
                qty: quantity,
                side: "buy",
                type: "limit",
                time_in_force: "gtc",
                limit_price: limit_price.toFixed(2),
            });
        } else if (type === "market") {
            order = await alpaca.createOrder({
                symbol,
                qty: quantity,
                side: "buy",
                type: "market",
                time_in_force: "gtc",
            });
        } else {
            const err = `Invalid order type: ${type}`;
            // console.error(err);
            orderResult.order = {err, transaction: 'buyStock', symbol, quantity, type, limit_price};
            orderResult.orderStatus = {err, transaction: 'buyStock', symbol, quantity, type, limit_price};
            return orderResult;
        }
        // console.log(`Bought ${quantity} shares of ${symbol}`);
        orderResult.order = order;
        // Poll for the status of the order until it's filled
        orderResult.orderStatus = await pollOrderStatus(order.id);
    } catch (error) {
        const err = `Received Error: ${error.message}`;
        // console.error(err);
        orderResult.order = {err, transaction: 'buyStock', symbol, quantity, type, limit_price};
        orderResult.orderStatus = {err, transaction: 'buyStock', symbol, quantity, type, limit_price};
    }
    return orderResult;
}

// Sell stock
// eslint-disable-next-line no-unused-vars
async function sellStock(symbol, quantity, type="market", limit_price) {
    const orderResult = {
        order: undefined,
        orderStatus: undefined
    };
    try {
        let order;
        if (type === "limit") {
            order = await alpaca.createOrder({
                symbol,
                qty: quantity,
                side: "sell",
                type: "limit",
                time_in_force: "gtc",
                limit_price: limit_price.toFixed(2),
            });
        } else if (type === "market") {
            order = await alpaca.createOrder({
                symbol,
                qty: quantity,
                side: "sell",
                type: "market",
                time_in_force: "gtc",
            });
        } else {
            const err = `Invalid order type: ${type}`;
            // console.error(err);
            orderResult.order = {err, transaction: 'sellStock', symbol, quantity, type, limit_price};
            orderResult.orderStatus = {err, transaction: 'sellStock', symbol, quantity, type, limit_price};
            return orderResult;
        }
        // console.log(`Sold ${quantity} shares of ${symbol}`);
        orderResult.order = order;
        orderResult.orderStatus = await pollOrderStatus(order.id);
    } catch (error) {
        const err = `Received Error: ${error.message}`;
        // console.error(err);
        orderResult.order = {err, transaction: 'sellStock', symbol, quantity, type, limit_price};
        orderResult.orderStatus = {err, transaction: 'sellStock', symbol, quantity, type, limit_price};
    }
    return orderResult;

}

async function pollOrderStatus(orderId, interval = 3000) {
    let order;
    while (true) {
        order = await alpaca.getOrder(orderId);
        if (order.status === 'filled') {
            return order;
        } else if (order.status === 'canceled') {
            return order;
        } else {
            console.log(`Order status: ${order.status}. Waiting for fill...`);
        }
        await new Promise(resolve => setTimeout(resolve, interval));  // Wait for the specified interval (default is 5 seconds)
    }
}

// example response:
// [
//   {
//     "id": "parent_order_id_123",
//     "client_order_id": "buy_order_001",
//     "created_at": "2024-12-04T12:00:00Z",
//     "status": "new",
//     "symbol": "SPY",
//     "qty": "100",
//     "filled_qty": "0",
//     "type": "market",
//     "time_in_force": "gtc",
//     "order_class": "bracket",
//     "legs": [
//       {
//         "id": "child_order_id_1",
//         "client_order_id": "take_profit_order",
//         "type": "limit",
//         "limit_price": "301",
//         "status": "new"
//       },
//       {
//         "id": "child_order_id_2",
//         "client_order_id": "stop_loss_order",
//         "type": "stop_limit",
//         "stop_price": "299",
//         "limit_price": "298.5",
//         "status": "new"
//       }
//     ]
//   }
// ]
export async function getOrdersAlpaca() {
    const orderList = [];
    const orders = await alpaca.getOrders({
        status: 'open', // or 'all' for all orders including closed ones
        limit: 50,      // Adjust the limit based on your needs
        nested: true    // Ensures child orders are included with the parent
    });

    if (orders.length >= 0) {
        for (const order of orders) {
            try {
                if (order.order_class === 'bracket') {
                    const parentOrder = order;
                    const takeProfitOrder = order?.legs?.find(leg => leg.type === 'limit')
                    const stopLossOrder = order?.legs?.find(leg => leg.type === 'stop')
                    orderList.push({
                        type: 'bracket',
                        parentOrder,
                        takeProfitOrder,
                        stopLossOrder
                    });
                } else {
                    orderList.push({type: 'single', order});
                }
            } catch (error) {
                console.error("Error parsing order:", error.message);
            }
        }
    }
    return orderList;
}

// Fetch real-time quote for a stock
export async function getQuoteAlpaca(symbol) {

    try {
        const quote = await alpaca.getLatestQuote(symbol);
        // console.log(`Fetched quote for ${symbol}:`, quote);
        return {
            bid: quote.BidPrice,
            bidSize: quote.BidSize,
            ask: quote.AskPrice,
            askSize: quote.AskSize,
            timestamp: quote.Timestamp,
        };
    } catch (error) {
        console.error("Error fetching quote:", error.message);
        return null;
    }
}

export async function getOpenPositionsAlpaca() {
    try {
        const positions = await alpaca.getPositions();
        return positions; // Array of open positions
    } catch (error) {
        console.error("Error fetching open positions:", error.message);
        return [];
    }
}

export async function setBracketOrdersForBuyAlpaca(symbol, quantity, limitPrice, takeProfitPrice, stopLossPrice ) {
    const orderResult = {
        order: undefined,
        orderStatus: undefined
    };
    try {
        const order = await alpaca.createOrder({
            symbol,                                     // The stock symbol (e.g., "AAPL")
            qty: quantity,                              // Quantity to buy
            side: "buy",                                // Buy action
            type: "limit",                              // Limit order
            time_in_force: "gtc",                       // Good till canceled
            limit_price: Number((limitPrice).toFixed(2)), // The price at which you want to buy
            order_class: "bracket",                     // Bracket order
            take_profit: {
                limit_price: Number((takeProfitPrice).toFixed(2)), // Price to take profit
            },
            stop_loss: {
                stop_price: Number((stopLossPrice).toFixed(2)), // Stop-loss activation price
            },
        });

        console.log(`Bracket order created for ${symbol}: ${JSON.stringify(order)}`);
        orderResult.order = order;
        orderResult.orderStatus = await pollOrderStatus(order.id);
    } catch (error) {
        const err = `Error setting bracket order for ${symbol}, Received Error: ${error.message}`;
        // console.error(err);
        orderResult.order = {err, transaction: 'bracket', symbol, quantity, type:"limit", limit_price: limitPrice, take_profit: takeProfitPrice, stop_loss: stopLossPrice};
        orderResult.orderStatus = {err, transaction: 'bracket', symbol, quantity, type:"limit", limit_price: limitPrice, take_profit: takeProfitPrice, stop_loss: stopLossPrice};
    }
    return orderResult;
}


