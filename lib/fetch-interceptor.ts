import type { Dispatcher } from 'undici-types';
import pino from 'pino';

const logger = pino(pino.destination({
  sync: true 
}));

export function createLoggingInterceptor(): (dispatch: Dispatcher['dispatch']) => Dispatcher['dispatch'] {
  return (dispatch: Dispatcher['dispatch']) => {
    return function loggingDispatch(opts, handler) {
      const startTime = Date.now();
      const requestId = Math.random().toString(36).substring(7);

      // Log the outgoing request
      logger.info({
        requestId,
        type: 'fetch-request',
        method: opts.method,
        url: opts.origin ? `${opts.origin}${opts.path}` : opts.path,
        headers: opts.headers,
        timestamp: new Date().toISOString(),
      }, 'Outgoing fetch request');

      // Create a custom handler that wraps the original handler
      const loggingHandler: Dispatcher.DispatchHandler = {
        onConnect(abort: () => void) {
          logger.debug({ requestId }, 'Connection established');
          if (handler.onConnect) {
            return handler.onConnect(abort);
          }
        },

        onError(error: Error) {
          const duration = Date.now() - startTime;
          logger.error({
            requestId,
            type: 'fetch-error',
            error: {
              message: error.message,
              name: error.name,
              stack: error.stack,
            },
            duration,
            timestamp: new Date().toISOString(),
          }, 'Fetch request failed');
          
          if (handler.onError) {
            return handler.onError(error);
          }
        },

        onHeaders(statusCode: number, headers: Buffer[], resume: () => void, statusText: string) {
          const duration = Date.now() - startTime;
          
          // Convert Buffer[] to string[] for logging
          const headerStrings = headers.map(h => h.toString());
          
          logger.info({
            requestId,
            type: 'fetch-response',
            statusCode,
            statusText,
            headers: parseHeadersArray(headerStrings),
            duration,
            timestamp: new Date().toISOString(),
          }, 'Fetch response received');

          if (handler.onHeaders) {
            return handler.onHeaders(statusCode, headers, resume, statusText);
          }
          return true;
        },

        onData(chunk: Buffer) {
          logger.debug({
            requestId,
            chunkSize: chunk.length,
          }, 'Response data chunk received');
          
          if (handler.onData) {
            return handler.onData(chunk);
          }
          return true;
        },

        onComplete(trailers: string[] | null) {
          const duration = Date.now() - startTime;
          logger.info({
            requestId,
            type: 'fetch-complete',
            duration,
            trailers: trailers ? parseHeadersArray(trailers) : undefined,
            timestamp: new Date().toISOString(),
          }, 'Fetch request completed');
          
          if (handler.onComplete) {
            return handler.onComplete(trailers);
          }
        },

        onBodySent(chunkSize: number, totalBytesSent: number) {
          if (handler.onBodySent) {
            return handler.onBodySent(chunkSize, totalBytesSent);
          }
        },
      };

      // Dispatch with the logging handler
      return dispatch(opts, loggingHandler);
    };
  };
}

/**
 * Helper function to parse headers array into an object
 */
function parseHeadersArray(headers: string[]): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};
  for (let i = 0; i < headers.length; i += 2) {
    const key = headers[i].toLowerCase();
    const value = headers[i + 1];
    
    if (result[key]) {
      if (Array.isArray(result[key])) {
        (result[key] as string[]).push(value);
      } else {
        result[key] = [result[key] as string, value];
      }
    } else {
      result[key] = value;
    }
  }
  return result;
}

export function setupFetchInterceptor() {
  try {
    // Access the global undici dispatcher symbol
    const globalDispatcherSymbol = Symbol.for('undici.globalDispatcher.1');
    
    // Type-safe access to global dispatcher
    interface GlobalWithDispatcher {
      [key: symbol]: Dispatcher | undefined;
    }
    
    const globalDispatcher = (globalThis as unknown as GlobalWithDispatcher)[globalDispatcherSymbol];

    if (!globalDispatcher) {
      logger.warn('Could not find global Undici dispatcher. Fetch interception may not work.');
      return;
    }

    // Compose the logging interceptor with the global dispatcher
    const interceptedDispatcher = globalDispatcher.compose(createLoggingInterceptor());
    
    // Override the global dispatcher
    (globalThis as unknown as GlobalWithDispatcher)[globalDispatcherSymbol] = interceptedDispatcher;

    logger.info('Fetch interceptor successfully installed');
  } catch (error) {
    logger.error({ error }, 'Failed to setup fetch interceptor');
  }
}
