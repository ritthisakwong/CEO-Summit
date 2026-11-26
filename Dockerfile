FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && mkdir /data && chown node:node /data
COPY server.mjs ./
COPY public ./public
ENV NODE_ENV=production DATA_DIR=/data PORT=8080
USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
