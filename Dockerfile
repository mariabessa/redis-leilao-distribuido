FROM node:18

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

# Executa o script definido pela variável de ambiente APP_SCRIPT
CMD ["sh", "-c", "node $APP_SCRIPT"]
