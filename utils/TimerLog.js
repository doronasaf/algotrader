const getEntityLogger = require('./logger/loggerManager');
const appLogger = getEntityLogger('app');
const appConfig = require('../config/config.json');


class TimerLog {
    constructor() {
        this.startTime = null;
        this.endTime = null;
        this.elapsedTime = null;
        this.logMessage = '';
    }

    /**
     * Starts the timer.
     * @param {string} message - A message to log at the start of the timer.
     */
    start(message = 'Execution started') {
        if (appConfig.app.DEBUG) {
            this.startTime = process.hrtime();
            this.logMessage = message;
            appLogger.info(`[START] ${message}`);
        }
    }

    /**
     * Stops the timer and calculates the elapsed time.
     * @param {string} message - A message to log at the end of the timer.
     */
    stop(message = 'Execution finished') {
        if (appConfig.app.DEBUG) {
            if (!this.startTime) {
                appLogger.info('[ERROR] Timer has not been started.');
                return;
            }
            this.endTime = process.hrtime(this.startTime);
            this.elapsedTime = this.endTime[0] * 1000 + this.endTime[1] / 1e6; // Convert to milliseconds
            appLogger.info(`[STOP] ${message}`);
            appLogger.info(`[TIME ELAPSED] ${this.elapsedTime.toFixed(3)} ms`);
        }
    }

    /**
     * Executes a given function while measuring its runtime.
     * @param {Function} func - The function to measure.
     * @param {string} [message] - A message to log.
     * @returns {any} The return value of the executed function.
     */
    async timeFunction(func, message = 'Function execution') {
        this.start(message);
        const result = await func();
        this.stop(message);
        return result;
    }
}

module.exports = {
    TimerLog
}
