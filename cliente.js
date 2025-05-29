const { createClient } = require('redis');

// Gera valores aleatórios se não forem fornecidos
const randomId = Math.floor(Math.random() * 10000);
const NOME = process.env.NOME || `Cliente${randomId}`;
const LANCE_INICIAL = parseInt(process.env.LANCE || Math.floor(Math.random() * 100 + 1));
const LANCE_MAXIMO = parseInt(process.env.LANCE_MAXIMO || (LANCE_INICIAL + Math.floor(Math.random() * 100 + 50)));

const clienteRedis = createClient({ url: process.env.REDIS_URL || 'redis://redis:6379' });
const publisher = clienteRedis.duplicate();

let jaDeiLanceInicial = false;

(async () => {
  await clienteRedis.connect();
  await publisher.connect();
  console.log(`${NOME} conectado ao leilao | Lance inicial: R$${LANCE_INICIAL} | Máximo: R$${LANCE_MAXIMO}`);
  process.stdout.write("");

  const subscriber = clienteRedis.duplicate();
  await subscriber.connect();

  // Espera 5 segundos, dá o lance inicial, e só depois se inscreve no canal
  setTimeout(async () => {
    await publisher.publish('comando', JSON.stringify({
      tipo: 'lance',
      nome: NOME,
      valor: LANCE_INICIAL,
    }));
    jaDeiLanceInicial = true;
    console.log(`${NOME} enviou lance inicial de R$${LANCE_INICIAL}`);
    process.stdout.write("");

    // Agora começa a escutar os lances
    await subscriber.subscribe('leilao', async (message) => {
      const msg = JSON.parse(message);
      console.log(`${NOME} recebeu: ${msg.mensagem}`);
      process.stdout.write("");

      // Responde automaticamente se valor for menor que o máximo
      if (
        jaDeiLanceInicial &&
        msg.tipo === 'lance' &&
        msg.nome !== NOME &&
        msg.valor < LANCE_MAXIMO
      ) {
        const novoLance = msg.valor + 10;
        console.log(`${NOME} respondendo com novo lance de R$${novoLance}`);
        await publisher.publish('comando', JSON.stringify({
          tipo: 'lance',
          nome: NOME,
          valor: novoLance,
        }));
      }
    });
  }, 5000);
})();

await subscriber.subscribe('leilao', async (message) => {
  const msg = JSON.parse(message);
  console.log(`${NOME} recebeu: ${msg.mensagem}`);

  if (msg.tipo === 'fim') {
    if (msg.vencedor === NOME) {
      console.log(`🎉 ${NOME} GANHOU o leilão com R$${msg.lance}!`);
    } else {
      console.log(`😢 ${NOME} perdeu o leilão. Vencedor: ${msg.vencedor}`);
    }
    // Encerra o processo (útil para Kubernetes não manter cliente ativo à toa)
    await clienteRedis.quit();
    await publisher.quit();
    await subscriber.quit();
    process.exit(0);
    return;
  }

  // Responde automaticamente se valor for menor que o máximo
  if (
    jaDeiLanceInicial &&
    msg.tipo === 'lance' &&
    msg.nome !== NOME &&
    msg.valor < LANCE_MAXIMO
  ) {
    const novoLance = msg.valor + 10;
    console.log(`${NOME} respondendo com novo lance de R$${novoLance}`);
    await publisher.publish('comando', JSON.stringify({
      tipo: 'lance',
      nome: NOME,
      valor: novoLance,
    }));
  }
});

