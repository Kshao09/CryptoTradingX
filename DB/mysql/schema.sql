-- Create and select the database
CREATE DATABASE IF NOT EXISTS cryptox
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;
USE cryptox;

-- Users (with first/middle/last names)
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  first_name  VARCHAR(100) NOT NULL,
  middle_name VARCHAR(100) NULL,
  last_name   VARCHAR(100) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci;

-- Assets (symbols like BTC-USD, BTC, ETH)
CREATE TABLE IF NOT EXISTS assets (
  id INT AUTO_INCREMENT PRIMARY KEY,
  symbol VARCHAR(32) NOT NULL UNIQUE
) ENGINE=InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci;

-- Wallet balances per user/asset
CREATE TABLE IF NOT EXISTS wallets (
  user_id INT NOT NULL,
  asset_id INT NOT NULL,
  balance DECIMAL(32,12) NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, asset_id),
  CONSTRAINT fk_wallets_users  FOREIGN KEY (user_id)  REFERENCES users(id)  ON DELETE CASCADE,
  CONSTRAINT fk_wallets_assets FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE RESTRICT
) ENGINE=InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci;

-- Orders (uses symbol string, but kept consistent with assets via FK)
CREATE TABLE IF NOT EXISTS orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  symbol VARCHAR(32) NOT NULL,
  side ENUM('BUY','SELL') NOT NULL,
  type ENUM('MARKET','LIMIT') NOT NULL,
  qty DECIMAL(32,12) NOT NULL,
  price DECIMAL(32,12) NULL,
  status ENUM('NEW','FILLED','PARTIAL','CANCELED') NOT NULL DEFAULT 'NEW',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_orders_user_time (user_id, created_at),

  -- optional data integrity (MySQL 8+ enforces CHECK)
  CHECK (qty > 0),
  CHECK (type <> 'LIMIT' OR price IS NOT NULL),

  CONSTRAINT fk_orders_users  FOREIGN KEY (user_id)  REFERENCES users(id)      ON DELETE CASCADE,
  CONSTRAINT fk_orders_symbol FOREIGN KEY (symbol)   REFERENCES assets(symbol) ON DELETE RESTRICT
) ENGINE=InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci;

-- Trades
CREATE TABLE IF NOT EXISTS trades (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  user_id INT NOT NULL,
  symbol VARCHAR(32) NOT NULL,
  price DECIMAL(32,12) NOT NULL,
  qty DECIMAL(32,12) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_trades_user_time (user_id, created_at),
  INDEX idx_trades_order (order_id),

  CHECK (qty > 0),

  CONSTRAINT fk_trades_orders  FOREIGN KEY (order_id) REFERENCES orders(id)     ON DELETE CASCADE,
  CONSTRAINT fk_trades_users   FOREIGN KEY (user_id)  REFERENCES users(id)      ON DELETE CASCADE,
  CONSTRAINT fk_trades_symbol  FOREIGN KEY (symbol)   REFERENCES assets(symbol) ON DELETE RESTRICT
) ENGINE=InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci;

-- OPTIONAL: Fiat top-ups (Stripe) — recommended to log purchases
CREATE TABLE IF NOT EXISTS fiat_topups (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  coin VARCHAR(32) NOT NULL,                 -- e.g., BTC-USD
  usd_amount DECIMAL(18,2) NOT NULL,         -- fiat charged
  coin_qty DECIMAL(32,12) NOT NULL,          -- coins credited
  stripe_payment_intent_id VARCHAR(64) NOT NULL UNIQUE,
  status ENUM('succeeded','processing','canceled','requires_action') NOT NULL DEFAULT 'succeeded',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_topups_users  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_topups_symbol FOREIGN KEY (coin)    REFERENCES assets(symbol) ON DELETE RESTRICT
) ENGINE=InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci;

-- Seed base symbols
INSERT IGNORE INTO assets(symbol) VALUES
  ('BTC-USD'),('ETH-USD'),('BTC'),('ETH');
