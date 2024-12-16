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
        this.margins = {};
    }

    setSupportResistance(support, resistance) {
        this.support = support;
        this.resistance = resistance;
    }

    setMarketData(marketData) {
        this.marketData = marketData;
    }

    async evaluateBreakout() {
        throw new Error('Method evaluateBreakout must be implemented.');
    }

    async evaluateAccumulation() {
        throw new Error('Method evaluateAccumulation must be implemented.');
    }

    calculateMargins() {
        let close = this.marketData.closes[this.marketData.closes.length - 1];
        const shares = Math.floor(this.params.capital / close);

        const takeProfit = Math.floor(close * this.params.takeProfit * 100) / 100;
        const stopLoss = Math.floor(close * this.params.stopLoss * 100) / 100;
        close = Math.floor(close * 100) / 100;
        this.margins.shares = shares;
        this.margins.close = close;
        this.margins.takeProfit = takeProfit;
        this.margins.stopLoss = stopLoss;
        return this.margins;
    }

    getMargins() {
        return this.margins;
    }

    toString() {
        return this.constructor.name;
    }
}

module.exports =  {
    IMarketAnalyzer
};