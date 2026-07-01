FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY prisma ./prisma
COPY prisma.config.ts ./
COPY src ./src

RUN npx prisma generate

EXPOSE 3000

CMD ["node", "start.js"]