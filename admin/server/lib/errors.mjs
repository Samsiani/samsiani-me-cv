// Typed errors the API maps to status codes (admin-ops.md §4.7). Never carry stacks to clients.
export class AppError extends Error {
  constructor(status, code, message, details = {}) { super(message); this.name = 'AppError'; this.status = status; this.code = code; this.details = details; }
}
export class DraftRejectedError extends AppError {
  constructor(errors) { super(400, 'draft_rejected', 'The document is structurally invalid and was not saved.', { errors }); }
}
export class PreconditionError extends AppError {
  constructor(current) { super(412, 'precondition_failed', 'The draft changed since it was loaded.', { current: { rev: current.rev, etag: current.etag, savedAt: current.savedAt } }); }
}
export class NotInitialisedError extends AppError {
  constructor(what = 'data') { super(503, 'not_initialised', `The admin ${what} is not initialised; run the CLI init / set-password.`); }
}
export class DegradedError extends AppError {
  constructor(msg = 'The published document is unreadable.') { super(503, 'degraded', msg); }
}
export class NotFoundError extends AppError {
  constructor(what = 'resource') { super(404, 'not_found', `Unknown ${what}.`); }
}
