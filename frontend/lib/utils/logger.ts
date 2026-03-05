/**
 * Logger helper.
 * Em desenvolvimento: loga no console.
 * Em produção: logger.error() envia para o Sentry; demais são no-ops.
 */

const isDev = process.env.NODE_ENV === 'development';

function captureToSentry(args: any[]) {
  // Import dinâmico evita problemas em dev onde o Sentry não está inicializado
  import('@sentry/nextjs').then((Sentry) => {
    const error = args.find((a) => a instanceof Error);
    if (error) {
      Sentry.captureException(error);
    } else {
      Sentry.captureMessage(args.map(String).join(' '), 'error');
    }
  }).catch(() => {/* noop */});
}

export const logger = {
  error: (...args: any[]) => {
    if (isDev) {
      console.error(...args);
    } else {
      captureToSentry(args);
    }
  },
  warn: (...args: any[]) => {
    if (isDev) {
      console.warn(...args);
    }
  },
  log: (...args: any[]) => {
    if (isDev) {
      console.log(...args);
    }
  },
  info: (...args: any[]) => {
    if (isDev) {
      console.info(...args);
    }
  },
  debug: (...args: any[]) => {
    if (isDev) {
      console.debug(...args);
    }
  },
};
