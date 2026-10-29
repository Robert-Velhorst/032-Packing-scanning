FROM debian:trixie-slim@sha256:f6b08b09a05725f9431502d3b5714f5c4576e82c1a84fa1debe0c24a7e0c3ec4 AS node-runtime
ARG TARGETARCH
WORKDIR /tmp
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl xz-utils libatomic1 \
 && rm -rf /var/lib/apt/lists/*
RUN set -eux; \
    case "$TARGETARCH" in \
      amd64) node_arch=x64; node_sha=d28a96af6c38596f6d9d97c0ee531c13d238d757742387d1928de822d959e997 ;; \
      arm64) node_arch=arm64; node_sha=406fe3fbde1c054adff8b297c16fdb5af6659db327c1ac8acd46b56ef1af9a92 ;; \
      *) echo "Unsupported target architecture: $TARGETARCH" >&2; exit 1 ;; \
    esac; \
    curl --fail --location --silent --show-error \
      "https://nodejs.org/dist/v26.13.0/node-v26.13.0-linux-${node_arch}.tar.xz" \
      --output node.tar.xz; \
    echo "${node_sha}  node.tar.xz" | sha256sum --check --status; \
    tar -xJf node.tar.xz --directory /usr/local --strip-components=1; \
    rm node.tar.xz; \
    node --version | grep --fixed-strings --line-regexp "v26.13.0" \
+ && npm install --global npm@12.2.1 --ignore-scripts \
+ && npm --version | grep --fixed-strings --line-regexp "12.2.1"

FROM node-runtime AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run check:benchmarks && npm test && npm run build

FROM debian:trixie-slim@sha256:f6b08b09a05725f9431502d3b5714f5c4576e82c1a84fa1debe0c24a7e0c3ec4 AS runtime
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates libatomic1 \
 && rm -rf /var/lib/apt/lists/*
COPY --from=node-runtime /usr/local /usr/local
WORKDIR /app
ENV NODE_ENV=production APP_HOST=0.0.0.0 APP_PORT=3001
COPY --from=build --chown=1000:1000 /app/dist ./dist
COPY --from=build --chown=1000:1000 /app/server ./server
COPY --from=build --chown=1000:1000 /app/src ./src
COPY --from=build --chown=1000:1000 /app/package.json ./package.json
RUN mkdir .carrier-cache .account-data && chown 1000:1000 .carrier-cache .account-data
USER 1000:1000
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=6s --start-period=10s CMD node -e "fetch('http://127.0.0.1:'+process.env.APP_PORT+'/health/ready',{signal:AbortSignal.timeout(5000)}).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "server/index.ts"]
