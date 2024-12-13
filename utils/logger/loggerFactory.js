// const { createLogger, format, transports } = require('winston');
// const { combine, timestamp, printf } = format;
// const path = require('path');
//
// // Create a function to generate a logger for an entity
// const createEntityLogger = (entityName) => {
//     const logPath = path.resolve(__dirname, `../../logs/${entityName}.log`);
//
//     return createLogger({
//         level: 'info',
//         format: combine(
//             timestamp(),
//             printf(({ level, message, timestamp }) => {
//                 return `${timestamp} [${level.toUpperCase()}]: ${message}`;
//             })
//         ),
//         transports: [
//             new transports.File({ filename: logPath }), // Log to a file specific to the entity
//         ],
//     });
// };
//
// module.exports = createEntityLogger;

const { createLogger, format, transports } = require('winston');
const { combine, printf } = format;
const path = require('path');

// Create a function to generate a logger for an entity
const createEntityLogger = (entityName) => {
    const logPath = path.resolve(__dirname, `../../logs/${entityName}.log`);

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
};

module.exports = createEntityLogger;
