import { error as logError, warn as logWarn } from '../utils/log.js';

/**
 * Whether we are talking to real users. Anything that is not development or
 * test is treated as production, so an unset NODE_ENV on a deployed box gets
 * the safe behaviour rather than the chatty one. This is deliberately
 * stricter than config/database.js and middleware/auth.js, which only switch
 * on NODE_ENV === 'production': a wrong database path is obvious in seconds,
 * a leaked stack is not. The dev script sets NODE_ENV=development, and either
 * way the stack of every 5xx is on the stderr log line, so a developer who
 * runs `npm start` locally still has it in the terminal.
 */
export const isProduction = (env = process.env) =>
  env.NODE_ENV !== 'development' && env.NODE_ENV !== 'test';

/**
 * Turn an error into the status and body a client sees.
 *
 * Pure so the tests can check it directly. A 5xx that we did not write on
 * purpose (a SQLite error, a TypeError, anything that is not an AppError) is
 * reported in production as a generic message with no stack and no internal
 * detail: whatever it said was written for us, not for the user, and may name
 * a file, a table or a query. An AppError is ours by construction, whatever
 * its status: "Google sign-in is not configured" is a 503 written for the
 * person looking at the sign-in page, and it goes through unchanged. An error
 * that carries `expose: true` (the http-errors convention body-parser and
 * friends follow) is treated the same way.
 */
export function shapeError(err, env = process.env) {
  const status = err?.statusCode;
  const statusCode = Number.isInteger(status) && status >= 400 && status < 600 ? status : 500;
  const serverFault = statusCode >= 500;
  const production = isProduction(env);
  const deliberate = err instanceof AppError || err?.expose === true;
  const hide = serverFault && production && !deliberate;

  const body = {
    error: {
      message: hide
        ? 'Something went wrong on our side. Please try again.'
        : (err?.message || 'Internal Server Error'),
      code: hide ? 'INTERNAL_ERROR' : (err?.code || 'INTERNAL_ERROR'),
      /* Some refusals are more useful with the thing they refused over.
         A 409 on a stale board carries the board that is actually there, so
         the client can offer a choice without a second request at the moment
         the network is already misbehaving. Details on an accidental 5xx are
         dropped with the message: nobody chose what went into them. */
      ...(!hide && err?.details !== undefined && { details: err.details }),
      /* A stack is only useful on a fault, and only to us. A 4xx is a refusal
         we wrote on purpose; its stack is noise, and it made two refusals
         that must look identical (wrong password, unknown email) differ. */
      ...(serverFault && !production && err?.stack && { stack: err.stack }),
    },
  };

  return { statusCode, body };
}

export function errorHandler(err, req, res, next) {
  const { statusCode, body } = shapeError(err);

  const entry = {
    status: statusCode,
    code: err?.code || 'INTERNAL_ERROR',
    path: req?.originalUrl || req?.url,
    method: req?.method,
    msg: err?.message || 'Internal Server Error',
  };

  if (statusCode >= 500) {
    /* A 5xx is ours to fix, so it gets the stack. */
    logError(entry, err?.stack ? { stack: err.stack } : undefined);
  } else if (statusCode !== 404) {
    logWarn(entry);
  }

  /* Headers already gone: the response is out of our hands, and writing
     again would throw from inside the error handler. */
  if (res.headersSent) return next(err);

  res.status(statusCode).json(body);
}

export class AppError extends Error {
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}
