// servidor.js
const Redis = require('ioredis');
const { promisify } = require('util');
const sleep = promisify(setTimeout);

// Canais
const COMANDO_CHANNEL = 'comando-leilao';
const NOTIFICACAO_CHANNEL = 'notificacao-leilao';

const redis = new Redis({
  sentinels: [
    { 
      host: process.env.REDIS_SENTINEL_HOST || 'redis-sentinel', 
      port: parseInt(process.env.REDIS_SENTINEL_PORT || 26379)
    }
  ],
  name: process.env.REDIS_MASTER_NAME || 'mymaster',
  password: process.env.REDIS_PASSWORD,
  sentinelRetryStrategy: times => Math.min(times * 100, 3000),
  maxRetriesPerRequest: 3,
  enableReadyCheck: true
});

const subscriber = redis.duplicate();
const productId = process.env.PRODUCT_ID || 'produto1';
const TEMPO_LEILAO = 30000; // 30 segundos

// UPDATED LOCK HANDLING
async function acquireLock(lockKey, clientId, ttl = 10000, maxAttempts = 5) {
  for (let i = 0; i < maxAttempts; i++) {
    const result = await redis.set(lockKey, clientId, 'NX', 'PX', ttl);
    if (result === 'OK') return true;
    
    // Exponential backoff
    await sleep(100 * Math.pow(2, i) + Math.random() * 100);
  }
  return false;
}

async function releaseLock(lockKey, clientId) {
  const currentOwner = await redis.get(lockKey);
  if (currentOwner === clientId) {
    await redis.del(lockKey);
  }
}

async function iniciarLeilao() {
  const LOCK_KEY = `lock:leilao:${productId}`;
  const CLIENT_ID = `${process.pid}-${Date.now()}`;
  
  let acquired = false;
  for (let i = 0; i < 3; i++) {
    acquired = await acquireLock(LOCK_KEY, CLIENT_ID);
    if (acquired) break;
    await sleep(100 * (i + 1));
  }
  if (!acquired) {
    console.log('🚫 Não adquiriu lock para iniciar leilão');
    return false;
  }

  try {
    // Verifica se o leilão já está ativo
    const leilao = await redis.hgetall(`leilao:${productId}`);
    if (leilao && leilao.ativo === 'true') {
      console.log('Leilão já está ativo!');
      return false;
    }

    // Cria o leilão com valores iniciais
    await redis.hmset(`leilao:${productId}`, {
      ativo: 'true',
      lanceAtual: '0',
      vencedor: 'none',
      item: 'Produto Padrão'
    });
    
    console.log(`Leilão para ${productId} iniciado!`);
    
    // Publica notificação de início
    await redis.publish(NOTIFICACAO_CHANNEL, JSON.stringify({
      tipo: 'inicio',
      productId,
      mensagem: `Leilão iniciado para produto ${productId}`,
      lanceAtual: 0
    }));
    
    return true;
  } catch (err) {
    console.error('Erro ao iniciar leilão:', err);
    return false;
  } finally {
    await releaseLock(LOCK_KEY, CLIENT_ID);
  }
}

async function processarLance(msg) {
  const LOCK_KEY = `lock:leilao:${productId}`;
  const CLIENT_ID = `${process.pid}-${Date.now()}`;
  
  let acquired = false;
  for (let i = 0; i < 3; i++) {
    acquired = await acquireLock(LOCK_KEY, CLIENT_ID);
    if (acquired) break;
    await sleep(100 * (i + 1));
  }

  if (!acquired) {
    console.log('🚫 Não adquiriu lock, ignorando mensagem');
    return;
  }

  try {
    // Consulta o estado atual do leilão
    const leilao = await redis.hgetall(`leilao:${productId}`) || {};
    if (leilao.ativo !== 'true') {
      console.log('Leilão não está ativo. Lance ignorado.');
      return;
    }

    const lanceAtual = parseFloat(leilao.lanceAtual || 0);
    const novoLance = parseFloat(msg.valor);

    if (novoLance > lanceAtual) {
      await redis.hmset(`leilao:${productId}`, {
        lanceAtual: novoLance.toString(),
        vencedor: msg.nome
      });
      
      await redis.publish(NOTIFICACAO_CHANNEL, JSON.stringify({
        tipo: 'lance',
        nome: msg.nome,
        valor: novoLance,
        productId,
        lanceAtual: novoLance,
        mensagem: `Novo lance de ${msg.nome}: R$${novoLance}`
      }));
    } else {
      const motivo = novoLance < lanceAtual 
        ? "menor" 
        : "igual";
      
      console.log(`Lance de ${msg.nome} (R$${novoLance}) é ${motivo} ao atual (R$${lanceAtual}) - Ignorado`);
    };
    
  } catch (err) {
    console.error('Erro ao processar lance:', err);
  } finally {
    await releaseLock(LOCK_KEY, CLIENT_ID);
  }
}

async function finalizarLeilao() {
  const LOCK_KEY = `lock:leilao:${productId}`;
  const CLIENT_ID = `${process.pid}-${Date.now()}`;
  
  let acquired = false;
  for (let i = 0; i < 3; i++) {
    acquired = await acquireLock(LOCK_KEY, CLIENT_ID);
    if (acquired) break;
    await sleep(100 * (i + 1));
  }
  if (!acquired) {
    console.log('🚫 Não adquiriu lock para finalizar leilão');
    return;
  }

  try {
    const leilao = await redis.hgetall(`leilao:${productId}`) || {};
    // Se o leilão já está inativo, não faz nada
    if (leilao.ativo !== 'true') {
      return;
    }
    
    const vencedor = leilao.vencedor || 'none';
    const lanceVencedor = leilao.lanceAtual || '0';
    
    // Marca o leilão como inativo
    await redis.hset(`leilao:${productId}`, 'ativo', 'false');
    
    // Publica notificação de fim
    await redis.publish(NOTIFICACAO_CHANNEL, JSON.stringify({
      tipo: 'fim',
      vencedor: vencedor,
      lance: lanceVencedor,
      productId,
      mensagem: `Leilão finalizado! Vencedor: ${vencedor} com R$${lanceVencedor}`
    }));
    
    console.log(`Leilão finalizado! Vencedor: ${vencedor} com R$${lanceVencedor}`);
  } catch (err) {
    console.error('Erro ao finalizar leilão:', err);
  } finally {
    await releaseLock(LOCK_KEY, CLIENT_ID);
  }
}

// Inicia o servidor
(async () => {
  try {
    console.log('Servidor de leilão iniciado...');
    
    // INÍCIO AUTOMÁTICO DO LEILÃO
    await iniciarLeilao();
    
    // Agenda a finalização
    setTimeout(() => {
      console.log('Tempo de leilão esgotado! Finalizando...');
      finalizarLeilao().then(() => {
        setTimeout(() => process.exit(0), 1000); // Wait 1 second after finalizing
      });
    }, TEMPO_LEILAO);
    
    await subscriber.subscribe(COMANDO_CHANNEL);
    
    subscriber.on('message', async (channel, message) => {
      if (channel !== COMANDO_CHANNEL) return;
      
      try {
        const msg = JSON.parse(message);
        
        switch (msg.tipo) {
          case 'iniciar':
            await iniciarLeilao();
            break;
            
          case 'lance':
            await processarLance(msg);
            break;
            
          case 'finalizar':
            await finalizarLeilao();
            break;
        }
      } catch (err) {
        console.error('Erro ao processar mensagem:', err);
      }
    });
    
    process.on('SIGINT', () => {
      redis.quit();
      subscriber.quit();
      process.exit(0);
    });
  } catch (err) {
    console.error('Erro fatal:', err);
    process.exit(1);
  }
})();