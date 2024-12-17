// testing example:
const { getQuote, setBracketOrdersForBuy, getOrders, getOpenPositions } = require('./tradeService');

(async () => {
    const symbol = 'AAPL';
    const quantity = 10;
    const limitPrice = 175;
    const takeProfitPrice = 180;
    const stopLossPrice = 170;

    // console.log('Placing Bracket Order...');
    // await setBracketOrdersForBuy(symbol, quantity, limitPrice, takeProfitPrice, stopLossPrice);

    console.log('Fetching Quote...');
    const quote = await getQuote(symbol);
    console.log(`Quote for ${symbol}:`, quote);

    console.log('Fetching Open Orders...');
    const orders = await getOrders();
    console.log('Open Orders:', orders);

    console.log('Fetching Open Positions...');
    const positions = await getOpenPositions();
    console.log('Open Positions:', positions);
})();
