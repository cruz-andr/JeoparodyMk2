export function errorHandler(err, req, res, _next) {
  console.error('Error:', err);

  // Default error response
  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  res.status(statusCode).json({
    error: {
      message,
      code: err.code || 'INTERNAL_ERROR',
      /* Some refusals are more useful with the thing they refused over.
         A 409 on a stale board carries the board that is actually there, so
         the client can offer a choice without a second request at the moment
         the network is already misbehaving. */
      ...(err.details !== undefined && { details: err.details }),
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
    },
  });
}

export class AppError extends Error {
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}
