FROM node:18

WORKDIR /app

# Copia os arquivos de dependência
COPY package.json package-lock.json ./

# Instala as dependências (usando install em vez de ci para mais flexibilidade)
RUN npm install --production

# Copia o resto dos arquivos
COPY . .

CMD ["node", "cliente.js"]
