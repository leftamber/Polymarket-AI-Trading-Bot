import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';

// Define log format
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json()
);

// Define transports
const transports: any[] = [
  new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.printf(
        ({ timestamp, level, message, meta }) => {
          const metaString = meta && Object.keys(meta).length ? `\n${JSON.stringify(meta, null, 2)}` : '';
          return `${timestamp} [${level}] ${message}${metaString}`;
        }
      )
    ),
  }),
];

// Add daily rotate file if log directory is desired
if (process.env.LOG_TO_FILE === 'true') {
  transports.push(
    new DailyRotateFile({
      filename: 'logs/%DATE%-arb-ai-bot.log',
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: '20m',
      maxFiles: '14d',
      format: logFormat,
    })
  );
}

// Create logger
export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: logFormat,
  transports,
  exitOnError: false,
});

// Export a stream for morgan or similar if needed
export const stream = {
  write: (message: string) => {
    logger.info(message.trim());
  },
};