# syntax=docker/dockerfile:1.6

ARG AIO_BASE_IMAGE=ghcr.io/agent-infra/sandbox:1.0.0.152

FROM --platform=$BUILDPLATFORM node:20-bookworm AS node-build
WORKDIR /src

RUN corepack enable

COPY package.json pnpm-lock.yaml tsconfig.json ./
COPY src ./src

RUN pnpm install --frozen-lockfile --ignore-scripts \
  && pnpm build \
  && pnpm prune --prod --ignore-scripts

FROM --platform=$BUILDPLATFORM rust:1.85-bookworm AS rust-build
WORKDIR /work/cli

COPY cli/Cargo.toml cli/Cargo.lock ./
COPY cli/src ./src

ARG BUILDARCH
ARG TARGETARCH
ARG ZIG_VERSION=0.13.0

RUN if [ -f /etc/apt/sources.list ]; then \
      sed -i 's|http://deb.debian.org|https://deb.debian.org|g' /etc/apt/sources.list; \
      sed -i 's|http://security.debian.org|https://security.debian.org|g' /etc/apt/sources.list; \
    fi \
  && if [ -f /etc/apt/sources.list.d/debian.sources ]; then \
      sed -i 's|http://deb.debian.org|https://deb.debian.org|g' /etc/apt/sources.list.d/debian.sources; \
      sed -i 's|http://security.debian.org|https://security.debian.org|g' /etc/apt/sources.list.d/debian.sources; \
    fi

RUN apt-get update -o Acquire::Retries=5 \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    gcc-aarch64-linux-gnu \
    gcc-x86-64-linux-gnu \
    libc6-dev-arm64-cross \
    libc6-dev-amd64-cross \
    xz-utils \
  && rm -rf /var/lib/apt/lists/*

RUN case "$BUILDARCH" in \
    amd64) ZIG_ARCH="x86_64" ;; \
    arm64) ZIG_ARCH="aarch64" ;; \
    *) echo >&2 "Unsupported BUILDARCH: $BUILDARCH"; exit 1 ;; \
  esac \
  && curl -sSL "https://ziglang.org/download/${ZIG_VERSION}/zig-linux-${ZIG_ARCH}-${ZIG_VERSION}.tar.xz" \
    | tar -xJ -C /opt \
  && ln -sf "/opt/zig-linux-${ZIG_ARCH}-${ZIG_VERSION}/zig" /usr/local/bin/zig

RUN rustup target add \
    x86_64-unknown-linux-gnu \
    aarch64-unknown-linux-gnu

RUN cargo install cargo-zigbuild --locked

RUN mkdir -p /.cargo \
  && printf '%s\n' \
    '[target.aarch64-unknown-linux-gnu]' \
    'linker = "aarch64-linux-gnu-gcc"' \
    '' \
    '[target.x86_64-unknown-linux-gnu]' \
    'linker = "x86_64-linux-gnu-gcc"' \
    > /.cargo/config.toml

RUN case "$TARGETARCH" in \
    amd64) RUST_TARGET="x86_64-unknown-linux-gnu" ;; \
    arm64) RUST_TARGET="aarch64-unknown-linux-gnu" ;; \
    *) echo >&2 "Unsupported TARGETARCH: $TARGETARCH"; exit 1 ;; \
  esac \
  && cargo zigbuild --release --target "$RUST_TARGET" \
  && mkdir -p /out \
  && cp "/work/cli/target/${RUST_TARGET}/release/agent-browser" /out/agent-browser

FROM ${AIO_BASE_IMAGE} AS runtime

WORKDIR /opt/agent-browser

RUN mkdir -p /opt/agent-browser/bin /opt/agent-browser/dist

COPY --from=node-build /src/dist ./dist
COPY --from=node-build /src/node_modules ./node_modules
COPY --from=node-build /src/package.json ./package.json
COPY --from=rust-build /out/agent-browser ./bin/agent-browser

RUN chmod +x /opt/agent-browser/bin/agent-browser \
  && ln -sf /opt/agent-browser/bin/agent-browser /usr/local/bin/agent-browser
