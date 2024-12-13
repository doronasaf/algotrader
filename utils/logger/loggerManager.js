const createEntityLogger = require('./loggerFactory');

const loggerCache = {};

// Get or create a logger for the given entity
const getEntityLogger = (entityName) => {
    if (!loggerCache[entityName]) {
        loggerCache[entityName] = createEntityLogger(entityName);
    }
    return loggerCache[entityName];
};

module.exports = getEntityLogger;
