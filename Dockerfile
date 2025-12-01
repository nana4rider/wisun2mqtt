FROM node:24-alpine AS build

WORKDIR /app
COPY package*.json ./
RUN npm ci

COPY src ./src
COPY tsconfig.json build.js ./
RUN npm run build

FROM node:24-alpine AS runtime

WORKDIR /app
COPY --chown=node:node --from=build /app/package*.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY --from=build /app/dist dist

RUN addgroup -g 20 dialout || true \
    && adduser node dialout

USER node
EXPOSE 3000

ENTRYPOINT ["node", "dist/index"]
