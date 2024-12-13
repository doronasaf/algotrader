const axios = require("axios");

// Fetch historical data
async function fetchHistoricalData(ticker, historyInDays) {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1m&range=${historyInDays}d`;

    try {
        const response = await axios.get(url);
        const { chart } = response.data;

        const timestamps = chart.result[0].timestamp;
        const prices = chart.result[0].indicators.quote[0];

        return timestamps.map((timestamp, index) => ({
            timestamp,
            high: prices.high[index],
            low: prices.low[index],
            close: prices.close[index],
            volume: prices.volume[index],
        }));
    } catch (error) {
        console.error("Error fetching historical data:", error.message);
        return [];
    }
}

function backtestStrategy(data, params) {
    let support = null;
    let resistance = null;
    let phase = "A"; // Start with Accumulation
    let capital = 10000; // Initial capital
    let position = 0; // Number of shares held
    let peakCapital = capital; // Track the peak for max drawdown
    let drawdown = 0;
    let totalProfit = 0;
    let totalLoss = 0;
    let wins = 0;
    let losses = 0;
    const trades = [];
    let stabilizationCounterResistance = 0; // Counter for resistance stabilization
    let stabilizationCounterSupport = 0; // Counter for support stabilization

    console.log("Starting backtest...");
    data.forEach((point, index) => {
        const { close, high, low, volume } = point;
        const time = new Date(point.timestamp * 1000).toLocaleTimeString();

        console.log(`\nIteration ${index + 1} | Time: ${time}`);
        console.log(`Close: ${close}, High: ${high}, Low: ${low}, Volume: ${volume}`);
        console.log(`Phase: ${phase}, Support: ${support}, Resistance: ${resistance}`);

        switch (phase) {
            case "A": // Accumulation
                if (support === null || resistance === null) {
                    support = low;
                    resistance = high;
                    console.log(`Initialized support to ${support} and resistance to ${resistance}`);
                } else {
                    if (high > resistance && stabilizationCounterResistance <= params.stabilizationPeriod ) {
                        resistance = high;
                        stabilizationCounterResistance = 0; // Reset resistance stabilization counter
                        console.log(`Resistance updated to ${resistance} (price still rising)`);
                    } else {
                        stabilizationCounterResistance++;
                        console.log(`Resistance stabilization counter incremented to ${stabilizationCounterResistance}`);
                    }

                    if (low < support) {
                        support = low;
                        stabilizationCounterSupport = 0; // Reset support stabilization counter
                        stabilizationCounterResistance = 0; // Reset resistance stabilization counter because stock price declines
                        resistance = null;
                        console.log(`Support updated to ${support} (price still falling), reset Resistance as well`);
                    } else {
                        stabilizationCounterSupport++;
                        console.log(`Support stabilization counter incremented to ${stabilizationCounterSupport}`);
                    }
                }

                // Check if both support and resistance have stabilized
                if (
                    stabilizationCounterResistance >= params.stabilizationPeriod &&
                    stabilizationCounterSupport >= params.stabilizationPeriod
                ) {
                    console.log("Range stabilized. Checking for breakout...");
                    if (close > resistance * params.breakoutThreshold && volume > params.volumeThreshold) {
                        console.log(`Breakout detected at ${close}. Moving to Breakout phase.`);
                        phase = "B";

                        const shares = Math.floor(capital / close);
                        position += shares;
                        capital -= shares * close;

                        trades.push({
                            action: "BUY",
                            price: close,
                            timestamp: point.timestamp,
                        });

                        console.log(`Bought ${shares} shares at ${close}. Capital: ${capital}`);
                    }
                }
                break;

            case "B": // Breakout
                console.log("In Breakout phase. Monitoring stop loss and take profit...");
                if (close < support * params.stopLoss) {
                    console.log(`Stop loss triggered at ${close}. Selling position and moving to Consolidation.`);
                    phase = "C";

                    const sellValue = position * close;
                    capital += sellValue;

                    const profitOrLoss = sellValue - trades[trades.length - 1].price * position;
                    if (profitOrLoss > 0) {
                        totalProfit += profitOrLoss;
                        wins++;
                        console.log(`Profit: $${profitOrLoss.toFixed(2)}`);
                    } else {
                        totalLoss += Math.abs(profitOrLoss);
                        losses++;
                        console.log(`Loss: $${Math.abs(profitOrLoss).toFixed(2)}`);
                    }

                    trades.push({
                        action: "SELL",
                        price: close,
                        timestamp: point.timestamp,
                        profitOrLoss,
                    });

                    position = 0;
                } else if (close > resistance * params.takeProfit) {
                    console.log(`Take profit triggered at ${close}. Selling position and moving to Consolidation.`);
                    phase = "C";

                    const sellValue = position * close;
                    capital += sellValue;

                    const profitOrLoss = sellValue - trades[trades.length - 1].price * position;
                    totalProfit += profitOrLoss;
                    wins++;
                    console.log(`Profit: $${profitOrLoss.toFixed(2)}`);

                    trades.push({
                        action: "SELL",
                        price: close,
                        timestamp: point.timestamp,
                        profitOrLoss,
                    });

                    position = 0;
                }
                break;

            case "C": // Consolidation
                console.log("In Consolidation phase. Monitoring for re-entry or exit...");
                if (close > resistance) {
                    console.log("Price broke resistance. Moving back to Breakout phase.");
                    phase = "B";
                } else if (close < support * params.stopLoss) {
                    console.log("Price fell below support. Moving to Distribution phase.");
                    phase = "D";
                }
                break;

            case "D": // Distribution
                console.log("In Distribution phase. No actions for now.");
                break;
        }

        // Track max drawdown
        peakCapital = Math.max(peakCapital, capital);
        drawdown = Math.max(drawdown, (peakCapital - capital) / peakCapital);

        console.log(`Capital: $${capital.toFixed(2)}, Drawdown: ${(drawdown * 100).toFixed(2)}%`);
    });

    // Final results
    if (position > 0) {
        const finalSell = position * data[data.length - 1].close;
        capital += finalSell;

        const profitOrLoss = finalSell - trades[trades.length - 1].price * position;
        if (profitOrLoss > 0) {
            totalProfit += profitOrLoss;
            wins++;
        } else {
            totalLoss += Math.abs(profitOrLoss);
            losses++;
        }

        trades.push({
            action: "SELL",
            price: data[data.length - 1].close,
            timestamp: data[data.length - 1].timestamp,
            profitOrLoss,
        });

        position = 0;
    }

    const netProfit = capital - 10000;
    const profitFactor = totalProfit / (totalLoss || 1);
    const winRate = (wins / (wins + losses || 1)) * 100;

    return {
        finalCapital: capital,
        netProfit,
        drawdown,
        profitFactor,
        winRate,
        trades,
    };
}

// Generate report
function generateReport(results, ticker) {
    console.log(`${ticker} Backtest Report:`);
    console.log(`Final Capital: $${results.finalCapital.toFixed(2)}`);
    console.log(`Net Profit: $${results.netProfit.toFixed(2)}`);
    console.log(`Max Drawdown: ${(results.drawdown * 100).toFixed(2)}%`);
    console.log(`Profit Factor: ${results.profitFactor.toFixed(2)}`);
    console.log(`Win Rate: ${results.winRate.toFixed(2)}%`);
    console.log("\nTrades:");
    results.trades.forEach((trade) => {
        console.log(
            `${trade.action} at $${trade?.price?.toFixed(2)} on ${new Date(
                trade.timestamp * 1000
            ).toLocaleTimeString()} ${
                trade.profitOrLoss !== undefined
                    ? `| Profit/Loss: $${trade.profitOrLoss.toFixed(2)}`
                    : ""
            }`
        );
    });
}

// Main function
async function main() {
    // const tickers = ["AAPL","DXYZ", "TSLA"];
    const tickers = ["DXYZ"];
    const historyInDays = 1;
    const params = [
        {
        breakoutThreshold: 1.002, // 0.2% breakout
        volumeThreshold: 1000,  // Minimum volume for breakout
        stabilizationPeriod: 1, // Stabilization period in iterations
        takeProfit: 1.003,       // 10% profit target
        stopLoss: 0.97         // 10% stop loss
        },
        {
            breakoutThreshold: 1.01, // 1% breakout
            volumeThreshold: 700,
            stabilizationPeriod: 2,
            takeProfit: 1.02,
            stopLoss: 0.95
        }
    ];
    for (const ticker of tickers){
        let data = await fetchHistoricalData(ticker, historyInDays);
        for (const param of params){
            if (data.length === 0) {
                console.log("No data retrieved. Exiting...");
                return;
            }

            let results = backtestStrategy(data, param);
            generateReport(results, ticker);
        }
    }
}

main();
