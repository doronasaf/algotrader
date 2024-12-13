const { macd, rsi } = require("technicalindicators"); // Install with `npm install technicalindicators`


function calculateIndicatorsExt(data, macdFastEMA, macdSlowEMA, macdSignalEMA, rsiPeriod) {
    const params = {
        macdFastEMA,
        macdSlowEMA,
        macdSignalEMA,
        rsiPeriod,
    };
    return calculateIndicators(data, params);
}


// Calculate MACD and RSI
function calculateIndicators(data, params) {
    const closes = data.closes;

    // Recommended Parameters for Moving from A to B
    // MACD Settings (Shorter Periods for Intraday Data):
    //
    // Fast EMA Period: 5
    // Slow EMA Period: 13
    // Signal Line Period: 3
    // This reduces the lag in MACD and makes it more responsive to price changes.

    const macdInput = {
        values: closes,
        fastPeriod: params.macdFastEMA,
        slowPeriod: params.macdSlowEMA,
        signalPeriod: params.macdSignalEMA,
        SimpleMAOscillator: false,
        SimpleMASignal: false,
    };

    const rsiInput = {
        values: closes,
        period: params.rsiPeriod,
    };

    // RSI: If RSI > 70, it might be overbought; if < 30, it might be oversold.
    const macdResult = macd(macdInput);
    const rsiResult = rsi(rsiInput);

    return {
        macd: macdResult,
        rsi: rsiResult,
    };
}

module.exports = {
    calculateIndicators,
    calculateIndicatorsExt,
};