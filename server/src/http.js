"use strict";

function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function requireAuth(req, res, next) {
  if (!req.session || !req.session.user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  next();
}

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function notFound(message) {
  const error = new Error(message);
  error.statusCode = 404;
  return error;
}

module.exports = {
  asyncHandler,
  badRequest,
  notFound,
  requireAuth
};

