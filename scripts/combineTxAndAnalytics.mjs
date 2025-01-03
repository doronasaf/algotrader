import fs from 'fs';
import { parse } from 'json2csv';

/**
 * Reads a JSON lines file and creates a map of logId to the corresponding log object.
 *
 * @param {string} filePath - Path to the JSON lines file.
 * @returns {Map} - Map of logId to log object.
 */
function createLogIdMap(filePath) {
    try {
        const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(line => line.trim() !== '');
        const map = new Map();
        lines.forEach(line => {
            let log;
            try {
                log = JSON.parse(line);
                if (log.logId) {
                    map.set(log.logId, log);
                }
            } catch (error) {
                console.error(`Error parsing JSON line: ${error.message}`);
            }
        });
        return map;
    } catch (error) {
        console.error(`Error creating map for file (${filePath}): ${error.message}`);
        return new Map();
    }
}

/**
 * Combines transactions and analytics logs based on logId.
 *
 * @param {Map} transactionsMap - Map of logId to transaction object.
 * @param {Map} analyticsMap - Map of logId to analytics object.
 * @returns {Array} - Array of combined transaction-analytics objects.
 */
function combineLogs(transactionsMap, analyticsMap) {
    const combinedLogs = [];
    for (const [logId, transaction] of transactionsMap.entries()) {
        const matchingAnalytics = analyticsMap.get(logId) || null; // Find matching analytics or null
        combinedLogs.push({
            ...transaction,
            analytics: matchingAnalytics, // Add matching analytics or null
        });
    }
    return combinedLogs;
}

/**
 * Converts combined logs to a CSV file.
 *
 * @param {Array} combinedLogs - Array of combined transaction-analytics objects.
 * @param {string} outputCsvFile - Path to the output CSV file.
 */
function combinedLogsToCSV(combinedLogs, outputCsvFile) {
    try {
        // Flatten the combined logs to a CSV-friendly format
        const flattenedLogs = combinedLogs.map((log) => ({
            ...log,
            ...log.analytics, // Spread analytics fields into the top-level object
            analytics: undefined, // Remove nested analytics object to avoid duplication
        }));

        if (flattenedLogs.length > 0) {
            const csv = parse(flattenedLogs);
            fs.writeFileSync(outputCsvFile, csv);
            console.log(`CSV file created successfully: ${outputCsvFile}`);
        } else {
            console.error('No combined logs to convert to CSV.');
        }
    } catch (error) {
        console.error(`Error converting logs to CSV: ${error.message}`);
    }
}

/**
 * Main function to process logs, combine them, and convert them to CSV.
 */
export function processAndCombineLogsToCSV() {
    const today = new Date();
    const todayStr = `${today.getDate()}_${today.getMonth() + 1}_${today.getFullYear()}`;

    // File paths
    const txFilePath = `/Users/asafdoron/Documents/dev/algotrader/logs/transactions_${todayStr}.log`;
    const analyticsFilePath = `/Users/asafdoron/Documents/dev/algotrader/logs/analytics_${todayStr}.log`;
    const combinedOutputCsvFile = `/Users/asafdoron/Documents/dev/algotrader/logs/combined_${todayStr}.csv`;

    try {
        // Create maps for transactions and analytics logs
        const transactionsMap = createLogIdMap(txFilePath);
        const analyticsMap = createLogIdMap(analyticsFilePath);

        // Combine logs
        const combinedLogs = combineLogs(transactionsMap, analyticsMap);

        // Save combined logs to a CSV file
        combinedLogsToCSV(combinedLogs, combinedOutputCsvFile);

        console.log('Processing and combination complete.');
        return combinedOutputCsvFile;
    } catch (error) {
        console.error(`Error processing logs: ${error.message}`);
        return null;
    }
}
// Example usage
// processAndCombineLogsToCSV();
