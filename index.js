'use strict';

const trade = require('./engine/StockEngineNew');

// async block to run the trading script
(async () => {
    try {
        await trade.main();
        // await trade.testPlaceOrder("AAPL", 5, 'sell');
    } catch (error) {
        console.error("Error running trading script:", error.stack);
    }
})();
