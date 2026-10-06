# 1) build the CMS
FROM node:22-alpine AS web
WORKDIR /web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# 2) build the Go server with the CMS embedded
FROM golang:1.27-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
COPY --from=web /web/dist ./web/dist
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /mume-server ./cmd/server

FROM gcr.io/distroless/static-debian12
COPY --from=build /mume-server /mume-server
EXPOSE 8080
ENTRYPOINT ["/mume-server"]
