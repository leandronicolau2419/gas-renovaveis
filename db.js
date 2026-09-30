import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const dbPath = process.env.DATABASE_PATH || "gas-renovaveis.sqlite";
if (dbPath !== ":memory:") fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
export const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  withdrawal_password_hash TEXT,
  vip INTEGER NOT NULL DEFAULT 0,
  deposit_balance INTEGER NOT NULL DEFAULT 0,
  withdrawal_balance INTEGER NOT NULL DEFAULT 0,
  bonus_balance INTEGER NOT NULL DEFAULT 0,
  commission_balance INTEGER NOT NULL DEFAULT 0,
  invite_code TEXT NOT NULL UNIQUE,
  invited_by INTEGER,
  terms_accepted_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(invited_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  vip_min INTEGER NOT NULL DEFAULT 0,
  term_days INTEGER NOT NULL,
  price INTEGER NOT NULL,
  daily_return INTEGER NOT NULL DEFAULT 0,
  final_return INTEGER NOT NULL DEFAULT 0,
  roi TEXT NOT NULL DEFAULT '',
  max_parts INTEGER NOT NULL DEFAULT 1,
  first_bonus INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS investments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  started_at TEXT,
  ends_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id),
  FOREIGN KEY(product_id) REFERENCES products(id)
);

CREATE TABLE IF NOT EXISTS deposits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  bank TEXT NOT NULL,
  reference TEXT,
  proof_path TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  reviewed_by INTEGER,
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS withdrawals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  fee INTEGER NOT NULL DEFAULT 0,
  net_amount INTEGER NOT NULL,
  method TEXT NOT NULL,
  destination TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_by INTEGER,
  reviewed_at TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS bonus_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  amount INTEGER NOT NULL,
  expires_at TEXT,
  max_uses INTEGER NOT NULL DEFAULT 1,
  uses INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS bonus_redemptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(code_id,user_id),
  FOREIGN KEY(code_id) REFERENCES bonus_codes(id),
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  content TEXT NOT NULL,
  image_path TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  reward INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS support_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  amount INTEGER NOT NULL,
  reference_type TEXT,
  reference_id INTEGER,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);

function publicId(){
  return "GR-" + Date.now().toString(36).toUpperCase() + "-" + crypto.randomBytes(3).toString("hex").toUpperCase();
}
export function seedAdmin(email, password){
  const exists = db.prepare("SELECT id FROM admins WHERE email=?").get(email);
  if(!exists){
    db.prepare("INSERT INTO admins(email,password_hash) VALUES(?,?)")
      .run(email, bcrypt.hashSync(password, 12));
  }
}
export function seedProducts(){
  const count = db.prepare("SELECT COUNT(*) c FROM products").get().c;
  if(count) return;
  const long = [
    ["Energia Solar Inicial",5000,1500,60,90000,"1800%",10,100],
    ["Biogás Essencial",15000,4800,60,288000,"1920%",10,200],
    ["Biomassa Verde",35000,11550,60,693000,"1980%",10,300],
    ["Energia Renovável Plus",98000,33320,60,1999200,"2040%",10,500],
    ["Energia Sustentável Pro",150000,52500,60,3150000,"2100%",1,1000],
    ["Projeto Renovável Premium",300000,108000,60,6480000,"2160%",1,2000]
  ];
  const stmt=db.prepare(`INSERT INTO products(name,category,vip_min,term_days,price,daily_return,final_return,roi,max_parts,first_bonus)
    VALUES(?,?,?,?,?,?,?,?,?,?)`);
  for(const p of long) stmt.run(p[0],"long",0,p[3],p[1],p[2],p[4],p[5],p[6],p[7]);

  const short=[
    [1,"Biogás Start",5000,7000,7000,"140%"],
    [2,"Energia Solar Plus",10000,18000,18000,"180%"],
    [3,"Biomassa Power",35000,66500,66500,"190%"],
    [4,"Energia Verde Pro",85000,170000,170000,"200%"],
    [5,"Gás Renovável Premium",150000,315000,315000,"210%"],
    [6,"Energia Sustentável Elite",300000,660000,660000,"220%"]
  ];
  for(const p of short) stmt.run(p[1],"short",p[0],1,p[2],p[3],p[4],p[5],1,0);
  const vipLong=[5000,70000,265000,1000000,3000000];
  vipLong.forEach((price,i)=>stmt.run(`VIP ${i+1} — Longo Prazo`,"vip_long",i+1,90,price,0,0,"",1,0));
}
export { publicId };
