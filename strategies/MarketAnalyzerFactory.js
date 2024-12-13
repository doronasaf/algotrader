const {BullishMomentumStrategy} = require("./BullishMomentumStrategy");
const {OversoldWithUpwardMomentumStrategy} = require("./OversoldWithUpwardMomentumStrategy");
const {CombinedMomentumStrategy} = require("./CombinedMomentumStrategy");
const {CombinedMomentumWithWeightsStrategy} = require("./CombinedMomentumWithWeightsStrategy");
const {KeltnerChannelsStrategy} = require("./KeltnerChannelsStrategy");
// const {DynamicWeightedStrategy} = require("./DynamicWeightStrategy");

const TradingStrategy = {
    CombinedWithWeightMomentum : "CombinedMomentumWithWeightsStrategy",
    CombinedMomentum : "CombinedMomentumStrategy",
    BullishMomentum : "BullishMomentumStrategy",
    OversoldWithUpwardMomentum : "OversoldWithUpwardMomentumStrategy",
    KeltnerChannelsStrategy: "KeltnerChannelsStrategy",
    // DynamicWeightedStrategy : "dynamicWeightedStrategy"
};


class MarketAnalyzerFactory {
    static createAnalyzer(tradingStrategy, symbol, marketData, support, resistance) {
        switch (tradingStrategy) {
            case TradingStrategy.BullishMomentum:
                return new BullishMomentumStrategy(symbol, marketData, support, resistance);
            case TradingStrategy.OversoldWithUpwardMomentum:
                return new OversoldWithUpwardMomentumStrategy(symbol, marketData, support, resistance);
            case TradingStrategy.CombinedMomentum:
                return new CombinedMomentumStrategy(symbol, marketData, support, resistance);
            case TradingStrategy.CombinedWithWeightMomentum:
                return new CombinedMomentumWithWeightsStrategy(symbol, marketData, support, resistance);
            case TradingStrategy.KeltnerChannelsStrategy:
                return new KeltnerChannelsStrategy(symbol, marketData);
            // case TradingStrategy.DynamicWeightedStrategy:
            //     return new DynamicWeightedStrategy(symbol, marketData, support, resistance);
            default:
                throw new Error(`Unknown analyzer type: ${tradingStrategy}`);
        }
    }
}

module.exports =  {
    MarketAnalyzerFactory,
    TradingStrategy,
};