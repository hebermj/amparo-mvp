'use strict';

const dotenv = require('dotenv');
const path = require('path');

// Load .env from project root
dotenv.config({ path: path.resolve(__dirname, '..', '..', '..', '.env') });

const config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.METRICS_PORT, 10) || 9092,

  // RabbitMQ
  rabbitmq: {
    url: process.env.RABBITMQ_URL || 'amqp://guest:guest@rabbitmq:5672',
    queues: {
      transcricao: process.env.RABBITMQ_QUEUE_TRANSCRICAO || 'transcricao',
      processamento: process.env.RABBITMQ_QUEUE_PROCESSAMENTO || 'processamento',
      buscaLojas: process.env.RABBITMQ_QUEUE_BUSCA_LOJAS || 'busca_lojas',
      envio: process.env.RABBITMQ_QUEUE_ENVIO || 'envio',
    },
  },

  // PostgreSQL
  database: {
    url: process.env.DATABASE_URL || 'postgresql://amparo:amparo123@postgres:5432/amparo_mvp',
    host: process.env.DATABASE_HOST || 'postgres',
    port: parseInt(process.env.DATABASE_PORT, 10) || 5432,
    name: process.env.DATABASE_NAME || 'amparo_mvp',
    user: process.env.DATABASE_USER || 'amparo',
    password: process.env.DATABASE_PASSWORD || 'amparo123',
  },

  // Redis
  redis: {
    url: process.env.REDIS_URL || 'redis://redis:6379',
    host: process.env.REDIS_HOST || 'redis',
    port: parseInt(process.env.REDIS_PORT, 10) || 6379,
  },

  // DeepSeek
  deepseek: {
    apiKey: process.env.DEEPSEEK_API_KEY || '',
    apiUrl: process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/v1',
    model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
  },

  // Claude (Anthropic)
  claude: {
    apiKey: process.env.CLAUDE_API_KEY || '',
    apiUrl: process.env.CLAUDE_API_URL || 'https://api.anthropic.com/v1',
    model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514',
  },

  // OpenAI
  openai: {
    apiKey: process.env.OPENAI_API_KEY || '',
    apiUrl: process.env.OPENAI_API_URL || 'https://api.openai.com/v1',
    model: process.env.OPENAI_MODEL || 'gpt-4o',
  },

  // LLM Gateway
  llm: {
    primaryProvider: process.env.LLM_PRIMARY_PROVIDER || 'deepseek',
    fallbackProvider: process.env.LLM_FALLBACK_PROVIDER || 'claude',
    secondaryFallbackProvider: process.env.LLM_SECONDARY_FALLBACK_PROVIDER || 'openai',
    cacheTtlSeconds: parseInt(process.env.LLM_CACHE_TTL_SECONDS, 10) || 3600,
    circuitBreakerThreshold: parseInt(process.env.LLM_CIRCUIT_BREAKER_THRESHOLD, 10) || 5,
    circuitBreakerWindowMs: parseInt(process.env.LLM_CIRCUIT_BREAKER_WINDOW_MS, 10) || 60000,
    circuitBreakerAutoResetMs: parseInt(process.env.LLM_CIRCUIT_BREAKER_AUTO_RESET_MS, 10) || 30000,
  },

  // Encryption
  encryptionKey: process.env.ENCRYPTION_KEY || 'uma_chave_aes256_de_32_caracteres_aqui',
};

module.exports = config;
