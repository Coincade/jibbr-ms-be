// User types
export interface User {
  id: string;
  email: string;
  username: string;
  createdAt: Date;
  updatedAt: Date;
}

// Auth types
export interface JWTPayload {
  id: string;
  name: string | null;
  email: string;
  iat?: number;
  exp?: number;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  username: string;
}

// File types
export interface FileMetadata {
  id: string;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  url: string;
  uploadedBy: string;
  createdAt: Date;
}

// Message types
export interface Message {
  id: string;
  content: string;
  senderId: string;
  channelId?: string;
  conversationId?: string;
  attachments?: FileMetadata[];
  createdAt: Date;
  updatedAt: Date;
}

// API Response types
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

// Service URLs (for inter-service communication)
export const SERVICE_URLS = {
  AUTH: process.env.AUTH_SERVICE_URL || 'http://localhost:3001',
  UPLOAD: process.env.UPLOAD_SERVICE_URL || 'http://localhost:3002',
  MESSAGING: process.env.MESSAGING_SERVICE_URL || 'http://localhost:3003',
} as const;

// Error types
export class AppError extends Error {
  constructor(
    public statusCode: number,
    public message: string,
    public isOperational = true
  ) {
    super(message);
    Error.captureStackTrace(this, this.constructor);
  }
}

