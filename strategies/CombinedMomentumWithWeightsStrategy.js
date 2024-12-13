const {IMarketAnalyzer} = require('./IMarketAnalyzer');
const {RSI, MACD, BollingerBands} = require('technicalindicators');
const getEntityLogger = require('../utils/logger/loggerManager');
const logger = getEntityLogger('analytics');

class CombinedMomentumWithWeightsStrategy extends IMarketAnalyzer {
    constructor(symbol, marketData, support = null, resistance = null) {
        super(symbol, marketData, support, resistance);
        this.rsiPeriod = 14
        this.macdFast = 12;
        this.macdSlow = 26;
        this.macdSignal = 9;
        this.dynamicVolumeThreshold = 1.3;
        this.breakoutThreshold = 1.004; // 0.4% above resistance
        this.narrowRangeThreshold = 1.5; // Pric
        this.weightsThreshold = 0.65;
    }

    setSupportResistance(support, resistance) {
        this.support = support;
        this.resistance = resistance;
    }

    async evaluateAccumulation() {
        if (this.marketData) return true;
        return false;
    }

    async evaluateBreakout() {
        let buyStock = 0; // hold, 1: buy, -1: move to accumulation
        try {
            const weights = {ma: 0.4, rsi: 0.3, bb: 0.2, macd: 0.1}; // Customize weights
            const buySignal = this.combineStrategies(this.marketData, weights, this.weightsThreshold);

            if (buySignal === 1) {
                logger.info(`Ticker: ${this.symbol} | CombinedMomentumWithWeightsStrategy | Buy | `);
            }
        } catch (error) {
            logger.error(`Ticker: ${this.symbol} | CombinedMomentumWithWeightsStrategy Error evaluating breakout: ${error}`);
            buyStock = -1;
        }
        return buyStock;
    }

    // Moving Average Crossover
    movingAverageCrossover(prices, shortPeriod = 10, longPeriod = 50) {
        const shortMA = prices.slice(-shortPeriod).reduce((sum, val) => sum + val, 0) / shortPeriod;
        const longMA = prices.slice(-longPeriod).reduce((sum, val) => sum + val, 0) / longPeriod;

        if (shortMA > longMA) return 1; // Bullish signal
        if (shortMA < longMA) return -1; // Bearish signal
        return 0; // Neutral
    }

    // RSI Strategy
    rsiStrategy(prices, period = 14) {
        const rsi = RSI.calculate({values: prices, period});
        const lastRSI = rsi[rsi.length - 1];
        if (lastRSI < 30) return 1; // Oversold (Buy signal)
        if (lastRSI > 70) return -1; // Overbought (Sell signal)
        return 0; // Neutral
    }

// Bollinger Bands
    bollingerBandsStrategy(prices, period = 20, stdDev = 2) {
        const effectivePeriod = Math.min(period, prices.length);
        const bb = BollingerBands.calculate({period: effectivePeriod, values: prices, stdDev});
        const lastPrice = prices[prices.length - 1];
        const lastBB = bb[bb.length - 1];

        if (lastPrice < lastBB.lower) return 1; // Buy signal
        if (lastPrice > lastBB.upper) return -1; // Sell signal
        return 0; // Neutral
    }

// MACD Strategy
    macdStrategy(prices, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
        const macd = MACD.calculate({
            values: prices,
            fastPeriod,
            slowPeriod,
            signalPeriod,
            SimpleMAOscillator: false,
            SimpleMASignal: false,
        });

        const lastMACD = macd[macd.length - 1];
        if (!lastMACD || !lastMACD.MACD || !lastMACD.signal ) return -1; // Neutral
        if (lastMACD.MACD > lastMACD.signal) return 1; // Bullish signal
        if (lastMACD.MACD < lastMACD.signal) return -1; // Bearish signal
        return 0; // Neutral
    }

    combineStrategies(prices, weights, threshold = 0.5) {
        const strategies = [
            {name: "Moving Average Crossover", score: this.movingAverageCrossover(prices.closes), weight: weights.ma, desc: (score)=> score > 0 ? "BUY" : (score ===0 ? "HOLD" : "SELL")},
            {name: "RSI", score: this.rsiStrategy(prices.closes), weight: weights.rsi, desc: (score)=> score > 0 ? "BUY" : (score ===0 ? "HOLD" : "SELL")},
            {name: "Bollinger Bands", score: this.bollingerBandsStrategy(prices.closes), weight: weights.bb, desc: (score)=> score > 0 ? "BUY" : (score ===0 ? "HOLD" : "SELL")},
            {name: "MACD", score: this.macdStrategy(prices.closes), weight: weights.macd, desc: (score)=> score > 0 ? "BUY" : (score ===0 ? "HOLD" : "SELL")},
        ];

        // Calculate total weighted score
        const totalScore = strategies.reduce((sum, strategy) => sum + strategy.score * strategy.weight, 0);

        let signal = this.generateSignal(totalScore, threshold);
        if (signal === 1) {
            logger.info(`
              Ticker: ${this.symbol}
              Strategy: CombinedMomentumWithWeightsStrategy
              Status: Buy
              Statistics:
                - Total Score: ${totalScore}
                - Strategy Breakdown:
                  ${strategies.map(strategy => `
                    * ${strategy.name}:
                      - Score: ${strategy.score}
                      - Weight: ${strategy.weight}
                  `).join('')}
            `);
        }
        return signal;
    }

    generateSignal(combinedScore, threshold = 0.5) {
        if (combinedScore > threshold) return 1; // "BUY";
        if (combinedScore < -threshold) return -1 // "SELL";
        return 0; // "HOLD";
    }
}

module.exports = {
    CombinedMomentumWithWeightsStrategy,
};
