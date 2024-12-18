import createEntityLogger from './loggerFactory.mjs';

const loggerCache = {};

// Get or create a logger for the given entity
export function getEntityLogger (entityName)  {
    if (!loggerCache[entityName]) {
        loggerCache[entityName] = createEntityLogger(entityName);
    }
    return loggerCache[entityName];
}

// module.exports = getEntityLogger;
