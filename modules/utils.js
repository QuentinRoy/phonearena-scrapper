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

module.exports = { retry };
