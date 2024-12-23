import {BullishMomentumStrategy} from "./BullishMomentumStrategy.mjs";
import {OversoldWithUpwardMomentumStrategy} from "./OversoldWithUpwardMomentumStrategy.mjs";
import {CombinedMomentumStrategy} from "./CombinedMomentumStrategy.mjs";
import {CombinedMomentumWithWeightsStrategy} from "./CombinedMomentumWithWeightsStrategy.mjs";
import {KeltnerChannelsStrategy} from "./KeltnerChannelsStrategy.mjs";
import {TrendMomentumBreakoutStrategy} from "./TrendMomentumBreakoutStrategy.mjs";
import {TrendMomentumBreakoutStrategySLAdjust} from "./TrendMomentumBreakoutStrategySLAdjust.mjs";

export const TradingStrategy = {
    TrendMomentumBreakoutStrategy: "TrendMomentumBreakoutStrategy",
    TrendMomentumBreakoutStrategySLAdjust: "TrendMomentumBreakoutStrategySLAdjust",
    // CombinedWithWeightMomentum : "CombinedMomentumWithWeightsStrategy",
    // CombinedMomentum : "CombinedMomentumStrategy",
    // BullishMomentum : "BullishMomentumStrategy",
    // OversoldWithUpwardMomentum : "OversoldWithUpwardMomentumStrategy",
    // KeltnerChannelsStrategy: "KeltnerChannelsStrategy"
};


export class MarketAnalyzerFactory {
    static createAnalyzer(tradingStrategy, symbol, marketData, support, resistance, params, appConf) {
        switch (tradingStrategy) {
            case TradingStrategy.BullishMomentum:
                return new BullishMomentumStrategy(symbol, marketData, support, resistance, params);
            case TradingStrategy.OversoldWithUpwardMomentum:
                return new OversoldWithUpwardMomentumStrategy(symbol, marketData, support, resistance, params);
            case TradingStrategy.CombinedMomentum:
                return new CombinedMomentumStrategy(symbol, marketData, support, resistance, params);
            case TradingStrategy.CombinedWithWeightMomentum:
                return new CombinedMomentumWithWeightsStrategy(symbol, marketData, support, resistance, params);
            case TradingStrategy.KeltnerChannelsStrategy:
                return new KeltnerChannelsStrategy(symbol, marketData, support, resistance, params);
            case TradingStrategy.TrendMomentumBreakoutStrategy:
                 return new TrendMomentumBreakoutStrategy(symbol, marketData, support, resistance, params, appConf);
            case TradingStrategy.TrendMomentumBreakoutStrategySLAdjust:
                return new TrendMomentumBreakoutStrategySLAdjust(symbol, marketData, support, resistance, params, appConf);
            default:
                throw new Error(`Unknown analyzer type: ${tradingStrategy}`);
        }
    }
}

// module.exports =  {
//     MarketAnalyzerFactory,
//     TradingStrategy,
// };