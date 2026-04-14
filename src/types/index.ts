export enum OccupationEnum {
  jurist = 'jurist',
  educator = 'educator',
  student = 'student',
  parent = 'parent',
  learner = 'learner',
}

export interface StandardResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export class NotFoundError extends Error {
  statusCode = 404;

  constructor(resource: string) {
    super(`${resource} not found`);
    this.name = 'NotFoundError';
  }
}

export class ValidationError extends Error {
  statusCode = 422;

  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}
