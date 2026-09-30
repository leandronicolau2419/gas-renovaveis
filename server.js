import express from "express";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db, publicId, seedAdmin, seedProducts } from "./db.js";

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const app=express();
const PORT=Number(process.env.PORT||3000);
const JWT_SECRET=process.env.JWT_SECRET||"DEV_ONLY_CHANGE_ME";
fs.mkdirSync(path.join(__dirname,"uploads"),{recursive:true});

app.use(helmet({crossOriginResourcePolicy:false}));
app.use(cors());
app.use(express.json({limit:"200kb"}));
app.use(express.urlencoded({extended:true}));
app.use(rateLimit({windowMs:15*60*1000,max:300}));
app.use("/uploads",express.static(path.join(__dirname,"uploads")));
app.use(express.static(path.join(__dirname,"../public")));

const upload=multer({
  dest:path.join(__dirname,"uploads"),
  limits:{fileSize:5*1024*1024},
  fileFilter:(req,file,cb)=>cb(null,/^image\/(jpeg|png|webp)$/.test(file.mimetype))
});

function sign(payload,expiresIn="2h"){return jwt.sign(payload,JWT_SECRET,{expiresIn});}
function auth(req,res,next){
  try{
    const h=req.headers.authorization||"";
    if(!h.startsWith("Bearer ")) throw new Error();
    req.user=jwt.verify(h.slice(7),JWT_SECRET);
    next();
  }catch{res.status(401).json({error:"Não autenticado"});}
}
function admin(req,res,next){
  if(req.user?.role!=="admin") return res.status(403).json({error:"Acesso administrativo necessário"});
  next();
}
function now(){return new Date().toISOString();}
function addLedger(userId,type,amount,refType,refId,note){
  db.prepare(`INSERT INTO ledger(user_id,type,amount,reference_type,reference_id,note) VALUES(?,?,?,?,?,?)`)
    .run(userId,type,amount,refType,refId,note||null);
}
function userView(id){
  const u=db.prepare(`SELECT id,public_id,name,phone,vip,deposit_balance,withdrawal_balance,bonus_balance,commission_balance,invite_code,created_at FROM users WHERE id=?`).get(id);
  if(!u) return null;
  u.active_invested=db.prepare(`SELECT COALESCE(SUM(amount),0) v FROM investments WHERE user_id=? AND status='active'`).get(id).v;
  return u;
}

seedProducts();
if(process.env.ADMIN_EMAIL&&process.env.ADMIN_PASSWORD) seedAdmin(process.env.ADMIN_EMAIL,process.env.ADMIN_PASSWORD);

app.get("/api/health",(req,res)=>res.json({ok:true,time:now()}));

app.post("/api/auth/register",(req,res)=>{
  const {name,phone,password,termsAccepted,inviteCode}=req.body||{};
  if(!name||!phone||!password||!termsAccepted) return res.status(400).json({error:"Dados incompletos"});
  if(String(password).length<8) return res.status(400).json({error:"A senha deve ter pelo menos 8 caracteres"});
  if(db.prepare("SELECT id FROM users WHERE phone=?").get(phone)) return res.status(409).json({error:"Este número já possui uma conta"});
  let inviter=null;
  if(inviteCode) inviter=db.prepare("SELECT id FROM users WHERE invite_code=?").get(inviteCode);
  const info=db.prepare(`INSERT INTO users(public_id,name,phone,password_hash,invite_code,invited_by,terms_accepted_at)
    VALUES(?,?,?,?,?,?,?)`).run(publicId(),name.trim(),phone.trim(),bcrypt.hashSync(password,12),"INV-"+cryptoRandom(),inviter?.id||null,now());
  const user=userView(info.lastInsertRowid);
  const token=sign({sub:user.id,role:"user"});
  res.status(201).json({token,user});
});
function cryptoRandom(){return Math.random().toString(36).slice(2,10).toUpperCase()+Date.now().toString(36).slice(-4);}
app.post("/api/auth/login",(req,res)=>{
  const {phone,password}=req.body||{};
  const u=db.prepare("SELECT * FROM users WHERE phone=?").get(phone);
  if(!u||!bcrypt.compareSync(password,u.password_hash)) return res.status(401).json({error:"Credenciais inválidas"});
  res.json({token:sign({sub:u.id,role:"user"}),user:userView(u.id)});
});
app.post("/api/admin/login",(req,res)=>{
  const {email,password}=req.body||{};
  const a=db.prepare("SELECT * FROM admins WHERE email=?").get(email);
  if(!a||!bcrypt.compareSync(password,a.password_hash)) return res.status(401).json({error:"Credenciais inválidas"});
  res.json({token:sign({sub:a.id,role:"admin"}),admin:{id:a.id,email:a.email}});
});

app.get("/api/me",auth,(req,res)=>res.json({user:userView(req.user.sub)}));
app.get("/api/products",(req,res)=>{
  const rows=db.prepare("SELECT * FROM products WHERE active=1 ORDER BY category,vip_min,price").all();
  res.json({products:rows});
});
app.get("/api/investments",auth,(req,res)=>{
  res.json({investments:db.prepare(`SELECT i.*,p.name product_name,p.category,p.term_days,p.daily_return,p.final_return,p.roi FROM investments i JOIN products p ON p.id=i.product_id WHERE i.user_id=? ORDER BY i.created_at DESC`).all(req.user.sub)});
});

app.post("/api/deposits",auth,upload.single("proof"),(req,res)=>{
  const amount=Number(req.body.amount),bank=String(req.body.bank||"").trim(),reference=String(req.body.reference||"").trim();
  if(!Number.isInteger(amount)||amount<5000||!bank) return res.status(400).json({error:"Valor mínimo de depósito: 5.000 AOA e banco obrigatório"});
  const proof=req.file?"/uploads/"+path.basename(req.file.path):null;
  const info=db.prepare(`INSERT INTO deposits(user_id,amount,bank,reference,proof_path) VALUES(?,?,?,?,?)`).run(req.user.sub,amount,bank,reference,proof);
  res.status(201).json({message:"Depósito enviado para análise",depositId:info.lastInsertRowid});
});

app.post("/api/withdrawals",auth,(req,res)=>{
  const amount=Number(req.body.amount),method=String(req.body.method||"").trim(),destination=String(req.body.destination||"").trim(),password=String(req.body.withdrawalPassword||"");
  if(!Number.isInteger(amount)||amount<4000||!method||!destination) return res.status(400).json({error:"Dados de retirada inválidos"});
  const u=db.prepare("SELECT * FROM users WHERE id=?").get(req.user.sub);
  if(!u.withdrawal_password_hash) return res.status(400).json({error:"Configure primeiro a senha de retirada"});
  if(!bcrypt.compareSync(password,u.withdrawal_password_hash)) return res.status(403).json({error:"Senha de retirada inválida"});
  const fee=Math.floor(amount*0.25),net=amount-fee;
  const tx=db.transaction(()=>{
    const row=db.prepare(`SELECT withdrawal_balance FROM users WHERE id=?`).get(u.id);
    if(row.withdrawal_balance<amount) throw new Error("Saldo insuficiente");
    db.prepare("UPDATE users SET withdrawal_balance=withdrawal_balance-? WHERE id=?").run(amount,u.id);
    const r=db.prepare(`INSERT INTO withdrawals(user_id,amount,fee,net_amount,method,destination) VALUES(?,?,?,?,?,?)`).run(u.id,amount,fee,net,method,destination);
    addLedger(u.id,"withdrawal_hold",-amount,"withdrawal",r.lastInsertRowid,"Retirada pendente");
    return r.lastInsertRowid;
  });
  try{res.status(201).json({message:"Retirada enviada para análise",withdrawalId:tx()})}catch(e){res.status(400).json({error:e.message})}
});

app.post("/api/withdrawal-password",auth,(req,res)=>{
  const {newPassword}=req.body||{};
  if(!newPassword||newPassword.length<8) return res.status(400).json({error:"A senha deve ter pelo menos 8 caracteres"});
  db.prepare("UPDATE users SET withdrawal_password_hash=? WHERE id=?").run(bcrypt.hashSync(newPassword,12),req.user.sub);
  res.json({message:"Senha de retirada atualizada"});
});

app.post("/api/investments",auth,(req,res)=>{
  const productId=Number(req.body.productId);
  const p=db.prepare("SELECT * FROM products WHERE id=? AND active=1").get(productId);
  if(!p) return res.status(404).json({error:"Produto não encontrado"});
  const u=db.prepare("SELECT * FROM users WHERE id=?").get(req.user.sub);
  if(u.vip<p.vip_min) return res.status(403).json({error:`VIP ${p.vip_min} obrigatório`});
  const result=db.transaction(()=>{
    const current=db.prepare("SELECT deposit_balance FROM users WHERE id=?").get(u.id).deposit_balance;
    if(current<p.price) throw new Error("Saldo de depósito insuficiente");
    db.prepare("UPDATE users SET deposit_balance=deposit_balance-?, withdrawal_balance=withdrawal_balance+? WHERE id=?").run(p.price,p.price,u.id);
    const r=db.prepare(`INSERT INTO investments(user_id,product_id,amount,status) VALUES(?,?,?,'active')`).run(u.id,p.id,p.price);
    addLedger(u.id,"investment",-p.price,"investment",r.lastInsertRowid,p.name);
    return r.lastInsertRowid;
  });
  try{res.status(201).json({message:"Investimento criado",investmentId:result()})}catch(e){res.status(400).json({error:e.message})}
});

app.post("/api/bonus/redeem",auth,(req,res)=>{
  const code=String(req.body.code||"").trim().toUpperCase();
  const tx=db.transaction(()=>{
    const c=db.prepare("SELECT * FROM bonus_codes WHERE code=? AND active=1").get(code);
    if(!c||c.uses>=c.max_uses) throw new Error("Código inválido ou esgotado");
    if(c.expires_at&&new Date(c.expires_at)<new Date()) throw new Error("Código expirado");
    if(db.prepare("SELECT id FROM bonus_redemptions WHERE code_id=? AND user_id=?").get(c.id,req.user.sub)) throw new Error("Código já utilizado");
    db.prepare("INSERT INTO bonus_redemptions(code_id,user_id,amount) VALUES(?,?,?)").run(c.id,req.user.sub,c.amount);
    db.prepare("UPDATE bonus_codes SET uses=uses+1 WHERE id=?").run(c.id);
    db.prepare("UPDATE users SET bonus_balance=bonus_balance+? WHERE id=?").run(c.amount,req.user.sub);
    addLedger(req.user.sub,"bonus",c.amount,"bonus_code",c.id,"Resgate de bônus");
    return c.amount;
  });
  try{res.json({message:"Bônus resgatado",amount:tx()})}catch(e){res.status(400).json({error:e.message})}
});

app.post("/api/posts",auth,upload.single("image"),(req,res)=>{
  const content=String(req.body.content||"").trim();
  if(!content||content.length>2000) return res.status(400).json({error:"Conteúdo inválido"});
  const image=req.file?"/uploads/"+path.basename(req.file.path):null;
  const r=db.prepare("INSERT INTO posts(user_id,content,image_path) VALUES(?,?,?)").run(req.user.sub,content,image);
  res.status(201).json({id:r.lastInsertRowid,status:"pending"});
});
app.get("/api/posts",auth,(req,res)=>{
  res.json({posts:db.prepare(`SELECT p.id,p.content,p.image_path,p.status,p.reward,p.created_at,u.name,u.public_id FROM posts p JOIN users u ON u.id=p.user_id WHERE p.status='approved' ORDER BY p.created_at DESC`).all()});
});
app.post("/api/support",auth,(req,res)=>{
  const message=String(req.body.message||"").trim();
  if(!message||message.length>3000) return res.status(400).json({error:"Mensagem inválida"});
  const r=db.prepare("INSERT INTO support_messages(user_id,message) VALUES(?,?)").run(req.user.sub,message);
  res.status(201).json({id:r.lastInsertRowid,status:"open"});
});

app.get("/api/admin/overview",auth,admin,(req,res)=>{
  const q=(sql)=>db.prepare(sql).get().v;
  res.json({users:q("SELECT COUNT(*) v FROM users"),deposits:q("SELECT COUNT(*) v FROM deposits WHERE status='pending'"),withdrawals:q("SELECT COUNT(*) v FROM withdrawals WHERE status='pending'"),investments:q("SELECT COUNT(*) v FROM investments WHERE status='active'")});
});
app.get("/api/admin/deposits",auth,admin,(req,res)=>res.json({items:db.prepare(`SELECT d.*,u.name,u.phone,u.public_id FROM deposits d JOIN users u ON u.id=d.user_id ORDER BY d.created_at DESC`).all()}));
app.post("/api/admin/deposits/:id/approve",auth,admin,(req,res)=>{
  const tx=db.transaction(()=>{
    const d=db.prepare("SELECT * FROM deposits WHERE id=?").get(req.params.id);
    if(!d||d.status!=="pending") throw new Error("Depósito indisponível");
    db.prepare("UPDATE deposits SET status='approved',reviewed_by=?,reviewed_at=? WHERE id=?").run(req.user.sub,now(),d.id);
    db.prepare("UPDATE users SET deposit_balance=deposit_balance+? WHERE id=?").run(d.amount,d.user_id);
    addLedger(d.user_id,"deposit",d.amount,"deposit",d.id,"Depósito aprovado");
  });
  try{tx();res.json({message:"Depósito aprovado"})}catch(e){res.status(400).json({error:e.message})}
});
app.post("/api/admin/deposits/:id/reject",auth,admin,(req,res)=>{
  db.prepare("UPDATE deposits SET status='rejected',reviewed_by=?,reviewed_at=? WHERE id=? AND status='pending'").run(req.user.sub,now(),req.params.id);
  res.json({message:"Depósito rejeitado"});
});
app.get("/api/admin/withdrawals",auth,admin,(req,res)=>res.json({items:db.prepare(`SELECT w.*,u.name,u.phone,u.public_id FROM withdrawals w JOIN users u ON u.id=w.user_id ORDER BY w.created_at DESC`).all()}));
app.post("/api/admin/withdrawals/:id/approve",auth,admin,(req,res)=>{
  const tx=db.transaction(()=>{
    const w=db.prepare("SELECT * FROM withdrawals WHERE id=?").get(req.params.id);
    if(!w||w.status!=="pending") throw new Error("Retirada indisponível");
    db.prepare("UPDATE withdrawals SET status='approved',reviewed_by=?,reviewed_at=? WHERE id=?").run(req.user.sub,now(),w.id);
    addLedger(w.user_id,"withdrawal_completed",-w.net_amount,"withdrawal",w.id,"Retirada aprovada");
  });
  try{tx();res.json({message:"Retirada aprovada"})}catch(e){res.status(400).json({error:e.message})}
});
app.post("/api/admin/withdrawals/:id/reject",auth,admin,(req,res)=>{
  const tx=db.transaction(()=>{
    const w=db.prepare("SELECT * FROM withdrawals WHERE id=?").get(req.params.id);
    if(!w||w.status!=="pending") throw new Error("Retirada indisponível");
    db.prepare("UPDATE withdrawals SET status='rejected',reviewed_by=?,reviewed_at=? WHERE id=?").run(req.user.sub,now(),w.id);
    db.prepare("UPDATE users SET withdrawal_balance=withdrawal_balance+? WHERE id=?").run(w.amount,w.user_id);
    addLedger(w.user_id,"withdrawal_release",w.amount,"withdrawal",w.id,"Retirada rejeitada e saldo devolvido");
  });
  try{tx();res.json({message:"Retirada rejeitada e saldo devolvido"})}catch(e){res.status(400).json({error:e.message})}
});
app.get("/api/admin/posts",auth,admin,(req,res)=>res.json({items:db.prepare(`SELECT p.*,u.name,u.public_id FROM posts p JOIN users u ON u.id=p.user_id ORDER BY p.created_at DESC`).all()}));
app.post("/api/admin/posts/:id/approve",auth,admin,(req,res)=>{db.prepare("UPDATE posts SET status='approved' WHERE id=?").run(req.params.id);res.json({message:"Publicação aprovada"})});
app.post("/api/admin/posts/:id/reject",auth,admin,(req,res)=>{db.prepare("UPDATE posts SET status='rejected' WHERE id=?").run(req.params.id);res.json({message:"Publicação rejeitada"})});

app.get(/.*/,(req,res)=>{
  if(req.path.startsWith("/api/")) return res.status(404).json({error:"Endpoint não encontrado"});
  res.sendFile(path.join(__dirname,"../public/index.html"));
});
app.listen(PORT,()=>console.log(`Gás Renováveis API: http://localhost:${PORT}`));
