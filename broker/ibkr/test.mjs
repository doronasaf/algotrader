// testing example:
// const { getQuote, setBracketOrdersForBuy, getOrders, getOpenPositions } = require('./tradeService');
// import { getQuote, setBracketOrdersForBuy, getOrders, getOpenPositions } from './tradeService.js';
//
// (async () => {
//     const symbol = 'AAPL';
//     const quantity = 10;
//     const limitPrice = 175;
//     const takeProfitPrice = 180;
//     const stopLossPrice = 170;
//
//     // console.log('Placing Bracket Order...');
//     // await setBracketOrdersForBuy(symbol, quantity, limitPrice, takeProfitPrice, stopLossPrice);
//
//     console.log('Fetching Quote...');
//     const quote = await getQuote(symbol);
//     console.log(`Quote for ${symbol}:`, quote);
//
//     console.log('Fetching Open Orders...');
//     const orders = await getOrders();
//     console.log('Open Orders:', orders);
//
//     console.log('Fetching Open Positions...');
//     const positions = await getOpenPositions();
//     console.log('Open Positions:', positions);
// })();



import { Client, Contract } from 'ib-tws-api';

async function streamMarketData() {
    let api = new Client({ host: '127.0.0.1', port: 4002 });

    try {
        let contract = Contract.stock('AAPL'); // Adjust contract type if needed
        let stream = await api.streamMarketData({ contract });

        stream.on('tick', (data) => {
            console.log('Market Data:', data.ticker);
        });

        stream.on('error', (err) => {
            console.error('Stream Error:', err.message);
        });

        setTimeout(() => {
            stream.stop();
            console.log('Streaming stopped.');
        }, 10000); // Stop after 10 seconds
    } catch (error) {
        console.error('Error streaming market data:', error.message);
    }
}

streamMarketData();
