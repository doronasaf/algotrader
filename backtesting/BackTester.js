// // Example using a publicly available dataset from Kaggle
// // const datasetURL = 'https://www.kaggle.com/some-user/some-dataset.csv';
const datasetURL = '../dataset/360ONE_minute.csv';


const fs = require('fs');
const path = require('path');
const readline = require('readline');

class MarketDataReader {
    constructor(dataFilePath) {
        this.dataFilePath = dataFilePath;
        this.watermarkFilePath = path.join(__dirname, 'watermark.json');
    }

    loadWatermark() {
        if (fs.existsSync(this.watermarkFilePath)) {
            const data = fs.readFileSync(this.watermarkFilePath, 'utf-8');
            return JSON.parse(data).lastIndex || 0;
        }
        return 0; // Default to 0 if no watermark file exists
    }

    saveWatermark(index) {
        const data = { lastIndex: index };
        fs.writeFileSync(this.watermarkFilePath, JSON.stringify(data, null, 2));
    }

    async fetchMarketData(batchSize = 100) {
        const startIndex = this.loadWatermark(); // Load watermark at the beginning
        const fileStream = fs.createReadStream(this.dataFilePath);
        const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

        let isHeader = true;
        let currentIndex = 0;
        let records = [];

        for await (const line of rl) {
            if (isHeader) {
                isHeader = false; // Skip the header line
                continue;
            }

            if (currentIndex < startIndex) {
                currentIndex++; // Skip lines until the start index
                continue;
            }

            const [date, open, close, high, low, volume] = line.split(',');
            records.push({
                date,
                open: parseFloat(open),
                close: parseFloat(close),
                high: parseFloat(high),
                low: parseFloat(low),
                volume: parseInt(volume, 10),
            });

            if (records.length >= batchSize) {
                break;
            }

            currentIndex++;
        }

        this.saveWatermark(startIndex + records.length); // Save updated watermark
        return records;
    }
}

const fetchMarketDataFromBackTester = async (symbol) => {
    const dataFilePath = path.join(__dirname, datasetURL);
    const marketDataReader = new MarketDataReader(dataFilePath);
    return await marketDataReader.fetchMarketData();
}
// // Example usage
// (async () => {
//     const dataFilePath = path.join(__dirname, datasetURL);
//     const marketDataReader = new MarketDataReader(dataFilePath);
//
//     let recentData = await marketDataReader.fetchMarketData();
//     console.log(recentData);
//     recentData = await marketDataReader.fetchMarketData();
//     console.log(recentData);
//
// })();

// 2015-02-03 09:15:00