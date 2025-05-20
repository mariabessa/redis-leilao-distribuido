//implementar o servidor: le os lance e pub o maior lance
const express = require('express');
const { createClient } = require('redis');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Conexao com Redis
const redisClient = createClient({ url: 'redis://redis:6379'});
const publisher = redisClient.duplicate();
const subscriber = redisClient.duplicate();

(async () => {
    await redisClient.connect();
    await publisher.connect();
    await subscriber.connect();
    console.log('Conectado ao Redis');
})();

// Estado do leilao
let leilaoAtivo = false;
let itemLeilao = '';
let lanceAtual = 0;
let vencedorAtual = '';

// Canal Redis para comunicacao
const CANAL_LEILAO = 'leilao';

// Rota para iniciar leilao
app.post('/iniciar', async (req, res) => {
    const { item } = req.body;

    itemLeilao = item;
    lanceAtual = 0;
    vencedorAtual = '';
    leilaoAtivo = true;

    await publisher.publish(CANAL_LEILAO, JSON.stringify({
        tipo: 'inicio',
        item,
        mensagem: `Leilao iniciado para : ${item}`
    }));

    res.json({ status: 'Leilao iniciado', item});
});

// Comando para iniciar leilão
await subscriber.subscribe('comando', async (message) => {
  const cmd = JSON.parse(message);
  
  if (cmd.tipo === 'iniciar') {
    await iniciarLeilao(cmd.item);
  } else if (cmd.tipo === 'lance') {
    await processarLance(cmd.nome, cmd.valor);
  }
});

// Rota para receber lances
app.post('/lance', async (req, res) => {
    if(!leilaoAtivo) {
        return res.status(400).json({erro: 'Leilao nao esta ativo'});
    }

    const { nome, valor } = req.body;

    if (valor > lanceAtual) {
        lanceAtual = valor;
        vencedorAtual = nome;

        await publisher.publish(CANAL_LEILAO, JSON.stringify({
            tipo: 'lance',
            nome,
            valor,
            mensagem: `Novo lance de ${nome}: R$${valor}`
        }));

        res.json({ status: 'Lance aceito '});
    } else {
        res.status(400).json({ erro: 'Lance deve ser maior que o atual'});
    }
});

// Rota para finalizar leilao
app.post('/finalizar', async (req, res) => {
    leilaoAtivo = false;

    await publisher.publish(CANAL_LEILAO, JSON.stringify({
        tipo: 'fim',
        vencedor: vencedorAtual,
        lance: lanceAtual,
        item: itemLeilao,
        mensagem: `Leilao encerrado! Vencedor: ${vencedorAtual} com R$${lanceAtual}`
    }));

    res.json({
        status: "Leilao finalizado",
        vencedor: vencedorAtual,
        lance: lanceAtual,
        item: itemLeilao
    });
});

// Publica os lances no canal Redis
app.post('/lance', async (req, res) => {
  const { nome, valor } = req.body;
  await publisher.publish('leilao', JSON.stringify({
    tipo: 'lance',
    nome,
    valor,
    mensagem: `Novo lance de ${nome}: R$${valor}`
  }));
  res.json({ status: 'Lance aceito' });
});

// Inicia servidor
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Servidor de leilao rodando na porta ${PORT}`);
});