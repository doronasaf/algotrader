const config = require("../config/config.json");
const axios = require("axios");

async function fetchCSV(url) {
    try {
        const response = await axios.get(url);
        const rows = response.data.split("\n").map((row) => row.split(","));
        const rowsWOHeaders = rows.slice(1);
        return rowsWOHeaders;
    } catch (error) {
        console.error("Error fetching CSV:", error.message);
        return [];
    }
}

// Example usage
// create IFEE to fetch CSV
// (async () => {
//     const rows = await fetchCSV("https://docs.google.com/spreadsheets/d/e/2PACX-1vRlm2IYtjYD783Gab4dWTRoerfrdMHrdRASxKT6nM9-oUThj57bPgSZyXNGCcL7KJol9LvxeYSJ0SrC/pub?output=csv");
//     const lll = rows?.slice(1).map((row) => {
//         if (row?.length === 2) {
//             return {symbol: row[0].trim(), strategy: row[1].trim()}
//         }
//     });
//     console.log(JSON.stringify(lll));
// })()

module.exports = {
    fetchCSV,
}
