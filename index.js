// 'use strict';

// import {main}  from "./engine/StockEngineNew.mjs";
import {main}  from "./engine/engine.mjs";

(async () => {
    try {
        await main();
    } catch (error) {
        console.error("Error running trading script:", error.stack);
    }
})();