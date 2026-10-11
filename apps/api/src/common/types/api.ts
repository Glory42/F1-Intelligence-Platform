export type Bindings = {
  DATABASE_URL: string;
  R2_PUBLIC_URL?: string;
  ENVIRONMENT?: string;
};

export type ApiSuccess<T> = { data: T; error: null };

export type ApiError = { data: null; error: { code: string; message: string } };

export type ApiResponse<T> = ApiSuccess<T> | ApiError;
