// cliente.js
const Redis = require('ioredis');

const redisClient = new Redis({
  sentinels: [
    { 
      host: process.env.REDIS_SENTINEL_HOST || 'redis-sentinel', 
      port: parseInt(process.env.REDIS_SENTINEL_PORT || 26379)
    }
  ],
  name: process.env.REDIS_MASTER_NAME || 'mymaster',
  password: process.env.REDIS_PASSWORD,
  sentinelRetryStrategy: times => Math.min(times * 500, 5000),
  retryStrategy: times => Math.min(times * 200, 2000),
  role: 'master',  // Explicitly require master
  maxRetriesPerRequest: 3,
  enableReadyCheck: true
});

const NOTIFICACAO_CHANNEL = 'notificacao-leilao';
const subscriber = redisClient.duplicate();
let leilaoInfo = { lanceAtual: 0 };
const productId = process.env.PRODUCT_ID || 'produto1';

// Escuta notificações
subscriber.subscribe(NOTIFICACAO_CHANNEL, (err) => {
  if (err) console.error('Erro ao subscrever:', err);
  else console.log(`Inscrito no canal de notificações`);
});

subscriber.on('message', (channel, message) => {
  if (channel === NOTIFICACAO_CHANNEL) {
    try {
      const msg = JSON.parse(message);
      
      if (msg.tipo === 'inicio') {
        leilaoInfo.lanceAtual = msg.lanceAtual; // ✅ Apenas para 'inicio'
      } else if (msg.tipo === 'lance') {
        leilaoInfo.lanceAtual = msg.lanceAtual; // ✅ Apenas para 'lance'
      }
      
      console.log(`[NOTIFICAÇÃO] ${msg.mensagem}`);
    } catch (err) {
      console.error('Erro ao processar notificação:', err);
    }
  }
});

(async () => {
  try {
    console.log(`Cliente ${process.env.NOME_CLIENTE} iniciando...`);
    
    const intervalo = setInterval(async () => {
      try {
        // Calcula um lance garantindo que seja maior que o atual
        const incremento = Math.floor(Math.random() * 100) + 1;
        const novoLance = leilaoInfo.lanceAtual + incremento;
        
        // Publica o lance
        await redisClient.publish('comando-leilao', JSON.stringify({
          tipo: 'lance',
          productId,
          nome: process.env.NOME_CLIENTE,
          valor: novoLance
        }));
        
        console.log(`Cliente ${process.env.NOME_CLIENTE} deu lance de R$${novoLance}`);
      } catch (err) {
        console.error('Erro ao processar lance:', err);
      }
    }, 3000);

    process.on('SIGINT', () => {
      clearInterval(intervalo);
      redisClient.quit();
      subscriber.quit();
    });
  } catch (err) {
    console.error('Erro fatal:', err);
    process.exit(1);
  }
})();