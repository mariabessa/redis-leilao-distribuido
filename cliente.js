//implementar o cliente: da um lance e escuta o leilão
const { createClient } = require('redis');
const readline = require('readline');

const clienteRedis = createClient ({ url: 'redis://redis:6379' });
const NOME = process.env.NOME;
const LANCE_INICIAL = parseInt(process.env.LANCE) || 0;

(async () => {
    await clienteRedis.connect();
    console.log(`${NOME} conectado ao leilao`);

    const subscriber = clienteRedis.duplicate();
    await subscriber.connect();

    // Inscreve no canal de leilão
    await subscriber.subscribe('leilao', (message) => {
        const msg = JSON.parse(message);
        console.log(`${NOME} recebeu:`, msg.mensagem);
  
        // Lógica para contra-lances automáticos
        if (msg.tipo === 'lance' && msg.valor < LANCE_MAXIMO) {
            const novoLance = msg.valor + 10;
            publisher.publish('comando', JSON.stringify({
                tipo: 'lance',
                nome: NOME,
                valor: novoLance
            }));
        }
    });

    // Interface para enviar lances 
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    // Simula envio de lance apos 5s
    setTimeout(async() => {
        await clienteRedis.publish('comando', JSON.stringify({
            tipo: 'lance',
            nome: NOME,
            valor: LANCE_INICIAL
        }));
        console.log(`${NOME} enviou lance inicial de ${LANCE_INICIAL}`);
    }, 5000);

})();