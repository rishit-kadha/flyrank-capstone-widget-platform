export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    Object.assign(this, { status, code, details });
  }
}
export const notFound = () => new AppError(404, 'not_found', 'Resource not found');

export function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  if (error.type === 'entity.too.large') return res.status(413).json({ error: { code: 'payload_too_large', message: 'Request body exceeds 16 KB' } });
  if (error.type === 'entity.parse.failed') return res.status(400).json({ error: { code: 'invalid_json', message: 'Malformed JSON body' } });
  if (['charset.unsupported', 'encoding.unsupported'].includes(error.type)) return res.status(415).json({ error: { code: 'unsupported_media_type', message: 'Use UTF-8 JSON with a supported content encoding' } });
  if (['request.aborted', 'request.size.invalid'].includes(error.type)) return res.status(400).json({ error: { code: 'invalid_body', message: 'Incomplete or invalid request body' } });
  if (error instanceof AppError) return res.status(error.status).json({ error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) } });
  console.error(JSON.stringify({ event: 'request_error', code: error.code || 'internal_error' }));
  return res.status(500).json({ error: { code: 'internal_error', message: 'Unexpected server error' } });
}
