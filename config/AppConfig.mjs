// modified paramters for Trend Momentum Breakout Strategy
export default function appConfig() {
    return {
        "app": {
            "tragingHours" : {"alwaysOpen" : false},
            "disableTrading": false,
            "DEBUG": true
        },
        "stockSelector": {
            "maxNumberOfStocks": 0, // was 10
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
        strategies: {
            TrendMomentumBreakoutStrategy: {
                emaShortPeriod: 9, // used in CMF
                emaLongPeriod: 21, // used in CMF
                rsiPeriod: 7,   // not used
                cmfRsiPeriod: 30,   // used in CMF
                bollingerRSIPeriod: 10,
                keltnerAtrPeriod: 30,
                stopLossAndTakeProfitAtrLength: 30, // 5 minutes (30 * 10s) otherwise it decreases the stop loss and take profit
                rvolThreshold: 1.2, // Minimum RVOL for a valid signal
                rvolHighIndicator: 2.0, // indicator for larger take profit percentage

                macdFastPeriod: 5,
                macdSlowPeriod: 15,
                macdSignalPeriod: 3,
                minSamplesForMACD: 18, //   macdSlowPeriod + macdSignalPeriod

                keltnerMultiplier: 1.5,
                cmfPeriod: 30,

                takeProfitMultiplier: 1.45, // ATR multiplier for take-profit - WAS 1.5.
                stopLossMultiplier: 0.75, // ATR multiplier for stop-loss
                takeProfitMaxPrecent: 1.5, // maximum percent of take profit (1.5%)
                takeProfitMaxPrecentForHighRVOL: 2, // maximum percent of take profit when rvol>2 (2%)
                stopLossMaxPercent: 1.5, // maximum percent of stop loss (1.5%)
                stopLossMinPercent: 0.6, // maximum percent of stop loss (0.6%)

                lowRsiBearishThreshold: 30, // for short term; long term is 45
                lowRsiBulishThreshold: 30, // for short term; long term is 60
                highRsiBulishThreshold: 65, // for short term; long term is 60

                numOfGrennCandlesInARawThreshold: 2, // number of green candles in a row to signal a bullish trend in heikin ashi
                heikinAshiAggregatedCandles: 3, // number of candles to aggregate in heikin ashi. i.e 3 means each candle is 3 * candleInterval
            },
            TrendMomentumBreakoutStrategySLAdjust: {
                stopLossMultiplier: 1,// ATR multiplier for stop-loss higher than normal
                stopLossMaxPercent: 0.01175 // maximum percent of stop loss (1.75%)
            }
        },
        dataSource: {
            "fetchInterval": 1000, // was 5000
            "testFetchInterval": 5000,
            "tradingProvider": "alpaca",
            "marketDataProvider": "ibkr",
            "marketDataProvider1": "yahoo",
            "marketDataProvider2": "alpacaStream",
            "marketDataProvider3": "backtesting",
            "google_sheets" : {
                "maxSymbols": 50, // was 25
                "url": "https://docs.google.com/spreadsheets/d/e/2PACX-1vRlm2IYtjYD783Gab4dWTRoerfrdMHrdRASxKT6nM9-oUThj57bPgSZyXNGCcL7KJol9LvxeYSJ0SrC/pub?output=csv"
            },
            "yahoo": {
                "takeProfitMultipler": 1.45
            },
            ibkr: {
                "candleInterval": 10000,//was 10000
                "maxSamples": 120, // 20 minutes (120 * 10s)
                "minSamples": 45,   // 7.5 minutes (45 * 10s)
                "takeProfitMultipler": 1.45,
                "account": "DUE737784",
                "liveAccount": "",
                "portalGwBaseUrl": "http://127.0.0.1:5001/v1/iserver"
            }
        }
    };
}