'use strict';

const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const stream = require('stream');
const fetch = require('node-fetch');
const config = require('../config');
const logger = require('../utils/logger').child('downloader');

const pipeline = promisify(stream.pipeline);

/**
 * Baixa um arquivo de áudio da WhatsApp Media API.
 *
 * Fluxo:
 *   1. GET /{apiVersion}/{mediaId}?phone_number_id={phoneNumberId}
 *      → recebe a URL real do media (campo 'url')
 *   2. GET na URL com Authorization: Bearer {token}
 *      → streama o arquivo para /tmp/audio_{messageId}.ogg
 *
 * @param {string} mediaId  — ID do media retornado pelo webhook do WhatsApp
 * @param {string} messageId — ID da mensagem (usado para nomear o arquivo)
 * @param {object} [options] — opcionais (retryDelay, timeout)
 * @returns {Promise<string>} — caminho absoluto do arquivo baixado
 */
async function downloadAudio(mediaId, messageId, options = {}) {
  const {
    retryDelay = config.audio.retryDelayMs,
    timeout = config.audio.downloadTimeout,
  } = options;

  const maxRetries = config.rabbitmq.maxRetries;
  const outputPath = path.join(config.audio.tempDir, `audio_${messageId}.ogg`);

  // Garante que o diretório temporário existe
  if (!fs.existsSync(config.audio.tempDir)) {
    fs.mkdirSync(config.audio.tempDir, { recursive: true });
  }

  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      logger.info('Iniciando download do áudio', {
        mediaId,
        attempt,
        maxRetries,
        outputPath,
      });

      // ── Passo 1: obter URL real do media ──────────────────────
      const mediaInfoUrl =
        `${config.whatsapp.apiUrl}/${config.whatsapp.apiVersion}/${mediaId}` +
        `?phone_number_id=${config.whatsapp.phoneNumberId}`;

      logger.debug('Obtendo URL do media', { mediaInfoUrl });

      const mediaInfoResp = await fetch(mediaInfoUrl, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${config.whatsapp.token}`,
        },
        signal: AbortSignal.timeout(timeout),
      });

      if (!mediaInfoResp.ok) {
        const errorBody = await mediaInfoResp.text().catch(() => '');
        throw new Error(
          `WhatsApp Media API retornou ${mediaInfoResp.status}: ${errorBody}`
        );
      }

      const mediaInfo = await mediaInfoResp.json();
      const downloadUrl = mediaInfo.url;

      if (!downloadUrl) {
        throw new Error(
          `Resposta da Media API não contém 'url'. Resposta: ${JSON.stringify(mediaInfo)}`
        );
      }

      logger.info('URL do media obtida, iniciando download', { url: downloadUrl });

      // ── Passo 2: baixar o arquivo de áudio ────────────────────
      const downloadResp = await fetch(downloadUrl, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${config.whatsapp.token}`,
        },
        signal: AbortSignal.timeout(timeout),
      });

      if (!downloadResp.ok) {
        const errorBody = await downloadResp.text().catch(() => '');
        throw new Error(
          `Download do áudio retornou ${downloadResp.status}: ${errorBody}`
        );
      }

      // Verifica content-length se disponível
      const contentLength = downloadResp.headers.get('content-length');
      if (contentLength && parseInt(contentLength, 10) > config.audio.maxSizeBytes) {
        throw new Error(
          `Áudio excede tamanho máximo (${contentLength} > ${config.audio.maxSizeBytes} bytes)`
        );
      }

      // Stream para arquivo
      const writeStream = fs.createWriteStream(outputPath);
      await pipeline(downloadResp.body, writeStream);

      // Verifica se o arquivo foi escrito
      const stats = fs.statSync(outputPath);
      if (stats.size === 0) {
        throw new Error('Arquivo de áudio baixado está vazio');
      }

      logger.info('Áudio baixado com sucesso', {
        outputPath,
        sizeBytes: stats.size,
        attempt,
      });

      return outputPath;
    } catch (err) {
      lastError = err;
      logger.warn(`Falha no download (tentativa ${attempt}/${maxRetries})`, {
        mediaId,
        messageId,
        attempt,
        error: err.message,
      });

      // Remove arquivo parcial se existir
      try {
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
      } catch { /* ignora */ }

      if (attempt < maxRetries) {
        const delay = retryDelay * attempt; // backoff linear: 2s, 4s, 6s...
        logger.debug(`Aguardando ${delay}ms antes da próxima tentativa`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  // Esgotou as tentativas
  throw lastError;
}

module.exports = { downloadAudio };
