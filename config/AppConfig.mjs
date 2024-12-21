import {TrendMomentumBreakoutStrategy} from "../strategies/TrendMomentumBreakoutStrategy.mjs";

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
            "budget": 42000,
            "singleTradeCapital": 1000,
            "takeProfit": 1.006,
            "stopLoss": 0.99
        },
        strategies: {
            TrendMomentumBreakoutStrategy: {
                emaShortPeriod: 9,
                emaLongPeriod: 21,
                rsiPeriod: 14,
                supertrentAtrPeriod: 30,
                KeltnerAtrPeriod: 30,
                profitLossAtrPeriod: 30,
                vwapPeriod: 1, // Daily VWAP
                rvolThreshold: 1.5, // Minimum RVOL for a valid signal

                macdFastPeriod: 18,
                macdSlowPeriod: 30,
                macdSignalPeriod: 9,
                minSamplesForMACD: 39, //   macdSlowPeriod + macdSignalPeriod

                keltnerMultiplier: 1.5,
                supertrendMultiplier: 3,
                cmfPeriod: 20,

                takeProfitMultiplier: 1.45, // ATR multiplier for take-profit - WAS 1.5.
                stopLossMultiplier: 0.75, // ATR multiplier for stop-loss
                takeProfitMaxPrecent: 0.04, // maximum percent of take profit (4%)
                stopLossMaxPercent: 0.03, // maximum percent of stop loss (3%)

                lowRsiBearishThreshold: 30, // for short term; long term is 45
                highRsiBulishThreshold: 45, // for short term; long term is 60
            }
        },
        "dataSource": {
            "fetchInterval": 1000, // was 5000
            "testFetchInterval": 5000,
            "provider": "ibkr",
            "provider1": "yahoo",
            "provider2": "alpacaStream",
            "provider3": "backtesting",
            "google_sheets" : {
                "maxSymbols": 40, // was 25
                "url": "https://docs.google.com/spreadsheets/d/e/2PACX-1vRlm2IYtjYD783Gab4dWTRoerfrdMHrdRASxKT6nM9-oUThj57bPgSZyXNGCcL7KJol9LvxeYSJ0SrC/pub?output=csv"
            },
            "yahoo": {
                "takeProfitMultipler": 1.45
            },
            "ibkr": {
                "candleInterval": 10000,//was 10000
                "maxSamples": 120, // 20 minutes (120 * 10s)
                "minSamples": 39,
                "takeProfitMultipler": 1.45,
            }
        }
    };
}