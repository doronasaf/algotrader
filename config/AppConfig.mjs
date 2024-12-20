export default function appConfig() {
    return {
        "app": {
            "tragingHours" : {"alwaysOpen" : false},
            "disableTrading": false,
            "DEBUG": true
        },
        "stockSelector": {
            "maxNumberOfStocks": 10, // was 10
            "atrThreshold": 2.5,
            "chartHistoryInDays": 5
        },
        "trading": {
            "minimumGain" : 6, // minimum gain for trade 6$
            "budget": 40000,
            "singleTradeCapital": 2000,
            "takeProfit": 1.006,
            "stopLoss": 0.99
        },
        "dataSource": {
            "fetchInterval": 1000, // was 5000
            "testFetchInterval": 5000,
            "provider": "ibkr",
            "provider1": "yahoo",
            "provider2": "alpacaStream",
            "provider3": "backtesting",
            "google_sheets" : {
                "maxSymbols": 25, // was 25
                "url": "https://docs.google.com/spreadsheets/d/e/2PACX-1vRlm2IYtjYD783Gab4dWTRoerfrdMHrdRASxKT6nM9-oUThj57bPgSZyXNGCcL7KJol9LvxeYSJ0SrC/pub?output=csv"
            },
            "yahoo": {
                "takeProfitMultipler": 1.45
            },
            "ibkr": {
                "candleInterval": 10000,//was 10000
                "maxSamples": 30,
                "takeProfitMultipler": 1.45,
            }
        }
    };
}