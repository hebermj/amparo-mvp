'use strict';

const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');
const metrics = require('../utils/metrics');

const MAX_RETRIES = 3;

/**
 * Amparo Worker-Orchestrator — RabbitMQ Consumer
 *
 * Consumes messages from the 'processamento' queue and routes
 * through the LLM Gateway, tools, and session manager.
 */
class OrchestratorConsumer {
  /**
   * @param {Object} deps
   * @param {Object} deps.channel - RabbitMQ channel
   * @param {Object} deps.queues - Queue name config
   * @param {Object} deps.llmGateway - LLMGateway instance
   * @param {Object} deps.sessionManager - SessionManager instance
   * @param {Object} deps.producer - Producer instance
   * @param {Object} deps.searchTool - SearchTool instance
   * @param {Object} deps.profileTool - ProfileTool instance
   * @param {Object} deps.consentTool - ConsentTool instance
   * @param {Object} deps.confirmTool - ConfirmTool instance
   * @param {Object} deps.checkoutTool - CheckoutTool instance
   * @param {string} deps.systemPrompt - System prompt for LLM
   * @param {Object} deps.pgClient - PostgreSQL pool
   */
  constructor(deps) {
    this.channel = deps.channel;
    this.queues = deps.queues;
    this.llmGateway = deps.llmGateway;
    this.sessionManager = deps.sessionManager;
    this.producer = deps.producer;
    this.searchTool = deps.searchTool;
    this.profileTool = deps.profileTool;
    this.consentTool = deps.consentTool;
    this.confirmTool = deps.confirmTool;
    this.checkoutTool = deps.checkoutTool;
    this.systemPrompt = deps.systemPrompt;
    this.pgClient = deps.pgClient;
    this.consumerTag = null;
    this._tools = null;
  }

  /**
   * Build a name→handler map for easy tool dispatching.
   */
  _getToolMap() {
    if (this._tools) return this._tools;
    const map = {};
    for (const tool of [this.searchTool, this.profileTool, this.consentTool, this.confirmTool, this.checkoutTool]) {
      if (tool && tool.definition) {
        map[tool.definition.name] = tool;
      }
      if (tool && tool.definitions) {
        for (const def of tool.definitions) {
          map[def.name] = tool;
        }
      }
    }
    this._tools = map;
    return map;
  }

  /**
   * Start consuming from the processamento queue.
   */
  async start() {
    logger.info('Consumer starting', { queue: this.queues.processamento });
    await this.channel.prefetch(1);
    const result = await this.channel.consume(
      this.queues.processamento,
      (msg) => this._handleMessage(msg),
      { noAck: false }
    );
    this.consumerTag = result.consumerTag;
    logger.info('Consumer started', { consumerTag: this.consumerTag });
  }

  /**
   * Stop consuming gracefully.
   */
  async stop() {
    if (this.consumerTag) {
      await this.channel.cancel(this.consumerTag);
      logger.info('Consumer stopped');
    }
  }

  // ── Message handling ──────────────────────────────────────────

  async _handleMessage(msg) {
    const startTime = Date.now();
    let content;

    try {
      content = JSON.parse(msg.content.toString());
    } catch (err) {
      logger.error('Invalid message format, discarding', { error: err.message });
      return this.channel.nack(msg, false, false);
    }

    const traceId = content.traceId || uuidv4();
    const whatsappPhone = content.whatsappPhone || content.from || content.userId;
    const log = logger.child({ traceId, whatsappPhone });

    log.info('Processing message', { type: content.type });

    try {
      // Route by message type
      if (content.type === 'search_result' && content.results) {
        await this._handleSearchResult(content, traceId, whatsappPhone);
      } else if (content.type === 'text' || content.type === 'interactive') {
        await this._handleUserMessage(content, traceId, whatsappPhone);
      } else if (content.type === 'audio') {
        await this._handleAudioMessage(content, traceId, whatsappPhone);
      } else {
        log.warn('Unknown message type, discarding', { type: content.type });
        this.channel.nack(msg, false, false);
        return;
      }

      this.channel.ack(msg);
      metrics.messagesProcessedTotal.inc({ status: 'success' });
    } catch (err) {
      log.error('Error processing message', { error: err.message, stack: err.stack });
      metrics.messagesProcessedTotal.inc({ status: 'error' });

      if (this._shouldRetry(msg)) {
        this.channel.nack(msg, false, true);
        log.warn('Re-queuing for retry');
      } else {
        await this._sendToDLQ(content, err, msg);
      }
    } finally {
      metrics.latencySeconds.observe((Date.now() - startTime) / 1000);
    }
  }

  _shouldRetry(msg) {
    const retryCount = (msg.properties.headers && msg.properties.headers['x-retry-count']) || 0;
    return retryCount < MAX_RETRIES;
  }

  async _sendToDLQ(content, err, msg) {
    const dlqPayload = {
      ...content,
      error: err.message,
      failedAt: new Date().toISOString(),
    };
    this.channel.sendToQueue(
      this.queues.processamento + '_dlq',
      Buffer.from(JSON.stringify(dlqPayload)),
      { persistent: true }
    );
    this.channel.ack(msg);
    logger.error('Message moved to DLQ', { error: err.message });
  }

  // ── Audio messages ────────────────────────────────────────────

  async _handleAudioMessage(content, traceId, whatsappPhone) {
    logger.info('Audio message received, forwarding to transcricao queue', { traceId });
    // For now, forward to the transcricao queue for STT processing
    this.producer._publish(this.queues.transcricao, {
      type: 'transcricao',
      whatsappPhone,
      mediaId: content.mediaId,
      traceId,
      timestamp: Date.now(),
    });
  }

  // ── User messages ─────────────────────────────────────────────

  async _handleUserMessage(content, traceId, whatsappPhone) {
    const log = logger.child({ traceId, whatsappPhone });
    const userMessage = (content.content && (content.content.text || content.content.buttonText)) || '';
    const buttonId = content.content && content.content.buttonId;

    log.info('User message received', { message: userMessage.substring(0, 50), buttonId });

    // Get or create session
    const session = await this.sessionManager.getOrCreateSession(whatsappPhone);

    // Append user message to history
    session.history.push({
      role: 'user',
      content: userMessage || buttonId,
      timestamp: Date.now(),
    });

    // Trim history (keep last 6)
    if (session.history.length > 6) {
      session.history = session.history.slice(-6);
    }

    // Handle button replies
    if (buttonId) {
      await this._handleButtonReply(buttonId, session, traceId, whatsappPhone);
      return;
    }

    // Process through LLM Gateway
    await this._processWithLLM(userMessage, session, traceId, whatsappPhone);

    // Save session state
    await this.sessionManager.updateSession(session);
  }

  async _handleButtonReply(buttonId, session, traceId, whatsappPhone) {
    const log = logger.child({ traceId, whatsappPhone });

    if (buttonId === 'confirmar_compra') {
      log.info('User confirmed purchase');
      const confirmResult = await this.confirmTool.handleConfirmResponse(session, { traceId });
      if (confirmResult && confirmResult.sendToUser) {
        await this.producer.publishToSend(confirmResult.sendToUser);
      }
      await this.sessionManager.updateSession(session);
      return;
    }

    if (buttonId === 'recusar_compra') {
      log.info('User declined purchase');
      await this.producer.publishToSend({
        type: 'text',
        whatsappPhone,
        message: 'Sem problemas! Se quiser tentar outra compra, é só me chamar.',
        traceId,
      });
      session.context = {};
      await this.sessionManager.updateSession(session);
      return;
    }

    if (buttonId === 'nova_compra') {
      log.info('User wants a new purchase');
      session.context = {};
      await this.producer.publishToSend({
        type: 'text',
        whatsappPhone,
        message: 'Claro! Me diga o que você está procurando hoje.',
        traceId,
      });
      await this.sessionManager.updateSession(session);
      return;
    }

    if (buttonId.startsWith('consent_')) {
      const granted = buttonId.endsWith('_sim');
      const tipo = buttonId.replace(/^consent_/, '').replace(/_(sim|nao)$/, '') || 'armazenar_endereco';
      log.info('Consent response', { tipo, granted });
      await this.consentTool.handleConsentResponse(session, tipo, granted, { traceId });

      if (granted) {
        await this.producer.publishToSend({
          type: 'text',
          whatsappPhone,
          message: 'Pronto! Obrigado por autorizar. Agora me diga qual o seu endereço de entrega.',
          traceId,
        });
      } else {
        await this.producer.publishToSend({
          type: 'text',
          whatsappPhone,
          message: 'Tudo bem! Vou usar o endereço só para esta compra sem guardar.',
          traceId,
        });
      }
      await this.sessionManager.updateSession(session);
      return;
    }

    // Generic button handler — treat as text
    session.history[session.history.length - 1].content = buttonId;
    await this._processWithLLM(buttonId, session, traceId, whatsappPhone);
    await this.sessionManager.updateSession(session);
  }

  async _processWithLLM(userMessage, session, traceId, whatsappPhone) {
    const log = logger.child({ traceId, whatsappPhone });

    // Collect tool definitions from all tools
    const toolDefinitions = this._collectToolDefinitions();

    const llmResult = await this.llmGateway.complete(
      userMessage,
      session.history,
      this.systemPrompt,
      toolDefinitions,
      session.sessionId
    );

    log.info('LLM response', {
      provider: llmResult.provider,
      hasToolCalls: !!(llmResult.toolCalls && llmResult.toolCalls.length > 0),
      cached: llmResult.cached,
    });

    if (llmResult.toolCalls && llmResult.toolCalls.length > 0) {
      await this._processToolCalls(llmResult.toolCalls, session, traceId, whatsappPhone);

      if (llmResult.response) {
        session.history.push({
          role: 'assistant',
          content: llmResult.response,
          timestamp: Date.now(),
        });
      }
    } else {
      session.history.push({
        role: 'assistant',
        content: llmResult.response,
        timestamp: Date.now(),
      });

      await this.producer.publishToSend({
        type: 'text',
        whatsappPhone,
        message: llmResult.response,
        traceId,
      });
    }
  }

  _collectToolDefinitions() {
    const defs = [];
    for (const tool of [this.searchTool, this.profileTool, this.consentTool, this.confirmTool, this.checkoutTool]) {
      if (tool && tool.definition) defs.push(tool.definition);
      if (tool && tool.definitions) defs.push(...tool.definitions);
    }
    return defs;
  }

  async _processToolCalls(toolCalls, session, traceId, whatsappPhone) {
    for (const toolCall of toolCalls) {
      const log = logger.child({ traceId, whatsappPhone });
      const toolMap = this._getToolMap();
      const tool = toolMap[toolCall.name];

      if (!tool) {
        log.warn('Unknown tool called', { tool: toolCall.name });
        continue;
      }

      log.info('Executing tool', { tool: toolCall.name, args: JSON.stringify(toolCall.args) });

      const result = await tool.execute(toolCall.name, toolCall.args, session, { traceId });

      if (result && result.requiresSearch) {
        log.info('Tool requires search, forwarding to busca_lojas queue', { query: result.query });
        await this.producer.publishToSearch({
          correlationId: traceId,
          query: result.query,
          limit: 5,
          sessionId: session.sessionId,
          whatsappPhone,
          timestamp: Date.now(),
        });
        // Save state — waiting for search results
        session.context = {
          ...session.context,
          awaitingSearchResult: true,
          lastQuery: result.query,
        };
        return; // Will continue when search results arrive
      }

      if (result && result.sendToUser) {
        await this.producer.publishToSend(result.sendToUser);
      }
    }
  }

  // ── Search results ────────────────────────────────────────────

  async _handleSearchResult(content, traceId, whatsappPhone) {
    const log = logger.child({ traceId, whatsappPhone });
    log.info('Processing search results', { count: content.results ? content.results.length : 0 });

    const session = await this.sessionManager.getOrCreateSession(whatsappPhone);

    // Build a summary of results for the LLM
    const resultsSummary = content.results.slice(0, 5).map((r, i) =>
      `[${i + 1}] ${r.title || r.name || 'Produto'} — ${r.price ? `R$ ${r.price.toFixed(2)}` : 'Preço sob consulta'} — ${r.source || r.store || r.loja || 'Loja'}`
    ).join('\n');

    const searchContext = `Busca por "${content.query}" retornou:\n${resultsSummary}`;
    session.history.push({
      role: 'system',
      content: searchContext,
      timestamp: Date.now(),
    });

    const toolDefinitions = this._collectToolDefinitions();
    const llmResult = await this.llmGateway.complete(
      'Mostre os resultados para o usuário de forma amigável e pergunte qual ele quer.',
      session.history,
      this.systemPrompt,
      toolDefinitions,
      session.sessionId
    );

    if (llmResult.response) {
      session.history.push({
        role: 'assistant',
        content: llmResult.response,
        timestamp: Date.now(),
      });

      // Build option buttons
      const buttons = content.results.slice(0, 3).map((p, i) => ({
        id: `escolher_${i}`,
        title: `Opção ${i + 1}${p.price ? ` — R$ ${p.price.toFixed(2)}` : ''}`,
      }));

      await this.producer.publishToSend({
        type: 'interactive',
        whatsappPhone,
        message: llmResult.response,
        buttons,
        traceId,
      });
    }

    session.context = {
      ...session.context,
      awaitingSearchResult: false,
      lastSearchResults: content.results,
    };
    await this.sessionManager.updateSession(session);
  }
}

module.exports = OrchestratorConsumer;
