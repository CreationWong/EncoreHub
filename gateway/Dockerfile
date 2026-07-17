FROM golang:1.25-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o bin/gateway ./cmd/gateway

FROM alpine:3.21
RUN apk add --no-cache ca-certificates tzdata \
    && addgroup -S encorehub \
    && adduser -S -G encorehub encorehub
COPY --from=builder /app/bin/gateway /usr/local/bin/gateway
USER encorehub
EXPOSE 8080
CMD ["gateway"]
