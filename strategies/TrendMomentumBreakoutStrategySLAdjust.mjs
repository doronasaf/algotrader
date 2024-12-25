import { TrendMomentumBreakoutStrategy } from "./TrendMomentumBreakoutStrategy.mjs";
import appConfig from "../config/AppConfig.mjs";

export class TrendMomentumBreakoutStrategySLAdjust extends TrendMomentumBreakoutStrategy {
    constructor(symbol, marketData, support, resistance, params, appConfig) {
        super(symbol, marketData, support, resistance, params, appConfig);

        this.stopLossMultiplier = appConfig().strategies.TrendMomentumBreakoutStrategySLAdjust.stopLossMultiplier;
        this.stopLossMaxPercent = appConfig().strategies.TrendMomentumBreakoutStrategySLAdjust.stopLossMaxPercent;
    }
}