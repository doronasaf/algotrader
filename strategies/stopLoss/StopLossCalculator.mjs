// Enhanced Stop Loss Calculator
export class StopLossCalculator {
    constructor(config = {}) {
        this.config = {
            minStopLossPercent: 0.6,
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
                          takeProfit
                      }) {

        const takeProfitPercentage = ((takeProfit - price) / price) * 100;
        if (takeProfitPercentage <= this.config.minStopLossPercent) {
            const effectiveSL = Math.max(this.config.minStopLossPercent, takeProfitPercentage);
            return price * (1 - effectiveSL / 100);
        }
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
        let finalStopLoss = Math.max(atrBasedStop, percentageBasedStop);

        // Calculate as percentage for validation
        const stopLossPercentage = ((price - finalStopLoss) / price) * 100;

        // Ensure we never exceed maximum stop loss percentage
        if (stopLossPercentage > this.config.maxStopLossPercent) {
            return price * (1 - this.config.maxStopLossPercent / 100);
        }

        const minStopLoss = price * (1 - this.config.minStopLossPercent / 100);

        if (finalStopLoss === price || finalStopLoss < minStopLoss) {
            finalStopLoss = minStopLoss;
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
                      takeProfit
                  }) {
        const stopLoss = this.calculateStopLoss({
            price,
            atr,
            heikinAshiScore,
            numGreenCandles,
            rvol,
            timeFromOpen,
            takeProfit
        });

        // Calculate risk and reward
        const risk = price - stopLoss;
        const reward = takeProfit - price;

        // Risk-reward ratio
        const riskRewardRatio = reward / risk;

        // If stop loss is less than minimum, trade is worth the risk
        // This is a special case where we want to take the trade even if R/R is less than 1
        // This is because the take profit is very close to the entry price
        // we use Math.round to avoid floating point errors
        const stopLossPercentage = Math.round(((price - stopLoss) / price) * 100 *10) / 10;
        if (stopLossPercentage <= this.config.minStopLossPercent) {
            return {
                stopLoss,
                risk,
                reward,
                riskRewardRatio,
                isWorthRisk: true
            };
        }


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
// const calculator = new StopLossCalculator({
//     maxStopLossPercent: 1.5,
//     baseAtrFactor: 1.5,
//     volumeThreshold: 2.5
// });
// //
//
// const price = 16.4571;
// const { stopLoss, risk, reward, riskRewardRatio, isWorthRisk } = calculator.evaluateTrade({
//     price,           // Entry price
//     atr: 0.05631590909,             // Current ATR
//     heikinAshiScore: 1,    // Current Heikin Ashi score
//     numGreenCandles: 2,    // Number of consecutive green candles
//     rvol: 2.5,             // Relative volume
//     timeFromOpen: 3,      // Minutes from market open
//     volume: 1000000,       // Current volume
//     takeProfit: 16.54       // Target take profit
// });
//
// console.log(`Price: ${price}, Stop loss: ${stopLoss}, Risk: ${risk}, Reward: ${reward}, R/R: ${riskRewardRatio}, Worth risk: ${isWorthRisk}`);