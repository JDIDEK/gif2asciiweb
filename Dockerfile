FROM rust:alpine AS wasm-build

WORKDIR /app/wasm-core

RUN apk add --no-cache musl-dev pkgconfig openssl-dev curl \
	&& cargo install wasm-pack

COPY wasm-core/Cargo.toml ./Cargo.toml
COPY wasm-core/src ./src

RUN wasm-pack build --target web --out-dir pkg

FROM oven/bun:1.2.12 AS deps

WORKDIR /app

# Local dependency in frontend/package.json points to ../wasm-core/pkg
COPY --from=wasm-build /app/wasm-core/pkg ./wasm-core/pkg
COPY frontend/package.json ./frontend/package.json
COPY frontend/bun.lock ./frontend/bun.lock

WORKDIR /app/frontend
RUN bun install --frozen-lockfile

FROM node:22-alpine AS build

WORKDIR /app

# Keep local dependency path resolvable during build.
COPY --from=wasm-build /app/wasm-core/pkg ./wasm-core/pkg
WORKDIR /app/frontend
COPY --from=deps /app/frontend/node_modules ./node_modules

COPY frontend ./
RUN ./node_modules/.bin/tsc -b && node ./node_modules/vite/bin/vite.js build

FROM nginx:1.27-alpine AS runtime

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]