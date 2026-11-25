import { createApp } from './create-app';

async function bootstrap() {
  const app = await createApp();
  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
  console.log(`Application is running on: ${await app.getUrl()}`);
}
bootstrap();
