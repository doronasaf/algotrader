const axios = require('axios');

const apiKey = 'ctb0tp9r01qgsps85v80ctb0tp9r01qgsps85v8g'; // Finnhub API key

// Function to fetch earnings data for a specific date
async function fetchEarnings(date) {
    const url = `https://finnhub.io/api/v1/calendar/earnings?from=${date}&to=${date}&token=${apiKey}`;

    try {
        const response = await axios.get(url);
        const earningsData = response.data;

        if (earningsData && earningsData.earningsCalendar && earningsData.earningsCalendar.length > 0) {
            console.log(`Earnings for ${date}:`);
            earningsData.earningsCalendar.forEach((item) => {
                console.log(`Symbol: ${item.symbol}, Company: ${item.name}, Time: ${item.time || 'N/A'}`);
            });
            return earningsData.earningsCalendar;
        } else {
            console.log(`No earnings data found for ${date}.`);
            return [];
        }
    } catch (error) {
        console.error(`Error fetching earnings data: ${error.message}`);
        return [];
    }
}

// Function to fetch sentiment for a given stock symbol
async function fetchSentiment(symbol) {
    const url = `https://finnhub.io/api/v1/news-sentiment?symbol=${symbol}&token=${apiKey}`;

    try {
        const response = await axios.get(url);
        const sentimentData = response.data;

        if (sentimentData) {
            console.log(`Sentiment for ${symbol}:`);
            console.log(`  Sentiment Score: ${sentimentData.sentiment}`);
            console.log(`  Buzz: ${sentimentData.buzz?.buzz || 'N/A'}`);
            console.log(`  News Score: ${sentimentData.sentimentScore || 'N/A'}`);
        }

        return sentimentData;
    } catch (error) {
        console.error(`Error fetching sentiment for ${symbol}: ${error.message}`);
        return null;
    }
}

// Function to fetch earnings and sentiment data
async function fetchEarningsAndSentiment(date) {
    const earnings = await fetchEarnings(date);

    for (const item of earnings) {
        const { symbol, name, time } = item;

        console.log(`\nAnalyzing ${symbol} (${name}) - Earnings Time: ${time}`);
        const sentiment = await fetchSentiment(symbol);

        // Combine earnings and sentiment analysis
        if (sentiment) {
            console.log(`  Combined Analysis for ${symbol}:`);
            console.log(`    Sentiment Score: ${sentiment.sentimentScore || 'N/A'}`);
            console.log(`    Buzz: ${sentiment.buzz?.buzz || 'N/A'}`);
            console.log(`    Articles Sentiment: ${sentiment.sentiment}`);
        }

        // Optional: Wait a bit between requests to avoid hitting rate limits
        await new Promise((resolve) => setTimeout(resolve, 1000));
    }
}

// Example usage
// const date = '2024-12-05'; // Replace with desired date (YYYY-MM-DD)
// implement ifee to run the function
// (async () => {
//     const date = '2024-12-09'; // Replace with desired date (YYYY-MM-DD)
//     await fetchEarnings(date);
// })();

module.exports = {
    fetchEarnings,
    fetchSentiment,
    fetchEarningsAndSentiment
}