FROM node:22-bookworm-slim AS dependencies

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --registry=https://mirrors.cloud.tencent.com/npm/ --noproxy=mirrors.cloud.tencent.com

FROM dependencies AS build

COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=3000

WORKDIR /app
COPY --from=build --chown=node:node /app /app

USER node
EXPOSE 3000

CMD ["npm", "run", "start", "--", "--port", "3000"]

