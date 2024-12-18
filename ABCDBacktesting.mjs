import axios from "axios";
import fs from "fs";

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

// Backtest strategy
function backtestStrategy(data) {
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

    data.forEach((point, i) => {
        const { close, high, low, volume } = point;

        switch (phase) {
            case "A": // Accumulation
                if (support === null || low < support) support = low;
                if (resistance === null || high > resistance) resistance = high;

                if (close > resistance && volume > 1000) {
                    phase = "B"; // Move to Breakout
                    const shares = Math.floor(capital / close);
                    position += shares;
                    capital -= shares * close;
                    trades.push({
                        action: "BUY",
                        price: close,
                        timestamp: point.timestamp,
                    });
                }
                break;

            case "B": // Breakout
                if (close < support) {
                    phase = "C"; // Move to Consolidation
                }
                break;

            case "C": // Consolidation
                if (close < support) {
                    phase = "D"; // Move to Distribution
                    const sellValue = position * close;
                    capital += sellValue;

                    const profitOrLoss = sellValue - trades[trades.length - 1].price * position;
                    if (profitOrLoss > 0) {
                        totalProfit += profitOrLoss;
                        wins += 1;
                    } else {
                        totalLoss += Math.abs(profitOrLoss);
                        losses += 1;
                    }

                    trades.push({
                        action: "SELL",
                        price: close,
                        timestamp: point.timestamp,
                        profitOrLoss,
                    });

                    position = 0;
                } else if (close > resistance) {
                    phase = "B"; // Back to Breakout
                }
                break;

            case "D": // Distribution
                // No action for this simplified strategy
                break;
        }

        // Track max drawdown
        peakCapital = Math.max(peakCapital, capital);
        drawdown = Math.max(drawdown, (peakCapital - capital) / peakCapital);
    });

    // Final results
    if (position > 0) {
        const finalSell = position * data[data.length - 1].close;
        capital += finalSell;

        const profitOrLoss = finalSell - trades[trades.length - 1].price * position;
        if (profitOrLoss > 0) {
            totalProfit += profitOrLoss;
            wins += 1;
        } else {
            totalLoss += Math.abs(profitOrLoss);
            losses += 1;
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
function generateReport(results) {
    console.log("\nBacktest Report:");
    console.log(`Final Capital: $${results.finalCapital.toFixed(2)}`);
    console.log(`Net Profit: $${results.netProfit.toFixed(2)}`);
    console.log(`Max Drawdown: ${(results.drawdown * 100).toFixed(2)}%`);
    console.log(`Profit Factor: ${results.profitFactor.toFixed(2)}`);
    console.log(`Win Rate: ${results.winRate.toFixed(2)}%`);
    console.log("\nTrades:");
    results.trades.forEach((trade) => {
        console.log(
            `${trade.action} at $${trade.price.toFixed(2)} on ${new Date(
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
async function mainBacktestStrategy() {
    const ticker = "DIS";
    const historyInDays = 5; //
    const data = await fetchHistoricalData(ticker, historyInDays);

    if (data.length === 0) {
        console.log("No data retrieved. Exiting...");
        return;
    }

    const results = backtestStrategy(data);

    generateReport(results);

    // Optionally write results to a file
    fs.writeFileSync("backtest_results.json", JSON.stringify(results, null, 2));
}

mainBacktestStrategy();