const Redis = require('ioredis');

// Configuração do Redis (similar ao cliente)
const sentinelPort = parseInt(process.env.REDIS_SENTINEL_PORT, 10);
const portFinal = Number.isInteger(sentinelPort) ? sentinelPort : 26379;

const redis = new Redis({
  sentinels: [
    { 
      host: process.env.REDIS_SENTINEL_HOST || 'redis-sentinel', 
      port: portFinal
    }
  ],
  name: process.env.REDIS_MASTER_NAME || 'mymaster',
  password: process.env.REDIS_PASSWORD,
  sentinelRetryStrategy: times => Math.min(times * 100, 3000),
  maxRetriesPerRequest: 3,
  enableReadyCheck: true
});

// Cliente para subscrição
const subscriber = redis.duplicate();

// Inicializa o leilão
async function iniciarLeilao(productId) {
  await redis.hmset(`leilao:${productId}`, {
    ativo: 'true',
    lanceAtual: '0',
    vencedor: 'none'
  });
  console.log(`Leilão para ${productId} iniciado!`);
}

// Processa os lances
async function processarLances() {
  const productId = process.env.PRODUCT_ID || 'produto1';
  
  // Inicia o leilão
  await iniciarLeilao(productId);

  // Subscreve ao canal de comandos
  await subscriber.subscribe('comando');
  
  subscriber.on('message', async (channel, message) => {
    try {
      const msg = JSON.parse(message);
      
      if (msg.tipo === 'lance' && msg.productId === productId) {
        const leilao = await redis.hgetall(`leilao:${productId}`);
        const lanceAtual = parseFloat(leilao.lanceAtual || 0);
        const novoLance = parseFloat(msg.valor);
        
        if (novoLance > lanceAtual) {
          // Atualiza o lance
          await redis.hmset(`leilao:${productId}`, {
            lanceAtual: novoLance.toString(),
            vencedor: msg.nome
          });
          
          // Notifica todos sobre o novo lance
          await redis.publish(`leilao:${productId}`, JSON.stringify({
            tipo: 'lance',
            nome: msg.nome,
            valor: novoLance,
            productId
          }));
          
          console.log(`Lance aceito: ${msg.nome} - R$${novoLance}`);
        } else {
          // Notifica o cliente específico sobre lance inválido
          await redis.publish(`leilao:${productId}`, JSON.stringify({
            tipo: 'lance_invalido',
            nome: msg.nome,
            valor: novoLance,
            productId
          }));
        }
      }
    } catch (err) {
      console.error('Erro ao processar mensagem:', err);
    }
  });
}

// Finaliza o leilão após um tempo
async function finalizarLeilao(productId) {
  setTimeout(async () => {
    await redis.hmset(`leilao:${productId}`, {
      ativo: 'false'
    });
    
    const leilao = await redis.hgetall(`leilao:${productId}`);
    console.log(`Leilão finalizado! Vencedor: ${leilao.vencedor} com lance de R$${leilao.lanceAtual}`);
    
    process.exit(0);
  }, 60000); // Finaliza após 1 minuto (ajuste conforme necessário)
}

// Inicia o servidor
(async () => {
  try {
    const productId = process.env.PRODUCT_ID || 'produto1';
    console.log('Servidor de leilão iniciado...');
    
    await processarLances();
    await finalizarLeilao(productId);
    
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