const yahooFinance = require('yahoo-finance2').default;
const {calculateIndicatorsExt} = require("../utils/TechUtils");
const getEntityLogger = require('../utils/logger/loggerManager');
const logger = getEntityLogger('analytics');
const appConfig = require('../config/config.json');
// Algorithm Overview
// 1. Identify Stocks with Potential for 4–5% Intraday Range
// This step involves assessing historical and pre-market movement.
//
// Criteria for Selection
// Historical Volatility (HV):
//
// Stocks with a history of 4–5% daily price ranges are likely to exhibit similar behavior.
// Calculate the ATR (Average True Range) relative to the stock's price over the past 10–14 days:
//      ATRPercentage = (ATR / AverageClosingPrice) × 100
// Select stocks with ATR% > 4–5%.
//
// Pre-Market Activity:
//
// Look for significant pre-market price and volume changes indicating momentum.
// Filter for pre-market price changes >2%.

// TODO: look for symbols with earning report scheduled for today, looks for news sentiment
// TODO: Look for the Sector trend and perormance over the past X months

// TODO: For long term, nalyze stocks for period of month

const atrThreshold = appConfig.stockSelector.atrThreshold;
const chartHistoryInDays = appConfig.stockSelector.chartHistoryInDays;

const identifyStocks = async (todaysEarningStocks) => {
    const candidates = [];
    try {
        const earningStocksMap = {};
        if (todaysEarningStocks?.length > 0) {
            todaysEarningStocks.forEach(item => {
                earningStocksMap[item.symbol] = true;
            });
        }
        // Step 1: Fetch Trending Symbols
        const trending = await yahooFinance.trendingSymbols("US"); // Adjust region as needed
        let trendingSymbols = trending.quotes.map(item => item.symbol);
        if (todaysEarningStocks?.length > 0)  {
            todaysEarningStocks = todaysEarningStocks.map(item => item.symbol);
            trendingSymbols = todaysEarningStocks.concat(trendingSymbols);
        }

        console.log("Trending Symbols:", trendingSymbols);
        const now = new Date();
        const avrIndicatorPeriod = new Date(now.getTime() - chartHistoryInDays * 24 * 60 * 60 * 1000); // 7 days ago

        const options = {
            interval: "1d",
            period1: avrIndicatorPeriod, // Start date (7 days ago)
            period2: now,             // End date (current time)
        };

        // Step 2: Analyze Stocks
        for (const symbol of trendingSymbols) {
            try {
                // Fetch historical data to calculate ATR
                const chart = await yahooFinance.chart(symbol, options);
                if (chart?.meta?.instrumentType === 'CRYPTOCURRENCY') continue; // Skip crypto
                const regMarketVolume = chart.meta.regularMarketVolume;
                const regMarketPrice = chart.meta.regularMarketPrice;
                if (regMarketVolume * regMarketPrice < 200_000_000) continue; // Skip low volume stocks
                let prices = chart.quotes.map(quote => quote.close);
                let highs = chart.quotes.map(quote => quote.high);
                let lows = chart.quotes.map(quote => quote.low);
                let volumes = chart.quotes.map(quote => quote.volume);

                // Calculate ATR for the last 7 days
                if (!prices || !highs || !lows || !volumes) continue; // Skip invalid data

                const atr = highs.map((high, i) => high - lows[i]); // the movement within the period
                const avgATR = atr.reduce((a, b) => a + b, 0) / atr.length;
                const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
                const atrPercentage = (avgATR / avgPrice) * 100;
                if (atrPercentage > atrThreshold || earningStocksMap[symbol]) { // accaept the stock if it is earning stock
                    // Step 3: Check Pre-Market Data
                    const preMarketQuote = await yahooFinance.quote(symbol);
                    const billion = 1e9;
                    let thePrice = preMarketQuote.preMarketPrice || preMarketQuote.regularMarketPrice;
                    let theChange = (((thePrice - preMarketQuote.regularMarketPreviousClose) / preMarketQuote.regularMarketPreviousClose) * 100);
                    if (preMarketQuote.marketCap > billion) { // apply filter for market cap
                        if (thePrice &&
                            Math.abs(theChange) > 2) {
                            logger.info(`
                          Stocks Selector: ${symbol}
                          Source: ${earningStocksMap[symbol] ? 'Earning' : 'Trending'}
                          Statistics:
                            - Volatility Metrics (not checked for earning stocks):
                              * AVT (Average True Range) Period: ${avrIndicatorPeriod} days
                              * ATR (Average True Range): ${avgATR}
                              * ATR Percentage: ${atrPercentage}%
                              * ATR Threshold: ${atrThreshold}%
                              * Average Price: ${avgPrice}
                            - Pre-Market Metrics:
                              * Pre/Market Change: ${theChange}%
                              * Market Capitalization: ${formatMarketCap(preMarketQuote.marketCap)}
                        `);
                            candidates.push({
                                symbol,
                                atrPercentage,
                                preMarketChange: theChange.toFixed(2),
                            });
                        }
                    }
                } else {
                    logger.info(`StocksSelector: ${symbol} has an ATR of ${atrPercentage} which is below the threshold`);
                }
            } catch (error) {
                logger.info(`StocksSelector: Error analyzing ${symbol}: ${error}`);
                // console.log(`StocksSelector: Error analyzing ${symbol}: ${error}`);
            }
        }
    } catch (error) {
        logger.info(`StocksSelector: Error: ${error}`);
        // console.log(`StocksSelector: Error: ${error}`);
    }
    return candidates; // symbol, atrPercentage, preMarketChange
};

function formatMarketCap(marketCap) {
    if (marketCap >= 1_000_000_000) {
        return `${(marketCap / 1_000_000_000).toFixed(2)}B`; // Billion
    } else if (marketCap >= 1_000_000) {
        return `${(marketCap / 1_000_000).toFixed(2)}M`; // Million
    } else {
        return `${marketCap.toFixed(2)}`; // Less than a million
    }
}


// implement the iffy pattern to run the function
(async () => {
    await identifyStocks();
})();

module.exports = {
    identifyStocks,
}