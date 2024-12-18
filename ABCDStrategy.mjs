import axios from "axios";

// Define market hours (Eastern Time for NYSE)
const tradingConfig = {
    premarket: { enabled: true, startTime: "09:00", endTime: "14:30" }, // UTC equivalent of 4:00 AM to 9:30 AM ET
    market: { enabled: true, startTime: "14:30", endTime: "21:00" }, // UTC equivalent of 9:30 AM to 4:00 PM ET
    afterHours: { enabled: true, startTime: "21:00", endTime: "01:00" }, // UTC equivalent of 4:00 PM to 8:00 PM ET
};

// Function to check if the current time is within trading hours
function isWithinTradingHours(config) {
    const now = new Date();
    const utcHour = now.getUTCHours();
    const utcMinute = now.getUTCMinutes();
    const currentTime = utcHour * 60 + utcMinute;

    const [startHour, startMinute] = config.startTime.split(":").map(Number);
    const [endHour, endMinute] = config.endTime.split(":").map(Number);

    const startTime = startHour * 60 + startMinute;
    const endTime = endHour * 60 + endMinute;

    return currentTime >= startTime && currentTime <= endTime;
}

// Fetch real-time quote
async function fetchRealTimeData(ticker) {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1m&range=1d`;

    try {
        const response = await axios.get(url);
        const { chart } = response.data;

        const timestamps = chart.result[0].timestamp;
        const prices = chart.result[0].indicators.quote[0];

        // Return the most recent data point
        let lastIndex = 0;
        for (let i = timestamps.length-1; i > 0; i--) {
            if (timestamps[i] && prices.high[i] && prices.low[i] && prices.close[i] && prices.volume[i]) {
                lastIndex = i;
                break;
            }
        }


        return {
            timestamp: timestamps[lastIndex],
            high: prices.high[lastIndex],
            low: prices.low[lastIndex],
            close: prices.close[lastIndex],
            volume: prices.volume[lastIndex],
        };
    } catch (error) {
        console.error("Error fetching real-time data:", error.message);
        return null;
    }
}

// Real-time A, B, C, D strategy implementation
async function analyzeRealTime(ticker, params) {
    let support = null;
    let resistance = null;
    let phase = "A"; // Start with Accumulation
    let capital = 10000; // Initial capital
    let position = 0; // Number of shares held
    let stabilizationCounterResistance = 0;
    let stabilizationCounterSupport = 0;

    const trades = [];

    for (const session in tradingConfig) {
        const config = tradingConfig[session];
        if (!config.enabled) continue;

        console.log(`Checking trading window for ${session}...`);
        while (isWithinTradingHours(config)) {
            console.log(`Starting real-time analysis for ${ticker}...`);
            const point = await fetchRealTimeData(ticker);
            if (!point) {
                console.log("Failed to fetch data. Retrying...");
                await new Promise((resolve) => setTimeout(resolve, 1000));
                continue;
            }

            const {close, high, low, volume} = point;
            const time = new Date(point.timestamp * 1000).toLocaleTimeString();

            console.log(`Ticker ${ticker} | Time: ${time}   | Close: ${close}, High: ${high}, Low: ${low}, Volume: ${volume}`);
            console.log(`Ticker ${ticker} | Phase: ${phase} | Support: ${support}, Resistance: ${resistance}`);

            switch (phase) {
                case "A": // Accumulation
                    if (support === null || resistance === null) {
                        support = low;
                        resistance = high;
                        console.log(`Initialized support to ${support} and resistance to ${resistance}`);
                    } else {
                        if (high > resistance && stabilizationCounterResistance <= params.stabilizationPeriod) {
                            resistance = high;
                            stabilizationCounterResistance = 0; // Reset resistance stabilization counter
                            console.log(`Resistance updated to ${resistance} (price still rising)`);
                        } else {
                            if (volume >= 0) {
                                stabilizationCounterResistance++;
                                console.log(`Resistance stabilization counter incremented to ${stabilizationCounterResistance}`);
                            }
                        }

                        if (low < support && stabilizationCounterSupport <= params.stabilizationPeriod) {
                            support = low;
                            stabilizationCounterSupport = 0; // Reset support stabilization counter
                            resistance = null; // Reset resistance because price is declining
                            console.log(`Support updated to ${support} (price still falling), reset Resistance as well`);
                        } else {
                            if (volume >= 0) {
                                stabilizationCounterSupport++;
                                console.log(`Support stabilization counter incremented to ${stabilizationCounterSupport}`);
                            }
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
                        phase = "D";

                        const sellValue = position * close;
                        capital += sellValue;

                        trades.push({
                            action: "SELL",
                            price: close,
                            timestamp: point.timestamp,
                        });
                        position = 0;
                        console.log(`StopLoss: Sold ${position} shares at ${close}. Capital: ${capital}`);
                    } else if (close > resistance * params.takeProfit) {
                        console.log(`Take profit triggered at ${close}. Selling position and moving to Consolidation.`);
                        phase = "A";

                        const sellValue = position * close;
                        capital += sellValue;

                        trades.push({
                            action: "SELL",
                            price: close,
                            timestamp: point.timestamp,
                        });
                        console.log(`TakeProfit: Sold ${position} shares at ${close}. Capital: ${capital}`);
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

            await new Promise((resolve) => setTimeout(resolve, 1000)); // Wait 1 second before fetching new data
            console.clear();
        }
    }
}

// Main function
async function main() {
    const ticker = "DXYZ"; // Replace with your desired ticker symbol
    const params = {
        breakoutThreshold: 1.002, // 0.2% breakout
        volumeThreshold: 1000,  // Minimum volume for breakout
        stabilizationPeriod: 20, // Stabilization period in iterations
        takeProfit: 1.006,       // 0.4% profit target (take profit - breakout price)
        stopLoss: 0.99,         // 1% stop loss
    };

    while (true) {
        // console.table(
        //     [{a:1,b:2,c:3},{a:4,b:5,c:6},{a:7,b:8,c:9}]
        // );
        // Run the trading strategy
        await analyzeRealTime(ticker, params);
        // sleep for 5 minutes before restarting
        await new Promise((resolve) => setTimeout(resolve, 5 * 60 * 1000));


    }
}

main();
