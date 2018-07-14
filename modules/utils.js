const sanitizeFileName = require('sanitize-filename');
const http = require('https');
const fs = require('fs');

const retry = n => f => {
  // Set up end of recursion.
  if (n <= 0) return f();
  try {
    const r = f();
    // Recognize promises and manage asynchronous errors and success.
    if (typeof r.then === 'function') {
      return r.then(x => x, () => retry(n - 1)(f));
    }
    // Manage synchronous success.
    return r;
  } catch (e) {
    // Manage synchronous errors.
    return retry(n - 1)(f);
  }
};

const getPhoneFileName = ({ address }) =>
  `${sanitizeFileName(address.replace('https://www.phonearena.com/', ''), {
    replacement: '_',
  })}.json`;

const download = (url, dest) =>
  new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    http
      .get(url, response => {
        response.pipe(file);
        file.on('finish', () => {
          file.close(resolve); // close() is async, call cb after close completes.
        });
      })
      .on('error', err => {
        // Handle errors
        fs.unlink(dest); // Delete the file async. (But we don't check the result)
        reject(err);
      });
  });

module.exports = { retry, getPhoneFileName, download };
