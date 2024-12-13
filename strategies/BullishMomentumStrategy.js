const {IMarketAnalyzer} = require("./IMarketAnalyzer");
const {calculateIndicatorsExt} = require("../utils/TechUtils");
const getEntityLogger = require('../utils/logger/loggerManager');
const logger = getEntityLogger('analytics');


// Signal Confirmation
// Combines RSI and MACD for robust signal confirmation:
// RSI < 30: Stock is oversold, signaling a potential rebound.
// MACD Histogram > 0: Indicates upward momentum.
// If both conditions are met, a buy signal is generated.

class BullishMomentumStrategy extends IMarketAnalyzer {
    constructor(symbol, marketData, support, resistance) {
        super(symbol, marketData, support, resistance);
        // this.symbol = symbol;
        // this.marketData = marketData;
        // this.support = support;
        // this.resistance = resistance;
        this.breakoutThreshold= 1.001; // 0.2% breakout

        this.dynamicVolumeThreshold= 1.3; // Minimum volume
        this.numberOfPrevVolumes= 25; // Last 20 volumes

        this.rsiAccumulationMin= 40;
        this.rsiAccumulationMax= 60;
        this.rsiBullishBreakoutMin= 69;
        this.rsiBullishBreakoutMax= 80;
        this.rsiPeriod= 12;
        this.macdFastEMA= 6;
        this.macdSlowEMA= 14;
        this.macdSignalEMA= 3
    }

    setSupportResistance(support, resistance) {
        this.support = support;
        this.resistance = resistance;
    }

    async evaluateBreakout() {
        let buyStock = 0; // hold
        try {
            let close = this.marketData.closes[this.marketData.closes.length - 1];

            // Calculate dynamic volume threshold

            const indicators = calculateIndicatorsExt(this.marketData, this.macdFastEMA, this.macdSlowEMA, this.macdSignalEMA, this.rsiPeriod);
            const rsiValue = indicators.rsi[indicators.rsi.length - 1];

            // Check for entry signals
            if (close > this.resistance * this.breakoutThreshold &&
                rsiValue > this.rsiBullishBreakoutMin && rsiValue < this.rsiBullishBreakoutMax) {
                logger.info(`
                  Ticker: ${this.symbol}
                  Strategy: BullishMomentumStrategy
                  Status: Buy
                  Statistics:
                    - Close Price: ${close}
                    - Resistance: ${this.resistance}
                    - Breakout Threshold: ${this.breakoutThreshold}
                    - RSI: ${rsiValue}
                      * RSI Bullish Breakout Range: [${this.rsiBullishBreakoutMin}, ${this.rsiBullishBreakoutMax}]
                    - MACD Configuration:
                      * Fast EMA: ${this.macdFastEMA}
                      * Slow EMA: ${this.macdSlowEMA}
                      * Signal EMA: ${this.macdSignalEMA}
                    - RSI Period: ${this.rsiPeriod}
                `);
                buyStock = 1; // buy
            }
        } catch (error) {
            logger.error(`Ticker: ${this.symbol} | BullishMomentumStrategy Error evaluating breakout: ${error}`);
        }
        return buyStock;
    }

    async evaluateAccumulation() {
        let accumulationCompleted = false;
        try {
            let close = this.marketData.closes[this.marketData.closes.length - 1];
            const volume = this.marketData.volumes[this.marketData.volumes.length - 1];

            // Calculate dynamic volume threshold
            let avgVolume = this.marketData.volumes.slice(-this.numberOfPrevVolumes).reduce((sum, v) => sum + v, 0) / this.numberOfPrevVolumes; // Last 20 volumes
            let dynamicVolumeThreshold = avgVolume * this.dynamicVolumeThreshold;

            const indicators = calculateIndicatorsExt(this.marketData, this.macdFastEMA, this.macdSlowEMA, this.macdSignalEMA, this.rsiPeriod);
            const macdValue = indicators.macd[indicators.macd.length - 1] || {};
            const rsiValue = indicators.rsi[indicators.rsi.length - 1];

            // Check for momentum confirmation
            if (
                // MACD Buffer = 0.05 // very high momentum
                // MACD > macdValue.signal * 1.01 moderate momentum
                // RSI in neutral range (40-60)
                // RSI > 70 overbought
                macdValue.MACD > macdValue.signal &&
                volume > dynamicVolumeThreshold &&         // Volume confirmation
                rsiValue > this.rsiAccumulationMin && rsiValue < this.rsiAccumulationMax  // RSI in neutral range
            ) {
                logger.info(`
                  Ticker: ${this.symbol}
                  Strategy: BullishMomentumStrategy
                  Status: AccCompleted
                  Statistics:
                    - Close Price: ${close}
                    - Volume:
                      * Current Volume: ${volume}
                      * Average Volume: ${avgVolume}
                      * Dynamic Volume Threshold: ${dynamicVolumeThreshold}
                      * Number of Previous Volumes: ${this.numberOfPrevVolumes}
                    - MACD:
                      * MACD Value: ${macdValue.MACD}
                      * Signal Value: ${macdValue.signal}
                      * Configuration:
                        - Fast EMA: ${this.macdFastEMA}
                        - Slow EMA: ${this.macdSlowEMA}
                        - Signal EMA: ${this.macdSignalEMA}
                    - RSI:
                      * Current RSI: ${rsiValue}
                      * Accumulation Range: [${this.rsiAccumulationMin}, ${this.rsiAccumulationMax}]
                      * RSI Period: ${this.rsiPeriod}
                `);
                accumulationCompleted = true;
            }
        } catch (error) {
            logger.error(`Ticker: ${this.symbol} | BullishMomentumStrategy Error evaluating accumulation: ${error}`);
        }
        return accumulationCompleted;
    }
}

module.exports =  {
    BullishMomentumStrategy
};