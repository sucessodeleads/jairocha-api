const serverless = require('serverless-http');
const { createApp } = require('../../dist/create-app');
let handler;

async function initialize() {
  const app = await createApp();
  await app.init();
  return serverless(app.getHttpAdapter().getInstance());
}

exports.handler = async (event, context) => {
  handler ??= initialize().catch(error => { handler = undefined; throw error; });
  return (await handler)(event, context);
};
