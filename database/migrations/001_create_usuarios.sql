-- =============================================
-- Amparo MVP v2 — Migration 001: usuarios
-- =============================================
CREATE TABLE IF NOT EXISTS usuarios (
    id              SERIAL PRIMARY KEY,
    whatsapp_phone  VARCHAR(20) UNIQUE NOT NULL,
    nome            VARCHAR(100),
    data_primeiro_contato TIMESTAMP DEFAULT NOW(),
    ativo           BOOLEAN DEFAULT TRUE,
    criado_em       TIMESTAMP DEFAULT NOW(),
    atualizado_em   TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_usuarios_whatsapp ON usuarios(whatsapp_phone);
