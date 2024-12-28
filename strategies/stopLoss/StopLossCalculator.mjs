// Enhanced Stop Loss Calculator
export class StopLossCalculator {
    constructor(config = {}) {
        this.config = {
            maxStopLossPercent: 1.5,
            baseAtrFactor: 0.75,
            volumeThreshold: 2.5,
            minRiskRewardRatio: 1.0,
            ...config
        };
    }

    calculateStopLoss({
                          price,
                          atr,
                          heikinAshiScore,
                          numGreenCandles,
                          rvol,
                          timeFromOpen,
                          volume
                      }) {
        // Start with base ATR factor
        let atrFactor = this.config.baseAtrFactor;

        // 1. Adjust based on Heikin Ashi strength
        atrFactor = this._adjustForHeikinAshi(atrFactor, heikinAshiScore, numGreenCandles);

        // 2. Adjust for volume conditions
        atrFactor = this._adjustForVolume(atrFactor, rvol);

        // 3. Adjust for time of day
        const maxStopLossPercent = this._adjustForTime(timeFromOpen);

        // Calculate both ATR-based and percentage-based stops
        const atrBasedStop = price - (atr * atrFactor);
        const percentageBasedStop = price * (1 - maxStopLossPercent / 100);

        // Take the higher (more conservative) stop loss
        const finalStopLoss = Math.max(atrBasedStop, percentageBasedStop);

        // Calculate as percentage for validation
        const stopLossPercentage = ((price - finalStopLoss) / price) * 100;

        // Ensure we never exceed maximum stop loss percentage
        if (stopLossPercentage > this.config.maxStopLossPercent) {
            return price * (1 - this.config.maxStopLossPercent / 100);
        }

        return finalStopLoss;
    }

    evaluateTrade({
                      price,
                      atr,
                      heikinAshiScore,
                      numGreenCandles,
                      rvol,
                      timeFromOpen,
                      volume,
                      takeProfit
                  }) {
        const stopLoss = this.calculateStopLoss({
            price,
            atr,
            heikinAshiScore,
            numGreenCandles,
            rvol,
            timeFromOpen,
            volume,
        });

        // Calculate risk and reward
        const risk = price - stopLoss;
        const reward = takeProfit - price;

        // Risk-reward ratio
        const riskRewardRatio = reward / risk;

        // Evaluate if trade is worth the risk
        const isWorthRisk = riskRewardRatio >= this.config.minRiskRewardRatio;

        return {
            stopLoss,
            risk,
            reward,
            riskRewardRatio: riskRewardRatio.toFixed(2),
            isWorthRisk
        };
    }

    _adjustForHeikinAshi(atrFactor, heikinAshiScore, numGreenCandles) {
        if (heikinAshiScore === 1) {
            if (numGreenCandles >= 3) {
                return atrFactor * 1.3; // Strongest signal
            } else if (numGreenCandles >= 2) {
                return atrFactor * 1.2; // Strong signal
            }
            return atrFactor * 1.1; // Moderate signal
        }
        return atrFactor; // No adjustment for weak signals
    }

    _adjustForVolume(atrFactor, rvol) {
        if (rvol > this.config.volumeThreshold) {
            // Higher volume suggests more volatility, widen stop slightly
            return atrFactor * (1 + (rvol - this.config.volumeThreshold) * 0.1);
        }
        return atrFactor;
    }

    _adjustForTime(minutesFromOpen) {
        if (minutesFromOpen <= 30) {
            return this.config.maxStopLossPercent; // Full range in first 30 mins
        } else if (minutesFromOpen <= 60) {
            return this.config.maxStopLossPercent * 0.85; // Slightly tighter after first 30 mins
        }
        return this.config.maxStopLossPercent * 0.7; // Tighter after first hour
    }
}

// Example usage:
const calculator = new StopLossCalculator({
    maxStopLossPercent: 3.5,
    baseAtrFactor: 1.5,
    volumeThreshold: 3.0
});


const { stopLoss, risk, reward, riskRewardRatio, isWorthRisk } = calculator.evaluateTrade({
    price: 20.93,           // Entry price
    atr: 0.25,             // Current ATR
    heikinAshiScore: 1,    // Current Heikin Ashi score
    numGreenCandles: 2,    // Number of consecutive green candles
    rvol: 2.5,             // Relative volume
    timeFromOpen: 45,      // Minutes from market open
    volume: 1000000,       // Current volume
    takeProfit: 22.50       // Target take profit
});

console.log(`Price: ${20.93}, Stop loss: ${stopLoss}, Risk: ${risk}, Reward: ${reward}, R/R: ${riskRewardRatio}, Worth risk: ${isWorthRisk}`);