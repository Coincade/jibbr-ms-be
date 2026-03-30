import { fileURLToPath } from 'url';
import { dirname } from 'path';
import dotenv from 'dotenv';
import path from 'path';
import { Logger } from '@jibbr/logger';
import { createUploadApp } from './app.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = path.join(__dirname, '../.env');

dotenv.config({ path: envPath });

const app = createUploadApp();
const logger = new Logger('upload-service');

// Use a dedicated env var for upload service
const rawPort = process.env.PORT || process.env.UPLOAD_PORT;
const PORT = rawPort && !Number.isNaN(Number(rawPort)) ? Number(rawPort) : 3002;

app.listen(PORT, () => {
  logger.info(`🚀 Upload service is running on port ${PORT}`);
});

