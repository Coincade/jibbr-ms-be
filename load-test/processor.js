/**
 * Artillery processor: set service ports from environment.
 * Use in config: processor: "./load-test/processor.js"
 * Env vars: AUTH_PORT, UPLOAD_PORT, MESSAGING_PORT, SOCKET_PORT (defaults: 3001–3004)
 */
function useEnvPorts(userContext, events, done) {
  userContext.vars.auth_port = process.env.AUTH_PORT || '3001';
  userContext.vars.upload_port = process.env.UPLOAD_PORT || '3002';
  userContext.vars.messaging_port = process.env.MESSAGING_PORT || '3003';
  userContext.vars.socket_port = process.env.SOCKET_PORT || '3004';
  return done();
}

module.exports = { useEnvPorts };
