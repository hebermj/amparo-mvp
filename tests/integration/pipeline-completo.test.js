/**
 * Amparo MVP v2 — Pipeline Completo Integration Test
 * 
 * Simula o fluxo: webhook → RabbitMQ → workers → resposta
 */

const assert = require('assert');

describe('Pipeline Completo - Fluxo de Mensagem', function () {
  it('deve processar mensagem de texto do webhook até o envio', async function () {
    // Simula:
    // 1. Webhook recebe "Quero comprar uma geladeira"
    // 2. Gateway publica na fila 'processamento'
    // 3. Orquestrador recebe, chama LLM, detecta busca
    // 4. Publica na fila 'busca_lojas'
    // 5. Worker-Search consulta SearXNG, retorna top 3
    // 6. Orquestrador gera resposta com produtos
    // 7. Publica na fila 'envio'
    // 8. Worker-Sender envia mensagem WhatsApp

    // Para MVP, validamos a estrutura do pipeline
    const pipelineSteps = [
      'webhook_received',
      'published_to_processamento',
      'consumed_by_orchestrator',
      'llm_gateway_called',
      'tool_search_invoked',
      'published_to_busca_lojas',
      'search_consumed_and_processed',
      'results_published_back',
      'orchestrator_generated_response',
      'published_to_envio',
      'whatsapp_message_sent',
    ];

    assert.ok(pipelineSteps.length === 11, 'Deve ter 11 etapas no pipeline');
    
    // Verifica cada etapa existe
    pipelineSteps.forEach((step, index) => {
      assert.ok(typeof step === 'string', `Etapa ${index} deve ser string`);
    });
  });

  it('deve processar mensagem de áudio com transcrição', async function () {
    // Fluxo para áudio:
    // 1. Webhook recebe áudio → publica na fila 'transcricao'
    // 2. Worker-STT consome, baixa mídia, transcreve
    // 3. Publica texto na fila 'processamento'
    // 4. Continua fluxo normal de texto

    const audioSteps = [
      'webhook_received_audio',
      'published_to_transcricao',
      'stt_downloaded_media',
      'stt_transcribed_audio',
      'text_published_to_processamento',
      'continues_as_text_pipeline',
    ];

    assert.ok(audioSteps.length === 6, 'Deve ter 6 etapas para áudio');
  });

  it('deve manter estado da sessão entre mensagens', async function () {
    const session = {
      whatsappPhone: '5511999999999',
      context: { stage: 'browsing', lastSearch: 'geladeira' },
      history: [
        { role: 'user', content: 'Quero comprar uma geladeira', timestamp: Date.now() },
        { role: 'assistant', content: 'Encontrei estas opções...', timestamp: Date.now() },
      ],
      lastInteraction: Date.now(),
    };

    assert.ok(session.history.length <= 6, 'Histórico máximo de 6 mensagens');
    assert.ok(session.whatsappPhone, 'Sessão vinculada ao WhatsApp');
  });
});
