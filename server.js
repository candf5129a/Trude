// Trude's shared local test server. The API is intentionally small and the
// static-file map is allow-listed so URLs cannot read arbitrary local files.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { DatabaseSync } = require('node:sqlite');

const scrypt = promisify(crypto.scrypt);
const root = __dirname;
const dataRoot = path.join(root, 'data');
fs.mkdirSync(dataRoot, { recursive: true });
const db = new DatabaseSync(path.join(dataRoot, 'trude.sqlite'));
db.exec(`
 PRAGMA journal_mode = WAL;
 PRAGMA foreign_keys = ON;
 CREATE TABLE IF NOT EXISTS users (
   id INTEGER PRIMARY KEY, email TEXT UNIQUE COLLATE NOCASE, phone TEXT UNIQUE,
   password_hash TEXT NOT NULL, password_salt TEXT NOT NULL, name TEXT NOT NULL,
   handle TEXT NOT NULL UNIQUE COLLATE NOCASE, bio TEXT NOT NULL DEFAULT '',
   website TEXT NOT NULL DEFAULT '', private INTEGER NOT NULL DEFAULT 0,
   avatar_data TEXT NOT NULL DEFAULT '', cover_data TEXT NOT NULL DEFAULT '',
   created_at TEXT NOT NULL, name_changed_at TEXT NOT NULL
 );
 CREATE TABLE IF NOT EXISTS sessions (
   token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
   expires_at INTEGER NOT NULL
 );
 CREATE TABLE IF NOT EXISTS password_resets (
   user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
   code_hash TEXT NOT NULL, expires_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0
 );
 CREATE TABLE IF NOT EXISTS posts (
   id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
   caption TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '', media_data TEXT NOT NULL DEFAULT '',
   media_type TEXT NOT NULL DEFAULT '', media_filter TEXT NOT NULL DEFAULT 'none',
   visibility TEXT NOT NULL DEFAULT 'public', is_story INTEGER NOT NULL DEFAULT 0,
   created_at TEXT NOT NULL
 );
 CREATE TABLE IF NOT EXISTS likes (
   user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
   post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
   created_at TEXT NOT NULL, PRIMARY KEY(user_id,post_id)
 );
 CREATE TABLE IF NOT EXISTS saves (
   user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
   post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
   created_at TEXT NOT NULL, PRIMARY KEY(user_id,post_id)
 );
 CREATE TABLE IF NOT EXISTS follows (
   follower_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
   followed_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
   created_at TEXT NOT NULL, PRIMARY KEY(follower_id,followed_id), CHECK(follower_id<>followed_id)
 );
 CREATE TABLE IF NOT EXISTS comments (
   id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
   post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
   body TEXT NOT NULL, created_at TEXT NOT NULL
 );
 CREATE TABLE IF NOT EXISTS reports (
   id INTEGER PRIMARY KEY, reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
   post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
   reason TEXT NOT NULL, created_at TEXT NOT NULL
 );
 CREATE TABLE IF NOT EXISTS shares (
   id INTEGER PRIMARY KEY, sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
   recipient_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
   post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
   created_at TEXT NOT NULL
 );
 CREATE TABLE IF NOT EXISTS rooms (
   id INTEGER PRIMARY KEY, host_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
   title TEXT NOT NULL, capacity INTEGER NOT NULL DEFAULT 20, duration_minutes INTEGER NOT NULL DEFAULT 30,
   started_at TEXT NOT NULL, expires_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open'
 );
 CREATE TABLE IF NOT EXISTS room_members (
   room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
   user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
   joined_at TEXT NOT NULL, PRIMARY KEY(room_id,user_id)
 );
 CREATE TABLE IF NOT EXISTS room_messages (
   id INTEGER PRIMARY KEY, room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
   user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
   body TEXT NOT NULL, created_at TEXT NOT NULL
 );
 CREATE TABLE IF NOT EXISTS room_game_scores (
   room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
   user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
   score INTEGER NOT NULL DEFAULT 0, eligible INTEGER NOT NULL DEFAULT 1,
   updated_at TEXT NOT NULL, PRIMARY KEY(room_id,user_id)
 );
 CREATE TABLE IF NOT EXISTS direct_messages (
   id INTEGER PRIMARY KEY, sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
   recipient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
   body TEXT NOT NULL, created_at TEXT NOT NULL,
   CHECK(sender_id<>recipient_id)
 );
`);
try{db.exec("ALTER TABLE posts ADD COLUMN media_items TEXT NOT NULL DEFAULT '[]'")}catch(e){if(!String(e.message).includes('duplicate column name'))throw e}

const now = () => new Date().toISOString();
const placeholder = (salt, value) => crypto.timingSafeEqual(Buffer.from(value), Buffer.from(salt));
function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id, email: user.email, phone: user.phone, name: user.name, handle: user.handle,
    bio: user.bio, website: user.website, private: !!user.private,
    avatarData: user.avatar_data || '', coverData: user.cover_data || '',
    createdAt: user.created_at,
  };
}
function send(res, status, data, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin', ...headers,
  });
  res.end(JSON.stringify(data));
}
function cookie(req, name) {
  const pair = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(`${name}=`));
  return pair ? decodeURIComponent(pair.slice(name.length + 1)) : '';
}
function setSession(res, token) {
  res.setHeader('Set-Cookie', `trude_session=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=2592000`);
}
function clearSession(res) {
  res.setHeader('Set-Cookie', 'trude_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0');
}
function currentUser(req) {
  const token = cookie(req, 'trude_session');
  if (!token) return null;
  const row = db.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=? AND s.expires_at>?`).get(crypto.createHash('sha256').update(token).digest('hex'), Date.now());
  return row || null;
}
function needUser(req, res) {
  const user = currentUser(req);
  if (!user) send(res, 401, { error: 'Sign in to do that.' });
  return user;
}
async function readBody(req, max = 12 * 1024 * 1024) {
  let size = 0, chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > max) throw Object.assign(new Error('This upload is too large (12 MB maximum).'), { status: 413 });
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  try { return raw ? JSON.parse(raw) : {}; }
  catch { throw Object.assign(new Error('That request could not be read.'), { status: 400 }); }
}
function parseId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : 0;
}
function setProfileCookie(res, user) { send(res, 200, { user: publicUser(user) }, { 'Set-Cookie': res.getHeader('Set-Cookie') }); }
function postRow(row, userId) {
  const liked = userId ? !!db.prepare('SELECT 1 FROM likes WHERE post_id=? AND user_id=?').get(row.id, userId) : false;
  const saved = userId ? !!db.prepare('SELECT 1 FROM saves WHERE post_id=? AND user_id=?').get(row.id, userId) : false;
  return {
    id: row.id, author: { id: row.author_id || 0, name: row.name || 'Trude creator', handle: row.handle || '@trude',
      private: !!row.author_private, following: userId ? !!db.prepare('SELECT 1 FROM follows WHERE follower_id=? AND followed_id=?').get(userId,row.author_id) : false, avatarData: row.avatar_data || '' },
    caption: row.caption, body: row.body, mediaUrl: row.media_data ? '/api/media/' + row.id + '/0' : '', mediaUrls: (()=>{try{const a=JSON.parse(row.media_items||'[]');return a.length?a.map((_,i)=>'/api/media/'+row.id+'/'+i):(row.media_data?['/api/media/'+row.id+'/0']:[])}catch{return row.media_data?['/api/media/'+row.id+'/0']:[]}})(), mediaType: row.media_type,
    mediaFilter: row.media_filter, visibility: row.visibility, story: !!row.is_story,
    createdAt: row.created_at, likes: Number(row.like_count || 0), comments: Number(row.comment_count || 0),
    liked, saved,
  };
}
function feedRows(user, tab = 'For you') {
  const uid = user?.id || 0;
  let filter = `p.is_story=0`;
  if (tab === 'Following') filter += ` AND (p.user_id IS NULL OR EXISTS (SELECT 1 FROM follows f WHERE f.follower_id=${uid} AND f.followed_id=p.user_id))`;
  if (tab === 'Liked') filter = `EXISTS (SELECT 1 FROM likes l WHERE l.user_id=${uid} AND l.post_id=p.id)`;
  if (tab === 'Saved') filter = `EXISTS (SELECT 1 FROM saves s WHERE s.user_id=${uid} AND s.post_id=p.id)`;
  if (tab === 'Posts') filter = `p.user_id=${uid} AND p.is_story=0`;
  if (tab === 'Shared') filter = `EXISTS (SELECT 1 FROM shares s WHERE s.sender_id=${uid} AND s.post_id=p.id)`;
  if (tab === 'Locked') filter = `p.user_id=${uid} AND p.visibility='private'`;
  return db.prepare(`SELECT p.*,u.id author_id,u.name,u.handle,u.private author_private,u.avatar_data,
    (SELECT COUNT(*) FROM likes l WHERE l.post_id=p.id) like_count,
    (SELECT COUNT(*) FROM comments c WHERE c.post_id=p.id) comment_count
    FROM posts p LEFT JOIN users u ON u.id=p.user_id WHERE ${filter} AND (p.visibility='public' OR p.user_id=${uid} OR (p.visibility='followers' AND EXISTS (SELECT 1 FROM follows f2 WHERE f2.follower_id=${uid} AND f2.followed_id=p.user_id))) AND (u.id IS NULL OR u.private=0 OR u.id=${uid} OR EXISTS (SELECT 1 FROM follows f3 WHERE f3.follower_id=${uid} AND f3.followed_id=u.id)) ORDER BY p.created_at DESC LIMIT 80`).all().map(r => postRow(r, uid));
}
function roomRow(room, userId) {
  return { id: room.id, title: room.title, hostId: room.host_id, hostName: room.host_name, hostHandle: room.host_handle,
    capacity: room.capacity, durationMinutes: room.duration_minutes, startedAt: room.started_at,
    expiresAt: room.expires_at, status: room.status, members: room.members, joined: !!db.prepare('SELECT 1 FROM room_members WHERE room_id=? AND user_id=?').get(room.id,userId) };
}
const roomSelect = `SELECT r.*,u.name host_name,u.handle host_handle,
  (SELECT COUNT(*) FROM room_members rm WHERE rm.room_id=r.id) members FROM rooms r JOIN users u ON u.id=r.host_id`;
function mediaResponse(res, dataUrl) {
  const match = /^data:(image\/(?:png|jpeg|webp|gif)|video\/(?:mp4|webm|quicktime)|audio\/(?:mpeg|mp4|wav|ogg|webm));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl || '');
  if (!match) return false;
  const buffer = Buffer.from(match[2], 'base64');
  res.writeHead(200, { 'Content-Type': match[1], 'Content-Length': buffer.length,
    'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, max-age=300' });
  res.end(buffer); return true;
}

// Small curated starter feed: sample accounts have no credentials and can only
// be followed or commented on; real testers can create accounts and posts.
if (!db.prepare('SELECT COUNT(*) n FROM posts').get().n) {
  const stamp = now();
  for (const [name, handle, caption, body] of [
    ['Mila Moves','mila.moves','POV: the song comes on and the kitchen becomes a stage ✨','little moments — BIG energy'],
    ['Jay Draws','jaydraws','made a tiny poster for the big dreamers 🎨','GO YOUR OWN WAY.'],
    ['The Good Club','thegoodclub','3 ingredient after-school snack. Rate it out of 10 👇','SNACK ATTACK 🍓'],
  ]) {
    const u = db.prepare('INSERT INTO users(email,phone,password_hash,password_salt,name,handle,created_at,name_changed_at) VALUES(NULL,NULL,?,?,?, ?,?,?)');
    const dummy = crypto.randomBytes(32).toString('hex'), salt = crypto.randomBytes(16).toString('hex');
    const result = u.run(dummy, salt, name, handle, stamp, stamp);
    db.prepare('INSERT INTO posts(user_id,caption,body,created_at) VALUES(?,?,?,?)').run(Number(result.lastInsertRowid), caption, body, stamp);
  }
}

async function api(req, res, url) {
  const method = req.method, pathname = url.pathname;
  if (method === 'GET' && pathname === '/api/health') return send(res, 200, { ok: true, storage: 'sqlite' });
  if (method === 'POST' && pathname === '/api/auth/signup') {
    const body = await readBody(req, 32000);
    const name = String(body.name || '').trim().slice(0, 40);
    const handle = String(body.handle || '').trim().replace(/^@/, '').slice(0, 24);
    const identifier = String(body.identifier || '').trim();
    const email = identifier.includes('@') ? identifier.toLowerCase() : null;
    const phone = email ? null : identifier.replace(/[\s()-]/g, '');
    const password = String(body.password || '');
    if (name.length < 2 || !/^[a-zA-Z0-9_.]{3,24}$/.test(handle)) return send(res, 400, { error: 'Enter a name and a handle with 3–24 letters, numbers, dots, or underscores.' });
    if ((email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) || (!email && !/^\+?[0-9]{7,15}$/.test(phone))) return send(res, 400, { error: 'Enter a valid email address or phone number.' });
    if (password.length < 10) return send(res, 400, { error: 'Use a password with at least 10 characters.' });
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = (await scrypt(password, salt, 64)).toString('hex');
    try {
      const stamp = now();
      const result = db.prepare('INSERT INTO users(email,phone,password_hash,password_salt,name,handle,created_at,name_changed_at) VALUES(?,?,?,?,?,?,?,?)').run(email, phone, hash, salt, name, handle, stamp, stamp);
      const user = db.prepare('SELECT * FROM users WHERE id=?').get(Number(result.lastInsertRowid));
      const token = crypto.randomBytes(32).toString('base64url');
      db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(crypto.createHash('sha256').update(token).digest('hex'), user.id, Date.now() + 30 * 86400000);
      setSession(res, token); return setProfileCookie(res, user);
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) return send(res, 409, { error: 'That email, phone, or handle is already in use.' });
      throw e;
    }
  }
  if (method === 'POST' && pathname === '/api/auth/login') {
    const body = await readBody(req, 16000), identifier = String(body.identifier || '').trim();
    const user = db.prepare('SELECT * FROM users WHERE email=? COLLATE NOCASE OR phone=?').get(identifier.toLowerCase(), identifier.replace(/[\s()-]/g, ''));
    if (!user) return send(res, 401, { error: 'Email/phone or password is incorrect.' });
    const candidate = (await scrypt(String(body.password || ''), user.password_salt, 64)).toString('hex');
    if (candidate.length !== user.password_hash.length || !placeholder(user.password_hash, candidate)) return send(res, 401, { error: 'Email/phone or password is incorrect.' });
    const token = crypto.randomBytes(32).toString('base64url');
    db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(crypto.createHash('sha256').update(token).digest('hex'), user.id, Date.now() + 30 * 86400000);
    setSession(res, token); return setProfileCookie(res, user);
  }
  if (method === 'POST' && pathname === '/api/auth/logout') {
    const token = cookie(req, 'trude_session');
    if (token) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(crypto.createHash('sha256').update(token).digest('hex'));
    clearSession(res); return send(res, 200, { ok: true });
  }
  if (method === 'GET' && pathname === '/api/auth/me') return send(res, 200, { user: publicUser(currentUser(req)) });
  if (method === 'POST' && pathname === '/api/auth/forgot') {
    const body=await readBody(req,8000),identifier=String(body.identifier||'').trim(),user=db.prepare('SELECT * FROM users WHERE email=? COLLATE NOCASE OR phone=?').get(identifier.toLowerCase(),identifier.replace(/[\s()-]/g,''));
    if(!user)return send(res,200,{ok:true,message:'If the account exists, a reset code has been prepared.'});
    const code=String(crypto.randomInt(0,1000000)).padStart(6,'0'),hash=crypto.createHash('sha256').update(code+':'+user.id).digest('hex');
    db.prepare('INSERT INTO password_resets(user_id,code_hash,expires_at,attempts) VALUES(?,?,?,0) ON CONFLICT(user_id) DO UPDATE SET code_hash=excluded.code_hash,expires_at=excluded.expires_at,attempts=0').run(user.id,hash,Date.now()+15*60*1000);
    return send(res,200,{ok:true,message:'A reset code is ready. In local test mode, copy the code shown here.',...(process.env.TRUDE_TEST_MODE==='0'?{}:{resetCode:code})});
  }
  if (method === 'POST' && pathname === '/api/auth/reset') {
    const body=await readBody(req,8000),identifier=String(body.identifier||'').trim(),user=db.prepare('SELECT * FROM users WHERE email=? COLLATE NOCASE OR phone=?').get(identifier.toLowerCase(),identifier.replace(/[\s()-]/g,'')),reset=user&&db.prepare('SELECT * FROM password_resets WHERE user_id=?').get(user.id);
    if(!user||!reset||reset.expires_at<Date.now()||reset.attempts>=5)return send(res,400,{error:'That reset code has expired or is invalid.'});
    const code=String(body.code||''),candidate=crypto.createHash('sha256').update(code+':'+user.id).digest('hex');
    if(candidate!==reset.code_hash){db.prepare('UPDATE password_resets SET attempts=attempts+1 WHERE user_id=?').run(user.id);return send(res,400,{error:'That reset code has expired or is invalid.'})}
    const password=String(body.password||'');if(password.length<10)return send(res,400,{error:'Use a password with at least 10 characters.'});
    const salt=crypto.randomBytes(16).toString('hex'),hash=(await scrypt(password,salt,64)).toString('hex');
    db.prepare('UPDATE users SET password_hash=?,password_salt=? WHERE id=?').run(hash,salt,user.id);db.prepare('DELETE FROM password_resets WHERE user_id=?').run(user.id);db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
    return send(res,200,{ok:true,message:'Password updated. Sign in with your new password.'});
  }
  if (method === 'POST' && pathname === '/api/auth/google') return send(res, 501, { error: 'Google sign-in needs the Trude Google OAuth client ID and a verified callback URL.' });

  if (method === 'GET' && pathname === '/api/feed') return send(res, 200, { posts: feedRows(currentUser(req), url.searchParams.get('tab') || 'For you') });
  if (method === 'GET' && pathname.startsWith('/api/media/')) {
    const match=pathname.match(/^\/api\/media\/(\d+)(?:\/(\d+))?$/),id=match&&parseId(match[1]),index=Number(match?.[2]||0),row=id&&db.prepare('SELECT p.media_data,p.media_items,p.visibility,p.user_id,u.private FROM posts p LEFT JOIN users u ON u.id=p.user_id WHERE p.id=?').get(id),viewer=currentUser(req);
    const follows=!!(row&&viewer&&row.user_id&&db.prepare('SELECT 1 FROM follows WHERE follower_id=? AND followed_id=?').get(viewer.id,row.user_id));
    const allowed=row&&(!row.private||viewer?.id===row.user_id||follows)&&(row.visibility==='public'||viewer?.id===row.user_id||(row.visibility==='followers'&&follows));
    let selected=row?.media_data||'';try{const items=JSON.parse(row?.media_items||'[]');if(items[index])selected=items[index]}catch{}
    if(!allowed||!mediaResponse(res,selected))return send(res,404,{error:'Media not found.'});return;
  }
  if (method === 'POST' && pathname === '/api/posts') {
    const user = needUser(req, res); if (!user) return;
    const b = await readBody(req, 12 * 1024 * 1024), caption = String(b.caption || '').slice(0, 500), body = String(b.body || '').slice(0, 3000);
    if (!caption && !body && !b.mediaData) return send(res, 400, { error: 'Add some text or choose a photo, video, or audio file first.' });
    const items=Array.isArray(b.mediaItems)?b.mediaItems.slice(0,6):(b.mediaData?[b.mediaData]:[]),totalBytes=items.reduce((n,d)=>n+Buffer.byteLength(String(d),'utf8'),0);
    if(items.length>6||totalBytes>10*1024*1024)return send(res,413,{error:'Use up to 6 photos and keep the combined upload under 7 MB.'});
    const valid=/^data:(image\/(?:png|jpeg|webp|gif)|video\/(?:mp4|webm|quicktime)|audio\/(?:mpeg|mp4|wav|ogg|webm));base64,[A-Za-z0-9+/=]+$/;
    if(items.some(d=>!valid.test(String(d))))return send(res,400,{error:'That media type is not supported.'});
    const first=items[0]||'';
    const result = db.prepare('INSERT INTO posts(user_id,caption,body,media_data,media_items,media_type,media_filter,visibility,is_story,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(user.id,caption,body,first,JSON.stringify(items),String(b.mediaType||'').slice(0,60),String(b.filter||'none').slice(0,40),['public','followers','private'].includes(b.visibility)?b.visibility:'public',b.story?1:0,now());
    return send(res, 201, { id: Number(result.lastInsertRowid) });
  }
  let m = pathname.match(/^\/api\/posts\/(\d+)\/(like|save|comments|report|share)$/);
  if (m) {
    const user = needUser(req, res); if (!user) return;
    const postId = parseId(m[1]), action = m[2];
    if (!db.prepare('SELECT 1 FROM posts WHERE id=?').get(postId)) return send(res, 404, { error: 'Post not found.' });
    if (action === 'like' || action === 'save') {
      const table = action === 'like' ? 'likes' : 'saves';
      const exists = db.prepare(`SELECT 1 FROM ${table} WHERE user_id=? AND post_id=?`).get(user.id,postId);
      if (exists) db.prepare(`DELETE FROM ${table} WHERE user_id=? AND post_id=?`).run(user.id,postId);
      else db.prepare(`INSERT INTO ${table}(user_id,post_id,created_at) VALUES(?,?,?)`).run(user.id,postId,now());
      return send(res, 200, { active: !exists });
    }
    if (action === 'comments' && method === 'GET') return send(res,200,{comments:db.prepare(`SELECT c.id,c.body,c.created_at,u.name,u.handle,u.avatar_data FROM comments c JOIN users u ON u.id=c.user_id WHERE c.post_id=? ORDER BY c.created_at`).all(postId)});
    const b = await readBody(req, 24000);
    if (action === 'comments') {
      const body=String(b.body||'').trim().slice(0,500); if(!body)return send(res,400,{error:'Write a comment first.'});
      const result=db.prepare('INSERT INTO comments(user_id,post_id,body,created_at) VALUES(?,?,?,?)').run(user.id,postId,body,now());return send(res,201,{id:Number(result.lastInsertRowid)});
    }
    if (action === 'report') {const reason=String(b.reason||'').slice(0,100);db.prepare('INSERT INTO reports(reporter_id,post_id,reason,created_at) VALUES(?,?,?,?)').run(user.id,postId,reason,now());return send(res,201,{ok:true});}
    if (action === 'share') {const recipient=parseId(b.recipientId)||null;db.prepare('INSERT INTO shares(sender_id,recipient_id,post_id,created_at) VALUES(?,?,?,?)').run(user.id,recipient,postId,now());return send(res,201,{ok:true});}
  }
  if (method === 'GET' && pathname === '/api/search') {
    const q=String(url.searchParams.get('q')||'').trim().slice(0,50), like=`%${q.replace(/[%_]/g,'')}%`;
    const users=db.prepare('SELECT id,name,handle,bio,private,avatar_data FROM users WHERE handle LIKE ? OR name LIKE ? LIMIT 20').all(like,like);
    const posts=q?db.prepare(`SELECT p.*,u.id author_id,u.name,u.handle,u.private author_private,u.avatar_data,(SELECT COUNT(*) FROM likes WHERE post_id=p.id) like_count,(SELECT COUNT(*) FROM comments WHERE post_id=p.id) comment_count FROM posts p LEFT JOIN users u ON u.id=p.user_id WHERE p.visibility='public' AND (u.private=0 OR u.id=? OR EXISTS (SELECT 1 FROM follows f WHERE f.follower_id=? AND f.followed_id=u.id)) AND (p.caption LIKE ? OR p.body LIKE ?) ORDER BY p.created_at DESC LIMIT 24`).all(currentUser(req)?.id||0,currentUser(req)?.id||0,like,like).map(r=>postRow(r,currentUser(req)?.id)):[];
    return send(res,200,{users,posts});
  }
  m=pathname.match(/^\/api\/profiles\/([^/]+)$/);
  if(m&&method==='GET'){
    const target=db.prepare('SELECT * FROM users WHERE handle=? COLLATE NOCASE').get(decodeURIComponent(m[1]).replace(/^@/,''));
    if(!target)return send(res,404,{error:'Creator not found.'});
    const viewer=currentUser(req), following=viewer?!!db.prepare('SELECT 1 FROM follows WHERE follower_id=? AND followed_id=?').get(viewer.id,target.id):false;
    const locked=!!target.private&&(!viewer||viewer.id!==target.id)&&!following;
    const counts={followers:db.prepare('SELECT COUNT(*) n FROM follows WHERE followed_id=?').get(target.id).n,following:db.prepare('SELECT COUNT(*) n FROM follows WHERE follower_id=?').get(target.id).n,likes:db.prepare('SELECT COUNT(*) n FROM likes l JOIN posts p ON p.id=l.post_id WHERE p.user_id=?').get(target.id).n,posts:db.prepare('SELECT COUNT(*) n FROM posts WHERE user_id=? AND is_story=0').get(target.id).n};
    const rows=locked?[]:feedRows(target,'Posts');return send(res,200,{profile:publicUser(target),following,locked,counts,posts:rows});
  }
  m=pathname.match(/^\/api\/profiles\/(\d+)\/(follow|followers|following|analytics|update|avatar|cover)$/);
  if(m){const targetId=parseId(m[1]), action=m[2], viewer=needUser(req,res);if(!viewer)return;
    if(action==='follow'&&method==='POST'){if(viewer.id===targetId)return send(res,400,{error:'You cannot follow yourself.'});const exists=db.prepare('SELECT 1 FROM follows WHERE follower_id=? AND followed_id=?').get(viewer.id,targetId);if(exists)db.prepare('DELETE FROM follows WHERE follower_id=? AND followed_id=?').run(viewer.id,targetId);else db.prepare('INSERT INTO follows(follower_id,followed_id,created_at) VALUES(?,?,?)').run(viewer.id,targetId,now());return send(res,200,{following:!exists});}
    if((action==='followers'||action==='following')&&method==='GET'){const col=action==='followers'?'followed_id':'follower_id',join=action==='followers'?'follower_id':'followed_id';return send(res,200,{users:db.prepare(`SELECT u.id,u.name,u.handle,u.bio,u.avatar_data FROM follows f JOIN users u ON u.id=f.${join} WHERE f.${col}=? ORDER BY f.created_at DESC`).all(targetId)});}
    if(action==='analytics'&&method==='GET'){if(viewer.id!==targetId)return send(res,403,{error:'These analytics are private.'});return send(res,200,{likes:db.prepare('SELECT COUNT(*) n FROM likes l JOIN posts p ON p.id=l.post_id WHERE p.user_id=?').get(targetId).n,followers:db.prepare('SELECT COUNT(*) n FROM follows WHERE followed_id=?').get(targetId).n,following:db.prepare('SELECT COUNT(*) n FROM follows WHERE follower_id=?').get(targetId).n,posts:db.prepare('SELECT COUNT(*) n FROM posts WHERE user_id=?').get(targetId).n,comments:db.prepare('SELECT COUNT(*) n FROM comments c JOIN posts p ON p.id=c.post_id WHERE p.user_id=?').get(targetId).n});}
    if((action==='update'||action==='avatar'||action==='cover')&&method==='POST'){if(viewer.id!==targetId)return send(res,403,{error:'You can only edit your own profile.'});const b=await readBody(req,3*1024*1024);if(action==='update'){const name=String(b.name||'').trim().slice(0,40),bio=String(b.bio||'').slice(0,240),website=String(b.website||'').trim().slice(0,200),handle=String(b.handle||'').replace(/^@/,'').trim();if(name.length<2||!/^[a-zA-Z0-9_.]{3,24}$/.test(handle))return send(res,400,{error:'Check your name and handle.'});const old=db.prepare('SELECT name_changed_at FROM users WHERE id=?').get(targetId);if(name!==viewer.name&&Date.now()-Date.parse(old.name_changed_at)<90*86400000)return send(res,400,{error:'You can change your display name once every 3 months.'});try{db.prepare('UPDATE users SET name=?,handle=?,bio=?,website=?,private=?,name_changed_at=? WHERE id=?').run(name,handle,bio,website,b.private?1:0,name!==viewer.name?now():old.name_changed_at,targetId)}catch(e){if(String(e.message).includes('UNIQUE'))return send(res,409,{error:'That handle is already taken.'});throw e}}else{const data=String(b.data||'');if(!/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(data))return send(res,400,{error:'Use a PNG, JPEG, or WebP image.'});db.prepare(`UPDATE users SET ${action==='avatar'?'avatar_data':'cover_data'}=? WHERE id=?`).run(data,targetId)}return send(res,200,{user:publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(targetId))});}
  }
  if(method==='GET'&&pathname==='/api/chats'){const user=needUser(req,res);if(!user)return;const peers=db.prepare(`SELECT u.id,u.name,u.handle,u.avatar_data,MAX(d.id) last_id,(SELECT body FROM direct_messages x WHERE (x.sender_id=u.id AND x.recipient_id=?) OR (x.sender_id=? AND x.recipient_id=u.id) ORDER BY x.id DESC LIMIT 1) last_message,(SELECT created_at FROM direct_messages x WHERE (x.sender_id=u.id AND x.recipient_id=?) OR (x.sender_id=? AND x.recipient_id=u.id) ORDER BY x.id DESC LIMIT 1) last_at FROM direct_messages d JOIN users u ON u.id=CASE WHEN d.sender_id=? THEN d.recipient_id ELSE d.sender_id END WHERE d.sender_id=? OR d.recipient_id=? GROUP BY u.id ORDER BY last_id DESC LIMIT 100`).all(user.id,user.id,user.id,user.id,user.id,user.id,user.id);return send(res,200,{chats:peers});}
  m=pathname.match(/^\/api\/chats\/(\d+)\/messages$/);
  if(m){const user=needUser(req,res);if(!user)return;const peerId=parseId(m[1]);if(peerId===user.id)return send(res,400,{error:'Choose another person to message.'});const peer=db.prepare('SELECT id,private FROM users WHERE id=?').get(peerId);if(!peer)return send(res,404,{error:'That profile could not be found.'});if(peer.private&&!db.prepare('SELECT 1 FROM follows WHERE follower_id=? AND followed_id=?').get(user.id,peerId))return send(res,403,{error:'Follow this private account before messaging.'});if(method==='GET'){const after=Number(url.searchParams.get('after')||0);const messages=db.prepare(`SELECT d.id,d.sender_id,d.recipient_id,d.body,d.created_at,u.name,u.handle,u.avatar_data FROM direct_messages d JOIN users u ON u.id=d.sender_id WHERE ((d.sender_id=? AND d.recipient_id=?) OR (d.sender_id=? AND d.recipient_id=?)) AND d.id>? ORDER BY d.id LIMIT 100`).all(user.id,peerId,peerId,user.id,after);return send(res,200,{messages,peer:publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(peerId))});}if(method==='POST'){const b=await readBody(req,12000),body=String(b.body||'').trim().slice(0,2000);if(!body)return send(res,400,{error:'Write a message first.'});const row=db.prepare('INSERT INTO direct_messages(sender_id,recipient_id,body,created_at) VALUES(?,?,?,?)').run(user.id,peerId,body,now());return send(res,201,{id:Number(row.lastInsertRowid)});}}
  m=pathname.match(/^\/api\/rooms\/(\d+)\/members$/);
  if(m&&method==='GET'){const user=needUser(req,res);if(!user)return;const id=parseId(m[1]);if(!db.prepare('SELECT 1 FROM room_members WHERE room_id=? AND user_id=?').get(id,user.id))return send(res,403,{error:'Join the lobby to see its players.'});return send(res,200,{members:db.prepare('SELECT u.id,u.name,u.handle,u.avatar_data,rm.joined_at FROM room_members rm JOIN users u ON u.id=rm.user_id WHERE rm.room_id=? ORDER BY rm.joined_at').all(id)});}
  m=pathname.match(/^\/api\/rooms\/(\d+)\/scores$/);
  if(m){const user=needUser(req,res);if(!user)return;const id=parseId(m[1]);if(!db.prepare('SELECT 1 FROM room_members WHERE room_id=? AND user_id=?').get(id,user.id))return send(res,403,{error:'Join the lobby to view game scores.'});if(method==='GET')return send(res,200,{scores:db.prepare('SELECT u.id,u.name,u.handle,s.score,s.eligible FROM room_game_scores s JOIN users u ON u.id=s.user_id WHERE s.room_id=? ORDER BY s.score DESC,u.name COLLATE NOCASE').all(id)});if(method==='POST'){const b=await readBody(req,12000),deltas=Array.isArray(b.deltas)?b.deltas.slice(0,20):[],out=Array.isArray(b.eliminate)?b.eliminate.slice(0,20):[];db.exec('BEGIN IMMEDIATE');try{for(const row of deltas){const uid=parseId(row.userId);if(!uid||!db.prepare('SELECT 1 FROM room_members WHERE room_id=? AND user_id=?').get(id,uid))continue;db.prepare('INSERT INTO room_game_scores(room_id,user_id,score,eligible,updated_at) VALUES(?,?,?,1,?) ON CONFLICT(room_id,user_id) DO UPDATE SET score=score+excluded.score,updated_at=excluded.updated_at').run(id,uid,Math.max(0,Math.min(10,Number(row.points)||0)),now())}for(const rawId of out){const uid=parseId(rawId);if(uid&&db.prepare('SELECT 1 FROM room_members WHERE room_id=? AND user_id=?').get(id,uid))db.prepare('INSERT INTO room_game_scores(room_id,user_id,score,eligible,updated_at) VALUES(?,?,0,0,?) ON CONFLICT(room_id,user_id) DO UPDATE SET eligible=0,updated_at=excluded.updated_at').run(id,uid,now())}db.exec('COMMIT')}catch(e){db.exec('ROLLBACK');throw e}return send(res,200,{ok:true})}}
  if(method==='GET'&&pathname==='/api/rooms'){const user=currentUser(req);db.prepare("UPDATE rooms SET status='closed' WHERE status='open' AND expires_at<=?").run(now());return send(res,200,{rooms:db.prepare(`${roomSelect} WHERE r.status='open' ORDER BY (SELECT COUNT(*) FROM room_members rm WHERE rm.room_id=r.id) DESC,r.started_at DESC LIMIT 40`).all().map(r=>roomRow(r,user?.id||0))});}
  if(method==='POST'&&pathname==='/api/rooms'){const user=needUser(req,res);if(!user)return;const b=await readBody(req,12000),capacity=Math.min(20,Math.max(2,Number(b.capacity)||20)),duration=Math.min(120,Math.max(5,Number(b.duration)||30)),stamp=now(),expires=new Date(Date.now()+duration*60000).toISOString(),title=String(b.title||`${user.name}'s lobby`).trim().slice(0,70);const r=db.prepare('INSERT INTO rooms(host_id,title,capacity,duration_minutes,started_at,expires_at) VALUES(?,?,?,?,?,?)').run(user.id,title,capacity,duration,stamp,expires);db.prepare('INSERT INTO room_members(room_id,user_id,joined_at) VALUES(?,?,?)').run(Number(r.lastInsertRowid),user.id,stamp);return send(res,201,{room:Number(r.lastInsertRowid)});}
  m=pathname.match(/^\/api\/rooms\/(\d+)\/(join|messages|leave)$/);
  if(m){const user=needUser(req,res);if(!user)return;const id=parseId(m[1]),action=m[2],room=db.prepare(`${roomSelect} WHERE r.id=?`).get(id);if(!room||room.status!=='open'||Date.parse(room.expires_at)<Date.now())return send(res,404,{error:'That lobby has ended.'});if(action==='join'&&method==='POST'){const existing=db.prepare('SELECT 1 FROM room_members WHERE room_id=? AND user_id=?').get(id,user.id);if(!existing&&room.members>=room.capacity)return send(res,409,{error:'This lobby is full.'});db.prepare('INSERT OR IGNORE INTO room_members(room_id,user_id,joined_at) VALUES(?,?,?)').run(id,user.id,now());return send(res,200,{room:roomRow(db.prepare(`${roomSelect} WHERE r.id=?`).get(id),user.id)});}
    if(action==='leave'&&method==='POST'){db.prepare('DELETE FROM room_members WHERE room_id=? AND user_id=?').run(id,user.id);return send(res,200,{ok:true});}
    if(action==='messages'&&method==='GET'){if(!db.prepare('SELECT 1 FROM room_members WHERE room_id=? AND user_id=?').get(id,user.id))return send(res,403,{error:'Join the lobby to read its chat.'});const after=Number(url.searchParams.get('after')||0);return send(res,200,{messages:db.prepare('SELECT m.id,m.body,m.created_at,u.name,u.handle FROM room_messages m JOIN users u ON u.id=m.user_id WHERE m.room_id=? AND m.id>? ORDER BY m.id LIMIT 100').all(id,after)});}
    if(action==='messages'&&method==='POST'){if(!db.prepare('SELECT 1 FROM room_members WHERE room_id=? AND user_id=?').get(id,user.id))return send(res,403,{error:'Join the lobby before chatting.'});const b=await readBody(req,12000),body=String(b.body||'').trim().slice(0,500);if(!body)return send(res,400,{error:'Write a message first.'});const result=db.prepare('INSERT INTO room_messages(room_id,user_id,body,created_at) VALUES(?,?,?,?)').run(id,user.id,body,now());return send(res,201,{id:Number(result.lastInsertRowid)});}}
  return send(res,404,{error:'Not found.'});
}

const assets = new Map([
 ['/',['index.html','text/html; charset=utf-8']], ['/index.html',['index.html','text/html; charset=utf-8']],
 ['/styles.css',['styles.css','text/css; charset=utf-8']], ['/app.js',['app.js','text/javascript; charset=utf-8']], ['/truth-dare.js',['truth-dare.js','text/javascript; charset=utf-8']],
]);
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname.startsWith('/api/')){try{return await api(req,res,url)}catch(e){console.error(e);return send(res,e.status||500,{error:e.status?e.message:'Something went wrong. Please try again.'})}}
  if(req.method==='GET'&&url.pathname.startsWith('/api/media/')){const id=parseId(url.pathname.slice('/api/media/'.length)),row=db.prepare('SELECT media_data FROM posts WHERE id=?').get(id);if(row&&mediaResponse(res,row.media_data))return;return send(res,404,{error:'Media not found.'})}
  const asset=assets.get(url.pathname);
  if(req.method!=='GET'||!asset){res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8','X-Content-Type-Options':'nosniff'});return res.end('Not found')}
  fs.readFile(path.join(root,asset[0]),(error,contents)=>{if(error){res.writeHead(500);return res.end('Unable to read app asset')}res.writeHead(200,{'Content-Type':asset[1],'X-Content-Type-Options':'nosniff','Cache-Control':'no-cache'});res.end(contents)});
});
server.listen(Number(process.env.PORT)||4173,'0.0.0.0',()=>console.log(`Trude shared test server: http://localhost:${Number(process.env.PORT)||4173}`));
process.on('SIGINT',()=>{db.close();server.close(()=>process.exit(0))});
