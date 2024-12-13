const {MarketAnalyzerFactory, TradingStrategy} = require("./MarketAnalyzerFactory");

class DynamicWeightedStrategy {
    constructor(symbol, marketData, support, resistance, strategyWeights) {
        this.symbol = symbol;
        this.marketData = marketData;
        this.support = support;
        this.resistance = resistance;

        // Define weights for each strategy
        this.strategyWeights = {
            "combinedWithWeightMomentum": 0.25,
            "combinedMomentum": 0.25,
            "bullishMomentum": 0.3,
            "oversoldWithUpwardMomentum": 0.2
        };

        // Instantiate strategies
        this.strategies = Object.keys(this.strategyWeights).map((strategyKey) =>
            MarketAnalyzerFactory.createAnalyzer(
                strategyKey,
                this.symbol,
                this.marketData,
                this.support,
                this.resistance
            )
        );
    }

    async evaluateAccumulation() {
        let totalScore = 0;
        const strategyResults = [];

        for (let strategyKey of Object.keys(this.strategyWeights)) {
            const strategy = this.strategies.find((s) => s.constructor.name === strategyKey);
            const result = await strategy.evaluateAccumulation();
            const weight = this.strategyWeights[strategyKey];
            strategyResults.push({strategy: strategyKey, result, weight});

            if (result) {
                totalScore += weight; // Add the weighted score if the strategy signals accumulation
            }
        }

        console.log(`Accumulation Evaluation for ${this.symbol}:`);
        console.table(strategyResults);

        return totalScore >= 0.5; // Buy if combined score exceeds the threshold
    }

    async evaluateBreakout() {
        let totalScore = 0;
        const strategyResults = [];

        for (let strategyKey of Object.keys(this.strategyWeights)) {
            const strategy = this.strategies.find((s) => s.constructor.name === strategyKey);
            const result = await strategy.evaluateBreakout();
            const weight = this.strategyWeights[strategyKey];
            strategyResults.push({strategy: strategyKey, result, weight});

            if (result) {
                totalScore += weight; // Add the weighted score if the strategy signals breakout
            }
        }

        console.log(`Breakout Evaluation for ${this.symbol}:`);
        console.table(strategyResults);

        return totalScore >= 0.5; // Buy if combined score exceeds the threshold
    }
}

module.exports = {
    DynamicWeightedStrategy,
};
