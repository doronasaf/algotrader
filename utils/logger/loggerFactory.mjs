import { createLogger, format, transports } from 'winston';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const { combine, printf } = format;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default function createEntityLogger(entityName, PLAIN = false) {
    const now = new Date();
    const day = now.getDate();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();
    const logPath = path.resolve(__dirname, `../../logs/${entityName}_${day}_${month}_${year}.log`);

    return createLogger({
        level: 'info',
        format: combine(
            // Custom formatting to add timestamp and preserve PLAIN
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

                // Attach the PLAIN flag to the info object
                info.plain = PLAIN;
                return info;
            })(),
            // Log output format
            printf(({ level, message, timestamp, plain }) => {
                if (plain) {
                    return `${message}`;
                }
                return `${timestamp} [${level.toUpperCase()}]: ${message}`;
            })
        ),
        transports: [
            new transports.File({ filename: logPath }), // Log to a file specific to the entity
        ],
    });
}
