FROM debian:trixie-slim@sha256:62bd423aeee912639ca8ee681c2b762cb3e25137e0a92b20be455898a9f034ad AS node-runtime
ARG TARGETARCH
WORKDIR /tmp
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl xz-utils libatomic1 \
 && rm -rf /var/lib/apt/lists/*
RUN set -eux; \
    case "$TARGETARCH" in \
      amd64) node_arch=x64; node_sha=6170b2d474e1c626f43cff3adc118df9fe3b573258a4fc3d850c8dbc6b079bbd ;; \
      arm64) node_arch=arm64; node_sha=42aa04922591ee5d4dbc7740d452621acf28508239daa512f5ee8c47ee224fdb ;; \
      *) echo "Unsupported target architecture: $TARGETARCH" >&2; exit 1 ;; \
    esac; \
    curl --fail --location --silent --show-error \
      "https://nodejs.org/dist/v26.12.1/node-v26.12.1-linux-${node_arch}.tar.xz" \
      --output node.tar.xz; \
    echo "${node_sha}  node.tar.xz" | sha256sum --check --status; \
    tar -xJf node.tar.xz --directory /usr/local --strip-components=1; \
    rm node.tar.xz; \
    node --version | grep --fixed-strings --line-regexp "v26.12.1"

FROM node-runtime AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run check:benchmarks && npm test && npm run build

FROM debian:trixie-slim@sha256:62bd423aeee912639ca8ee681c2b762cb3e25137e0a92b20be455898a9f034ad AS runtime
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
