class IMarketAnalyzer {
    constructor(symbol, marketData, support, resistance) {
        if (new.target === IMarketAnalyzer) {
            throw new Error('Cannot instantiate abstract class MarketAnalyzer directly.');
        }
        this.symbol = symbol;
        this.marketData = marketData;
        this.support = support;
        this.resistance = resistance;
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

    toString() {
        return this.constructor.name;
    }
}

module.exports =  {
    IMarketAnalyzer
};