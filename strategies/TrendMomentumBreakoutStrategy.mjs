import { EMA, RSI, ATR, VWAP, MACD, BollingerBands } from 'technicalindicators';
import {IMarketAnalyzer} from "./IMarketAnalyzer.mjs";
import {getEntityLogger} from '../utils/logger/loggerManager.mjs';
import {nyseTime} from "../utils/TimeFormatting.mjs";
const analyticsLogger = getEntityLogger('analytics');
const appLogger = getEntityLogger('appLog');

export class TrendMomentumBreakoutStrategy extends IMarketAnalyzer {
    constructor(symbol, marketData, support, resistance, params, appConfig) {
        super(symbol, marketData, support, resistance, params, appConfig);
        this.marketData = marketData; // { closes, highs, lows, volumes }

        // Strategy parameters
        this.emaShortPeriod = appConfig.strategies.TrendMomentumBreakoutStrategy.emaShortPeriod || 9;
        this.emaLongPeriod = appConfig.strategies.TrendMomentumBreakoutStrategy.emaLongPeriod || 21;
        this.rsiPeriod = appConfig.strategies.TrendMomentumBreakoutStrategy.rsiPeriod || 7;
        this.bollingerRSIPeriod = appConfig.strategies.TrendMomentumBreakoutStrategy.bollingerRSIPeriod || 14;
        this.keltnerAtrPeriod = appConfig.strategies.TrendMomentumBreakoutStrategy.keltnerAtrPeriod || 30;
        this.rvolThreshold = appConfig.strategies.TrendMomentumBreakoutStrategy.rvolThreshold || 1.2; // Minimum RVOL for a valid signal

        // MACD uses:
        // A 18-period EMA (fast).
        // A 30-period EMA (slow).
        // A 9-period EMA for the signal line.
        // At least 39 data points (30 for the slow EMA + 9 for the signal line) are needed.
        this.macdParams = {
            fastPeriod: appConfig.strategies.TrendMomentumBreakoutStrategy.macdFastPeriod || 18,
            slowPeriod: appConfig.strategies.TrendMomentumBreakoutStrategy.macdSlowPeriod || 30,
            signalPeriod: appConfig.strategies.TrendMomentumBreakoutStrategy.macdSignalPeriod || 9,
            SimpleMAOscillator: false,
            SimpleMASignal: false,
        };
        this.keltnerMultiplier = appConfig.strategies.TrendMomentumBreakoutStrategy.keltnerMultiplier || 1.5;
        this.cmfPeriod = appConfig.strategies.TrendMomentumBreakoutStrategy.cmfPeriod || 20;

        // Yahoo: 1.5, 1.45
        // Alpaca: 0.5-1.0
        // IBKR: 0.5-1.0
        this.takeProfitMultiplier = appConfig.strategies.TrendMomentumBreakoutStrategy.takeProfitMultiplier || 1.45; // ATR multiplier for take-profit - WAS 1.5.
        this.stopLossMultiplier = appConfig.strategies.TrendMomentumBreakoutStrategy.stopLossMultiplier || 0.75; // ATR multiplier for stop-loss
        this.stopLossMultiplierAlt = appConfig.strategies.TrendMomentumBreakoutStrategySLAdjust.stopLossMultiplier || 1; // ATR multiplier for stop-loss

        this.takeProfitMaxPrecent = appConfig.strategies.TrendMomentumBreakoutStrategy.takeProfitMaxPrecent || 0.015 ; // maximum percent of take profit (4%)
        this.stopLossMaxPercent = appConfig.strategies.TrendMomentumBreakoutStrategy.stopLossMaxPercent || 0.01125; // maximum percent of stop loss (3%)
        this.stopLossMaxPercentAlt = appConfig.strategies.TrendMomentumBreakoutStrategySLAdjust.stopLossMaxPercent || 0.01175; // maximum percent of stop loss (3%)

        this.lowRsiBearishThreshold = appConfig.strategies.TrendMomentumBreakoutStrategy.lowRsiBearishThreshold || 30; // for short term; long term is 45
        this.lowRsiBulishThreshold = appConfig.strategies.TrendMomentumBreakoutStrategy.lowRsiBulishThreshold || 30;// for short term; long term is 60
        this.highRsiBulishThreshold = appConfig.strategies.TrendMomentumBreakoutStrategy.highRsiBulishThreshold || 65;// for short term; long term is 60

        this.candleInterval = appConfig.dataSource.ibkr.candleInterval || 10000;
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
        } else if (this.rvol < 1) {
            return -1; // Weak market participation (Bearish)
        }
        return 0; // Neutral
    }

    calculateRSI(closes) {
        return RSI.calculate({ values: closes, period: this.rsiPeriod });
    }

    calculateATR(highs, lows, closes, period) {
        return ATR.calculate({ high: highs, low: lows, close: closes, period });
    }

    calculateVWAP(highs, lows, closes, volumes) {
        const hlc3 = highs.map((high, i) => (high + lows[i] + closes[i]) / 3); // HLC Average
        const cumulativeVWAP = hlc3.reduce((acc, price, i) => acc + price * volumes[i], 0);
        const cumulativeVolume = volumes.reduce((acc, volume) => acc + volume, 0);
        return cumulativeVWAP / cumulativeVolume;
    }

    validateMACDInput(closes, macdParams) {
        const { fastPeriod, slowPeriod, signalPeriod } = macdParams;

        // Check if MACD parameters are valid
        if (!fastPeriod || !slowPeriod || !signalPeriod) {
            appLogger.info(`TrendMomentumBreakoutStrategy.validateMACDInput: Ticker: ${this.symbol} MACD parameters are missing or invalid.`);
            throw new Error("MACD parameters are missing or invalid.");
        }
        if (fastPeriod >= slowPeriod) {
            appLogger.info(`TrendMomentumBreakoutStrategy.validateMACDInput: Ticker: ${this.symbol} MACD fastPeriod must be less than slowPeriod.`);
            throw new Error("MACD fastPeriod must be less than slowPeriod.");
        }
        if (signalPeriod <= 0) {
            appLogger.info(`TrendMomentumBreakoutStrategy.validateMACDInput: Ticker: ${this.symbol} MACD signalPeriod must be greater than 0.`);
            throw new Error("MACD signalPeriod must be greater than 0.");
        }

        // Check data length
        const requiredLength = slowPeriod + signalPeriod - 1;
        if (!Array.isArray(closes) || closes.length < requiredLength) {
            appLogger.info(`TrendMomentumBreakoutStrategy.validateMACDInput: Ticker: ${this.symbol} Insufficient data for MACD calculation. Need at least ${requiredLength} data points, but received ${closes.length}.`);
            throw new Error(
                `Insufficient data for MACD calculation. Need at least ${requiredLength} data points, but received ${closes.length}.`
            );
        }

        // Check for invalid data
        const invalidDataIndex = closes.findIndex((val) => isNaN(val) || val === null || val === undefined);
        if (invalidDataIndex !== -1) {
            appLogger.info(`TrendMomentumBreakoutStrategy.validateMACDInput: Ticker: ${this.symbol} Invalid data at index ${invalidDataIndex}: ${closes[invalidDataIndex]}`);
            throw new Error(`Invalid data at index ${invalidDataIndex}: ${closes[invalidDataIndex]}`);
        }

        // Check for variability in data
        const allSame = closes.every((val, i, arr) => val === arr[0]);
        if (allSame) {
            appLogger.info(`TrendMomentumBreakoutStrategy.validateMACDInput: Ticker: ${this.symbol} All closing prices are identical: ${closes[0]}, MACD cannot be calculated.`);
            throw new Error("Closing prices are all identical. MACD cannot be calculated.");
        }
    }

    calculateMACD(closes) {
        this.validateMACDInput(closes, this.macdParams);
        return MACD.calculate({
            values: closes,
            ...this.macdParams,
        });
    }

    calculateBollingerBands(closes) {
        return BollingerBands.calculate({
            period: this.bollingerRSIPeriod,
            values: closes,
            stdDev: 2,
        });
    }

    calculateKeltnerChannels(highs, lows, closes) {
        // Input validation
        if (!Array.isArray(highs) || !Array.isArray(lows) || !Array.isArray(closes)) {
            throw new Error(`Ticker ${this.symbol} Input data must be arrays.`);
        }
        if (highs.length < this.keltnerAtrPeriod || lows.length < this.keltnerAtrPeriod || closes.length < this.keltnerAtrPeriod) {
            throw new Error(`Insufficient data. At least ${this.keltnerAtrPeriod} data points are required.`);
        }
        if (highs.some((val) => isNaN(val)) || lows.some((val) => isNaN(val)) || closes.some((val) => isNaN(val))) {
            throw new Error("Input arrays contain invalid numbers.");
        }

        // Calculate EMA (Middle Line)
        const middleLine = EMA.calculate({ values: closes, period: this.keltnerAtrPeriod });

        // Calculate ATR
        const atr = this.calculateATR(highs, lows, closes, this.keltnerAtrPeriod);

        // Ensure arrays are aligned
        const minLength = Math.min(middleLine.length, atr.length);
        const trimmedMiddleLine = middleLine.slice(-minLength);
        const trimmedATR = atr.slice(-minLength);

        // Validate intermediate values
        if (trimmedMiddleLine.some((val) => isNaN(val)) || trimmedATR.some((val) => isNaN(val))) {
            appLogger.info(`Ticker ${this.symbol} Intermediate values contain NaN. Check input data or calculation logic.`);
            return { middleLine: [], upperBand: [], lowerBand: [] };
        }

        // Calculate Upper and Lower Bands
        const upperBand = trimmedMiddleLine.map((ml, i) => ml + trimmedATR[i] * this.keltnerMultiplier);
        const lowerBand = trimmedMiddleLine.map((ml, i) => ml - trimmedATR[i] * this.keltnerMultiplier);

        return {
            middleLine: trimmedMiddleLine,
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

    calculateCMF(closes, highs, lows, volumes, period = 20) {
        if (!closes || !highs || !lows || !volumes || closes.length < period) {
            throw new Error(`Ticker ${this.symbol} Insufficient data for CMF calculation`);
        }

        let moneyFlowVolumeSum = 0;
        let volumeSum = 0;

        for (let i = closes.length - period; i < closes.length; i++) {
            const moneyFlowMultiplier =
                ((closes[i] - lows[i]) - (highs[i] - closes[i])) / (highs[i] - lows[i] || 1); // Avoid division by zero
            const moneyFlowVolume = moneyFlowMultiplier * volumes[i];
            moneyFlowVolumeSum += moneyFlowVolume;
            volumeSum += volumes[i];
        }

        return volumeSum === 0 ? 0 : moneyFlowVolumeSum / volumeSum;
    }

    evaluateBollingerBands() {
        const { closes } = this.marketData;
        if (closes.length < this.bollingerRSIPeriod) {
            appLogger.info(`Ticker: ${this.symbol} | Bollinger Bands calculation failed, not enough data`);
        }
        const bollingerBands = this.calculateBollingerBands(closes);

        // Ensure we have enough data for analysis
        if (!bollingerBands || bollingerBands.length === 0) {
            appLogger.info(`Ticker: ${this.symbol} | Bollinger Bands calculation failed, not enough data`);
            throw new Error(`Ticker ${this.symbol} Insufficient data for Bollinger Bands evaluation`);
        }

        // Get the latest Bollinger Band values
        const latest = bollingerBands[bollingerBands.length - 1];
        const { upper, lower, middle } = latest;
        const lastClose = closes[closes.length - 1];

        // Log the latest Bollinger Band state
        appLogger.info(
            `Ticker: ${this.symbol} | Bollinger Bands: Upper = ${upper}, Middle = ${middle}, Lower = ${lower}, Last Close = ${lastClose}`
        );

        // Evaluate the price relative to the Bollinger Bands
        if (lastClose > upper) {
            appLogger.info(`Ticker: ${this.symbol} | Bullish: Price broke above the upper band.`);
            this.bollingerSignalDesc = "Strong Bullish"
            return 1; // Bullish
        } else if (lastClose < lower) {
            appLogger.info(`Ticker: ${this.symbol} | Bearish: Price broke below the lower band.`);
            return -1; // Bearish
        } else if (lastClose > middle) {
            appLogger.info(`Ticker: ${this.symbol} | Slightly Bullish: Price is above the middle band.`);
            this.bollingerSignalDesc = "Slightly Bullish";
            return 1; // Bullish
        } else if (lastClose < middle) {
            appLogger.info(`Ticker: ${this.symbol} | Slightly Bearish: Price is below the middle band.`);
            return -1; // Bearish
        }

        appLogger.info(`Ticker: ${this.symbol} | Neutral: Price is near the middle band.`);
        return 0; // Neutral
    }

    /**
     * Evaluate a stock's trading opportunity based on CMF, EMA, and RSI.
     * @param {Object} marketData - Object containing market data { closes, highs, lows, volumes }.
     * @param {Object} params - Configuration parameters for the strategy.
     * @returns {number} - 1 for buy, -1 for sell, 0 for hold.
     */
    evaluateCMFStrategy() {
        const { closes, highs, lows, volumes } = this.marketData;
        let isBullish = false, isBearish = false;
        let lastEMAShort, lastEMALong;
        try {
            // Calculate CMF
            this.cmf = this.calculateCMF(closes, highs, lows, volumes, this.cmfPeriod);

            // Calculate RSI
            const rsi = RSI.calculate({values: closes, period: this.rsiPeriod});
            this.lastRSI = rsi[rsi.length - 1];

            // Calculate EMAs
            const emaShort = EMA.calculate({values: closes, period: this.emaShortPeriod});
            const emaLong = EMA.calculate({values: closes, period: this.emaLongPeriod});

            lastEMAShort = emaShort[emaShort.length - 1];
            lastEMALong = emaLong[emaLong.length - 1];
            this.emaShortIsBiggerThenLong = lastEMAShort > lastEMALong;

            // Determine trading signals
            isBullish = this.cmf > 0 && lastEMAShort > lastEMALong && this.lastRSI >= this.lowRsiBulishThreshold && this.lastRSI <= this.highRsiBulishThreshold;
            isBearish = this.cmf < 0 && lastEMAShort < lastEMALong && (this.lastRSI < this.lowRsiBearishThreshold || this.lastRSI > this.highRsiBulishThreshold);
        } catch (error) {
            // not enough data to calculate CMF
            appLogger.info(`Ticker: ${this.symbol} | Strategy: TrendMomentumBreakoutStrategy | API: evaluateCMFStrategy | Error: ${error.message}`);
        }
        if (isBullish) {
            appLogger.info(`Bullish Signal: CMF = ${this.cmf}, EMA Short = ${lastEMAShort}, EMA Long = ${lastEMALong}, RSI = ${this.lastRSI}`);
            return 1; // Buy
        } else if (isBearish) {
            //appLogger.info(`Bearish Signal: CMF = ${this.cmf}, EMA Short = ${lastEMAShort}, EMA Long = ${lastEMALong}, RSI = ${this.lastRSI}`);
            return -1; // Sell
        }

        return 0; // Hold
    }

    evaluateHeikinAshi() {
        const heikinAshi = this.calculateHeikinAshi();

        // Input validation
        if (!heikinAshi || !heikinAshi.opens || !heikinAshi.closes || !heikinAshi.highs || !heikinAshi.lows) {
            throw new Error(`Invalid Heikin-Ashi data for ${this.symbol}`);
        }

        if (heikinAshi.closes.length < 3) {
            throw new Error(`Insufficient data for Heikin-Ashi evaluation for ${this.symbol}. At least 3 candles are required.`);
        }

        // Extract last three candles
        const lastClose = heikinAshi.closes[heikinAshi.closes.length - 1];
        const lastOpen = heikinAshi.opens[heikinAshi.opens.length - 1];
        const lastLow = heikinAshi.lows[heikinAshi.lows.length - 1];

        const prevClose = heikinAshi.closes[heikinAshi.closes.length - 2];
        const prevOpen = heikinAshi.opens[heikinAshi.opens.length - 2];

        const prevPrevClose = heikinAshi.closes[heikinAshi.closes.length - 3];
        const prevPrevOpen = heikinAshi.opens[heikinAshi.opens.length - 3];

        // Check for bullish signal
        // Last candle is green with no lower wick
        const lastCandleGreen = lastClose > lastOpen && lastLow === lastOpen;

        // Previous two candles are also green
        const prevCandleGreen = prevClose > prevOpen;
        const prevPrevCandleGreen = prevPrevClose > prevPrevOpen;

        this.numOfGrennCandlesInARaw = 0;
        if (lastCandleGreen && prevCandleGreen && prevPrevCandleGreen) {
            this.numOfGrennCandlesInARaw = 3;
            return 1; // Bullish
        } else if (lastCandleGreen && prevCandleGreen) {
            this.numOfGrennCandlesInARaw = 2;
            return 1; // Bullish
        } else if (lastCandleGreen) {
            this.numOfGrennCandlesInARaw = 1;
            return 1; // Bullish
        }
        // Check for bearish signal: Red candle with no upper wick and previous two candles are red
        const lastHigh = heikinAshi.highs[heikinAshi.highs.length - 1];
        const lastCandleRed = lastClose < lastOpen && lastHigh === lastOpen;

        if (lastCandleRed) {
            return -1; // Bearish
        }

        return 0; // Neutral
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
        // const macdValues = MACD.calculate({
        //     values: closes,
        //     ...this.macdParams,
        // });
        const macdValues = this.calculateMACD(closes);
        if (!macdValues || macdValues.length === 0) {
            const message = `Ticker: ${this.symbol} | Strategy: TrendMomentumBreakoutStrategy | Error: MACD calculation failed, not enough data`;
            appLogger.info(message);
            throw new Error(message);
        }
        this.lastMACD = macdValues[macdValues.length - 1];

        if (!this.lastMACD || typeof this.lastMACD.MACD !== "number" || typeof this.lastMACD.signal !== "number") {
            const message = `Ticker: ${this.symbol} | Strategy: TrendMomentumBreakoutStrategy | Error: Invalid MACD values`;
            appLogger.info(message);
            throw new Error(message);
        }

        if (this.lastMACD && this.lastMACD.MACD > this.lastMACD.signal) {
            return 1; // Bullish
        } else if (this.lastMACD && this.lastMACD.MACD < this.lastMACD.signal) {
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
        const { stopLoss, takeProfit, stopLossAlt } = this.calculateStopLossAndTakeProfit();
        this.margins.shares = shares;
        this.margins.close = close;
        this.margins.takeProfit = takeProfit;
        this.margins.stopLoss = stopLoss;
        this.margins.stopLossAlt = stopLossAlt;
        return this.margins;
    }

    calculateStopLossAndTakeProfit() {
        const entryPrice = this.marketData.closes[this.marketData.closes.length - 1];
        const { highs, lows, closes } = this.marketData;
        const atr = this.calculateATR(highs, lows, closes, closes.length-1);
        const lastATR = atr[atr.length - 1];
        const vwap = this.calculateVWAP(highs, lows, closes, this.marketData.volumes);
        const calculatedStopLoss = Math.min(entryPrice - this.stopLossMultiplier * lastATR, vwap);
        const calculatedStopLossAlt = Math.min(entryPrice - this.stopLossMultiplierAlt * lastATR, vwap);
        const calculatedTakeProfit = entryPrice + this.takeProfitMultiplier * lastATR;

        let stopLoss = Math.min(calculatedStopLoss, (1-this.stopLossMaxPercent) * entryPrice);
        let stopLossAlt = Math.min(calculatedStopLossAlt, (1-this.stopLossMaxPercentAlt) * entryPrice);
        let takeProfit = Math.min(calculatedTakeProfit, (1+this.takeProfitMaxPrecent) * entryPrice);
        if (stopLoss < calculatedStopLoss) {
            appLogger.info(`Ticker: ${this.symbol} | Strategy: TrendMomentumBreakoutStrategy | Stop Loss adjusted from ${calculatedStopLoss} to ${stopLoss}`);
        }
        if (takeProfit > calculatedTakeProfit) {
            appLogger.info(`Ticker: ${this.symbol} | Strategy: TrendMomentumBreakoutStrategy | Take Profit adjusted from ${calculatedTakeProfit} to ${takeProfit}`);
        }
        return { stopLoss: parseFloat(stopLoss.toFixed(2)), takeProfit: parseFloat(takeProfit.toFixed(2)) , stopLossAlt: parseFloat(stopLossAlt.toFixed(2))};
    }

    async evaluateBreakout() {
        try {
            // Combine signals from all strategies
            // const emaSignal = this.evaluateEMA(); // included in evaluateCMFStrategy
            // const rsiSignal = this.evaluateRSI(); // included in evaluateCMFStrategy
            const vwapSignal = this.evaluateVWAP();
            const macdSignal = this.evaluateMACD();
            const keltnerSignal = this.evaluateKeltnerChannels();
            const rvolSignal = this.evaluateRVOL();
            const heikinAshiSignal = this.evaluateHeikinAshi();
            const cmfSignal = this.evaluateCMFStrategy();
            const bullingerSignal = this.evaluateBollingerBands();

            const signals = [vwapSignal, macdSignal, keltnerSignal, rvolSignal, heikinAshiSignal, cmfSignal, bullingerSignal];
            // const buySignals = signals.filter((s) => s === 1).length;
            // const sellSignals = signals.filter((s) => s === -1).length;
            const totalScore = signals.reduce((acc, signal) => acc + signal, 0);
            const close = this.marketData.closes[this.marketData.closes.length - 1];

            appLogger.info(`Ticker: ${this.symbol} | Strategy: TrendMomentumBreakoutStrategy | Score: ${totalScore} Target Score: ${signals.length} | Breakdown - VWAP: ${vwapSignal}, MACD: ${macdSignal}, Keltner: ${keltnerSignal}, RVOL: ${rvolSignal}, Heikin-Ashi: ${heikinAshiSignal}, CMF: ${cmfSignal}`);
            if (totalScore >= 4) {
                this.calculateMargins();
                let signalAgeInMin = this.marketData.closes.length * this.candleInterval / 1000 / 60;
                let buySignal = {
                    timestamp: nyseTime(),
                    symbol: this.symbol,
                    ageMins: signalAgeInMin,
                    strategy: 'TrendMomentumBreakoutStrategy',
                    status: 'Buy',
                    shares: this.margins.shares,
                    limit: close,
                    stopLoss: this.margins.stopLoss,
                    stopLossAlt: this.margins.stopLossAlt,
                    takeProfit: this.margins.takeProfit,
                    cmf: this.cmf,
                    cmfScore: cmfSignal,
                    emaShortIsBiggerThenLong: this.emaShortIsBiggerThenLong,
                    lastRSI: this.lastRSI,
                    rsiBullishRange: `[${this.lowRsiBulishThreshold}-${this.highRsiBulishThreshold}]`,
                    rsiBearishRange: `[0-${this.lowRsiBearishThreshold}] or [>${this.highRsiBulishThreshold}]`,
                    vwap: this.vwap,
                    vwapScore: vwapSignal,
                    rvol: this.rvol,
                    rvolThreshold: this.rvolThreshold,
                    rvolScore: rvolSignal,
                    macd: this.lastMACD.MACD,
                    macdSignal: this.lastMACD.signal,
                    macdScore: macdSignal,
                    keltnerScore: keltnerSignal,
                    heikinAshiScore: heikinAshiSignal,
                    heikinAshiSeqOfGreenCandles: this.numOfGrennCandlesInARaw,
                    bollingerSignal: this.bollingerSignalDesc,
                    bollingerScore: bullingerSignal
                }
                analyticsLogger.info(JSON.stringify(buySignal));
                // analyticsLogger.info(`
                //     Ticker: ${this.symbol}
                //     Strategy: TrendMomentumBreakoutStrategy
                //     Status: Buy
                //     Shares: ${this.margins.shares},
                //     Limit: ${close},
                //     Stop Loss: ${this.margins.stopLoss},
                //     Take Profit: ${this.margins.takeProfit}
                //     Statistics:
                //       - EMA:
                //         * Short Period: ${this.emaShortPeriod}
                //         * Long Period: ${this.emaLongPeriod}
                //       - RSI:
                //         * Value: ${this.lastRSI}
                //         * RSI Range: >${this.highRsiBulishThreshold}, indicating bullish momentum
                //       - VWAP:
                //         * Value: ${this.vwap}
                //         * Score: ${vwapSignal}
                //       - RVol:
                //         * Value: ${this.rvol}
                //         * Threshold: ${this.rvolThreshold}
                //         * Score: ${rvolSignal}
                //       - MACD:
                //         * MACD Value: ${this.lastMACD.MACD}
                //         * Signal Value: ${this.lastMACD.signal}
                //         * Score: ${macdSignal}
                //       - Keltner Channels:
                //         * Score: ${keltnerSignal}
                //       - Heikin-Ashi:
                //         * Score: ${heikinAshiSignal}
                //       - CMF (includes RSI and EMA):
                //         * Value: ${this.cmf}
                //         * Score: ${cmfSignal}
                //       - Bollinger Bands:
                //         * Value: ${this.bollingerSignalDesc}
                //         * Score: ${bullingerSignal}
                // `);
                return 1; // Buy Signal
            } else {
                return 0; // Hold
            }
        } catch (error) {
            appLogger.info(`Ticker: ${this.symbol} | Strategy: TrendMomentumBreakoutStrategy | API: evaluateBreakout | Error: ${error.message}`);
            return -2; // Error
        }
    }

    async evaluateAccumulation() {
        return true;
    }
}

// module.exports = {
//     TrendMomentumBreakoutStrategy,
// };
