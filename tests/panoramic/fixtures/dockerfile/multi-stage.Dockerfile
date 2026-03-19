FROM node:20-alpine AS builder

WORKDIR /build

COPY package.json package-lock.json ./
RUN npm ci

COPY src/ ./src/
COPY tsconfig.json ./
RUN npm run build

FROM node:20-alpine AS runner

WORKDIR /app

COPY --from=builder /build/dist ./dist
COPY --from=builder /build/package.json ./

RUN npm ci --production

EXPOSE 8080

ENV NODE_ENV=production

CMD ["node", "dist/server.js"]
