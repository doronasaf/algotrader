export class IMarketAnalyzer {
    constructor(symbol, marketData, support, resistance, params, appConf) {
        if (new.target === IMarketAnalyzer) {
            throw new Error('Cannot instantiate abstract class MarketAnalyzer directly.');
        }
        this.symbol = symbol;
        this.marketData = marketData;
        this.support = support;
        this.resistance = resistance;
        this.params = params;
        this.appConf = appConf;
        this.margins = {};
    }

    setSupportResistance(support, resistance) {
        this.support = support;
        this.resistance = resistance;
    }

    setMarketData(marketData) {
        this.marketData = marketData;
    }
    setUniqueID(id) {
        this.id = id;
    }
    getUniqueID() {
        return this.id;
    }

    async evaluateBreakout() {
        throw new Error('Method evaluateBreakout must be implemented.');
    }

    async evaluateAccumulation() {
        throw new Error('Method evaluateAccumulation must be implemented.');
    }

    calculateMargins() {
        throw new Error('Method evaluateAccumulation must be implemented.');
    }

    getMargins() {
        return this.margins;
    }

    toString() {
        return this.constructor.name;
    }
}

