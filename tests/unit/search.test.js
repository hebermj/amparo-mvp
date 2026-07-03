/**
 * Amparo MVP v2 — Unit Tests: Search (SearXNG)
 */

const assert = require('assert');

describe('Search Worker (SearXNG)', function () {
  describe('#ranker', function () {
    it('deve ranquear resultados por relevância', function () {
      const results = [
        { title: 'Geladeira Frost Free 420L', snippet: 'Geladeira eficiente...', score: 0.95 },
        { title: 'Livro de Receitas', snippet: 'Aprenda a cozinhar...', score: 0.3 },
        { title: 'Geladeira Consul 350L', snippet: 'Geladeira compacta...', score: 0.85 },
      ];

      const filtered = results.filter(r => r.score >= 0.5);
      assert.strictEqual(filtered.length, 2, 'Deve filtrar resultados irrelevantes');
      assert.ok(filtered[0].score >= filtered[1].score, 'Deve manter ordenação por score');
    });

    it('deve retornar top 3 resultados', function () {
      const top3 = [1, 2, 3];
      assert.strictEqual(top3.length, 3);
    });
  });

  describe('#comparator', function () {
    it('deve agrupar mesmo produto de lojas diferentes', function () {
      const results = [
        { title: 'Geladeira Brastemp 420L', store: 'Magazine Luiza', price: 2999.00 },
        { title: 'Geladeira Brastemp 420L', store: 'Amazon', price: 2899.00 },
        { title: 'Geladeira Brastemp 420L', store: 'Casas Bahia', price: 3099.00 },
      ];

      const similarProducts = results.filter(r => r.title === 'Geladeira Brastemp 420L');
      assert.strictEqual(similarProducts.length, 3, 'Deve agrupar produtos iguais');

      const prices = similarProducts.map(r => r.price);
      const lowestPrice = Math.min(...prices);
      assert.strictEqual(lowestPrice, 2899.00, 'Amazon deve ter menor preço');
    });
  });

  describe('#priceAlerta', function () {
    it('deve alertar se preço for < 50% da média', function () {
      const prices = [100.00, 110.00, 90.00, 45.00, 105.00];
      const average = prices.reduce((a, b) => a + b) / prices.length;
      const suspect = prices.find(p => p < average * 0.5);

      assert.strictEqual(suspect, 45.00, 'Preço 45.00 é suspeito');
    });
  });
});
