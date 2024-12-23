import fs from 'fs';
import path from 'path';
import { parse } from 'json2csv';

// Function to convert log file to CSV
function logToCSV(inputLogFile, outputCsvFile) {
    try {
        // Read the log file
        const logData = fs.readFileSync(inputLogFile, 'utf8');
        const lines = logData.split('\n').filter(line => line.trim() !== '');

        // Extract JSON objects and convert to CSV
        const records = lines.map(line => {
            const jsonPart = line.split('[INFO]:')[1]?.trim();
            if (!jsonPart) {
                console.error(`Invalid line skipped: ${line}`);
                return null;
            }
            try {
                return JSON.parse(jsonPart);
            } catch (err) {
                console.error(`Error parsing JSON: ${line}`);
                return null;
            }
        }).filter(record => record !== null); // Remove null entries

        // Convert JSON records to CSV
        if (records.length > 0) {
            const csv = parse(records);
            fs.writeFileSync(outputCsvFile, csv);
            console.log(`CSV file created successfully: ${outputCsvFile}`);
        } else {
            console.error('No valid JSON records found in the log file.');
        }
    } catch (error) {
        console.error(`Error processing log file: ${error.message}`);
    }
}

// Example usage
const fileName = 'transactions_23_12_2024.log';
const inputLogFile = `/Users/asafdoron/Documents/dev/algotrader/logs/${fileName}`; // Replace with your input file
const outputCsvFile = `/Users/asafdoron/Documents/dev/algotrader/logs/${fileName}_output.csv`; // Replace with your desired output file
logToCSV(inputLogFile, outputCsvFile);
