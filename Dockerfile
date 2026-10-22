# Stage 1
ARG BUILD_FROM=amd64/alpine:3.18
ARG BUILD_PLATFORM=linux/amd64
FROM node:20-alpine AS build_image

# Install dependencies
RUN apk update && \
  apk add --no-cache git && \
  rm -rf /var/cache/apk/*

# Create working directory
RUN mkdir -p /usr/src/app && chown -R node:node /usr/src/app

# Configure user
USER node:node

# Working directory
WORKDIR /usr/src/app

# Source repository to build from. GIT_REF may be a branch name or a tag.
# CI passes the ref that triggered the build. Changing any of the args below
# invalidates the cache exactly like the previously used dynamic ADD did.
ARG GIT_REPO=congatudo/Congatudo
ARG GIT_REF=master
ARG GIT_CACHEBUST=0

# Force cache invalidation
RUN echo "${GIT_CACHEBUST}" > /usr/src/version.json

# Download valetudo
RUN git clone --depth 1 --branch "${GIT_REF}" https://github.com/${GIT_REPO} --single-branch . && \
  (git rev-parse --verify refs/heads/master >/dev/null 2>&1 || git switch -c master)

# Build environment
ENV NODE_ENV=production
ENV PKG_CACHE_PATH=./build_dependencies/pkg

# Install dependencies
RUN npm ci --production=false

# Build openapi schema
RUN npm run build_openapi_schema

# Build frontend
RUN npm run build --workspace=frontend

# Build args
ARG PKG_TARGET=node20-linuxstatic-x64
ARG PKG_OPTIONS=expose-gc,max-heap-size=64

# Build binary
RUN npx pkg \
  --targets "${PKG_TARGET}" \
  --compress Brotli \
  --no-bytecode \
  --public-packages "*" \
  --options "${PKG_OPTIONS}" \
  --output ./build/valetudo \
  backend

# Stage 2
FROM --platform=${BUILD_PLATFORM} ${BUILD_FROM}

# Install dependencies
RUN apk update && \
  apk add --no-cache dumb-init && \
  rm -rf /var/cache/apk/*

# Configure user
RUN addgroup -S node && adduser -S node -G node
RUN mkdir -p /etc/valetudo && chown -R node:node /etc/valetudo
USER node:node

# Working directory
WORKDIR /usr/local/bin

# Copy from build image
COPY --chown=node:node --from=build_image /usr/src/app/build/valetudo ./valetudo

# Exposed ports
EXPOSE 8080
EXPOSE 4010 4030 4050

# Run environment
ENV LANG=C.UTF-8
ENV VALETUDO_CONFIG_PATH=/etc/valetudo/config.json
ENV NODE_ENV=production

# Run binary
CMD ["dumb-init", "valetudo"]
