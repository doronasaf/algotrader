// const { IMarketAnalyzer } = require('./IMarketAnalyzer');
// const { RSI, MACD, BollingerBands } = require('technicalindicators');
// const getEntityLogger = require('../utils/logger/loggerManager');
import { IMarketAnalyzer } from './IMarketAnalyzer.mjs';
import { RSI, MACD, BollingerBands } from 'technicalindicators';
import {getEntityLogger} from '../utils/logger/loggerManager.mjs';
const logger = getEntityLogger('analytics');

export class CombinedMomentumStrategy extends IMarketAnalyzer {
    constructor(symbol, marketData, support, resistance, params) {
        super(symbol, marketData, support, resistance, params);
        this.rsiPeriod = 14
        this.macdFast = 12;
        this.macdSlow = 26;
        this.macdSignal = 9;
        this.dynamicVolumeThreshold = 1.3;
        this.breakoutThreshold = 1.004; // 0.4% above resistance
        this.narrowRangeThreshold = 1.5; // Pric
    }

    // Checks if the stock is in the accumulation phase based on:
    //
    // Low Volume:
    // Current volume is less than 50% of the average.
    // Narrow Price Range:
    // Price range (high - low) is below narrowRangeThreshold.
    // Neutral RSI:
    // RSI is between 40 and 60, suggesting no strong trend.
    // Flat MACD Histogram:
    // Histogram is near zero (< 0.01), indicating no significant momentum.
    // If all conditions are met, the stock is likely in accumulation and ready for a potential breakout.
    async evaluateAccumulation(params) {
        try {
            const {closes, volumes} = this.marketData;
            const averageVolume = volumes.reduce((sum, vol) => sum + vol, 0) / volumes.length;

            // RSI Calculation
            const rsiValues = RSI.calculate({values: closes, period: this.rsiPeriod});
            const lastRSI = rsiValues[rsiValues.length - 1];

            // MACD Calculation
            const macdValues = MACD.calculate({
                values: closes,
                fastPeriod: this.macdFast,
                slowPeriod: this.macdSlow,
                signalPeriod: this.macdSignal,
                SimpleMAOscillator: false,
                SimpleMASignal: false,
            });
            const lastMACD = macdValues[macdValues.length - 1] || {};

            // Volume and Range Conditions
            const lowVolumeMultiplier = 0.5;
            const lowVolumeIndicator = volumes[volumes.length - 1] < lowVolumeMultiplier * averageVolume;
            const narrowRange = Math.max(...closes) - Math.min(...closes) < this.narrowRangeThreshold;
            const rsiAccMin = 40;
            const rsiAccMax = 60;
            // Evaluate Accumulation Phase (Phase A)
            if (lowVolumeIndicator && narrowRange && lastRSI > rsiAccMin && lastRSI < rsiAccMax && lastMACD.histogram < 0.01) {
                logger.info(`
                  Ticker: ${this.symbol}
                  Strategy: CombinedMomentumStrategy
                  Status: AccCompleted
                  Statistics:
                    - RSI:
                      * Last RSI: ${lastRSI}
                      * Accumulation Range: [${rsiAccMin}, ${rsiAccMax}]
                      * RSI Period: ${this.rsiPeriod}
                    - MACD:
                      * Last Histogram Value: ${lastMACD.histogram}
                      * Configuration:
                        - Fast EMA: ${this.macdFast}
                        - Slow EMA: ${this.macdSlow}
                        - Signal EMA: ${this.macdSignal}
                    - Volume:
                      * Latest Volume: ${volumes[volumes.length - 1]}
                      * Average Volume: ${averageVolume}
                      * Low Volume Multiplier: ${lowVolumeMultiplier}
                      * Low Volume Indicator: ${lowVolumeIndicator}
                      * Dynamic Volume Threshold: ${this.dynamicVolumeThreshold}
                    - Narrow Range:
                      * Current Value: ${narrowRange}
                      * Threshold: ${this.narrowRangeThreshold}
                    - Breakout:
                      * Breakout Threshold: ${this.breakoutThreshold}
                `);
                return true;
            }
        } catch (error) {
            logger.error(`Ticker: ${this.symbol} | CombinedMomentumStrategy Error evaluating accumulation: ${error}`);
        }
        return false;
    }

    // Checks if the stock is breaking out of the accumulation phase based on:
    // Price Above Resistance:
    // Last close is greater than resistance * breakoutThreshold (e.g., 0.4% above resistance).
    // Volume Surge:
    // Last volume is greater than dynamicVolumeThreshold (1.3x the average volume).
    // Bullish RSI:
    // RSI > 60 confirms upward momentum.
    // Positive MACD Histogram:
    // Histogram > 0 indicates a bullish trend.
    // If all conditions are met, it confirms a breakout and issues a buy signal.
    async evaluateBreakout(params) {
        let buySignal = 0 ; // 0: hold, 1: buy, -1: move to accumulation
        try {
            const {closes, volumes} = this.marketData;
            const lastClose = closes[closes.length - 1];
            const lastVolume = volumes[volumes.length - 1];

            // RSI Calculation
            const rsiValues = RSI.calculate({values: closes, period: this.rsiPeriod});
            const lastRSI = rsiValues[rsiValues.length - 1];

            // MACD Calculation
            const macdValues = MACD.calculate({
                values: closes,
                fastPeriod: this.macdFast,
                slowPeriod: this.macdSlow,
                signalPeriod: this.macdSignal,
                SimpleMAOscillator: false,
                SimpleMASignal: false,
            });
            const lastMACD = macdValues[macdValues.length - 1] || {};
            let avgVolume = this.marketData.volumes.reduce((sum, v) => sum + v, 0) / this.marketData.volumes.length; // Last 20 volumes
            let dynamicVolumeThreshold = avgVolume * this.dynamicVolumeThreshold;
            let resistanceMulBreakoutThreshold = this.resistance * this.breakoutThreshold;
            const rsiTreshold = 60;
            // Check Breakout Conditions
            const breakoutCondition =
                lastClose > resistanceMulBreakoutThreshold &&
                lastVolume > dynamicVolumeThreshold &&
                lastRSI > rsiTreshold &&
                lastMACD.histogram > 0;

            if (breakoutCondition) {
                this.calculateMargins();
                logger.info(`
                  Ticker: ${this.symbol}
                  Strategy: CombinedMomentumStrategy
                  Status: Buy
                  Shares: ${this.margins.shares},
                  Limit: ${close},
                  Stop Loss: ${this.margins.stopLoss},
                  Take Profit: ${this.margins.takeProfit}
                  Statistics:
                    - Price:
                      * Last Close: ${lastClose}
                      * Resistance Multiplier Breakout Threshold: ${resistanceMulBreakoutThreshold}
                    - Volume:
                      * Last Volume: ${lastVolume}
                      * Dynamic Volume Threshold: ${dynamicVolumeThreshold}
                    - RSI:
                      * Last RSI: ${lastRSI}
                      * RSI Threshold: ${rsiTreshold}
                      * RSI Period: ${this.rsiPeriod}
                    - MACD:
                      * Last Histogram Value: ${lastMACD.histogram}
                      * Configuration:
                        - Fast EMA: ${this.macdFast}
                        - Slow EMA: ${this.macdSlow}
                        - Signal EMA: ${this.macdSignal}
                `);

                buySignal = 1;
            }
        } catch (error) {
            logger.error(`Ticker: ${this.symbol} | CombinedMomentumStrategy Error evaluating breakout: ${error}`);
            buySignal = -1;
        }
        return buySignal;
    }
}

// module.exports = {
//     CombinedMomentumStrategy,
// };
