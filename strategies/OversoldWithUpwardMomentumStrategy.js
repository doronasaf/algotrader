const {IMarketAnalyzer} = require("./IMarketAnalyzer");
const {calculateIndicatorsExt} = require("../utils/TechUtils");
const getEntityLogger = require('../utils/logger/loggerManager');
const logger = getEntityLogger('analytics');


// Signal Confirmation
// Combines RSI and MACD for robust signal confirmation:
// RSI < 30: Stock is oversold, signaling a potential rebound.
// MACD Histogram > 0: Indicates upward momentum.
// If both conditions are met, a buy signal is generated.

class OversoldWithUpwardMomentumStrategy extends IMarketAnalyzer {
    constructor(symbol, marketData, support, resistance, params) {
        super(symbol, marketData, support, resistance, params);
        this.numberOfPrevVolumes = 20;
        this.dynamicVolumeThreshold = 1.3;
        this.rsiPeriod= 9;
        this.macdFastEMA= 5;
        this.macdSlowEMA= 13;
        this.macdSignalEMA= 3;
    }

    async evaluateBreakout() {
        let buyStock = 0; // hold, 1: buy, -1: move to accumulation
        try {
            const indicators = calculateIndicatorsExt(this.marketData, this.macdFastEMA, this.macdSlowEMA, this.macdSignalEMA, this.rsiPeriod);
            const macdValue = indicators.macd[indicators.macd.length - 1] || {};
            const rsiValue = indicators.rsi[indicators.rsi.length - 1];
            const oversoldThreshold = 30;
            // Check for entry signals
            if (rsiValue < oversoldThreshold && macdValue.histogram > 0) {
                this.calculateMargins();
                logger.info(`
                  Ticker: ${this.symbol}
                  Strategy: OversoldWithUpwardMomentumStrategy
                  Status: Buy
                  Shares: ${this.margins.shares},
                  Limit: ${close},
                  Stop Loss: ${this.margins.stopLoss},
                  Take Profit: ${this.margins.takeProfit}
                  Statistics:
                    - RSI:
                      * Value: ${rsiValue}
                      * Period: ${this.rsiPeriod}
                    - MACD:
                      * Current Value: ${macdValue.MACD}
                      * Signal Value: ${macdValue.signal}
                      * Histogram: ${macdValue.histogram}
                      * Configuration:
                        - Fast EMA: ${this.macdFastEMA}
                        - Slow EMA: ${this.macdSlowEMA}
                        - Signal EMA: ${this.macdSignalEMA}
                `);
                buyStock = 1;
            }
        } catch (error) {
            console.error("Error:", error);
            buyStock = -1;
        }
        return buyStock;
    }

    async evaluateAccumulation() {
        let accumulationCompleted = false;
        try {
            const volume = this.marketData.volumes[this.marketData.volumes.length - 1];

            // Calculate dynamic volume threshold
            let avgVolume = this.marketData.volumes.slice(-this.numberOfPrevVolumes).reduce((sum, v) => sum + v, 0) / this.numberOfPrevVolumes; // Last 20 volumes
            const indicators = calculateIndicatorsExt(this.marketData, this.macdFastEMA, this.macdSlowEMA, this.macdSignalEMA, this.rsiPeriod);
            const macdValue = indicators.macd[indicators.macd.length - 1] || {};
            let dynamicVolumeWithThreshold = avgVolume * this.dynamicVolumeThreshold;

            if (volume > dynamicVolumeWithThreshold && macdValue.MACD > macdValue.signal) {
                logger.info(`
                  Ticker: ${this.symbol}
                  Strategy: OversoldWithUpwardMomentumStrategy
                  Status: Accumulation
                  Statistics:
                    - Volume:
                      * Current Volume: ${volume}
                      * Average Volume: ${avgVolume}
                      * Dynamic Volume Threshold: ${dynamicVolumeWithThreshold}
                    - MACD:
                      * Current Value: ${macdValue.MACD}
                      * Signal Value: ${macdValue.signal}
                      * Configuration:
                        - Fast EMA: ${this.macdFastEMA}
                        - Slow EMA: ${this.macdSlowEMA}
                        - Signal EMA: ${this.macdSignalEMA}
                    - RSI:
                      * RSI Period: ${this.rsiPeriod}
                `);

                accumulationCompleted = true;
            }
        } catch (error) {
            logger.error("Error:", error);
        }
        return accumulationCompleted;
    }
}

module.exports =  {
    OversoldWithUpwardMomentumStrategy
};