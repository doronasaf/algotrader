class IMarketAnalyzer {
    constructor(symbol, marketData, support, resistance, params) {
        if (new.target === IMarketAnalyzer) {
            throw new Error('Cannot instantiate abstract class MarketAnalyzer directly.');
        }
        this.symbol = symbol;
        this.marketData = marketData;
        this.support = support;
        this.resistance = resistance;
        this.params = params;
    }

    setSupportResistance(support, resistance) {
        throw new Error('Method setSupportResistance must be implemented.');
    }

    async evaluateBreakout() {
        throw new Error('Method evaluateBreakout must be implemented.');
    }

    async evaluateAccumulation() {
        throw new Error('Method evaluateAccumulation must be implemented.');
    }

    calculateMargins() {
        let close = this.marketData.closes[this.marketData.closes.length - 1];
        const shares = Math.floor(params.capital / close);

        const takeProfit = Math.floor(close * params.takeProfit * 100) / 100;
        const stopLoss = Math.floor(close * params.stopLoss * 100) / 100;
        close = Math.floor(close * 100) / 100;
        return {shares, takeProfit, stopLoss, close};
    }

    getMargins() {
        throw new Error('Method evaluateAccumulation must be implemented.');
    }

    toString() {
        return this.constructor.name;
    }
}

module.exports =  {
    IMarketAnalyzer
};