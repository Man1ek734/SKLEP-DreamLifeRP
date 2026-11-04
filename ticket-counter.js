const fs = require('node:fs');
const path = require('node:path');

const directory = process.env.TICKET_DATA_DIR || '/data';
const file = path.join(directory, 'shop-ticket-counter.txt');

function nextTicketNumber() {
  const stat = fs.statSync(directory);
  if (!stat.isDirectory()) throw new Error('Ticket counter directory is not a directory');

  let last = 0n;
  try {
    const text = fs.readFileSync(file, 'utf8').trim();
    if (!/^\d+$/.test(text)) throw new Error('Ticket counter file is invalid');
    last = BigInt(text);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const current = last + 1n;
  const temporary = path.join(directory, '.ticket-counter-' + process.pid + '.tmp');
  fs.writeFileSync(temporary, current.toString(), 'utf8');
  fs.renameSync(temporary, file);
  return current.toString();
}

module.exports = { nextTicketNumber };
