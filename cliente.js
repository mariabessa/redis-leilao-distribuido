const Redis = require('ioredis');

// Configuração do Redis
const sentinelPort = parseInt(process.env.REDIS_SENTINEL_PORT, 10);
const portFinal = Number.isInteger(sentinelPort) ? sentinelPort : 26379;

const redisClient = new Redis({
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
const subscriber = redisClient.duplicate();

redisClient.on('error', (err) => {
  console.error('Erro no cliente Redis:', err);
});

redisClient.on('ready', () => {
  console.log(`Cliente ${process.env.NOME_CLIENTE} conectado ao Redis`);
});

(async () => {
  try {
    const productId = process.env.PRODUCT_ID || 'produto1';
    console.log(`Cliente ${process.env.NOME_CLIENTE} iniciando...`);

    let lanceAtual = 0; // Armazena o lance atual conhecido pelo cliente

    // Subscreve ao canal do produto para atualizações
    await subscriber.subscribe(`leilao:${productId}`);
    subscriber.on('message', (channel, message) => {
      try {
        const msg = JSON.parse(message);
        if (msg.tipo === 'lance') {
          lanceAtual = msg.valor;
          console.log(`Novo lance aceito: ${msg.nome} - R$${msg.valor}`);
        } else if (msg.tipo === 'lance_invalido' && msg.nome === process.env.NOME_CLIENTE) {
          console.log(`Seu lance de R$${msg.valor} foi rejeitado (menor ou igual ao lance atual de R$${lanceAtual})`);
        }
      } catch (err) {
        console.error('Erro ao processar mensagem:', err);
      }
    });


    // Faz lances periodicamente
    const intervalo = setInterval(async () => {
      try {
        const leilao = await redisClient.hgetall(`leilao:${productId}`);
        
        if (leilao && leilao.ativo === 'true') {
          const novoLance = lanceAtual + Math.floor(Math.random() * 100 + 1); // Sempre maior que o atual

          const comando = {
            tipo: 'lance',
            productId,
            nome: process.env.NOME_CLIENTE,
            valor: novoLance
          };

          await redisClient.publish('comando', JSON.stringify(comando));
          console.log(`Cliente ${comando.nome} deu lance de R$${comando.valor}`);
        } else {
          console.log(`Aguardando leilão ativo para ${productId}...`);
        }
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