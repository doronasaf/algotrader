import {TrendMomentumBreakoutStrategy} from "../strategies/TrendMomentumBreakoutStrategy.mjs";
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
                rsiPeriod: 7,   // used in CMF
                bollingerRSIPeriod: 10,
                KeltnerAtrPeriod: 30,
                rvolThreshold: 1.2, // Minimum RVOL for a valid signal

                macdFastPeriod: 5,
                macdSlowPeriod: 15,
                macdSignalPeriod: 3,
                minSamplesForMACD: 18, //   macdSlowPeriod + macdSignalPeriod

                keltnerMultiplier: 1.5,
                cmfPeriod: 20,

                takeProfitMultiplier: 1.45, // ATR multiplier for take-profit - WAS 1.5.
                stopLossMultiplier: 0.75, // ATR multiplier for stop-loss
                takeProfitMaxPrecent: 0.015, // maximum percent of take profit (1.5%)
                stopLossMaxPercent: 0.01125, // maximum percent of stop loss (1.25%) => 0.0175

                lowRsiBearishThreshold: 30, // for short term; long term is 45
                highRsiBulishThreshold: 50, // for short term; long term is 60
            },
            TrendMomentumBreakoutStrategySLAdjust: {
                stopLossMultiplier: 1,// ATR multiplier for stop-loss higher than normal
                stopLossMaxPercent: 0.01175 // maximum percent of stop loss (1.75%)
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
                "minSamples": 33,
                "takeProfitMultipler": 1.45,
            }
        }
    };
}