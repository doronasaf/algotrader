// const {EMA, ATR, RSI, MACD, BollingerBands} = require("technicalindicators");
// const getEntityLogger = require('../utils/logger/loggerManager');
// const {IMarketAnalyzer} = require("./IMarketAnalyzer");

import {EMA, ATR, RSI, MACD, BollingerBands} from "technicalindicators";
import {getEntityLogger} from '../utils/logger/loggerManager.mjs';
import {IMarketAnalyzer} from "./IMarketAnalyzer.mjs";
const logger = getEntityLogger('analytics');

/**
 * Keltner Channels Strategy
 */
export class KeltnerChannelsStrategy extends IMarketAnalyzer{
    constructor(symbol, marketData, support, resistance, params, emaPeriod = 20, atrPeriod = 14, multiplier = 2) {
        super(symbol, marketData, support, resistance, params);
        this.symbol = symbol;
        this.marketData = marketData; // { closes, highs, lows }
        this.emaPeriod = emaPeriod; // EMA period for middle line
        this.atrPeriod = atrPeriod; // ATR period for volatility
        this.multiplier = multiplier; // Multiplier for ATR to calculate bands
        this.macdFast = 5; // Fast EMA period
        this.macdSlow = 13; // Slow EMA period
        this.macdSignal = 3; // Signal period

        // Momentum Indicators
        this.rsiPeriod = 14;
        this.lowRsiAccThreshold = 40;
        this.highRsiAccThreshold = 60;
        this.highRsiBuyThreshold = 60;
        // accumulation parameters
        this.macdFastAcc = 12;
        this.macdSlowAcc = 26;
        this.macdSignalAcc = 9;

        // Accumulation Thresholds
        this.volatilityThreshold = 0.005; // Small price range
        this.lowVolumeMultiplier = 0.5; // Volume < 50% of average
    }

    /**
     * Calculate Keltner Channels
     * @returns {Object} { middle, upper, lower }
     */
    calculateChannels() {
        const {closes, highs, lows} = this.marketData;

        // Calculate the middle line (EMA of closes)
        const middleLine = EMA.calculate({
            period: this.emaPeriod,
            values: closes,
        });

        // Calculate the ATR
        const atrValues = ATR.calculate({
            period: this.atrPeriod,
            high: highs,
            low: lows,
            close: closes,
        });

        // Ensure we have the same length for both
        const length = Math.min(middleLine.length, atrValues.length);
        const middle = middleLine.slice(-length);
        const atr = atrValues.slice(-length);

        // Calculate the upper and lower bands
        const upper = middle.map((m, i) => m + this.multiplier * atr[i]);
        const lower = middle.map((m, i) => m - this.multiplier * atr[i]);

        // calculate the rsi
        const rsi = RSI.calculate({
            values: closes,
            period: this.rsiPeriod,
        });
        const rsiValue = rsi[rsi.length - 1];
        return {middle, upper, lower, rsi: rsiValue};
    }

    /**
     * Calculate MACD and Histogram
     * @returns {Object} { MACD, signal, histogram }
     */
    calculateMACD() {
        const {closes} = this.marketData;

        const macdValues = MACD.calculate({
            values: closes,
            fastPeriod: this.macdFast,
            slowPeriod: this.macdSlow,
            signalPeriod: this.macdSignal,
            SimpleMAOscillator: false,
            SimpleMASignal: false,
        });

        const lastMACD = macdValues[macdValues.length - 1] || {};
        return lastMACD;
    }

    /**
     * Evaluate Phase B Breakout
     * @returns {Boolean} Whether conditions are met for a breakout
     */
    evaluateBreakout() {
        try {
            const {closes} = this.marketData;
            const lastClose = closes[closes.length - 1];

            const {upper, middle, rsi} = this.calculateChannels();
            const macdData = this.calculateMACD();

            const lastUpper = upper[upper.length - 1];
            const lastMiddle = middle[middle.length - 1];
            const lastHistogram = macdData.histogram || 0;

            // Bullish Breakout: Price consistently near or above the upper band
            if (lastClose > lastUpper && rsi > this.highRsiBuyThreshold && lastHistogram > 0) {
                // write the log like that
                this.calculateMargins();
                logger.info(`
                    Ticker: ${this.symbol}
                    Strategy: KeltnerChannelsStrategy
                    Status: Buy
                    Shares: ${this.margins.shares},
                    Limit: ${lastClose},
                    Stop Loss: ${this.margins.stopLoss},
                    Take Profit: ${this.margins.takeProfit}
                    Statistics:
                      - Close Price: ${lastClose}
                      - RSI: ${rsi}
                        * RSI Range: >50, indicating bullish momentum
                      - MACD:
                        * MACD Value: ${macdData.MACD}
                        * Signal Value: ${macdData.signal}
                        * Histogram: ${lastHistogram}
                        * Configuration:
                          - Fast EMA: ${this.macdFast}
                          - Slow EMA: ${this.macdSlow}
                          - Signal EMA: ${this.macdSignal}
                      - Keltner Channels:
                        * Middle Band: ${lastMiddle}
                        * Upper Band: ${lastUpper}
                `);
                return 1; // Buy Signal
            }

            // Exit Signal: Price moves back inside the middle band after a breakout
            if (lastClose < lastMiddle) {
                return -1; // Exit Signal - move to Accumulation
            }

            return 0; // "HOLD";
        } catch (error) {
            console.error(`Error in KeltnerChannelsStrategy: ${error.message}`);
            return false;
        }
    }

    async evaluateAccumulation() {
        try {
            const {closes, highs, lows, volumes} = this.marketData;

            // Calculate RSI
            const rsiValues = RSI.calculate({values: closes, period: this.rsiPeriod});
            const lastRSI = rsiValues[rsiValues.length - 1];

            // Calculate MACD
            const macdValues = MACD.calculate({
                values: closes,
                fastPeriod: this.macdFastAcc,
                slowPeriod: this.macdSlowAcc,
                signalPeriod: this.macdSignalAcc,
                SimpleMAOscillator: false,
                SimpleMASignal: false,
            });
            const lastMACD = macdValues[macdValues.length - 1] || {};

            // Calculate ATR (Volatility)
            const atrValues = ATR.calculate({high: highs, low: lows, close: closes, period: this.atrPeriod});
            const lastATR = atrValues[atrValues.length - 1];

            // Average True Range as % of price
            const lastClose = closes[closes.length - 1];
            const priceVolatility = lastATR / lastClose;

            // Average Volume
            const averageVolume = volumes.reduce((sum, v) => sum + v, 0) / volumes.length;

            // Volume Condition
            const lowVolume = volumes[volumes.length - 1] < this.lowVolumeMultiplier * averageVolume;

            // Accumulation Phase Conditions
            const isInAccumulation =
                priceVolatility < this.volatilityThreshold && // Low volatility
                lowVolume && // Low volume
                lastRSI > this.lowRsiAccThreshold && lastRSI < this.highRsiAccThreshold && // Neutral RSI
                Math.abs(lastMACD.histogram || 0) < 0.01; // Neutral MACD Histogram

            if (isInAccumulation) {
                logger.info(`
                Ticker: ${this.symbol}
                Strategy: KeltnerChannelsStrategy
                Status: Accumulation
                Statistics:
                  - RSI: ${lastRSI}
                    * RSI Range: ${this.lowRsiAccThreshold} - ${this.highRsiAccThreshold}
                  - MACD:
                    * MACD Value: ${lastMACD.MACD}
                    * Signal Value: ${lastMACD.signal}
                    * Histogram: ${lastMACD.histogram}
                    * Configuration:
                      - Fast EMA: ${this.macdFastAcc}
                      - Slow EMA: ${this.macdSlowAcc}
                      - Signal EMA: ${this.macdSignalAcc}
                  - ATR: ${lastATR}
                    * Volatility Threshold: ${this.volatilityThreshold}
                  - Volume: ${volumes[volumes.length - 1]}
                    * Average Volume: ${averageVolume}
            `);
                return true;
            }
        } catch (error) {
            console.error(`Error in KeltnerChannelsStrategy: ${error.message}`);
        }
        return false;
    }

}

// module.exports = {
//     KeltnerChannelsStrategy,
// };
