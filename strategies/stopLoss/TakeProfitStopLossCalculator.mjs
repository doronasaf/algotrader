export class TakeProfitStopLossCalculator {
    constructor({
                    period = 14,
                    stopLossMultiplier = 0.75,
                    takeProfitMultiplier = 1.5,
                    takeProfitMaxPrecent = 1.5,
                    takeProfitMinPrecent = 0.3,
                    stopLossMaxPercent = 1.5,
                    stopLossMinPercent = 0.6}) {
        this.period = period; // Number of candles to consider for swing points
        this.stopLossMultiplier = stopLossMultiplier; // Buffer to widen TP and SL levels
        this.takeProfitMultiplier = takeProfitMultiplier; // Buffer to widen TP and SL levels
        this.takeProfitMinPrecent = takeProfitMinPrecent; // Maximum percent of take profit
        this.takeProfitMaxPrecent = takeProfitMaxPrecent; // Maximum percent of take profit
        this.stopLossMaxPercent = stopLossMaxPercent; // Maximum percent of stop loss
        this.stopLossMinPercent = stopLossMinPercent; // Minimum percent of stop loss
    }

    // Filter data to exclude zero-volume samples
    filterData(data) {
        const { highs, lows, closes, volumes } = data;
        return highs
            .map((high, i) => ({
                high,
                low: lows[i],
                close: closes[i],
                volume: volumes[i],
            }))
            .filter((sample) => sample.volume > 0); // Exclude zero-volume samples
    }

    // Calculate Swing High (Baseline for TP)
    calculateSwingHigh(filteredData) {
        const highs = filteredData.map((d) => d.high);
        return Math.max(...highs.slice(-this.period));
    }

    // Calculate Swing Low (Baseline for SL)
    calculateSwingLow(filteredData) {
        const lows = filteredData.map((d) => d.low);
        return Math.min(...lows.slice(-this.period));
    }

    // Main function to calculate TP and SL
    calculateTakeProfitAndStopLoss(data) {
        // Filter out zero-volume samples
        this.entryPrice = data.closes[data.closes.length - 1];
        const filteredData = this.filterData(data);

        // Validate data
        // if (filteredData.length < this.period) {
        //     throw new Error("Not enough valid data points after filtering.");
        // }

        // Calculate Swing Points
        const swingHigh = this.calculateSwingHigh(filteredData);
        const swingLow = this.calculateSwingLow(filteredData);

        // Apply buffer to widen levels
        const takeProfit = swingHigh * (100+this.takeProfitMultiplier) / 100;
        const stopLoss = swingLow * (100-this.stopLossMultiplier) / 100;

        // calaculate the take profit and stop loss percents
        const takeProfitPercent = (takeProfit - this.entryPrice) / this.entryPrice;
        const stopLossPercent = (this.entryPrice - stopLoss) / this.entryPrice;

        let finalTakeProfit = takeProfit , finalStopLoss = stopLoss;
        if (takeProfitPercent > this.takeProfitMaxPrecent) {
            finalTakeProfit = this.entryPrice * (100+this.takeProfitMaxPrecent) / 100;
        } else if (takeProfitPercent < this.takeProfitMinPrecent) {
            finalTakeProfit = this.entryPrice * (100 + this.takeProfitMinPrecent) / 100;
        }

        if (stopLossPercent > this.stopLossMaxPercent) {
            finalStopLoss = this.entryPrice * (100-this.stopLossMaxPercent) / 100;
        } else if (stopLossPercent < this.stopLossMinPercent) {
            finalStopLoss = this.entryPrice * (100 - this.stopLossMinPercent) / 100;
        }
        return { takeProfit: finalTakeProfit, stopLoss: finalStopLoss, swingHigh, swingLow };
    }
}

// Example Usage
const data = {
    highs: [117, 112, 114, 113, 111, 115, 112, 110],
    lows: [105, 106, 108, 109, 107, 110, 112, 113],
    closes: [108, 110, 112, 111, 109, 114, 116, 115],
    volumes: [1000, 1200, 1300, 1400, 0, 1500, 1600, 1700], // Includes a zero-volume entry
};

const calculator = new TakeProfitStopLossCalculator({ period: 7, stopLossMultiplier: 1.1, takeProfitMultiplier: 1.1});
const result = calculator.calculateTakeProfitAndStopLoss(data);
console.log(result);
