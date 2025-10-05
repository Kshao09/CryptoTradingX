idsymbol-- Create and select the database
CREATE DATABASE IF NOT EXISTS cryptox
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE cryptox;

-- Users
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- Assets (symbols like BTC-USD, BTC, ETH)
CREATE TABLE IF NOT EXISTS assets (
  id INT AUTO_INCREMENT PRIMARY KEY,
  symbol VARCHAR(32) NOT NULL UNIQUE
) ENGINE=InnoDB;

-- Wallet balances per user/asset
CREATE TABLE IF NOT EXISTS wallets (
  user_id INT NOT NULL,
  asset_id INT NOT NULL,
  balance DECIMAL(32,12) NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, asset_id),
  CONSTRAINT fk_wallets_users  FOREIGN KEY (user_id)  REFERENCES users(id)  ON DELETE CASCADE,
  CONSTRAINT fk_wallets_assets FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

-- Orders (INT AUTO_INCREMENT ids to match your server.js)
CREATE TABLE IF NOT EXISTS orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  symbol VARCHAR(32) NOT NULL,
  side ENUM('BUY','SELL') NOT NULL,
  type ENUM('MARKET','LIMIT') NOT NULL,
  qty DECIMAL(32,12) NOT NULL CHECK (qty > 0),
  price DECIMAL(32,12) NULL,
  status ENUM('NEW','FILLED') NOT NULL DEFAULT 'NEW',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_orders_user_time (user_id, created_at),
  CONSTRAINT fk_orders_users FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Trades
CREATE TABLE IF NOT EXISTS trades (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  user_id INT NOT NULL,
  symbol VARCHAR(32) NOT NULL,
  price DECIMAL(32,12) NOT NULL,
  qty DECIMAL(32,12) NOT NULL CHECK (qty > 0),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_trades_user_time (user_id, created_at),
  CONSTRAINT fk_trades_orders FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_trades_users  FOREIGN KEY (user_id)  REFERENCES users(id)  ON DELETE CASCADE
) ENGINE=InnoDB;

-- Seed base symbols
INSERT IGNORE INTO assets(symbol) VALUES ('BTC-USD'),('ETH-USD'),('BTC'),('ETH');