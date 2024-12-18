// const { createLogger, format, transports } = require('winston');
// const { combine, timestamp, printf } = format;
// const path = require('path');

import { createLogger, format, transports } from 'winston';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const { combine, printf } = format;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Create a function to generate a logger for an entity
export default function createEntityLogger(entityName) {
    const now = new Date();
    const day = now.getDate();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();
    const logPath = path.resolve(__dirname, `../../logs/${entityName}_${day}_${month}_${year}.log`);

    return createLogger({
        level: 'info',
        format: combine(
            format((info) => {
                const israelTimeFormatter = new Intl.DateTimeFormat('en-IL', {
                    timeZone: 'Asia/Jerusalem',
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                });
                const formattedTime = israelTimeFormatter.format(new Date());
                info.timestamp = formattedTime;
                return info;
            })(),
            printf(({ level, message, timestamp }) => {
                return `${timestamp} [${level.toUpperCase()}]: ${message}`;
            })
        ),
        transports: [
            new transports.File({ filename: logPath }), // Log to a file specific to the entity
        ],
    });
}
// module.exports = createEntityLogger;
