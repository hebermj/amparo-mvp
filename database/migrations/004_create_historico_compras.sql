-- =============================================
-- Amparo MVP v2 — Migration 004: historico_compras
-- =============================================
CREATE TABLE IF NOT EXISTS historico_compras_mvp (
    id              SERIAL PRIMARY KEY,
    usuario_id      INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    pedido_id       VARCHAR(50),
    produto         TEXT NOT NULL,
    loja            VARCHAR(100) NOT NULL,
    valor           DECIMAL(10,2) NOT NULL,
    link_checkout   TEXT,
    criado_em       TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_historico_usuario ON historico_compras_mvp(usuario_id);
