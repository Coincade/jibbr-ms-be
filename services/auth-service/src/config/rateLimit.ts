import rateLimit from "express-rate-limit";

export const appLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, //60 mins
  limit: 100,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: "Too many requests, please try again later.",
});

export const authLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, //60 mins
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: "Too many requests, please try again later.",
});
