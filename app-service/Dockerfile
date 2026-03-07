# Stage 1: Rust Builder
FROM rust:latest AS rust-builder
WORKDIR /usr/src/helper

# Install sccache for faster builds
ARG SCCACHE_VERSION=v0.14.0
RUN curl -L https://github.com/mozilla/sccache/releases/download/${SCCACHE_VERSION}/sccache-${SCCACHE_VERSION}-x86_64-unknown-linux-musl.tar.gz \
    | tar xz -C /usr/local/bin --strip-components=1 sccache-${SCCACHE_VERSION}-x86_64-unknown-linux-musl/sccache && \
    chmod +x /usr/local/bin/sccache

# Enable GitHub Actions cache if the arguments are provided
ARG ACTIONS_RESULTS_URL
ARG ACTIONS_RUNTIME_TOKEN
ARG SCCACHE_GHA_ENABLED
ENV ACTIONS_RESULTS_URL=$ACTIONS_RESULTS_URL
ENV ACTIONS_RUNTIME_TOKEN=$ACTIONS_RUNTIME_TOKEN
ENV SCCACHE_GHA_ENABLED=$SCCACHE_GHA_ENABLED
ENV RUSTC_WRAPPER=sccache

# Optional but nice for CI reproducibility
ENV CARGO_INCREMENTAL=0

# 1a. Copy only manifests
COPY rust-crypto-helper/Cargo.toml rust-crypto-helper/Cargo.lock* ./

# 1b. Create a dummy main.rs to build dependencies
RUN mkdir src && echo "fn main() {}" > src/main.rs
RUN cargo build --release && \
    sccache --show-stats && \
    sccache --stop-server || true
RUN rm -f target/release/deps/rust_crypto_helper*

# 1c. Now copy the real source and build
COPY rust-crypto-helper/src ./src
RUN cargo build --release && \
    sccache --show-stats && \
    sccache --stop-server || true

# Stage 2: Node App
FROM node:22-slim

WORKDIR /app

# Install dependencies for building native modules
RUN apt-get update -y && apt-get install -y openssl ca-certificates python3 make g++ curl

# 1. Build Frontend
WORKDIR /app/client
COPY app-service/client/package*.json ./
RUN npm install
COPY app-service/client/ ./
ARG VITE_COVERAGE=false
RUN VITE_COVERAGE=$VITE_COVERAGE npm run build

# 2. Build Backend
WORKDIR /app
COPY app-service/package*.json ./
RUN npm install
COPY app-service/ .

RUN npx prisma generate
RUN npx tsc

# Copy Rust helper from builder
COPY --from=rust-builder /usr/src/helper/target/release/rust-crypto-helper /usr/local/bin/

COPY app-service/docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 9000
EXPOSE 9001
ENTRYPOINT ["docker-entrypoint.sh"]
