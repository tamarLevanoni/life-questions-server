import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import * as Sentry from '@sentry/node';
import { apiSecretMiddleware } from './middleware/apiSecret.middleware';
import { errorHandlerMiddleware } from './middleware/errorHandler.middleware';
import { notFoundMiddleware } from './middleware/notFound.middleware';
import { usersRouter } from './modules/users/users.router';

const app = express();

// Sentry must wrap the app early to capture errors from all routes
Sentry.setupExpressErrorHandler(app);

// Security headers
app.use(helmet());

// CORS — restrict to configured frontend origins
const allowedOrigins = [
  process.env.CORS_ORIGIN_DEV ?? 'http://localhost:3000',
  process.env.CORS_ORIGIN_PROD,
].filter(Boolean) as string[];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g. curl, Postman, server-to-server)
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS policy: origin ${origin} is not allowed`));
      }
    },
    credentials: true,
  })
);

// Parse JSON request bodies
app.use(express.json());

// API secret validation — applied globally before all routes
app.use(apiSecretMiddleware);

// Routes
app.use('/api/users', usersRouter);

// 404 fallback
app.use(notFoundMiddleware);

// Global error handler (must be last)
app.use(errorHandlerMiddleware);

export { app };
