// implementar o cliente: dá um lance e escuta o leilão
const { createClient } = require('redis');

const clienteRedis = createClient({ url: 'redis://redis:6379' });
const publisher = clienteRedis.duplicate();

const NOME = process.env.NOME || 'Anonimo';
const LANCE_INICIAL = parseInt(process.env.LANCE || 0);
const LANCE_MAXIMO = parseInt(process.env.LANCE_MAXIMO || 200);

let jaDeiLanceInicial = false;

(async () => {
  await clienteRedis.connect();
  await publisher.connect();
  console.log(`${NOME} conectado ao leilao`);

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
    console.log(`${NOME} enviou lance inicial de ${LANCE_INICIAL}`);

    // Agora começa a escutar os lances
    await subscriber.subscribe('leilao', async (message) => {
      const msg = JSON.parse(message);
      console.log(`${NOME} recebeu: ${msg.mensagem}`);
    //   console.log(msg);
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
