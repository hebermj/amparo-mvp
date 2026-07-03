import dotenv from 'dotenv';
import { existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env from project root (one level up from src/)
const envPath = resolve(__dirname, '..', '..', '.env');
if (existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  // Fallback — let dotenv look in process.cwd()
  dotenv.config();
}

const config = {
  port: parseInt(process.env.PORT, 10) || 3000,

  whatsappToken: process.env.WHATSAPP_TOKEN || '',
  whatsappVerifyToken: process.env.WHATSAPP_VERIFY_TOKEN || 'amparo_verify_2024',

  rabbitmqUrl: process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672',

  serviceName: process.env.SERVICE_NAME || 'amparo-gateway',

  nodeEnv: process.env.NODE_ENV || 'development',
};

export default config;
