import { TrendMomentumBreakoutStrategy } from "./TrendMomentumBreakoutStrategy.mjs";

export class TrendMomentumBreakoutStrategySLAdjust extends TrendMomentumBreakoutStrategy {
    constructor(symbol, marketData, support, resistance, params, appConfig) {
        super(symbol, marketData, support, resistance, params, appConfig);

        this.stopLossMultiplier = appConf.strategies.TrendMomentumBreakoutStrategySLAdjust.stopLossMultiplier;
        this.stopLossMaxPercent = appConf.strategies.TrendMomentumBreakoutStrategySLAdjust.stopLossMaxPercent;
    }
}