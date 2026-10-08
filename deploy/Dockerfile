FROM node:22-bookworm-slim@sha256:43ac6c60b8f89723f746e8a92ce91abd5017e627ce1ddfe4238355d3a30b772c AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm test && npm run build

FROM node:22-bookworm-slim@sha256:43ac6c60b8f89723f746e8a92ce91abd5017e627ce1ddfe4238355d3a30b772c AS runtime
WORKDIR /app
ENV NODE_ENV=production APP_HOST=0.0.0.0 APP_PORT=3001
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/server ./server
COPY --from=build --chown=node:node /app/src ./src
COPY --from=build --chown=node:node /app/package.json ./package.json
RUN mkdir .carrier-cache .account-data && chown node:node .carrier-cache .account-data
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=6s --start-period=10s CMD node -e "fetch('http://127.0.0.1:3001/',{signal:AbortSignal.timeout(5000)}).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "server/index.ts"]
