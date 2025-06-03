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
            const exists = await redisClient.exists(`leilao:${productId}`);
            if (exists) {
                const leilao = await redisClient.hGetAll(`leilao:${productId}`);
                if (leilao.ativo === 'true') {
                    const mensagem = {
                        tipo: 'erro',
                        productId,
                        mensagem: `Leilão para ${productId} já está ativo`
                    };
                    await publisher.publish(`leilao:${productId}`, JSON.stringify(mensagem));
                    await broadcastSSE(mensagem);
                    return;
                }
            }

            await redisClient.hSet(`leilao:${productId}`, {
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
            await broadcastSSE(mensagem);
        } else if (cmd.tipo === 'lance') {
            const { nome, valor } = cmd;
            const leilao = await redisClient.hGetAll(`leilao:${productId}`);

            if (leilao && leilao.ativo === 'true' && valor > parseInt(leilao.lanceAtual)) {
                await redisClient.hSet(`leilao:${productId}`, {
                    lanceAtual: valor,
                    vencedorAtual: nome
                });

                const mensagem = {
                    tipo: 'lance',
                    productId,
                    nome,
                    valor,
                    mensagem: `Novo lance de ${nome}: R$${valor} para ${leilao.item} (ID: ${productId})`
                };
                await publisher.publish(`leilao:${productId}`, JSON.stringify(mensagem));
                await broadcastSSE(mensagem);
            } else if (leilao && leilao.ativo === 'true') {
                const mensagem = {
                    tipo: 'lance_invalido',
                    productId,
                    nome,
                    valor,
                    mensagem: `Lance de ${nome}: R$${valor} rejeitado para ${leilao.item} (ID: ${productId}) (menor ou igual ao lance atual de R$${leilao.lanceAtual})`
                };
                await broadcastSSE(mensagem);
            }
        } else if (cmd.tipo === 'finalizar') {
            const leilao = await redisClient.hGetAll(`leilao:${productId}`);
            if (leilao && leilao.ativo === 'true') {
                await redisClient.hSet(`leilao:${productId}`, 'ativo', false);
                const mensagem = {
                    tipo: 'fim',
                    productId,
                    vencedor: leilao.vencedorAtual,
                    lance: parseInt(leilao.lanceAtual),
                    item: leilao.item,
                    mensagem: `Leilão encerrado para ${leilao.item} (ID: ${productId})! Vencedor: ${leilao.vencedorAtual} com R$${leilao.lanceAtual}`
                };
                await publisher.publish(`leilao:${productId}`, JSON.stringify(mensagem));
                await broadcastSSE(mensagem);
            }
        }
    });
})();

// Rota para listar leilões ativos
app.get('/leiloes', async (req, res) => {
    const keys = await redisClient.keys('leilao:*');
    const auctions = [];
    for (const key of keys) {
        const leilao = await redisClient.hGetAll(key);
        if (leilao.ativo === 'true') {
            auctions.push({
                productId: key.replace('leilao:', ''),
                item: leilao.item,
                ativo: leilao.ativo === 'true',
                lanceAtual: parseInt(leilao.lanceAtual),
                vencedorAtual: leilao.vencedorAtual
            });
        }
    }
    res.json({ auctions });
});

// Rota para iniciar leilão
app.post('/iniciar', async (req, res) => {
    console.log('Iniciando leilão...');
    const { item, productId } = req.body;
    if (!productId || !item) {
        return res.status(400).json({ erro: 'productId e item são obrigatórios' });
    }

    const exists = await redisClient.exists(`leilao:${productId}`);
    if (exists) {
        const leilao = await redisClient.hGetAll(`leilao:${productId}`);
        if (leilao.ativo === 'true') {
            return res.status(400).json({ erro: `Leilão para o produto ${productId} já está ativo` });
        }
    }

    await redisClient.hSet(`leilao:${productId}`, {
        item: String(item),
        ativo: 'true',
        lanceAtual: '0',
        vencedorAtual: ''
    });

    const mensagem = {
        tipo: 'inicio',
        productId,
        mensagem: `Leilão iniciado para ${item} (ID: ${productId})`
    };
    await publisher.publish(`leilao:${productId}`, JSON.stringify(mensagem));
    await broadcastSSE(mensagem);

    res.json({ status: 'Leilão iniciado', item, productId });
});

// Rota para receber lances
app.post('/lance', async (req, res) => {
    const { nome, valor, productId } = req.body;
    if (!productId || !nome || !valor) {
        return res.status(400).json({ erro: 'productId, nome e valor são obrigatórios' });
    }

    const leilao = await redisClient.hGetAll(`leilao:${productId}`);
    if (!leilao || leilao.ativo !== 'true') {
        return res.status(400).json({ erro: `Leilão para o produto ${productId} não está ativo` });
    }

    if (valor > parseInt(leilao.lanceAtual)) {
        await redisClient.hSet(`leilao:${productId}`, {
            lanceAtual: valor,
            vencedorAtual: nome
        });

        const mensagem = {
            tipo: 'lance',
            productId,
            nome,
            valor,
            mensagem: `Novo lance de ${nome}: R$${valor} para ${leilao.item} (ID: ${productId})`
        };
        await publisher.publish(`leilao:${productId}`, JSON.stringify(mensagem));
        await broadcastSSE(mensagem);
        res.json({ status: 'Lance aceito' });
    } else {
        const mensagem = {
            tipo: 'lance_invalido',
            productId,
            nome,
            valor,
            mensagem: `Lance de ${nome}: R$${valor} rejeitado para ${leilao.item} (ID: ${productId}) (menor ou igual ao lance atual de R$${leilao.lanceAtual})`
        };
        await broadcastSSE(mensagem);
        res.status(400).json({ erro: 'Lance deve ser maior que o atual' });
    }
});

// Rota para histórico de eventos
app.get('/eventos/historico', async (req, res) => {
    const { productId } = req.query;
    const events = await redisClient.lRange(`eventos:${productId}`, 0, -1);
    res.json(events.map(JSON.parse));
});

// Função para broadcast SSE e salvar eventos
async function broadcastSSE(dado) {
    if (dado.productId) {
        await redisClient.lPush(`eventos:${dado.productId}`, JSON.stringify(dado));
    }
    const msg = `data: ${JSON.stringify(dado)}\n\n`;
    clientesSSE.forEach(res => res.write(msg));
}

// Rota para finalizar leilão
app.post('/finalizar', async (req, res) => {
    const { productId } = req.body;
    if (!productId) {
        return res.status(400).json({ erro: 'productId é obrigatório' });
    }

    const leilao = await redisClient.hGetAll(`leilao:${productId}`);
    if (!leilao || leilao.ativo !== 'true') {
        return res.status(400).json({ erro: `Leilão para o produto ${productId} não está ativo` });
    }

    await redisClient.hSet(`leilao:${productId}`, 'ativo', false);
    const mensagem = {
        tipo: 'fim',
        productId,
        vencedor: leilao.vencedorAtual,
        lance: parseInt(leilao.lanceAtual),
        item: leilao.item,
        mensagem: `Leilão encerrado para ${leilao.item} (ID: ${productId})! Vencedor: ${leilao.vencedorAtual} com R$${leilao.lanceAtual}`
    };
    await publisher.publish(`leilao:${productId}`, JSON.stringify(mensagem));
    await broadcastSSE(mensagem);

    res.json({
        status: 'Leilão finalizado',
        vencedor: leilao.vencedorAtual,
        lance: parseInt(leilao.lanceAtual),
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

// Inicia servidor
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Servidor de leilão rodando na porta ${PORT}`);
});