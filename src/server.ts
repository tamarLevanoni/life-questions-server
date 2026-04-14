// Sentry must be initialized before any other imports
import './lib/sentry';
import 'dotenv/config';
import { app } from './app';

const PORT = process.env.PORT ?? 3001;

app.listen(PORT, () => {
  console.log(`[server] Life Questions API running on port ${PORT}`);
  console.log(`[server] Environment: ${process.env.NODE_ENV ?? 'development'}`);
});
