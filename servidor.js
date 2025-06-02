const express = require('express');
const { createClient } = require('redis');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Conexão com Redis
const redisClient = createClient({ url: 'redis://redis:6379' });
const publisher = redisClient.duplicate();
const subscriber = redisClient.duplicate();

// Estado dos leilões (por produto)
const leiloes = new Map(); // Mapa para armazenar estado de cada leilão por productId

(async () => {
    await redisClient.connect();
    await publisher.connect();
    await subscriber.connect();
    console.log('Conectado ao Redis');

    // Comando para processar mensagens no canal 'comando'
    await subscriber.subscribe('comando', async (message) => {
        const cmd = JSON.parse(message);
        const { productId } = cmd;

        if (cmd.tipo === 'iniciar') {
            const { item } = cmd;
            leiloes.set(productId, {
                item,
                ativo: true,
                lanceAtual: 0,
                vencedorAtual: ''
            });

            const mensagem = {
                tipo: 'inicio',
                productId,
                mensagem: `Leilão iniciado para ${item} (ID: ${productId})`
            };
            await publisher.publish(`leilao:${productId}`, JSON.stringify(mensagem));
            broadcastSSE(mensagem);
        } else if (cmd.tipo === 'lance') {
            const { nome, valor } = cmd;
            const leilao = leiloes.get(productId);

            if (leilao && leilao.ativo && valor > leilao.lanceAtual) {
                leilao.lanceAtual = valor;
                leilao.vencedorAtual = nome;

                const mensagem = {
                    tipo: 'lance',
                    productId,
                    nome,
                    valor,
                    mensagem: `Novo lance de ${nome}: R$${valor} para ${leilao.item} (ID: ${productId})`
                };
                await publisher.publish(`leilao:${productId}`, JSON.stringify(mensagem));
                broadcastSSE(mensagem);
            } else if (leilao && leilao.ativo) {
                const mensagem = {
                    tipo: 'lance_invalido',
                    productId,
                    nome,
                    valor,
                    mensagem: `Lance de ${nome}: R$${valor} rejeitado para ${leilao.item} (ID: ${productId}) (menor ou igual ao lance atual de R$${leilao.lanceAtual})`
                };
                broadcastSSE(mensagem);
            }
        } else if (cmd.tipo === 'finalizar') {
            const leilao = leiloes.get(productId);
            if (leilao && leilao.ativo) {
                leilao.ativo = false;
                const mensagem = {
                    tipo: 'fim',
                    productId,
                    vencedor: leilao.vencedorAtual,
                    lance: leilao.lanceAtual,
                    item: leilao.item,
                    mensagem: `Leilão encerrado para ${leilao.item} (ID: ${productId})! Vencedor: ${leilao.vencedorAtual} com R$${leilao.lanceAtual}`
                };
                await publisher.publish(`leilao:${productId}`, JSON.stringify(mensagem));
                broadcastSSE(mensagem);
            }
        }
    });
})();

// Rota para listar leilões ativos
app.get('/leiloes', (req, res) => {
  const auctions = Array.from(leiloes.entries()).map(([productId, leilao]) => ({
    productId,
    item: leilao.item,
    ativo: leilao.ativo,
    lanceAtual: leilao.lanceAtual,
    vencedorAtual: leilao.vencedorAtual
  }));
  res.json({ auctions });
});

// Rota para iniciar leilão
app.post('/iniciar', async (req, res) => {
    console.log('Iniciando leilão...');
    const { item, productId } = req.body;
    if (!productId || !item) {
        return res.status(400).json({ erro: 'productId e item são obrigatórios' });
    }

    if (leiloes.has(productId) && leiloes.get(productId).ativo) {
        return res.status(400).json({ erro: `Leilão para o produto ${productId} já está ativo` });
    }

    leiloes.set(productId, {
        item,
        ativo: true,
        lanceAtual: 0,
        vencedorAtual: ''
    });

    const mensagem = {
        tipo: 'inicio',
        productId,
        mensagem: `Leilão iniciado para ${item} (ID: ${productId})`
    };
    await publisher.publish(`leilao:${productId}`, JSON.stringify(mensagem));
    broadcastSSE(mensagem);

    res.json({ status: 'Leilão iniciado', item, productId });
});

// Rota para receber lances
app.post('/lance', async (req, res) => {
    const { nome, valor, productId } = req.body;
    if (!productId || !nome || !valor) {
        return res.status(400).json({ erro: 'productId, nome e valor são obrigatórios' });
    }

    const leilao = leiloes.get(productId);
    if (!leilao || !leilao.ativo) {
        return res.status(400).json({ erro: `Leilão para o produto ${productId} não está ativo` });
    }
    console.log(valor, leilao.lanceAtual);

    if (valor > leilao.lanceAtual) {
        leilao.lanceAtual = valor;
        leilao.vencedorAtual = nome;

        const mensagem = {
            tipo: 'lance',
            productId,
            nome,
            valor,
            mensagem: `Novo lance de ${nome}: R$${valor} para ${leilao.item} (ID: ${productId})`
        };
        await publisher.publish(`leilao:${productId}`, JSON.stringify(mensagem));
        broadcastSSE(mensagem);
        res.json({ status: 'Lance aceito' });
    } else {
        console.log(valor, leilao.lanceAtual);
        const mensagem = {
            tipo: 'lance_invalido',
            productId,
            nome,
            valor,
            mensagem: `Lance de ${nome}: R$${valor} rejeitado para ${leilao.item} (ID: ${productId}) (menor ou igual ao lance atual de R$${leilao.lanceAtual})`
        };
        broadcastSSE(mensagem);
        res.status(400).json({ erro: 'Lance deve ser maior que o atual' });
    }
});

// Rota para finalizar leilão
app.post('/finalizar', async (req, res) => {
    const { productId } = req.body;
    if (!productId) {
        return res.status(400).json({ erro: 'productId é obrigatório' });
    }

    const leilao = leiloes.get(productId);
    if (!leilao || !leilao.ativo) {
        return res.status(400).json({ erro: `Leilão para o produto ${productId} não está ativo` });
    }

    leilao.ativo = false;
    const mensagem = {
        tipo: 'fim',
        productId,
        vencedor: leilao.vencedorAtual,
        lance: leilao.lanceAtual,
        item: leilao.item,
        mensagem: `Leilão encerrado para ${leilao.item} (ID: ${productId})! Vencedor: ${leilao.vencedorAtual} com R$${leilao.lanceAtual}`
    };
    await publisher.publish(`leilao:${productId}`, JSON.stringify(mensagem));
    broadcastSSE(mensagem);

    res.json({
        status: 'Leilão finalizado',
        vencedor: leilao.vencedorAtual,
        lance: leilao.lanceAtual,
        item: leilao.item,
        productId
    });
});

// Configuração do SSE
const clientesSSE = [];

app.get('/eventos', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    clientesSSE.push(res);

    req.on('close', () => {
        const index = clientesSSE.indexOf(res);
        if (index !== -1) clientesSSE.splice(index, 1);
    });
});

function broadcastSSE(dado) {
    console.log('📢 Broadcast para todos:', dado);
    const msg = `data: ${JSON.stringify(dado)}\n\n`;
    clientesSSE.forEach(res => res.write(msg));
}

// Inicia servidor
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Servidor de leilão rodando na porta ${PORT}`);
});