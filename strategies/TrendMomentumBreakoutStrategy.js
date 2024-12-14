const { EMA, RSI, ATR, VWAP, MACD, BollingerBands, Supertrend } = require('technicalindicators');
const {IMarketAnalyzer} = require("./IMarketAnalyzer");
const getEntityLogger = require('../utils/logger/loggerManager');
const logger = getEntityLogger('analytics');


class TrendMomentumBreakoutStrategy extends IMarketAnalyzer {
    constructor(symbol, marketData, support, resistance, params) {
        super(symbol, marketData, support, resistance, params);
        this.marketData = marketData; // { closes, highs, lows, volumes }

        // Strategy parameters
        this.emaShortPeriod = params.emaShortPeriod || 9;
        this.emaLongPeriod = params.emaLongPeriod || 21;
        this.rsiPeriod = params.rsiPeriod || 14;
        this.atrPeriod = params.atrPeriod || 14;
        this.vwapPeriod = params.vwapPeriod || 1; // Daily VWAP
        this.rvolThreshold = params.rvolThreshold || 1.5; // Minimum RVOL for a valid signal
        this.macdParams = {
            fastPeriod: params.macdFast || 12,
            slowPeriod: params.macdSlow || 26,
            signalPeriod: params.macdSignal || 9,
            SimpleMAOscillator: false,
            SimpleMASignal: false,
        };
        this.keltnerMultiplier = params.keltnerMultiplier || 1.5;
        this.supertrendMultiplier = params.supertrendMultiplier || 3;
        this.cmfPeriod = params.cmfPeriod || 20;

        this.takeProfitMultiplier = params.takeProfitMultiplier || 1.5; // ATR multiplier for take-profit
        this.stopLossMultiplier = params.stopLossMultiplier || 0.75; // ATR multiplier for stop-loss

        this.lowRsiBearishThreshold = 40;
        this.highRsiBulishThreshold = 60;
        this.margins = {};
    }

    calculateEMA(closes, period) {
        return EMA.calculate({ values: closes, period });
    }

    calculateRVOL(volumes) {
        // Calculate the average volume (e.g., for the last 14 periods)
        const historicalVolume = volumes.slice(0, -1); // Exclude the most recent volume
        const averageVolume = historicalVolume.reduce((sum, vol) => sum + vol, 0) / historicalVolume.length;

        // Calculate the Relative Volume (RVOL) for the most recent period
        const lastVolume = volumes[volumes.length - 1];
        return lastVolume / averageVolume; // RVOL
    }

    evaluateRVOL() {
        const { volumes } = this.marketData;
        this.rvol = this.calculateRVOL(volumes);

        if (this.rvol > this.rvolThreshold) {
            return 1; // Strong market participation (Bullish)
        } else if (rvol < 1) {
            return -1; // Weak market participation (Bearish)
        }
        return 0; // Neutral
    }

    calculateRSI(closes) {
        return RSI.calculate({ values: closes, period: this.rsiPeriod });
    }

    calculateATR(highs, lows, closes) {
        return ATR.calculate({ high: highs, low: lows, close: closes, period: this.atrPeriod });
    }

    calculateVWAP(highs, lows, closes, volumes) {
        const hlc3 = highs.map((high, i) => (high + lows[i] + closes[i]) / 3); // HLC Average
        const cumulativeVWAP = hlc3.reduce((acc, price, i) => acc + price * volumes[i], 0);
        const cumulativeVolume = volumes.reduce((acc, volume) => acc + volume, 0);
        return cumulativeVWAP / cumulativeVolume;
    }

    calculateMACD(closes) {
        return MACD.calculate({
            values: closes,
            ...this.macdParams,
        });
    }

    calculateBollingerBands(closes) {
        return BollingerBands.calculate({
            period: this.rsiPeriod,
            values: closes,
            stdDev: 2,
        });
    }

    calculateSupertrend(highs, lows, closes) {
        return Supertrend.calculate({
            high: highs,
            low: lows,
            close: closes,
            period: this.atrPeriod,
            multiplier: this.supertrendMultiplier,
        });
    }

    calculateKeltnerChannels(highs, lows, closes) {
        const middleLine = EMA.calculate({ values: closes, period: this.atrPeriod });
        const atr = this.calculateATR(highs, lows, closes);
        const upperBand = middleLine.map((ml, i) => ml + atr[i] * this.keltnerMultiplier);
        const lowerBand = middleLine.map((ml, i) => ml - atr[i] * this.keltnerMultiplier);

        return {
            middleLine,
            upperBand,
            lowerBand,
        };
    }

    calculateHeikinAshi() {
        const { closes, highs, lows } = this.marketData;
        const opens = [];
        for (let i = 0; i < closes.length; i++) {
            if (i === 0) {
                // For the first interval, we can assume the open is the same as the close
                opens.push(closes[i]);
            } else {
                // Open of the current interval = Close of the previous interval
                opens.push(closes[i - 1]);
            }
        }
        const heikinAshi = {
            opens: [],
            closes: [],
            highs: [],
            lows: [],
        };

        for (let i = 0; i < closes.length; i++) {
            const currentClose = (opens[i] + closes[i] + highs[i] + lows[i]) / 4;

            let currentOpen;
            if (i === 0) {
                // Initialize the first open as the average of the first open and close
                currentOpen = (opens[0] + closes[0]) / 2;
            } else {
                // Current open is the average of the previous Heikin-Ashi open and close
                currentOpen =
                    (heikinAshi.opens[i - 1] + heikinAshi.closes[i - 1]) / 2;
            }

            const currentHigh = Math.max(highs[i], currentOpen, currentClose);
            const currentLow = Math.min(lows[i], currentOpen, currentClose);

            heikinAshi.opens.push(currentOpen);
            heikinAshi.closes.push(currentClose);
            heikinAshi.highs.push(currentHigh);
            heikinAshi.lows.push(currentLow);
        }

        return heikinAshi;
    }

    evaluateHeikinAshi() {
        const heikinAshi = this.calculateHeikinAshi();

        const lastClose = heikinAshi.closes[heikinAshi.closes.length - 1];
        const lastOpen = heikinAshi.opens[heikinAshi.opens.length - 1];
        const lastHigh = heikinAshi.highs[heikinAshi.highs.length - 1];
        const lastLow = heikinAshi.lows[heikinAshi.lows.length - 1];

        // Check for bullish signal: Green candle with no lower wick
        if (lastClose > lastOpen && lastLow === Math.min(lastClose, lastOpen)) {
            return 1; // Bullish
        }

        // Check for bearish signal: Red candle with no upper wick
        if (lastClose < lastOpen && lastHigh === Math.max(lastClose, lastOpen)) {
            return -1; // Bearish
        }

        return 0; // Hold/Neutral
    }
    evaluateEMA() {
        const { closes } = this.marketData;
        const emaShort = this.calculateEMA(closes, this.emaShortPeriod);
        const emaLong = this.calculateEMA(closes, this.emaLongPeriod);

        if (emaShort[emaShort.length - 1] > emaLong[emaLong.length - 1]) {
            return 1; // Bullish
        } else if (emaShort[emaShort.length - 1] < emaLong[emaLong.length - 1]) {
            return -1; // Bearish
        }
        return 0; // Neutral
    }

    evaluateRSI() {
        const { closes } = this.marketData;
        const rsi = this.calculateRSI(closes);
        this.lastRSI = rsi[rsi.length - 1];

        if (this.lastRSI > this.highRsiBulishThreshold) {
            return 1; // Bullish
        } else if (this.lastRSI < this.lowRsiBearishThreshold) {
            return -1; // Bearish
        }
        return 0; // Neutral
    }

    evaluateVWAP() {
        const { highs, lows, closes, volumes } = this.marketData;
        this.vwap = this.calculateVWAP(highs, lows, closes, volumes);
        const lastClose = closes[closes.length - 1];

        if (lastClose > this.vwap) {
            return 1; // Bullish
        } else if (lastClose < this.vwap) {
            return -1; // Bearish
        }
        return 0; // Neutral
    }

    evaluateMACD() {
        const { closes } = this.marketData;
        const macdValues = this.calculateMACD(closes);
        this.lastMACD = macdValues[macdValues.length - 1];

        if (this.lastMACD && this.lastMACD.MACD > this.lastMACD.signal) {
            return 1; // Bullish
        } else if (this.lastMACD && this.lastMACD.MACD < this.lastMACD.signal) {
            return -1; // Bearish
        }
        return 0; // Neutral
    }

    evaluateSupertrend() {
        const { highs, lows, closes } = this.marketData;
        const supertrendValues = this.calculateSupertrend(highs, lows, closes);
        this.lastSupertrend = supertrendValues[supertrendValues.length - 1];

        if (this.lastSupertrend && this.lastSupertrend.trend === "bullish") {
            return 1; // Bullish
        } else if (this.lastSupertrend && this.lastSupertrend.trend === "bearish") {
            return -1; // Bearish
        }
        return 0; // Neutral
    }

    evaluateKeltnerChannels() {
        const { highs, lows, closes } = this.marketData;
        const keltner = this.calculateKeltnerChannels(highs, lows, closes);
        const lastClose = closes[closes.length - 1];
        const lastUpper = keltner.upperBand[keltner.upperBand.length - 1];
        const lastLower = keltner.lowerBand[keltner.lowerBand.length - 1];

        if (lastClose > lastUpper) {
            return 1; // Bullish
        } else if (lastClose < lastLower) {
            return -1; // Bearish
        }
        return 0; // Neutral
    }

    calculateMargins() {
        let close = this.marketData.closes[this.marketData.closes.length - 1];
        const shares = Math.floor(this.params.capital / close);
        const { stopLoss, takeProfit } = this.calculateStopLossAndTakeProfit();
        return { shares, takeProfit, stopLoss, close };
    }

    calculateStopLossAndTakeProfit() {
        const entryPrice = this.marketData.closes[this.marketData.closes.length - 1];
        const { highs, lows, closes } = this.marketData;
        const atr = this.calculateATR(highs, lows, closes);
        const lastATR = atr[atr.length - 1];
        const vwap = this.calculateVWAP(highs, lows, closes, this.marketData.volumes);

        const stopLoss = Math.min(entryPrice - this.stopLossMultiplier * lastATR, vwap);
        const takeProfit = entryPrice + this.takeProfitMultiplier * lastATR;

        return { stopLoss: parseFloat(stopLoss.toFixed(2)), takeProfit: parseFloat(takeProfit.toFixed(2)) };
    }

    async evaluateBreakout() {
        // Combine signals from all strategies
        const emaSignal = this.evaluateEMA();
        const rsiSignal = this.evaluateRSI();
        const vwapSignal = this.evaluateVWAP();
        const macdSignal = this.evaluateMACD();
        const supertrendSignal = this.evaluateSupertrend();
        const keltnerSignal = this.evaluateKeltnerChannels();
        const rvolSignal = this.evaluateRVOL();
        const heikinAshiSignal = this.evaluateHeikinAshi();

        const signals = [emaSignal, rsiSignal, vwapSignal, macdSignal, supertrendSignal, keltnerSignal, rvolSignal, heikinAshiSignal];
        const buySignals = signals.filter((s) => s === 1).length;
        const sellSignals = signals.filter((s) => s === -1).length;

        if (buySignals > sellSignals) {
            this.margins = this.calculateMargins();
            logger.info(`
                    Ticker: ${this.symbol}
                    Strategy: TrendMomentumBreakoutStrategy
                    Status: Buy
                    Shares: ${margins.shares},
                    Limit: ${close},
                    Stop Loss: ${margins.stopLoss},
                    Take Profit: ${margins.takeProfit}
                    Statistics:
                      - EMA:
                        * Short Period: ${this.emaShortPeriod}
                        * Long Period: ${this.emaLongPeriod}
                        * Score: ${emaSignal} 
                      - RSI:
                        * Value: ${this.lastRSI}
                        * RSI Range: >${this.highRsiBulishThreshold}, indicating bullish momentum
                        * Score: ${rsiSignal}
                      - VWAP:
                        * Value: ${this.vwap}
                        * Score: ${vwapSignal}
                      - RVol:
                        * Value: ${this.rvol}
                        * Threshold: ${this.rvolThreshold}
                        * Score: ${rvolSignal}
                      - MACD:
                        * MACD Value: ${this.lastMACD.MACD}
                        * Signal Value: ${this.lastMACD.signal}
                        * Score: ${macdSignal}
                      - Supertrend:
                        * Trend: ${this.lastSupertrend.trend}
                        * Score: ${supertrendSignal}
                        - Keltner Channels:
                        * Score: ${keltnerSignal}
                      - Heikin-Ashi:
                        * Score: ${heikinAshiSignal}
                `);
            return 1; // Buy Signal
        } else if (sellSignals > buySignals) {
            return 0; // Hold
        }
        // sell signal is never returned because we are only measuring a buy signals
    }

    async evaluateAccumulation() {
        return true;
    }

    getMargins() {
        return this.margins;
    }
}

module.exports = {
    TrendMomentumBreakoutStrategy,
};
