// 'use strict';

import {main}  from "./engine/StockEngineNew.mjs";

(async () => {
    try {
        await main();
    } catch (error) {
        console.error("Error running trading script:", error.stack);
    }
})();