import fs from 'fs';
import { parse } from 'json2csv';

// Function to convert log file to CSV
function logToCSV(inputLogFile, outputCsvFile) {
    try {
        // Read the log file
        const logData = fs.readFileSync(inputLogFile, 'utf8');
        const lines = logData.split('\n').filter(line => line.trim() !== '');

        // Extract JSON objects and convert to CSV
        const records = lines.map(line => {
            try {
                return JSON.parse(line);
            } catch (err) {
                console.error(`Error parsing JSON: ${err.message}`);
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

export function convertLogsToCSV() {


    let today = new Date();
    const todayStr = `${today.getDate()}_${today.getMonth()+1}_${today.getFullYear()}`;
    const performanceFileName = `performanceLog_${todayStr}.log`;
    const performanceFilePath = `/Users/asafdoron/Documents/dev/algotrader/logs/${performanceFileName}`; // Replace with your input file
    const performanceOutputCsvFile = `/Users/asafdoron/Documents/dev/algotrader/logs/${performanceFileName}_output.csv`; // Replace with your desired output file
    logToCSV(performanceFilePath, performanceOutputCsvFile);

    return { performanceLog: performanceOutputCsvFile };
}



// Example usage
// convertLogsToCSV()