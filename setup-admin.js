'use strict';
/** Interactive setup. Writes ONLY username + salted password hash into local ignored .env. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const readline = require('node:readline/promises');

const ENV = path.join(__dirname, '.env');
function hiddenQuestion(prompt) {
  if (!process.stdin.isTTY) throw new Error('Для настройки нужен интерактивный терминал.');
  return new Promise((resolve, reject) => {
    process.stdout.write(prompt);
    let value = '';
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    const cleanup = () => { process.stdin.removeListener('data', onData); process.stdin.setRawMode(false); process.stdin.pause(); process.stdout.write('\n'); };
    const onData = chunk => {
      for (const char of chunk) {
        if (char === '\u0003') { cleanup(); reject(new Error('Отмена')); return; }
        if (char === '\r' || char === '\n') { cleanup(); resolve(value); return; }
        if (char === '\u007f' || char === '\b') { if (value.length) { value = value.slice(0, -1); process.stdout.write('\b \b'); } }
        else if (char >= ' ' && value.length < 1024) { value += char; process.stdout.write('•'); }
      }
    };
    process.stdin.on('data', onData);
  });
}
async function main() {
  if (fs.existsSync(ENV)) {
    console.error('Файл .env уже существует. Для изменения данных сначала создайте его резервную копию и удалите старый файл.');
    process.exitCode = 1; return;
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  let name;
  try { name = (await rl.question('Логин администратора [vladrogen27]: ')).trim() || 'vladrogen27'; }
  finally { rl.close(); }
  if (!/^[a-zA-Z0-9_.-]{3,80}$/.test(name)) throw new Error('Логин может содержать 3–80 латинских букв, цифр, точек, дефисов или подчёркиваний.');
  const password = await hiddenQuestion('Пароль (будет скрыт): ');
  if (password.length < 10) throw new Error('Пароль должен содержать не менее 10 символов.');
  const confirmation = await hiddenQuestion('Повторите пароль: ');
  if (password !== confirmation) throw new Error('Пароли не совпадают.');
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  const content = [
    '# Automatically generated. Keep this file private.',
    'ADMIN_USERNAME=' + name,
    'ADMIN_PASSWORD_HASH=scrypt$' + salt.toString('hex') + '$' + hash.toString('hex'),
    'PORT=3000',
    'HOST=127.0.0.1',
    'TRUST_PROXY=0',
    ''
  ].join('\n');
  fs.writeFileSync(ENV, content, { mode: 0o600, flag: 'wx' });
  console.log('Админка настроена. Хэш сохранён в .env; исходный пароль туда не записан.');
  console.log('Запуск: npm start');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
