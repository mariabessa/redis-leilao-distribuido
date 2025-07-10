# Trabalho Prático 2 - Sistemas Distribuídos

##  Implementação de Protocolo de Exclusão Mútua Distribuído com Redis Pub/Sub



## Descrição Geral

Este projeto implementa uma aplicação distribuída baseada no padrão Pub/Sub com Redis, simulando um sistema de leilões em tempo real. Utilizamos Redis Sentinel para garantir tolerância a falhas, com múltiplas instâncias cliente (usuários) e servidor (gerente do leilão), orquestradas em Kubernetes com contêineres Docker.

---

## Tecnologias Utilizadas

* **Redis Sentinel** (Alta disponibilidade, tolerância a falhas)
* **Redis Pub/Sub** (canal de comunicação distribuído)
* **Node.js** (implementação de cliente e servidor)
* **Docker e Kubernetes** (orquestração de contêineres)
* **ConfigMap, Secrets e StatefulSets** (manutenção e estado)

---
Arquitetura da Solução

O sistema é composto por:

Um servidor que gerencia o leilão (início, processamento de lances e finalização).

Múltiplos clientes que fazem lances automaticamente via Redis Pub/Sub.

Cluster Redis com um master, múltiplos slaves e Redis Sentinel com failover configurado.

A comunicação entre os componentes ocorre via canais Pub/Sub (comando-leilao, notificacao-leilao) e acesso ao banco Redis via conexão configurada com Sentinel.

Componentes e Arquivos

* cliente.yaml         # StatefulSet para múltiplos pods cliente
* servidor.yaml        # Deployment + Service (NodePort) para o servidor
* redis-master.yaml    # ConfigMap, Deployment e Service do Redis master
* redis-slave.yaml     # ConfigMap, Deployment e Service dos Redis slaves
* redis-rentinel.yaml  # ConfigMap, Deployment e Service dos Redis Sentinel
* cliente.js           # Lógica do cliente que realiza lances via Redis
* servidor.js          # Lógica do servidor que gerencia o leilão

---

## Funcionalidades do Sistema

* Gerenciamento de leilões com tempo fixo (30 segundos)

* Lances automáticos por múltiplos clientes em paralelo

* Notificações em tempo real via Redis Pub/Sub

* Coordenação distribuída com uso de locks no Redis

* Failover automático com Redis Sentinel

* Deploy escalável e resiliente com Kubernetes

---

## Persistência e Tolerância a Falhas

* Redis Master com persistência ativada via appendonly

* Redis Slaves replicam o estado do Master

* Redis Sentinel (3 instâncias) monitora e promove novo master automaticamente em caso de falha

* Clientes se conectam através de configuração lógica via Sentinel (mymaster)
