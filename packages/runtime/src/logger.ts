import { pino, type DestinationStream, type Logger } from 'pino';

export type { Logger };

/**
 * Field names that may hold personal data (section 11 of the build plan).
 * pino replaces their values with "[redacted]" before anything is written,
 * so a careless `log.info({ msg })` can never leak a phone number or a
 * sender's name into the logs. Extend this list when new fields appear.
 */
export const REDACTED_FIELDS = [
  'phone',
  'phoneNumber',
  'senderName',
  'senderPhone',
  'pushName',
  'participant',
  'password',
  'token',
  'authorization',
] as const;

/**
 * Creates the JSON logger for one service. Every line carries the service
 * name, so logs from all containers can be read together. Logs go to stdout
 * unless a destination is given (tests pass one to capture the output).
 */
export function createLogger(
  service: string,
  level: string = 'info',
  destination?: DestinationStream,
): Logger {
  const options = {
    level,
    base: { service },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: REDACTED_FIELDS.flatMap((field) => [field, `*.${field}`]),
      censor: '[redacted]',
    },
  };
  return destination ? pino(options, destination) : pino(options);
}
