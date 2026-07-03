'use strict';

/**
 * Response templates for the Amparo shopping assistant.
 * All responses are in Brazilian Portuguese.
 */
const templates = {
  /**
   * Initial greeting.
   */
  saudacao() {
    return 'Olá! 😊 Como posso ajudar nas suas compras hoje?';
  },

  /**
   * Search results presentation.
   * @param {Array<{nome: string, preco: number, loja: string, link: string}>} products
   */
  resultadosBusca(products) {
    if (!products || products.length === 0) {
      return 'Desculpe, não encontrei nenhum produto com essas características. Pode tentar com outras palavras?';
    }

    const lines = products.map((p, i) => {
      const preco = typeof p.preco === 'number' ? `R$ ${p.preco.toFixed(2)}` : p.preco;
      return `${i + 1}. *${p.nome}* — ${preco} — ${p.loja}`;
    });

    return `Encontrei estas opções para você:\n\n${lines.join('\n')}\n\nQual delas te interessou? Posso ajudar com mais detalhes ou já quer comprar alguma?`;
  },

  /**
   * Purchase confirmation request.
   * @param {string} produto - Product name
   * @param {string|number} valor - Price
   * @param {string} endereco - Delivery address
   */
  confirmacaoCompra(produto, valor, endereco) {
    const preco = typeof valor === 'number' ? `R$ ${valor.toFixed(2)}` : valor;
    return `Vou confirmar os dados da sua compra:\n\n🛒 *Produto:* ${produto}\n💰 *Valor:* ${preco}\n📍 *Endereço de entrega:* ${endereco}\n\nEstá tudo certo? Posso finalizar?`;
  },

  /**
   * General error message.
   */
  erroGeral() {
    return 'Desculpe, tive um problema para processar sua solicitação. 😕 Pode tentar novamente?';
  },

  /**
   * Ask for delivery address.
   */
  pedirEndereco() {
    return 'Qual o endereço para entrega? Pode me passar o nome da rua, número, bairro, cidade e CEP.';
  },

  /**
   * Ask for LGPD consent to store address.
   */
  consentimentoPergunta() {
    return 'Para agilizar suas próximas compras, posso salvar seu endereço? Fique tranquilo, você pode pedir para eu excluir quando quiser. 😊\n\nQuer salvar o endereço?';
  },

  /**
   * Consent given confirmation.
   */
  consentimentoDado() {
    return 'Seu endereço foi salvo com sucesso! ✅ Pode ficar tranquilo, seus dados estão protegidos. Se quiser excluir depois, é só me avisar.';
  },

  /**
   * Consent revoked confirmation.
   */
  consentimentoRevogado() {
    return 'Seu endereço foi removido dos meus registros. ✅ Se precisar salvar novamente no futuro, é só me pedir.';
  },

  /**
   * Checkout link generated.
   * @param {string} link - Payment link
   * @param {string} pedidoId - Order ID
   * @param {string} loja - Store name
   */
  checkoutLink(link, pedidoId, loja) {
    return `Seu pedido foi gerado com sucesso! 🎉\n\n📋 *Pedido:* #${pedidoId}\n🏪 *Loja:* ${loja}\n🔗 *Link para pagamento:* ${link}\n\nClique no link acima para finalizar o pagamento. Se precisar de ajuda, é só me chamar!`;
  },

  /**
   * Successful checkout.
   */
  compraFinalizada(pedidoId) {
    return `Compra finalizada com sucesso! 🎉 Seu pedido #${pedidoId} está confirmado. Obrigado por comprar com a gente! 😊`;
  },

  /**
   * Generic help message.
   */
  ajuda() {
    return 'Posso ajudar você a comprar produtos online! 🤖\n\nVocê pode me pedir:\n• Buscar produtos — "Quero comprar um café"\n• Ver meu endereço salvo\n• Finalizar uma compra\n\nComo posso te ajudar?';
  },
};

module.exports = templates;
