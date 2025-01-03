import createEntityLogger from './loggerFactory.mjs';

const loggerCache = {};

// Get or create a logger for the given entity
export function getEntityLogger(entityName, PLAIN = false) {
    const cacheKey = `${entityName}_${PLAIN}`;
    if (!loggerCache[cacheKey]) {
        loggerCache[cacheKey] = createEntityLogger(entityName, PLAIN);
    }
    return loggerCache[cacheKey];
}
