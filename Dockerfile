FROM node:20-alpine

# pg_dump / pg_restore for the daily verified backup job (plan §6)
RUN apk add --no-cache postgresql16-client bash

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src
COPY public ./public
COPY scripts ./scripts

ENV NODE_ENV=production
EXPOSE 3000

# migrations run on boot; idempotent
CMD ["sh", "-c", "npm run migrate && node src/server.js"]
