import {getEntityLogger} from '../utils/logger/loggerManager.mjs';
import appConfig from '../config/AppConfig.mjs';
import {MarketAnalyzerFactory, TradingStrategy} from "../strategies/MarketAnalyzerFactory.mjs";
import {fetchMarketData, setBracketOrdersForBuy, monitorBracketOrder} from "../broker/MarketDataFetcher.mjs";
import {tradingConfig, isWithinTradingHours, timeUntilMarketClose} from "../utils/TradingHours.mjs";
import {TimerLog} from "../utils/TimerLog.mjs";
import {nyseTime} from "../utils/TimeFormatting.mjs";

const appConf = appConfig();
const transactionLog = getEntityLogger('transactions');
const appLog = getEntityLogger('appLog');

export const sentTransactions = []; // Array to store all transactions
export const tradeOrders = [];
const strategyTypes = Object.values(TradingStrategy);

export async function analyzeEnhancedStrategy (ticker, params, budgetManager, stopFlags) {
    let support = null;
    let resistance = null;
    let phase = "A"; // Start with Accumulation
    const regularInterval = appConf.app.disableTrading ? appConf.dataSource.testFetchInterval : appConf.dataSource.fetchInterval;
    const monitoringInterval = 60000; // 1 minute
    let timeoutInterval = regularInterval;
    const timerLog = new TimerLog();
    const analyzersList = [];
    let selectedAnalyzer;
    let accumulationAchieved, breakoutConfirmed = false, potentialGain, potentialLoss, orderResults;
    let budgetAllocationSucceeded = false;

    for (const session in tradingConfig) {
        if (session !== "market") continue;
        const tradingSession = tradingConfig[session];
        if (!tradingSession.enabled) continue;
        while (isWithinTradingHours(tradingSession)) {
            try {
                // **Check Stop Flag**
                if (stopFlags.get(ticker) && phase !== "E") {
                    appLog.info(`Worker for ${ticker} stopped by user, phase = ${phase}`);
                    return; // Exit gracefully
                }

                let { closes, highs, lows, volumes } = await fetchMarketData(ticker);
                if (!closes || !highs || !lows || !volumes || closes?.length < 20) {
                    // appLog.info(`Insufficient data for ${ticker}. Retrying...`);
                    await new Promise((resolve) => setTimeout(resolve, regularInterval));
                    continue;
                }

                let close = closes[closes.length - 1];
                const high = highs[highs.length - 1];
                const low = lows[lows.length - 1];
                if (analyzersList.length === 0) {
                    for (const strategy of strategyTypes) {
                        analyzersList.push({
                            analyzer: MarketAnalyzerFactory.createAnalyzer(strategy, ticker, {
                                closes,
                                highs,
                                lows,
                                volumes
                            }, support, resistance, params, appConf),
                            accCompleted: false
                        });
                    }
                }

                switch (phase) {
                    case "A": // Accumulation
                        if (!support || !resistance) {
                            support = low;
                            resistance = high;
                        } else {
                            if (high > resistance) resistance = high;
                            if (low < support) support = low;
                        }
                        for (const analyzerItem of analyzersList) {
                            selectedAnalyzer = analyzerItem.analyzer;
                            selectedAnalyzer.setSupportResistance(support, resistance);
                            selectedAnalyzer.setMarketData({ closes, highs, lows, volumes });
                            timerLog.start(`Ticker ${ticker} | Strategy: ${selectedAnalyzer.toString()} | Accumulation Phase (A)`);
                            accumulationAchieved = await selectedAnalyzer.evaluateAccumulation();
                            analyzerItem.accCompleted = accumulationAchieved;
                            timerLog.stop(`Ticker ${ticker} | Accumulation Phase (A)`);
                            if (accumulationAchieved) {
                                phase = "B";
                                appLog.info(`Ticker ${ticker} | Strategy: ${selectedAnalyzer.toString()} | Moved to Breakout Phase (B)`);
                            }
                        }
                        break;

                    case "B": // Breakout
                        for (const analyzerItem of analyzersList) {
                            selectedAnalyzer = analyzerItem.analyzer;
                            if (!analyzerItem.accCompleted) {
                                selectedAnalyzer.setSupportResistance(support, resistance);
                                selectedAnalyzer.setMarketData({ closes, highs, lows, volumes });
                                accumulationAchieved = await selectedAnalyzer.evaluateAccumulation();
                                analyzerItem.accCompleted = accumulationAchieved;
                            }
                            if (analyzerItem.accCompleted) {
                                selectedAnalyzer.setMarketData({ closes, highs, lows, volumes });
                                timerLog.start(`Ticker ${ticker} | Strategy: ${selectedAnalyzer.toString()} | Breakout Phase (B)`);
                                breakoutConfirmed = await selectedAnalyzer.evaluateBreakout();
                                timerLog.stop(`Ticker ${ticker} | Strategy: ${selectedAnalyzer.toString()} | Breakout Phase (B)`);
                                if (breakoutConfirmed === 1) {
                                    break;
                                }
                            }
                        }
                        if (breakoutConfirmed === 1) { // Buy opportunity
                            const { shares, takeProfit, stopLoss } = selectedAnalyzer.getMargins();
                            potentialLoss = (close - stopLoss) * shares;
                            potentialGain = (takeProfit - close) * shares;
                            if (potentialGain >= appConf.trading.minimumGain) {
                                budgetAllocationSucceeded = await budgetManager.allocateBudget(params.capital);
                                if (budgetAllocationSucceeded) {
                                    let budgetInfo = await budgetManager.getBudgetInfo();
                                    let trx = {
                                        ticker,
                                        source: params.source,
                                        action: "bracket",
                                        price: close,
                                        timestamp: nyseTime(),
                                        shares,
                                        takeProfit,
                                        stopLoss,
                                        potentialGain: potentialGain,
                                        potentialLoss: potentialLoss,
                                        budgetRemaining: budgetInfo.availableBudget,
                                        budgetAllocated: budgetInfo.allocatedBudget,
                                        status: "Live Buy",
                                        strategy: selectedAnalyzer.toString()
                                    };
                                    if (appConf.app.disableTrading === true) {
                                        appLog.info(`Ticker ${ticker} | In demo mode. Skipping order placement.`);
                                        trx.status = "Demo Buy";
                                        phase = "C";
                                    } else {
                                        orderResults = await setBracketOrdersForBuy(ticker, shares, close, takeProfit, stopLoss);
                                        trx.orderResults = orderResults;
                                        params.tradeTime = Date.now();
                                        timeoutInterval = monitoringInterval;
                                        phase = "E"; // Move to Execution Monitoring
                                    }
                                    await writeToLog(ticker, orderResults, tradeOrders, sentTransactions, trx);
                                } else {
                                    let {availableBudget, allocatedBudget} = await budgetManager.getBudgetInfo();
                                    appLog.info(`Ticker ${ticker} | Strategy: ${selectedAnalyzer.toString()} | Source: ${params.source} | Required Budget: ${params.capital} | Allocated Budget: ${allocatedBudget} | Remaining Budget: ${availableBudget} | Status: Budget Insufficient. Quit buying`);
                                }
                            } else {
                                appLog.info(`Ticker ${ticker} | Strategy: ${selectedAnalyzer.toString()} | Potential gain too low: ${potentialGain}`);
                                phase = "C"; // Skip execution monitoring
                            }
                        } else if (breakoutConfirmed === 0) {
                            phase = "B"; // Stay in Breakout phase
                        } else if (breakoutConfirmed === -1) {
                            phase = "A"; // Return to Accumulation phase
                        } else if (breakoutConfirmed === -2) {
                            appLog.info(`Ticker ${ticker} | Strategy: ${selectedAnalyzer.toString()} | Breakout phase failed with errors! check the app.log. Exiting strategy.`);
                            phase = "C"; // Exit the strategy
                        }
                        break;

                    case "C": // Cleanup
                        appLog.info(`Ticker ${ticker} | End of trading session`);
                        budgetManager.releaseBudget(params.capital);
                        return;

                    case "E": // Execution Monitoring
                        if (appConf.dataSource.tradingProvider === 'ibkr') {
                            if (orderResults?.parentOrder && orderResults?.takeProfitOrder && orderResults?.stopLossOrder) {
                                appLog.info(`Ticker ${ticker} | IBKR Orders: ${JSON.stringify(orderResults)}`);
                                const monitoringTime = timeUntilMarketClose();
                                const pollingInterval = 60000;
                                const executionResults = await monitorBracketOrder(orderResults.parentOrder.orderId, [orderResults.takeProfitOrder.orderId, orderResults.stopLossOrder.orderId], pollingInterval, monitoringTime);

                                if (executionResults?.parentOrder?.status === "Filled") {
                                    executionResults.parentOrder.name = "Parent Order";
                                    tradeOrders.push(executionResults.parentOrder);
                                    const takeProfitOrderResult = executionResults.childOrders.find(order => order.orderId === orderResults.takeProfitOrder.orderId);
                                    const stopLossOrderResult = executionResults.childOrders.find(order => order.orderId === orderResults.stopLossOrder.orderId);
                                    if (takeProfitOrderResult && takeProfitOrderResult.status === "Filled") {
                                        takeProfitOrderResult.name = "Take Profit Order";
                                        tradeOrders.push(takeProfitOrderResult);
                                        phase = "C";
                                    } else if (stopLossOrderResult && stopLossOrderResult.status === "Filled") {
                                        stopLossOrderResult.name = "Stop Loss Order";
                                        tradeOrders.push(stopLossOrderResult);
                                        phase = "C";
                                    } else {
                                        appLog.info(`Ticker ${ticker} | Bracket Order No Children Return Status: ${JSON.stringify(executionResults)}`);
                                        transactionLog.info(JSON.stringify(executionResults));
                                    }
                                }
                            }
                        } else if (appConf.dataSource.tradingProvider === 'alpaca'){
                            if (orderResults?.order?.order_class === "bracket") {
                                if (orderResults.orderStatus?.status === "filled") {
                                    appLog.info(`Ticker ${ticker} | Bracket Order Limit (Parent) Filled: ${JSON.stringify(orderResults.order)}`);
                                    if (orderResults.orderStatus?.legs) {
                                        const takeProfitOrder = orderResults.orderStatus.legs.find(leg => leg.type === "limit");
                                        const stopLossOrder = orderResults.orderStatus.legs.find(leg => leg.type === "stop");
                                        if (takeProfitOrder?.status === "filled") {
                                            appLog.info(`Ticker ${ticker} | Bracket Order Take Profit Filled: ${JSON.stringify(takeProfitOrder)}`);
                                            transactionLog.info(JSON.stringify(takeProfitOrder));
                                            timeoutInterval = regularInterval;
                                            phase = "C";
                                        }
                                        if (stopLossOrder?.status === "filled") {
                                            appLog.info(`Ticker ${ticker} | Bracket Order Stop Loss Filled: ${JSON.stringify(stopLossOrder)}`);
                                            transactionLog.info(JSON.stringify(stopLossOrder));
                                            timeoutInterval = regularInterval;
                                            phase = "C";
                                        }
                                    }
                                }
                            }
                        }
                        break;
                }

                await new Promise((resolve) => setTimeout(resolve, timeoutInterval));
            } catch (error) {
                appLog.error(`Error in strategy for ${ticker}: ${error.message}`);
                phase = "C"; // Exit strategy
            }
        }
    }
};

const writeToLog = async (ticker, orderResult, tradeOrders, sentTransactions, trx) => {
    if (appConf.app.disableTrading === false) { // Live Trading
        tradeOrders.push(orderResult.order);
        tradeOrders.push(orderResult.orderStatus);
    }
    sentTransactions.push(trx);
    transactionLog.info(JSON.stringify(trx));
}
