import axios from "axios";

export async function fetchCSV(url) {
    try {
        const response = await axios.get(url);
        const rows = response.data.split("\n").map((row) => row.split(","));
        const rowsWOHeaders = rows.slice(1);
        return rowsWOHeaders.map((row) => {
            let symbol = row[0].trim();
            let source = "Google_Sheet";
            return { symbol, source };
        });
    } catch (error) {
        console.error("Error fetching CSV:", error.message);
        return [];
    }
}

// Example usage
// create IFEE to fetch CSV
// (async () => {
//     const rows = await fetchCSV("https://docs.google.com/spreadsheets/d/e/2PACX-1vRlm2IYtjYD783Gab4dWTRoerfrdMHrdRASxKT6nM9-oUThj57bPgSZyXNGCcL7KJol9LvxeYSJ0SrC/pub?output=csv");
//     console.log(JSON.stringify(rows));
// })()

