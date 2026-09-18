// Express 4 doesn't automatically catch errors thrown inside an async
// function — an unhandled rejection there just hangs the request. Wrapping
// every async handler with this passes any error to next(), which
// server.js's error-handling middleware turns into a proper 500 response.
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = asyncHandler;
