FROM node:20
WORKDIR /app

COPY package*.json ./
RUN npm install

COPY servidor.js .
COPY cliente.js .