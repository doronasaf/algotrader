export default function appConfig() {
    return {
        "app": {
            "tragingHours" : {"alwaysOpen" : true},
            "disableTrading": true,
            "DEBUG": true
        },
        "stockSelector": {
            "maxNumberOfStocks": 10,
            "atrThreshold": 2.5,
            "chartHistoryInDays": 5
        },
        "trading": {
            "budget": 60000,
            "singleTradeCapital": 2000,
            "takeProfit": 1.006,
            "stopLoss": 0.99
        },
        "dataSource": {
            "fetchInterval": 5000,
            "testFetchInterval": 5000,
            "provider": "yahoo",
            "provider2": "alpacaStream",
            "provider3": "backtesting",
            "google_sheets" : {
                "url": "https://docs.google.com/spreadsheets/d/e/2PACX-1vRlm2IYtjYD783Gab4dWTRoerfrdMHrdRASxKT6nM9-oUThj57bPgSZyXNGCcL7KJol9LvxeYSJ0SrC/pub?output=csv"
            }
        }
    };
}