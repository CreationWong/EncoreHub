FROM rust:1.83-alpine AS builder
RUN apk add --no-cache musl-dev pkgconfig openssl-dev
WORKDIR /app
COPY Cargo.toml Cargo.lock* ./
COPY crates/ ./crates/
COPY src/ ./src/
RUN cargo build --release

FROM alpine:3.21
RUN apk add --no-cache ca-certificates tzdata libgcc
COPY --from=builder /app/target/release/encorehub-engine /usr/local/bin/encorehub-engine
EXPOSE 50051
CMD ["encorehub-engine"]
