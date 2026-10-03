export type ErrorCode =
  | 'INVALID_BOARD'
  | 'INVALID_SEQUENCE'
  | 'INVALID_PIECE'
  | 'INVALID_ROTATION'
  | 'INVALID_COLUMN'
  | 'OUT_OF_BOUNDS'
  | 'SPAWN_BLOCKED'
  | 'STALE_STEP'
  | 'GAME_NOT_FOUND'
  | 'STEP_NOT_FOUND'
  | 'SEQUENCE_EXHAUSTED'
  | 'BAD_REQUEST';

export class ApiError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
