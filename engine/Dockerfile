FROM rust:1.92-alpine AS builder
RUN apk add --no-cache musl-dev pkgconfig openssl-dev
WORKDIR /build
COPY engine/Cargo.toml engine/Cargo.lock ./
COPY engine/crates/ ./crates/
COPY engine/src/ ./src/
RUN cargo build --release --features standalone --bin encorehub-engine

FROM alpine:3.21
RUN apk add --no-cache ca-certificates tzdata libgcc \
    && addgroup -S encorehub \
    && adduser -S -G encorehub encorehub \
    && mkdir -p /data /opt/encorehub/skills \
    && chown encorehub:encorehub /data
COPY --from=builder /build/target/release/encorehub-engine /usr/local/bin/encorehub-engine
COPY skills/ /opt/encorehub/skills/
RUN chmod -R a-w /opt/encorehub/skills
ENV ENGINE_BIND=0.0.0.0:3000
ENV ENGINE_DB=/data/encorehub.db
ENV ENCOREHUB_SKILLS_DIR=/opt/encorehub/skills
WORKDIR /data
USER encorehub
EXPOSE 3000
CMD ["encorehub-engine"]
