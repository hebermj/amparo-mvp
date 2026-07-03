'use strict';

const fs = require('fs');
const { spawn } = require('child_process');
const path = require('path');
const config = require('../config');
const logger = require('../utils/logger').child('transcriber');

// ==================================================================
// Transcriber — Speech-to-Text
//
// Suporta dois providers:
//   1. whisper  → executa whisper.cpp como subprocesso (MVP: mock)
//   2. google   → chama Google Cloud Speech-to-Text API
//
// Cada provider deve exportar:
//   async function transcribe(audioFilePath, options) → { text, confidence }
// ==================================================================

/**
 * Transcreve um arquivo de áudio para texto.
 *
 * @param {string} audioFilePath — Caminho absoluto do .ogg baixado
 * @param {object} [options]
 * @param {string} [options.provider]  — Força provider (default: config.stt.provider)
 * @param {string} [options.language]  — Código de idioma BCP-47 (default: pt-BR)
 * @returns {Promise<{text: string, confidence: number}>}
 */
async function transcribe(audioFilePath, options = {}) {
  const provider = options.provider || config.stt.provider;
  const language = options.language || config.stt.language;

  if (!audioFilePath || !fs.existsSync(audioFilePath)) {
    throw new Error(`Arquivo de áudio não encontrado: ${audioFilePath}`);
  }

  logger.info('Iniciando transcrição', { provider, language, audioFilePath });

  switch (provider) {
    case 'whisper':
      return transcribeWhisper(audioFilePath, { language });
    case 'google':
      return transcribeGoogle(audioFilePath, { language });
    default:
      throw new Error(`Provider STT desconhecido: ${provider}`);
  }
}

// ── Whisper (whisper.cpp) ─────────────────────────────────────────
//
// MVP: implementação mock que simula uma transcrição realista.
// Quando o modelo whisper.cpp estiver disponível no container,
// substitua o bloco 'mock' pelo spawn real comentado abaixo.
//
// Referência de instalação do whisper.cpp no Dockerfile:
//   git clone https://github.com/ggerganov/whisper.cpp.git
//   cd whisper.cpp && make -j4
//   bash models/download-ggml-model.sh base
//
// Uso real:
//   ./whisper.cpp/main -m whisper.cpp/models/ggml-base.bin -f audio.ogg -otxt
//
async function transcribeWhisper(audioFilePath, { language }) {
  // ── Implementação real (whisper.cpp subprocesso) ──────────────
  //
  // const whisperBinary = path.join(__dirname, '..', '..', 'whisper.cpp', 'main');
  // const modelPath = path.join(
  //   __dirname, '..', '..', 'whisper.cpp', 'models', `ggml-${config.stt.whisperModel}.bin`
  // );
  //
  // return new Promise((resolve, reject) => {
  //   const proc = spawn(whisperBinary, [
  //     '-m', modelPath,
  //     '-f', audioFilePath,
  //     '-l', language || 'pt',
  //     '-otxt',
  //     '--no-timestamps',
  //   ], { stdio: ['pipe', 'pipe', 'pipe'] });
  //
  //   let stdout = '';
  //   let stderr = '';
  //
  //   proc.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
  //   proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  //
  //   proc.on('close', (code) => {
  //     if (code !== 0) {
  //       return reject(new Error(`whisper.cpp exit code ${code}: ${stderr}`));
  //     }
  //     const text = stdout.trim();
  //     resolve({
  //       text,
  //       confidence: 0.92,  // whisper não expõe confidence por padrão
  //     });
  //   });
  //
  //   proc.on('error', reject);
  // });

  // ── MVP: Mock realista ────────────────────────────────────────
  // Simula processamento com latência de ~500ms
  const fileSize = fs.statSync(audioFilePath).size;

  // Gera uma transcrição mock baseada no tamanho do arquivo
  const mocks = [
    'Olá, tudo bem? Gostaria de saber o horário de funcionamento da loja.',
    'Sim, estou procurando um tênis de corrida tamanho 42.',
    'Qual o preço daquele sofá que estava na promoção?',
    'Pode me ajudar com informações sobre o produto?',
    'Quero fazer uma reclamação sobre o último pedido.',
    'Sim, confirme meu endereço de entrega por favor.',
    'Não, obrigado, era só isso mesmo.',
    'Gostaria de saber se vocês tem aquele modelo mais novo.',
    'Pode repetir, por favor? Não entendi direito.',
  ];

  // Seleciona um mock baseado no arquivo para ser determinístico
  const mockIndex = (fileSize % 97) % mocks.length;
  const text = mocks[mockIndex];

  // Confiança simulada: varia entre 0.75 e 0.99 baseado no tamanho
  const confidence = Math.min(0.99, 0.75 + (fileSize % 25) / 100);

  // Latência simulada do whisper
  await new Promise((resolve) => setTimeout(resolve, 500));

  logger.info('Transcrição whisper concluída (mock)', {
    text: text.substring(0, 60),
    confidence: confidence.toFixed(3),
    audioSize: fileSize,
  });

  return { text, confidence: Math.round(confidence * 1000) / 1000 };
}

// ── Google Cloud Speech-to-Text ────────────────────────────────────
//
// Chama a API REST do Google Cloud STT.
// Documentação: https://cloud.google.com/speech-to-text/docs/reference/rest/v1/speech/recognize
//
async function transcribeGoogle(audioFilePath, { language }) {
  const apiKey = config.stt.googleApiKey;

  if (!apiKey) {
    throw new Error('GOOGLE_STT_API_KEY não configurada');
  }

  // Lê o arquivo de áudio e codifica em base64
  const audioBuffer = fs.readFileSync(audioFilePath);
  const audioBase64 = audioBuffer.toString('base64');

  const payload = {
    config: {
      encoding: 'OGG_OPUS',
      sampleRateHertz: 16000,
      languageCode: language || 'pt-BR',
      model: 'phone_call',       // otimizado para conversas curtas
      enableAutomaticPunctuation: true,
      enableWordConfidence: true,
    },
    audio: {
      content: audioBase64,
    },
  };

  const fetch = require('node-fetch');

  const response = await fetch(
    `https://speech.googleapis.com/v1/speech:recognize?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }
  );

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new Error(`Google STT API retornou ${response.status}: ${errorBody}`);
  }

  const result = await response.json();

  // Extrai o texto completo e a confiança média
  const results = result.results || [];
  if (results.length === 0) {
    return { text: '', confidence: 0 };
  }

  const fullText = results
    .map((r) => r.alternatives && r.alternatives[0] ? r.alternatives[0].transcript : '')
    .filter(Boolean)
    .join(' ');

  // Confiança: média da primeira alternativa de cada resultado
  const confidences = results
    .map((r) => (r.alternatives && r.alternatives[0] ? r.alternatives[0].confidence : 0))
    .filter((c) => c > 0);

  const avgConfidence = confidences.length > 0
    ? confidences.reduce((a, b) => a + b, 0) / confidences.length
    : 0;

  logger.info('Transcrição Google concluída', {
    textLength: fullText.length,
    confidence: avgConfidence.toFixed(3),
    resultsCount: results.length,
  });

  return {
    text: fullText,
    confidence: Math.round(avgConfidence * 1000) / 1000,
  };
}

module.exports = { transcribe };
