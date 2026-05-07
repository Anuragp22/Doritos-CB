FROM node:20-alpine

WORKDIR /app

COPY package*.json ./

RUN npm ci

COPY . .

RUN mkdir -p uploads

EXPOSE 3000

# `prisma generate` and `prisma migrate deploy` both load prisma.config.ts,
# which requires DATABASE_URL. Run them at container start where the compose
# env is in scope, not at image-build time where it is not.
CMD ["sh", "-c", "npx prisma generate && npx prisma migrate deploy && node index.js"]
