FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./

RUN npm ci && npx prisma generate

COPY . .

RUN mkdir -p uploads

EXPOSE 3000

CMD ["sh", "-c", "npx prisma migrate deploy && node index.js"]
