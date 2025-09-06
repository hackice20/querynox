const { createLogger, format, transports } = require("winston");
const LokiTransport = require('winston-loki');
const { colorizeLevel, colorizeRequest } = require("../services/colorService");

/** * Levels and Priority error: 0, warn: 1, info: 2, http: 3, verbose: 4, debug: 5, silly: 6 */

const logger = createLogger({
  level: process.env.NODE_ENV !== "production" ? "silly" :" http", // accept all levels >= silly on Development
  format: format.combine(
    format.timestamp(),
    format.errors({ stack: true }), // ensures error stack traces are logged
    format.splat(),
    format.json() // base format for Loki
  ),
  transports:[
    new transports.File({ filename: "logs/error.log", level: "error" }),
    new transports.File({ filename: "logs/combined.log" })
  ]
});

logger.add(new LokiTransport({
  level: "http",
  labels: { app: "express", service: "querynox_backend" },
  host: process.env.LOKI_LOGGER_HOST,
  basicAuth: `${process.env.LOKI_USER}:${process.env.LOKI_API_KEY}`,
  batching: true,
  interval: 5,
  json: true
}));

// Custom console formatter
const customConsoleFormatter = format.printf(({ level, message, timestamp, ...rest }) => {
  if (level === 'http' && message === "REQUEST") {
    return `${colorizeLevel(level)} [${timestamp}] ${colorizeRequest(rest)}`;
  } else {
    return `${colorizeLevel(level)} [${timestamp}] ${message} ${
      Object.keys(rest).length > 0 ? JSON.stringify(rest) : ""
    }`;
  }
});

if (process.env.NODE_ENV !== "production") {
  logger.add(new transports.Console({
    level: "silly", // log everything to console
    format: format.combine(
      format.timestamp(),
      customConsoleFormatter
    )
  }));
}

module.exports = logger;
