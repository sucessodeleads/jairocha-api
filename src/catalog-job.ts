import { getStore } from '@netlify/blobs';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ImoveisService } from './imoveis/imoveis.service';

async function netlify(path: string, method = 'GET') {
  const response = await fetch('https://api.netlify.com/api/v1' + path, {
    method,
    headers: { Authorization: 'Bearer ' + process.env.NETLIFY_AUTH_TOKEN },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error('Netlify respondeu com HTTP ' + response.status);
  return response.json();
}

async function run() {
  for (const key of ['TOKEN_SMART', 'NETLIFY_SITE_ID', 'NETLIFY_AUTH_TOKEN']) {
    if (!process.env[key]) throw new Error('Configuração ausente: ' + key);
  }
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['warn', 'error'] });
  try {
    const catalog = await app.get(ImoveisService).findAll();
    const digest = (rows: unknown) => createHash('sha256').update(JSON.stringify(rows)).digest('hex');
    const hash = digest(catalog);
    const site = encodeURIComponent(process.env.NETLIFY_SITE_ID!);
    const versionUrl = 'https://jairorocha.com.br/catalogo-versao.txt';
    const version = await fetch(versionUrl, { signal: AbortSignal.timeout(30_000) });
    if (version.ok && (await version.text()).trim() === hash) {
      console.log('Catálogo já publicado.');
      return;
    }
    if (!version.ok && version.status !== 404) throw new Error('Falha ao verificar a versão publicada.');
    const store = getStore({ name: 'catalogo-portal', siteID: process.env.NETLIFY_SITE_ID!,
      token: process.env.NETLIFY_AUTH_TOKEN!, consistency: 'strong' });
    await store.setJSON('imoveis', catalog);
    const build = await netlify('/sites/' + site + '/builds', 'POST');
    if (!build.deploy_id) throw new Error('Netlify não retornou o identificador do deploy.');
    for (let attempt = 0; attempt < 80; attempt++) {
      const deploy = await netlify('/deploys/' + encodeURIComponent(build.deploy_id));
      if (deploy.state === 'error' || deploy.state === 'canceled') throw new Error('Deploy interrompido.');
      if (deploy.state === 'ready' && deploy.published_at && deploy.context === 'production') {
        const published = await fetch(versionUrl, { signal: AbortSignal.timeout(30_000) });
        if (!published.ok || (await published.text()).trim() !== hash) throw new Error('Versão publicada divergente.');
        console.log('Publicado: ' + catalog.length + ' imóveis.');
        return;
      }
      await delay(15_000);
    }
    throw new Error('Tempo esgotado aguardando a publicação.');
  } finally {
    await app.close();
  }
}

run().catch(error => {
  // Respostas de clientes HTTP podem conter o token usado na consulta ao CRM.
  console.error(error.message);
  process.exitCode = 1;
});
